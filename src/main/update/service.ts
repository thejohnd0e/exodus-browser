import {mkdir,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {parseLatestRelease,parseSha256Sums,type LatestRelease} from './release';
import {downloadInstaller} from './download';
import type {UpdateState} from '../../shared/update';

export const UPDATE_API_URL='https://api.github.com/repos/thejohnd0e/exodus-browser/releases/latest';
const REQUEST_TIMEOUT_MS=10000;
const METADATA_LIMIT_BYTES=64*1024;

type Available=Extract<LatestRelease,{kind:'available'}>;

export type UpdateServiceOptions={
  appVersion:string;
  root:string;
  apiUrl?:string;
  fetch:(url:string,init:{signal:AbortSignal;redirect:'manual'})=>Promise<Response>;
  busy:()=>Promise<boolean>;
  runInstaller:(path:string)=>Promise<void>;
  onState:(state:UpdateState)=>void;
};

export class UpdateService {
  private current:UpdateState={state:'idle'};
  private offer:Available|null=null;
  private controller:AbortController|null=null;
  private readyPath:string|null=null;

  constructor(private readonly options:UpdateServiceOptions){}

  state():UpdateState{
    return this.current;
  }

  async check():Promise<UpdateState>{
    this.assertIdle();
    this.set({state:'checking'});
    try{
      const json=await this.fetchMetadata(this.options.apiUrl??UPDATE_API_URL);
      const release=parseLatestRelease(json,this.options.appVersion);
      if(release.kind==='up-to-date'){
        this.offer=null;
        return this.set({state:'up-to-date'});
      }
      this.offer=release;
      return this.set({state:'available',version:release.version,size:release.installer.size});
    }catch(error){
      this.offer=null;
      return this.set({state:'error',code:codeOf(error,'UPDATE_CHECK_FAILED')});
    }
  }

  async download():Promise<UpdateState>{
    if(this.controller)throw Error('UPDATE_BUSY');
    if(this.current.state!=='available'||!this.offer)throw Error('UPDATE_NOT_READY');
    const offer=this.offer;
    const controller=new AbortController();
    this.controller=controller;
    const destinationDir=join(this.options.root,'updates',offer.version);
    try{
      this.set({state:'downloading',version:offer.version,received:0,total:offer.installer.size});
      const expectedSha256=parseSha256Sums(await this.fetchMetadataText(offer.checksumsUrl),offer.installer.name);
      const path=await downloadInstaller({
        url:offer.installer.url,
        expectedSize:offer.installer.size,
        expectedSha256,
        destinationDir,
        fileName:offer.installer.name,
        fetch:this.options.fetch,
        signal:controller.signal,
        onProgress:({received,total})=>{this.set({state:'downloading',version:offer.version,received,total});},
      });
      await this.removeOtherVersions(offer.version);
      this.readyPath=path;
      this.offer=null;
      return this.set({state:'ready',version:offer.version});
    }catch(error){
      await rm(destinationDir,{recursive:true,force:true}).catch(()=>undefined);
      if(controller.signal.aborted&&codeOf(error,'')==='UPDATE_CANCELLED'){
        return this.set({state:'available',version:offer.version,size:offer.installer.size});
      }
      this.offer=null;
      return this.set({state:'error',code:codeOf(error,'UPDATE_DOWNLOAD_FAILED')});
    }finally{
      this.controller=null;
    }
  }

  async cancel():Promise<void>{
    this.controller?.abort();
  }

  async install():Promise<void>{
    if(this.current.state!=='ready'||!this.readyPath)throw Error('UPDATE_NOT_READY');
    if(await this.options.busy())throw Error('UPDATE_BUSY_PROFILES');
    await this.options.runInstaller(this.readyPath);
  }

  private assertIdle():void{
    if(this.controller||this.current.state==='checking'||this.current.state==='downloading')throw Error('UPDATE_BUSY');
  }

  private set(state:UpdateState):UpdateState{
    this.current=state;
    this.options.onState(state);
    return state;
  }

  private async fetchMetadata(url:string):Promise<unknown>{
    return JSON.parse(await this.fetchMetadataText(url));
  }

  private async fetchMetadataText(url:string):Promise<string>{
    const response=await this.options.fetch(url,{signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS),redirect:'manual'}).catch(()=>{throw Error('UPDATE_CHECK_FAILED');});
    if(!response.ok)throw Error('UPDATE_CHECK_FAILED');
    const bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length>METADATA_LIMIT_BYTES)throw Error('UPDATE_INVALID_RELEASE');
    return bytes.toString('utf8');
  }

  private async removeOtherVersions(keep:string):Promise<void>{
    const base=join(this.options.root,'updates');
    await mkdir(base,{recursive:true});
    for(const entry of await readdir(base)){
      if(entry!==keep)await rm(join(base,entry),{recursive:true,force:true});
    }
  }
}

function codeOf(error:unknown,fallback:string):string{
  return error instanceof Error&&/^UPDATE_[A-Z_]+$/.test(error.message)?error.message:fallback;
}
