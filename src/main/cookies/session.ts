import {MAX_COOKIE_EXPIRY} from '../../shared/cookies';
import {spawn,type ChildProcess} from 'node:child_process';
import type {CookieInput} from '../../shared/cookies';
import {CdpClient} from '../cdp/client';
import {waitForDevtools} from '../engines/devtools';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function cookieArgs(userDataDir: string): string[] {
  return [
    '--headless=new',
    '--user-data-dir=' + userDataDir,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-domain-reliability',
    '--disable-sync',
    '--no-pings',
    '--metrics-recording-only',
    '--host-resolver-rules=MAP * ~NOTFOUND',
    '--proxy-server=http://127.0.0.1:9',
    '--proxy-bypass-list=<-loopback>',
    'about:blank',
  ];
}

type CookieCdp = Pick<CdpClient, 'send' | 'close'>;
export interface CookieSession {
  setCookie(cookie: CookieInput): Promise<void>;
  getCookies(): Promise<CookieInput[]>;
  clearCookies():Promise<void>;
  getRawCookieCount():Promise<number>;
  close(): Promise<void>;
}

const sameSiteToCdp = (value: CookieInput['sameSite']): 'None' | 'Lax' | 'Strict' | undefined =>
  value === 'no_restriction' ? 'None' : value === 'lax' ? 'Lax' : value === 'strict' ? 'Strict' : undefined;
const sameSiteFromCdp = (value: unknown): CookieInput['sameSite'] =>
  value === 'None' ? 'no_restriction' : value === 'Lax' ? 'lax' : value === 'Strict' ? 'strict' : 'unspecified';

export async function openCookieSession({client, close}: {client: CookieCdp; close: () => Promise<void>}): Promise<CookieSession> {
  let pageSession: string | null = null;
  const page = async (): Promise<string> => {
    if (pageSession) return pageSession;
    const deadline = Date.now() + 5000;
    for (;;) {
      const {targetInfos} = await client.send<{targetInfos: Array<{targetId: string; type: string}>}>('Target.getTargets', {});
      const target = targetInfos.find(item => item.type === 'page');
      if (target) {
        const attached = await client.send<{sessionId: string}>('Target.attachToTarget', {targetId: target.targetId, flatten: true});
        pageSession = attached.sessionId;
        return pageSession;
      }
      if (Date.now() >= deadline) throw Error('COOKIES_SESSION_FAILED');
      await sleep(50);
    }
  };
  return {
    async setCookie(cookie) {
      const sessionId = await page();
      const params: Record<string, unknown> = {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
      };
      const sameSite = sameSiteToCdp(cookie.sameSite);
      if (sameSite) params.sameSite = sameSite;
      if (cookie.expirationDate !== null) params.expires = cookie.expirationDate;
      await client.send('Network.setCookies', {cookies: [params]}, sessionId);
    },
    async getCookies() {
      const {cookies} = await client.send<{cookies: Array<Record<string, unknown>>}>('Storage.getCookies', {});
      return cookies
        .filter(cookie => !cookie.partitionKey)
        .map(cookie => ({
          domain: String(cookie.domain ?? ''),
          name: String(cookie.name ?? ''),
          path: String(cookie.path ?? '/'),
          value: String(cookie.value ?? ''),
          expirationDate: typeof cookie.expires === 'number' && cookie.expires > 0 ? Math.min(Math.floor(cookie.expires), MAX_COOKIE_EXPIRY) : null,
          httpOnly: cookie.httpOnly === true,
          secure: cookie.secure === true,
          sameSite: sameSiteFromCdp(cookie.sameSite),
          storeId: '0',
        }));
    },
    async clearCookies(){await client.send('Storage.clearCookies',{});},
    async getRawCookieCount(){const {cookies}=await client.send<{cookies:Array<Record<string,unknown>>}>('Storage.getCookies',{});return cookies.length;},
    async close() {
      await close();
    },
  };
}

export async function launchCookieBrowser({executable, userDataDir}: {executable: string; userDataDir: string}): Promise<{client: CdpClient; close: () => Promise<void>}> {
  const child = spawn(executable, cookieArgs(userDataDir), {shell: false, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true});
  let exited = false;
  const exit = new Promise<void>(resolve => {
    child.once('exit', () => {
      exited = true;
      resolve();
    });
    child.once('error', () => {
      exited = true;
      resolve();
    });
  });
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  const url = await waitForDevtools(child);
  if (!url) {
    if (!exited && child.exitCode === null && !child.killed) child.kill();
    throw Error('COOKIES_SESSION_FAILED');
  }
  let client: CdpClient;
  try {
    client = await CdpClient.connect(url);
  } catch {
    if (!exited && child.exitCode === null && !child.killed) child.kill();
    throw Error('COOKIES_SESSION_FAILED');
  }
  const close = async () => {
    try {
      await client.send('Browser.close', {});
    } catch {
      /* browser may already be gone */
    }
    await Promise.race([exit, sleep(10000)]);
    client.close();
    if (!exited && child.exitCode === null && !child.killed) child.kill();
    await Promise.race([exit, sleep(5000)]);
  };
  return {client, close};
}
