import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {access,mkdir,mkdtemp,readdir,rename,rm,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

/** Google's own offline installer, published for enterprise deployment. */
export const BRANDED_ENGINE_URL='https://dl.google.com/dl/chrome/install/googlechromestandaloneenterprise64.msi';
const MIN_ARCHIVE_BYTES=50*1024**2;
const MAX_ARCHIVE_BYTES=400*1024**2;

export type BrandedEngineRecord={version:string;executable:string;sha256:string};

export type BrandedDeps={
  download:(url:string,destination:string,onBytes?:(received:number,total:number|null)=>void)=>Promise<void>;
  sevenZip:string;
  run?:(executable:string,args:string[])=>Promise<void>;
  verify?:(executable:string)=>Promise<{trusted:boolean;version:string|null}>;
  onProgress?:(progress:{stage:'download'|'extract'|'verify';received?:number;total?:number|null})=>void;
};

async function sha256File(file:string){
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(file))hash.update(chunk);
  return hash.digest('hex');
}

async function runProcess(executable:string,args:string[]){
  await new Promise<void>((resolve,reject)=>{
    const child=spawn(executable,args,{stdio:'ignore',windowsHide:true});
    child.once('error',reject);
    child.once('exit',code=>code===0?resolve():reject(Error('ENGINE_EXTRACT_FAILED')));
  });
}

/**
 * Authenticode check instead of a pinned hash: Google rebuilds the binary with every
 * release, so a hash would break on each update while the signature stays valid.
 */
async function verifySignature(executable:string){
  const script=String.raw`$s=Get-AuthenticodeSignature -LiteralPath $env:EXODUS_ENGINE
if($s.Status -ne 'Valid'){ exit 2 }
if($s.SignerCertificate.Subject -notlike '*O=Google LLC*'){ exit 3 }
exit 0`;
  const windowsPowerShellModules=join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','Modules');
  const code=await new Promise<number|null>((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{
      // Windows PowerShell loads type data from every directory in PSModulePath. When
      // PowerShell 7 is installed its Security module collides with the 5.1 one, so the
      // module fails to load and every signature would look invalid.
      env:{
        SystemRoot:process.env.SystemRoot,windir:process.env.SystemRoot,PATH:process.env.PATH,
        PSModulePath:windowsPowerShellModules,TEMP:process.env.TEMP,TMP:process.env.TMP,
        EXODUS_ENGINE:executable,
      },stdio:'ignore',windowsHide:true,
    });
    child.once('error',reject);
    child.once('close',resolve);
  });
  return {trusted:code===0,version:null};
}

/**
 * Downloads Google's offline installer and unpacks the browser out of it without
 * touching the system installation. The MSI is a wrapper around nested archives:
 * msi -> Binary.GoogleChromeInstaller -> updater.7z -> *_chrome_installer.exe -> chrome.7z.
 */
export async function installBrandedEngine(root:string,deps:BrandedDeps):Promise<BrandedEngineRecord>{
  const stage=await mkdtemp(join(root,'.branded-'));
  try{
    const run=deps.run??runProcess;
    const verify=deps.verify??verifySignature;
    const msi=join(stage,'chrome.msi');
    await deps.download(BRANDED_ENGINE_URL,msi,(received,total)=>deps.onProgress?.({stage:'download',received,total}));
    const size=(await stat(msi)).size;
    if(size<MIN_ARCHIVE_BYTES||size>MAX_ARCHIVE_BYTES)throw Error('ENGINE_DOWNLOAD_FAILED');
    deps.onProgress?.({stage:'extract'});

    const payload=join(stage,'payload');await mkdir(payload);
    await run(deps.sevenZip,['e',msi,`-o${payload}`,'-y','Binary.GoogleChromeInstaller']);
    await run(deps.sevenZip,['e',join(payload,'Binary.GoogleChromeInstaller'),`-o${payload}`,'-y']);
    await run(deps.sevenZip,['e',join(payload,'updater.7z'),`-o${payload}`,'-y','-r','*_chrome_installer.exe']);
    const installer=(await readdir(payload)).find(name=>/_chrome_installer\.exe$/i.test(name));
    if(!installer)throw Error('ENGINE_EXTRACT_FAILED');
    const versionFromName=/^(\d+\.\d+\.\d+\.\d+)_chrome_installer\.exe$/i.exec(installer)?.[1]??null;
    await run(deps.sevenZip,['e',join(payload,installer),`-o${payload}`,'-y']);

    const appDir=join(stage,'app');await mkdir(appDir);
    await run(deps.sevenZip,['x',join(payload,'chrome.7z'),`-o${appDir}`,'-y']);
    const executable=join(appDir,'Chrome-bin','chrome.exe');
    await access(executable);

    deps.onProgress?.({stage:'verify'});
    const {trusted,version}=await verify(executable);
    if(!trusted)throw Error('ENGINE_UNTRUSTED');
    const resolved=version??versionFromName;
    if(!resolved)throw Error('ENGINE_UNTRUSTED');

    const destination=join(root,'branded',resolved);
    await rm(destination,{recursive:true,force:true});
    await mkdir(join(root,'branded'),{recursive:true});
    await rename(appDir,destination);
    const record:BrandedEngineRecord={version:resolved,executable:join(destination,'Chrome-bin','chrome.exe'),sha256:await sha256File(join(destination,'Chrome-bin','chrome.exe'))};
    await writeFile(join(root,'branded.json'),JSON.stringify(record));
    await rm(join(root,'external.json'),{force:true});
    return record;
  }finally{
    await rm(stage,{recursive:true,force:true}).catch(()=>undefined);
  }
}

/**
 * Deletes engine versions other than the active one after an update has been activated. Only
 * directories that look like a Chrome version are touched, and a missing directory is fine; the
 * caller guarantees no profile browser is running when it calls this.
 */
export async function removeOtherBrandedVersions(root:string,keep:string):Promise<void>{
  let entries:string[];
  try{entries=await readdir(join(root,'branded'));}catch{return;}
  for(const entry of entries){
    if(entry!==keep&&/^\d+\.\d+\.\d+\.\d+$/.test(entry))await rm(join(root,'branded',entry),{recursive:true,force:true}).catch(()=>undefined);
  }
}
