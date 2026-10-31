import {createHash} from 'node:crypto';
import {mkdir,open,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {MAX_INSTALLER_BYTES} from './release';

const MAX_REDIRECTS=5;

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
};

export function isAllowedHost(url:string):boolean{
  let parsed:URL;
  try{parsed=new URL(url);}catch{return false;}
  if(parsed.protocol!=='https:')return false;
  return parsed.hostname==='github.com'||parsed.hostname.endsWith('.githubusercontent.com');
}

export async function downloadInstaller(options:DownloadOptions):Promise<string>{
  const finalPath=join(options.destinationDir,options.fileName);
  const partialPath=`${finalPath}.partial`;
  await mkdir(options.destinationDir,{recursive:true});
  if(!isAllowedHost(options.url))throw Error('UPDATE_UNTRUSTED_REDIRECT');
  if(options.signal.aborted)throw Error('UPDATE_CANCELLED');
  const response=await fetchAllowed(options);
  const handle=await open(partialPath,'wx').catch(()=>{throw Error('UPDATE_DOWNLOAD_FAILED');});
  let finished=false;
  try{
    const hash=createHash('sha256');
    let received=0;
    const reader=response.body?.getReader();
    if(!reader)throw Error('UPDATE_DOWNLOAD_FAILED');
    const onAbort=()=>{void reader.cancel().catch(()=>undefined);};
    options.signal.addEventListener('abort',onAbort,{once:true});
    try{
      for(;;){
        const {done,value}=await reader.read().catch(()=>{throw Error(options.signal.aborted?'UPDATE_CANCELLED':'UPDATE_DOWNLOAD_FAILED');});
        if(done)break;
        received+=value.length;
        if(received>options.expectedSize||received>MAX_INSTALLER_BYTES)throw Error('UPDATE_TOO_LARGE');
        if(options.signal.aborted)throw Error('UPDATE_CANCELLED');
        hash.update(value);
        await handle.write(value);
        options.onProgress({received,total:options.expectedSize});
      }
    }finally{
      options.signal.removeEventListener('abort',onAbort);
    }
    if(options.signal.aborted)throw Error('UPDATE_CANCELLED');
    if(received!==options.expectedSize)throw Error('UPDATE_DOWNLOAD_FAILED');
    if(hash.digest('hex')!==options.expectedSha256)throw Error('UPDATE_CHECKSUM_MISMATCH');
    await handle.close();
    await rename(partialPath,finalPath);
    finished=true;
    return finalPath;
  }finally{
    if(!finished){
      await handle.close().catch(()=>undefined);
      await rm(partialPath,{force:true});
    }
  }
}

async function fetchAllowed(options:DownloadOptions):Promise<Response>{
  let target=options.url;
  for(let redirects=0;;redirects++){
    const response=await options.fetch(target,{signal:options.signal,redirect:'manual'}).catch(()=>{
      throw Error(options.signal.aborted?'UPDATE_CANCELLED':'UPDATE_DOWNLOAD_FAILED');
    });
    if(response.status>=300&&response.status<400){
      const location=response.headers.get('location');
      if(!location||redirects>=MAX_REDIRECTS)throw Error('UPDATE_DOWNLOAD_FAILED');
      const next=new URL(location,target).toString();
      if(!isAllowedHost(next))throw Error('UPDATE_UNTRUSTED_REDIRECT');
      target=next;
      continue;
    }
    if(!response.ok)throw Error('UPDATE_DOWNLOAD_FAILED');
    return response;
  }
}
