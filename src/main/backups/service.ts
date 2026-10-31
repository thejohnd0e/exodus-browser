import {randomUUID} from 'node:crypto';
import {mkdir,rm,readFile,readdir,lstat,rename} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {ZipFile} from 'yazl';
import {z} from 'zod';
import {legacyProfileSchema,historicalLanguagesSchema,normalizeStoredLanguages,publicProxySchema,publicSavedProxySchema} from '../../shared/validation';
import {DEFAULT_FINGERPRINT,fingerprintSchema} from '../../shared/fingerprint';
import {sessionSnapshotSchema,type SessionSnapshot} from '../../shared/session';
import {ProfileService} from '../profiles/service';
import type {SessionStore} from '../sessions/store';
import {profilePath} from '../profiles/paths';
import {extractArchive,validateEntryPath} from './archive';
type Lease={withStopped<T>(id:string,fn:()=>Promise<T>):Promise<T>};
const basicProfile=z.object({name:z.string().trim().min(1).max(120),note:z.string().max(4000),startUrls:z.array(z.string().max(8192)).max(20)});
const v2Profile=basicProfile.extend({languages:historicalLanguagesSchema,proxy:publicSavedProxySchema.nullable()}).strict();
const v3Profile=v2Profile.extend({fingerprint:fingerprintSchema}).strict();
const v4Profile=v3Profile.extend({restoreLastSession:z.boolean(),fingerprintSeed:z.number().int().min(0).max(0xffffffff)}).strict();
const manifestSchema=z.discriminatedUnion('version',[
 z.object({version:z.literal(1),profile:legacyProfileSchema.omit({proxy:true}).extend({proxy:publicProxySchema.nullable()})}).strict(),
 z.object({version:z.literal(2),profile:v2Profile}).strict(),
 z.object({version:z.literal(3),profile:v3Profile}).strict(),
 z.object({version:z.literal(4),profile:v4Profile,session:sessionSnapshotSchema.nullable()}).strict()
]);
export class BackupService {
  constructor(private profiles:ProfileService,private lease:Lease,private extract:typeof extractArchive=extractArchive,private sessions?:SessionStore){}
  async create(id:string,destination:string){return this.lease.withStopped(id,async()=>{
    const dir=profilePath(this.profiles.root,id);
    if(!relative(dir,resolve(destination)).startsWith('..'))throw Error('BACKUP_INSIDE_PROFILE');
    const p=this.profiles.get(id);const proxy=p.proxy?{name:p.proxy.name,kind:p.proxy.kind,host:p.proxy.host,port:p.proxy.port,...(p.proxy.username?{username:p.proxy.username}:{})}:null;
      const session=await this.sessions?.read(id)??null;
      const manifest={version:4,profile:{name:p.name,note:p.note,startUrls:p.startUrls,languages:p.languages,fingerprint:p.fingerprint,restoreLastSession:p.restoreLastSession,fingerprintSeed:p.fingerprintSeed,proxy},session};
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
        const fingerprint=manifest.version===3||manifest.version===4?manifest.profile.fingerprint:DEFAULT_FINGERPRINT;
        const extended=manifest.version===4?manifest.profile:null;
        const restored=await this.profiles.restoreProfile({name,note,startUrls,languages,fingerprint,restoreLastSession:extended?.restoreLastSession??false,...(extended?{fingerprintSeed:extended.fingerprintSeed}:{})},proxy?{...proxy,name:'name' in proxy?proxy.name:name}:null,data);
        const session:SessionSnapshot|null=manifest.version===4?manifest.session:null;
        try{if(session&&this.sessions)await this.sessions.write(restored.id,session);return restored;}
        catch(error){await this.profiles.remove(restored.id).catch(()=>undefined);await this.sessions?.remove(restored.id).catch(()=>undefined);throw error;}
    }finally{await rm(stage,{recursive:true,force:true});}
  }
}
