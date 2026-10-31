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
  '--user-data-dir='+input.userDataDir,'--lang='+input.languages[0],'--no-first-run','--no-default-browser-check','--remote-debugging-port=0',
  ...(input.proxyUrl?['--proxy-server='+input.proxyUrl,'--proxy-bypass-list=<-loopback>']:[]),
  ...(input.extensionDirs?.length?['--disable-extensions-except='+input.extensionDirs.join(','),'--load-extension='+input.extensionDirs.join(',')]:[]),
  ...fingerprintArgs(fingerprint),
  'about:blank'
];}
async function applyLanguages(input:EngineLaunch){
  const languages=languagesSchema.parse(input.languages);const dir=join(input.userDataDir,'Default');
  try{const info=await lstat(dir);if(info.isSymbolicLink()||!info.isDirectory())throw Error('UNSAFE_PROFILE_FILE');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  await mkdir(dir,{recursive:true});const file=join(dir,'Preferences');let prefs:Record<string,unknown>={};
  try{if((await lstat(file)).isSymbolicLink())throw Error('UNSAFE_PROFILE_FILE');prefs=JSON.parse(await readFile(file,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(!prefs||typeof prefs!=='object'||Array.isArray(prefs))throw Error('INVALID_PREFERENCES');
  const intl=prefs.intl;if(intl!==undefined&&(!intl||typeof intl!=='object'||Array.isArray(intl)))throw Error('INVALID_PREFERENCES');
  prefs.intl={...(intl as Record<string,unknown>|undefined),accept_languages:languages.join(','),selected_languages:languages.join(',')};
  const partial=file+'.partial-'+randomUUID();try{await writeFile(partial,JSON.stringify(prefs),{flag:'wx'});await rename(partial,file);}finally{await rm(partial,{force:true});}
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
  constructor(private resolveExecutable:string|(()=>string|Promise<string>),private connect:(url:string)=>Promise<CdpClient>=(url)=>CdpClient.connect(url)){}
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
    await this.validate();await mkdir(input.userDataDir,{recursive:true});await applyLanguages(input);
    const executable=await this.executable();
    const fingerprint=input.fingerprint??DEFAULT_FINGERPRINT;
    const child=spawn(executable,chromiumArgs({...input,fingerprint}),{shell:false,stdio:['ignore','ignore','pipe'],windowsHide:false});
    let exited=false;let tracker:SessionTracker|undefined;
    const exit=new Promise<{code:number|null;signal:string|null}>((resolve)=>{const finish=(result:{code:number|null;signal:string|null})=>{exited=true;void(async()=>{await tracker?.flush(true).catch(()=>undefined);tracker?.dispose();resolve(result);})();};child.once('exit',(code,signal)=>finish({code,signal}));child.once('error',()=>finish({code:1,signal:null}));});
    await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    let client:CdpClient|null=null;
    try{
      const url=await waitForDevtools(child);
      if(!url)throw Error('FINGERPRINT_UNAVAILABLE');
      client=await this.connect(url);
      if(input.onSessionSnapshot){
        tracker=new SessionTracker(input.onSessionSnapshot);
        client.onEvent(message=>tracker?.onEvent(message));
        await client.send('Target.setDiscoverTargets',{discover:true});
      }
      const {targetInfos}=await client.send<{targetInfos:Array<{targetId:string;type:string;url?:string}>}>('Target.getTargets',{});
      for(const target of targetInfos)tracker?.onEvent({method:'Target.targetCreated',params:{targetInfo:target}});
      let engineUserAgent:string|undefined;
      try{engineUserAgent=(await client.send<{userAgent:string}>('Browser.getVersion',{})).userAgent;}catch{/* hints stay derived from the chosen UA */}
      const session=await installFingerprint(client,{fingerprint,languages:input.languages,seed:input.fingerprintSeed??seedFor(input.profileId),engineUserAgent});
      await session.navigate(input.startUrls);
    }catch(error){tracker?.dispose();await this.dispose(child,client,exit);throw Error('FINGERPRINT_UNAVAILABLE');}
    const cdp=client;
    const startedAt=new Date().toISOString();
    return {pid:child.pid!,executable,startedAt,exit,stop:async()=>{
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
