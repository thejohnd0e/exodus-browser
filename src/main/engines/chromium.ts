import {access,mkdir,readFile,writeFile,rename,rm,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {languagesSchema} from '../../shared/validation';
import {DEFAULT_FINGERPRINT,type Fingerprint} from '../../shared/fingerprint';
import {spawn,execFile,type ChildProcess} from 'node:child_process';
import {promisify} from 'node:util';
import type {BrowserEngineAdapter,EngineLaunch,EngineProcess} from './types';
import {fingerprintArgs,seedFor} from './fingerprint';
import {CdpClient} from '../cdp/client';
import {waitForDevtools} from './devtools';
import {installFingerprint} from '../cdp/fingerprint';
import {SessionTracker} from '../sessions/tracker';
export function chromiumArgs(input:EngineLaunch){const fingerprint=input.fingerprint??DEFAULT_FINGERPRINT;return [
  '--user-data-dir='+input.userDataDir,'--lang='+input.languages[0],'--no-first-run','--no-default-browser-check','--hide-crash-restore-bubble','--remote-debugging-pipe','--disable-blink-features=AutomationControlled','--test-type','--disable-infobars',
  ...(input.proxyUrl?['--proxy-server='+input.proxyUrl,'--proxy-bypass-list=<-loopback>']:[]),
  ...fingerprintArgs(fingerprint,{proxied:Boolean(input.proxyUrl)}),
  // Diagnostics for CI only: EXODUS_CHROME_LOG_DIR makes each launch write its own Chromium log file.
  ...(process.env.EXODUS_CHROME_LOG_DIR?['--enable-logging','--v=0','--log-file='+join(process.env.EXODUS_CHROME_LOG_DIR,input.profileId+'-'+Date.now()+'.log')]:[]),
  'about:blank'
];}
export async function prepareProfilePreferences(input:{userDataDir:string;languages:string[]}){
  const languages=languagesSchema.parse(input.languages);const dir=join(input.userDataDir,'Default');
  try{const info=await lstat(dir);if(info.isSymbolicLink()||!info.isDirectory())throw Error('UNSAFE_PROFILE_FILE');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  await mkdir(dir,{recursive:true});const file=join(dir,'Preferences');let prefs:Record<string,unknown>={};
  try{if((await lstat(file)).isSymbolicLink())throw Error('UNSAFE_PROFILE_FILE');prefs=JSON.parse(await readFile(file,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(!prefs||typeof prefs!=='object'||Array.isArray(prefs))throw Error('INVALID_PREFERENCES');
  const intl=prefs.intl;if(intl!==undefined&&(!intl||typeof intl!=='object'||Array.isArray(intl)))throw Error('INVALID_PREFERENCES');
  prefs.intl={...(intl as Record<string,unknown>|undefined),accept_languages:languages.join(','),selected_languages:languages.join(',')};
  // Chromium must never restore its own tabs: Exodus restores the saved URLs itself, and doing both
  // duplicated every tab. `restore_on_startup` 5 ("continue where you left off") was the usual cause.
  const session=prefs.session;const sessionRecord=session&&typeof session==='object'&&!Array.isArray(session)?session as Record<string,unknown>:{};
  prefs.session={...sessionRecord,restore_on_startup:1,startup_urls:[],restore_on_startup_migrated:true};
  const profile=prefs.profile;const profileRecord=profile&&typeof profile==='object'&&!Array.isArray(profile)?profile as Record<string,unknown>:{};
  prefs.profile={...profileRecord,exit_type:'Normal',exited_cleanly:true};
  const partial=file+'.partial-'+randomUUID();try{await writeFile(partial,JSON.stringify(prefs),{flag:'wx'});await rename(partial,file);}finally{await rm(partial,{force:true});}
  await seedPasswordCheck(input.userDataDir);
}
/**
 * On Windows, Chrome probes whether the account has a blank password by calling LogonUser with an
 * empty password (password_manager_util_win.cc, CheckBlankPasswordWithPrefs). With a real password
 * every probe is a failed logon (Security event 4625), and a fresh user data directory probes on
 * its first start, so creating or testing several profiles locked the Windows account (4740).
 * Chrome skips the probe while Local State holds a password_manager.os_password_last_changed that
 * is not older than the password, so it is set to the largest value before every launch; Chrome
 * then stores the real date itself. The account is assumed to have a password. See DECISIONS #84.
 */
export const PASSWORD_CHECK_SEED={os_password_blank:false,os_password_last_changed:'9223372036854775807'};
export async function seedPasswordCheck(userDataDir:string){
  if(process.platform!=='win32')return;
  const file=join(userDataDir,'Local State');let state:Record<string,unknown>={};
  try{if((await lstat(file)).isSymbolicLink())throw Error('UNSAFE_PROFILE_FILE');state=JSON.parse(await readFile(file,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(!state||typeof state!=='object'||Array.isArray(state))throw Error('INVALID_PREFERENCES');
  const current=state.password_manager;const record=current&&typeof current==='object'&&!Array.isArray(current)?current as Record<string,unknown>:{};
  state.password_manager={...record,...PASSWORD_CHECK_SEED};
  const partial=file+'.partial-'+randomUUID();try{await writeFile(partial,JSON.stringify(state),{flag:'wx'});await rename(partial,file);}finally{await rm(partial,{force:true});}
}
async function closeMainWindow(executable:string,pid:number|undefined,dir:string){
  if(process.platform!=='win32'||!pid)return false;
  const data=Buffer.from(JSON.stringify({pid,exe:executable,dir})).toString('base64');
  const command=`$d=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}'))|ConvertFrom-Json; $p=Get-CimInstance Win32_Process -Filter (\"ProcessId=\"+$d.pid); if($p -and $p.ExecutablePath -eq $d.exe -and $p.CommandLine.Contains($d.dir)){ $x=Get-Process -Id $d.pid; [void]$x.CloseMainWindow() }`;
  await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:10000});
  return true;
}
export class ChromiumAdapter implements BrowserEngineAdapter {
  capabilities={fingerprints:true as const};
  constructor(private resolveExecutable:string|(()=>string|Promise<string>),private connect?:(inStream:NodeJS.WritableStream,outStream:NodeJS.ReadableStream)=>Promise<CdpClient>|CdpClient){}
  private async executable(){return typeof this.resolveExecutable==='function'?await this.resolveExecutable():this.resolveExecutable;}
  async validate(){await access(await this.executable());}
  private async dispose(child:ChildProcess,client:CdpClient|null,exit:Promise<unknown>){
    try{await client?.send('Browser.close',{});}catch{/* browser may be unreachable */}
    try{await Promise.race([exit,new Promise(resolve=>setTimeout(resolve,5000))]);}catch{/* ignore */}
    client?.close();
    if(child.exitCode===null&&!child.killed)child.kill();
    await Promise.race([exit,new Promise(resolve=>setTimeout(resolve,5000))]);
  }
  async launch(input:EngineLaunch):Promise<EngineProcess>{
    await this.validate();await mkdir(input.userDataDir,{recursive:true});await prepareProfilePreferences(input);
    const executable=await this.executable();
    const fingerprint=input.fingerprint??DEFAULT_FINGERPRINT;
    const child=spawn(executable,chromiumArgs({...input,fingerprint}),{shell:false,stdio:['ignore','ignore','pipe','pipe','pipe'],windowsHide:false});
    let exited=false;let tracker:SessionTracker|undefined;
    const exit=new Promise<{code:number|null;signal:string|null}>((resolve)=>{const finish=(result:{code:number|null;signal:string|null})=>{exited=true;void(async()=>{await tracker?.flush(true).catch(()=>undefined);tracker?.dispose();resolve(result);})();};child.once('exit',(code,signal)=>finish({code,signal}));child.once('error',()=>finish({code:1,signal:null}));});
    await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    let client:CdpClient|null=null;
    let session:import('../cdp/fingerprint').FingerprintSession;
    try{
      const inStream=child.stdio[3] as NodeJS.WritableStream;
      const outStream=child.stdio[4] as NodeJS.ReadableStream;
      if(!inStream||!outStream)throw Error('FINGERPRINT_UNAVAILABLE');
      client=await (this.connect?this.connect(inStream,outStream):CdpClient.fromPipe(inStream,outStream));
      if(input.onSessionSnapshot){
        tracker=new SessionTracker(input.onSessionSnapshot);
        client.onEvent(message=>tracker?.onEvent(message));
        await client.send('Target.setDiscoverTargets',{discover:true});
      }
      const {targetInfos}=await client.send<{targetInfos:Array<{targetId:string;type:string;url?:string}>}>('Target.getTargets',{});
      for(const target of targetInfos)tracker?.onEvent({method:'Target.targetCreated',params:{targetInfo:target}});
      let engineUserAgent:string|undefined;let engineVersion:string|undefined;
      try{const version=await client.send<{userAgent:string;product?:string}>('Browser.getVersion',{});engineUserAgent=version.userAgent;engineVersion=version.product?.split('/')[1];}catch{/* hints stay derived from the chosen UA */}
      const installed=await installFingerprint(client,{fingerprint,languages:input.languages,seed:input.fingerprintSeed??seedFor(input.profileId),engineUserAgent,engineVersion,strict:fingerprint.strictProtection===true,onPageFailure:(_reason,outcome)=>input.onProtectionFailure?.(outcome)});
      session=installed;
      // Google Chrome ignores --load-extension, so the enabled copies are loaded through the pipe
      // (Extensions.loadUnpacked) before the first page opens. A failure is not skipped: a profile
      // that silently runs without its content blocker is worse than one that does not start.
      for(const dir of input.extensionDirs??[]){
        try{await client.send('Extensions.loadUnpacked',{path:dir});}catch{throw Error('EXTENSION_LOAD_FAILED');}
      }
      await session.navigate(input.startUrls);
      await session.ready();
    }catch(error){tracker?.dispose();await this.dispose(child,client,exit);throw Error(error instanceof Error&&error.message==='EXTENSION_LOAD_FAILED'?'EXTENSION_LOAD_FAILED':'FINGERPRINT_UNAVAILABLE');}
    const cdp=client;
    const startedAt=new Date().toISOString();
    const browser:import('./types').EngineBrowser={
      pages:async()=>(await session.pages()).map(target=>({targetId:target.targetId,url:target.url})),
      attach:targetId=>session.attach(targetId),
      send:(method,params,sessionId,timeoutMs)=>cdp.send(method,params,sessionId,timeoutMs),
    };
    return {pid:child.pid!,executable,startedAt,exit,browser,stop:async()=>{
      if(exited)return;
      try{const {targetInfos}=await cdp.send<{targetInfos:Array<{targetId:string;type:string;url?:string}>}>('Target.getTargets',{});tracker?.updateTargets(targetInfos);}catch{/* Keep the latest observed snapshot if CDP is already closing. */}
      await tracker?.flush();
      tracker?.dispose();
      try{await cdp.send('Browser.close',{});}catch{await closeMainWindow(executable,child.pid,input.userDataDir).catch(()=>undefined);}
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{await Promise.race([exit,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('STOP_TIMEOUT')),10000);})]);}
      catch{await closeMainWindow(executable,child.pid,input.userDataDir).catch(()=>undefined);await Promise.race([exit,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('STOP_TIMEOUT')),10000);})]);}
      finally{clearTimeout(timer);cdp.close();}
    }};
  }
}
