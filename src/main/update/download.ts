import {createHash} from 'node:crypto';
import {mkdir,open,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {isAllowedHost,MAX_INSTALLER_BYTES} from './hosts';

export {isAllowedHost} from './hosts';

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
  isAllowedUrl?:(url:string)=>boolean;
};

export async function downloadInstaller(options:DownloadOptions):Promise<string>{
  const finalPath=join(options.destinationDir,options.fileName);
  const partialPath=`${finalPath}.partial`;
  await mkdir(options.destinationDir,{recursive:true});
  const allowed=options.isAllowedUrl??isAllowedHost;
  if(!allowed(options.url))throw Error('UPDATE_UNTRUSTED_REDIRECT');
  if(options.signal.aborted)throw Error('UPDATE_CANCELLED');
  const response=await fetchAllowedRedirects({url:options.url,signal:options.signal,fetch:options.fetch,isAllowedUrl:allowed});
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

export type DownloadFetch=(url:string,init:{signal:AbortSignal;redirect:'manual'})=>Promise<Response>;

export async function fetchAllowedRedirects(request:{url:string;signal:AbortSignal;fetch:DownloadFetch;isAllowedUrl:(url:string)=>boolean}):Promise<Response>{
  let target=request.url;
  for(let redirects=0;;redirects++){
    const response=await request.fetch(target,{signal:request.signal,redirect:'manual'}).catch(()=>{
      throw Error(request.signal.aborted?'UPDATE_CANCELLED':'UPDATE_DOWNLOAD_FAILED');
    });
    if(response.status>=300&&response.status<400){
      const location=response.headers.get('location');
      if(!location||redirects>=MAX_REDIRECTS)throw Error('UPDATE_DOWNLOAD_FAILED');
      const next=new URL(location,target).toString();
      if(!request.isAllowedUrl(next))throw Error('UPDATE_UNTRUSTED_REDIRECT');
      target=next;
      continue;
    }
    if(!response.ok)throw Error('UPDATE_DOWNLOAD_FAILED');
    return response;
  }
}
