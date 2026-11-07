import {createHash,randomUUID} from 'node:crypto';
import {access,mkdir,readFile,writeFile,rename,rm,stat} from 'node:fs/promises';
import {basename,join} from 'node:path';
import {createReadStream} from 'node:fs';
import {extractArchive} from '../backups/archive';
import {installBrandedEngine,removeOtherBrandedVersions,type BrandedDeps,type BrandedEngineRecord} from './branded';
import {engineCompatibility,SUPPORTED_CHROME_MAJORS} from './compat';
import type {EngineStatus} from '../../shared/contracts';
export type EngineRelease={version:string;url:string;sha256:string};
export type Download=(url:string,destination:string,onBytes?:(received:number,total:number|null)=>void)=>Promise<void>;
type External={executable:string;sha256:string};
async function sha256File(file:string){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
export class EngineInstaller {
  private installing=false;
  constructor(readonly root:string,private download:Download){}
  get packagedExecutable(){return join(this.root,'current','chrome-win64','chrome.exe');}
  private get externalRecord(){return join(this.root,'external.json');}
  private get brandedRecord(){return join(this.root,'branded.json');}
  private async branded():Promise<BrandedEngineRecord|null>{
    try{
      const record=JSON.parse(await readFile(this.brandedRecord,'utf8')) as BrandedEngineRecord;
      if(basename(record.executable).toLowerCase()!=='chrome.exe')return null;
      await access(record.executable);
      if(await sha256File(record.executable)!==record.sha256)return null;
      return record;
    }catch{return null;}
  }
  async resolveExecutable(){
    const branded=await this.branded();
    if(branded)return branded.executable;
    try{const record=JSON.parse(await readFile(this.externalRecord,'utf8')) as External;
      if(basename(record.executable).toLowerCase()!=='chrome.exe')throw Error('UNSAFE_ENGINE');
      await access(record.executable);
      if(await sha256File(record.executable)!==record.sha256)throw Error('ENGINE_CHANGED');
      return record.executable;
    }catch{return this.packagedExecutable;}
  }
  async status():Promise<EngineStatus>{
    const branded=await this.branded();
    if(branded)return {state:'ready',version:branded.version,source:'branded',compatibility:engineCompatibility(branded.version),supportedMajors:SUPPORTED_CHROME_MAJORS};
    try{const executable=await this.resolveExecutable();await access(executable);
      if(executable===this.packagedExecutable){const r=JSON.parse(await readFile(join(this.root,'current','release.json'),'utf8')) as EngineRelease;return {state:'ready',version:r.version,source:'downloaded',compatibility:engineCompatibility(r.version),supportedMajors:SUPPORTED_CHROME_MAJORS};}
      return {state:'ready',version:'linked Chromium',source:'external'};
    }catch{return {state:'missing'};}
  }
  /** Links an already-installed browser chosen explicitly by the user. The user vouches for its provenance; the app pins its hash. */
  async link(executable:string){
    if(basename(executable).toLowerCase()!=='chrome.exe')throw Error('UNSAFE_ENGINE');
    const info=await stat(executable);if(!info.isFile())throw Error('UNSAFE_ENGINE');
    await mkdir(this.root,{recursive:true});
    await rm(this.brandedRecord,{force:true});
    await writeFile(this.externalRecord,JSON.stringify({executable,sha256:await sha256File(executable)} satisfies External));
  }
  /**
   * Downloads Google's own Chrome (official enterprise installer) and unpacks it into
   * the engine directory. Nothing is installed system-wide; the browser is only used by
   * this application, so users do not need Chrome on the machine.
   */
  async installBranded(sevenZip:string,onProgress?:BrandedDeps['onProgress'],verify?:BrandedDeps['verify']):Promise<BrandedEngineRecord>{
    if(this.installing)throw Error('ENGINE_INSTALLING');
    this.installing=true;
    try{
      await mkdir(this.root,{recursive:true});
      const record=await installBrandedEngine(this.root,{download:this.download,sevenZip,verify,onProgress});
      await removeOtherBrandedVersions(this.root,record.version);
      return record;
    }finally{this.installing=false;}
  }
  async install(release:EngineRelease){
    if(this.installing)throw Error('ENGINE_INSTALLING');
    if(!/^\d+\.\d+\.\d+\.\d+$/.test(release.version)||release.url!==`https://storage.googleapis.com/chrome-for-testing-public/${release.version}/win64/chrome-win64.zip`||!/^\w{64}$/.test(release.sha256))throw Error('UNTRUSTED_ENGINE_RELEASE');
    if((await this.status()).state==='ready')throw Error('ENGINE_ALREADY_INSTALLED');
    this.installing=true;const stage=join(this.root,'.stage-'+randomUUID());
    try{
      await mkdir(stage,{recursive:true});const zip=join(stage,'engine.zip');await this.download(release.url,zip);
      const hash=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(zip)){bytes+=chunk.length;if(bytes>500*1024**2)throw Error('ENGINE_TOO_LARGE');hash.update(chunk);}
      if(hash.digest('hex')!==release.sha256)throw Error('ENGINE_HASH_MISMATCH');
      const unpack=join(stage,'unpack');await mkdir(unpack);await extractArchive(zip,unpack);
      await access(join(unpack,'chrome-win64','chrome.exe'));await writeFile(join(unpack,'release.json'),JSON.stringify(release));
      await rm(join(this.root,'current'),{recursive:true,force:true});
      await rename(unpack,join(this.root,'current'));
    }finally{this.installing=false;await rm(stage,{recursive:true,force:true});}
  }
}
