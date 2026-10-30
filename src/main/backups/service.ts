import {randomUUID} from 'node:crypto';
import {mkdir,rm,readFile,readdir,lstat,rename} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {ZipFile} from 'yazl';
import {z} from 'zod';
import {profileSchema,legacyProfileSchema,historicalLanguagesSchema,normalizeStoredLanguages,publicProxySchema,publicSavedProxySchema} from '../../shared/validation';
import {DEFAULT_FINGERPRINT,fingerprintSchema} from '../../shared/fingerprint';
import {ProfileService} from '../profiles/service';
import {profilePath} from '../profiles/paths';
import {extractArchive,validateEntryPath} from './archive';
type Lease={withStopped<T>(id:string,fn:()=>Promise<T>):Promise<T>};
const manifestSchema=z.discriminatedUnion('version',[
 z.object({version:z.literal(1),profile:legacyProfileSchema.omit({proxy:true}).extend({proxy:publicProxySchema.nullable()})}).strict(),
 z.object({version:z.literal(2),profile:profileSchema.omit({proxyId:true,languages:true,fingerprint:true}).extend({languages:historicalLanguagesSchema,proxy:publicSavedProxySchema.nullable()})}).strict(),
 z.object({version:z.literal(3),profile:profileSchema.omit({proxyId:true,languages:true,fingerprint:true}).extend({languages:historicalLanguagesSchema,fingerprint:fingerprintSchema,proxy:publicSavedProxySchema.nullable()})}).strict()
]);
export class BackupService {
  constructor(private profiles:ProfileService,private lease:Lease,private extract:typeof extractArchive=extractArchive){}
  async create(id:string,destination:string){return this.lease.withStopped(id,async()=>{
    const dir=profilePath(this.profiles.root,id);
    if(!relative(dir,resolve(destination)).startsWith('..'))throw Error('BACKUP_INSIDE_PROFILE');
    const p=this.profiles.get(id);const proxy=p.proxy?{name:p.proxy.name,kind:p.proxy.kind,host:p.proxy.host,port:p.proxy.port,...(p.proxy.username?{username:p.proxy.username}:{})}:null;
     const manifest={version:3,profile:{name:p.name,note:p.note,startUrls:p.startUrls,languages:p.languages,fingerprint:p.fingerprint,proxy}};
    const zip=new ZipFile();zip.addBuffer(Buffer.from(JSON.stringify(manifest)),'manifest.json');
    let count=1,bytes=0;
    const walk=async(path:string,prefix:string)=>{for(const entry of await readdir(path,{withFileTypes:true})){
      const file=join(path,entry.name);const stat=await lstat(file);const name=validateEntryPath(prefix+entry.name);
      if(++count>100000||stat.isSymbolicLink())throw Error('UNSAFE_PROFILE_FILE');
      if(stat.isDirectory())await walk(file,name+'/');else if(stat.isFile()){bytes+=stat.size;if(bytes>20*1024**3)throw Error('BACKUP_TOO_LARGE');zip.addFile(file,name);}else throw Error('UNSAFE_PROFILE_FILE');
    }};
    await walk(dir,'data/');const partial=destination+'.partial-'+randomUUID();
    try{const done=pipeline(zip.outputStream,createWriteStream(partial,{flags:'wx'}));zip.end();await done;await rename(partial,destination);}finally{await rm(partial,{force:true});}
  });}
  async restore(source:string){
    const stage=join(this.profiles.root,'.restore-'+randomUUID());await mkdir(stage,{recursive:true});
    try{
      await this.extract(source,stage);
      const stat=await lstat(join(stage,'manifest.json'));if(stat.size>1024**2)throw Error('INVALID_MANIFEST');
      const manifest=manifestSchema.parse(JSON.parse(await readFile(join(stage,'manifest.json'),'utf8')));
      const allowed=await readdir(stage);if(allowed.some(n=>!['manifest.json','data'].includes(n)))throw Error('INVALID_BACKUP_LAYOUT');
      const data=join(stage,'data');await mkdir(data,{recursive:true});await mkdir(join(this.profiles.root,'profiles'),{recursive:true});
      const {name,note,startUrls,proxy}=manifest.profile;
       const languages=manifest.version===1?[manifest.profile.language]:normalizeStoredLanguages(manifest.profile.languages);
       const fingerprint=manifest.version===3?manifest.profile.fingerprint:DEFAULT_FINGERPRINT;
       return await this.profiles.restoreProfile({name,note,startUrls,languages,fingerprint},proxy?{...proxy,name:'name' in proxy?proxy.name:name}:null,data);
    }finally{await rm(stage,{recursive:true,force:true});}
  }
}
