import {randomUUID} from 'node:crypto';
import {basename} from 'node:path';
import {writeFile,rename,rm,access} from 'node:fs/promises';
import {cookieKey,isExpiredCookie} from '../../shared/cookies';
import type {CdpClient} from '../cdp/client';
import {probeProfileProcesses,type ProcessRecord} from '../runtime/recovery';
import {profilePath} from '../profiles/paths';
import {ProfileService} from '../profiles/service';
import {readCookieFile,parseCookies,type CookieFormat} from './parse';
import {serializeCookies} from './serialize';
import {launchCookieBrowser,openCookieSession,type CookieSession} from './session';

type Launched = {client: Pick<CdpClient, 'send' | 'close'>; close: () => Promise<void>};
type Lease = {withStopped<T>(id: string, fn: () => Promise<T>): Promise<T>};
type Engine = {resolveExecutable(): Promise<string>};
type Deps = {
  probe?: () => Promise<ProcessRecord[]>;
  launch?: (input: {executable: string; userDataDir: string}) => Promise<Launched>;
  now?: () => number;
};
export type CookieResult = {count: number; fileName: string};

export class CookieService {
  private handles = new Set<Launched>();
  private active = new Set<Promise<unknown>>();
  constructor(private profiles: ProfileService, private supervisor: Lease, private engine: Engine, private deps: Deps = {}) {}

  private async session<T>(id: string, fn: (session: CookieSession) => Promise<T>,requireSuccessfulClose=false): Promise<T> {
    const operation = this.supervisor.withStopped(id, async () => {
      const dir = profilePath(this.profiles.root, id);
      const rows = await (this.deps.probe ?? probeProfileProcesses)();
      if (rows.some(row => row.commandLine.toLowerCase().includes(dir.toLowerCase()))) throw Error('ORPHAN_BROWSER');
      let executable: string;
      try {
        executable = await this.engine.resolveExecutable();
        await access(executable);
      } catch {
        throw Error('ENGINE_NOT_READY');
      }
      const launching = (this.deps.launch ?? launchCookieBrowser)({executable, userDataDir: dir}).then(launched => {
        this.handles.add(launched);
        return launched;
      });
      const launched = await launching;
      try {
        const session = await openCookieSession(launched);
        return await fn(session);
      } finally {
        this.handles.delete(launched);
          if(requireSuccessfulClose){try{await launched.close();}catch{throw Error('COOKIE_SESSION_CLOSE_FAILED');}}
          else await launched.close().catch(() => undefined);
      }
    });
    this.active.add(operation);
    try {
      return await operation;
    } finally {
      this.active.delete(operation);
    }
  }

  async importFile(id: string, filePath: string): Promise<CookieResult> {
    const cookies = parseCookies(await readCookieFile(filePath));
    if (!cookies.length) throw Error('INVALID_COOKIE_FILE');
    return this.session(id, async session => {
      for (const cookie of cookies) {
        try {
          await session.setCookie(cookie);
        } catch {
          throw Error('COOKIE_REJECTED_BY_BROWSER');
        }
      }
      const stored = new Set((await session.getCookies()).map(cookieKey));
      if (!cookies.every(cookie => stored.has(cookieKey(cookie)))) throw Error('COOKIES_NOT_PERSISTED');
      return {count: cookies.length, fileName: basename(filePath)};
    });
  }

  async exportFile(id: string, filePath: string, format: CookieFormat): Promise<CookieResult> {
    return this.session(id, async session => {
      const nowSeconds = Math.floor((this.deps.now?.() ?? Date.now()) / 1000);
      const cookies = (await session.getCookies()).filter(cookie => !isExpiredCookie(cookie, nowSeconds));
      const partial = `${filePath}.partial-${randomUUID()}`;
      try {
        await writeFile(partial, serializeCookies(cookies, format), {flag: 'wx'});
        await rename(partial, filePath);
      } catch (error) {
        await rm(partial, {force: true}).catch(() => undefined);
        throw error;
      }
      return {count: cookies.length, fileName: basename(filePath)};
    });
  }

  async clear(id:string):Promise<{cleared:true}>{
    return this.session(id,async session=>{
      try{await session.clearCookies();}catch{throw Error('COOKIE_CLEAR_FAILED');}
      let count:number;try{count=await session.getRawCookieCount();}catch{throw Error('COOKIE_CLEAR_FAILED');}
      if(count!==0)throw Error('COOKIES_NOT_CLEARED');
      return {cleared:true};
    },true);
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled([...this.active]);
    await Promise.allSettled([...this.handles].map(handle => handle.close()));
  }
}
