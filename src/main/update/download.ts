import {createHash} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {mkdir, rename, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {once} from 'node:events';
import {isAllowedHost,MAX_INSTALLER_BYTES} from './hosts';

export {isAllowedHost} from './hosts';

const MAX_REDIRECTS=5;
const DEFAULT_IDLE_TIMEOUT_MS=60000;
const PROGRESS_BYTES=1024*1024;
const PROGRESS_MS=250;

export type DownloadProgress={received:number;total:number};

export type DownloadOptions={
  url:string;
  expectedSize:number;
  expectedSha256:string;
  destinationDir:string;
  fileName:string;
  fetch:(url:string,init:{signal:AbortSignal;redirect:'manual'})=>Promise<Response>;
  signal:AbortSignal;
  onProgress:(progress:DownloadProgress)=>void;
  isAllowedUrl?:(url:string)=>boolean;
  idleTimeoutMs?:number;
};

export async function downloadInstaller(options:DownloadOptions):Promise<string>{
  const finalPath=join(options.destinationDir,options.fileName);
  const partialPath=`${finalPath}.partial`;
  await mkdir(options.destinationDir,{recursive:true});
  const allowed=options.isAllowedUrl??isAllowedHost;
  if(!allowed(options.url))throw Error('UPDATE_UNTRUSTED_REDIRECT');
  if(options.signal.aborted)throw Error('UPDATE_CANCELLED');
  const idleTimeoutMs=options.idleTimeoutMs??DEFAULT_IDLE_TIMEOUT_MS;
  const response=await fetchAllowedRedirects({url:options.url,signal:options.signal,fetch:options.fetch,isAllowedUrl:allowed});
  const writeStream=createWriteStream(partialPath,{flags:'wx'});
  let finished=false;
  const hash=createHash('sha256');
  let received=0;
  let lastReported=0;
  let lastReportedAt=Date.now();
  const reader=response.body?.getReader();
  if(!reader)throw Error('UPDATE_DOWNLOAD_FAILED');
  const onAbort=()=>{void reader.cancel().catch(()=>undefined);};
  options.signal.addEventListener('abort',onAbort,{once:true});
  try{
    for(;;){
      if(options.signal.aborted)throw Error('UPDATE_CANCELLED');
      const {done,value}=await readWithIdleTimeout(reader,idleTimeoutMs,options.signal);
      if(done)break;
      received+=value.length;
      if(received>options.expectedSize||received>MAX_INSTALLER_BYTES)throw Error('UPDATE_TOO_LARGE');
      if(options.signal.aborted)throw Error('UPDATE_CANCELLED');
      hash.update(value);
      const ok=writeStream.write(value);
      if(!ok)await once(writeStream,'drain');
      const now=Date.now();
      if(lastReported===0||received-lastReported>=PROGRESS_BYTES||now-lastReportedAt>=PROGRESS_MS){
        lastReported=received;
        lastReportedAt=now;
        options.onProgress({received,total:options.expectedSize});
      }
    }
    if(options.signal.aborted)throw Error('UPDATE_CANCELLED');
    if(received!==options.expectedSize)throw Error('UPDATE_DOWNLOAD_FAILED');
    if(hash.digest('hex')!==options.expectedSha256)throw Error('UPDATE_CHECKSUM_MISMATCH');
    options.onProgress({received,total:options.expectedSize});
    await new Promise<void>((resolve,reject)=>{writeStream.end((error?:Error|null)=>{if(error)reject(error);else resolve();});});
    await rename(partialPath,finalPath);
    finished=true;
    return finalPath;
  }catch(error){
    writeStream.destroy();
    await rm(partialPath,{force:true}).catch(()=>undefined);
    throw error;
  }finally{
    options.signal.removeEventListener('abort',onAbort);
    if(!finished){
      await reader.cancel().catch(()=>undefined);
      await rm(partialPath,{force:true}).catch(()=>undefined);
    }
  }
}

async function readWithIdleTimeout(reader:ReadableStreamDefaultReader<Uint8Array>,idleTimeoutMs:number,signal:AbortSignal):Promise<ReadableStreamReadResult<Uint8Array>>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  const timeoutPromise=new Promise<never>((_resolve,reject)=>{
    timer=setTimeout(()=>reject(new Error('UPDATE_DOWNLOAD_STALLED')),idleTimeoutMs);
  });
  try{
    const result=await Promise.race([reader.read(),timeoutPromise]);
    if(timer)clearTimeout(timer);
    return result;
  }catch(error){
    if(timer)clearTimeout(timer);
    if(signal.aborted)throw new Error('UPDATE_CANCELLED');
    throw error;
  }
}

export async function fetchAllowedRedirects(request:{url:string;signal:AbortSignal;fetch:(url:string,init:{signal:AbortSignal;redirect:'manual'})=>Promise<Response>;isAllowedUrl:(url:string)=>boolean}):Promise<Response>{
  let target=request.url;
  let redirects=0;
  for(;;){
    const response=await request.fetch(target,{signal:request.signal,redirect:'manual'}).catch(()=>{throw Error(request.signal.aborted?'UPDATE_CANCELLED':'UPDATE_DOWNLOAD_FAILED');});
    if(response.status>=300&&response.status<400){
      const location=response.headers.get('location');
      await response.body?.cancel().catch(()=>undefined);
      if(!location||redirects>=MAX_REDIRECTS)throw Error('UPDATE_DOWNLOAD_FAILED');
      const next=new URL(location,target).toString();
      if(!request.isAllowedUrl(next))throw Error('UPDATE_UNTRUSTED_REDIRECT');
      target=next;
      redirects++;
      continue;
    }
    if(!response.ok){
      await response.body?.cancel().catch(()=>undefined);
      throw Error('UPDATE_DOWNLOAD_FAILED');
    }
    return response;
  }
}
