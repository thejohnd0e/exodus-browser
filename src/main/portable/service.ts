import {randomUUID} from 'node:crypto';
import {access,lstat,mkdir,readdir,rename,rm} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {join,relative,resolve,isAbsolute,sep} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {ZipFile} from 'yazl';
import {portableCookiesSchema,portableManifestSchema,type PortableCookie,type PortableManifest} from '../../shared/portable';
import type {Profile} from '../../shared/contracts';
import {profilePath} from '../profiles/paths';
import {ProfileService} from '../profiles/service';
import {probeProfileProcesses,type ProcessRecord} from '../runtime/recovery';
import type {SessionStore} from '../sessions/store';
import {launchCookieBrowser,openCookieSession} from '../cookies/session';
import type {PortableCookieClient} from './cookies';
import {readPortableCookies,writePortableCookies} from './cookies';
import {extractPortableArchive,isPortableDataPath} from './archive';

type Lease={withStopped<T>(id:string,fn:()=>Promise<T>):Promise<T>};
type Engine={resolveExecutable():Promise<string>};
type Launched={client:PortableCookieClient;close:()=>Promise<void>};
type Stage='after-cookie-restore'|'after-directory-rename'|'after-session-publication'|'after-database-writes';
type Deps={probe?:()=>Promise<ProcessRecord[]>;launch?:(input:{executable:string;userDataDir:string})=>Promise<Launched>;failAt?:Stage;extract?:typeof extractPortableArchive;writeArchive?:(zip:ZipFile,destination:string)=>Promise<void>};
const MAX_ENTRIES=100000;const MAX_BYTES=20*1024**3;const MAX_MANIFEST=1024**2;const MAX_COOKIES=5*1024**2;
const inside=(directory:string,target:string)=>{const rel=relative(resolve(directory),resolve(target));return rel===''||(!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel));};

export class PortableProfileService{
 private active=new Set<Promise<unknown>>();private handles=new Set<Launched>();
 constructor(private profiles:ProfileService,private lease:Lease,private engine:Engine,private sessions:SessionStore,private deps:Deps={}){}
 private fault(stage:Stage){if(this.deps.failAt===stage)throw Error('INJECTED_PORTABLE_FAILURE');}
 private async executable(){try{const path=await this.engine.resolveExecutable();await access(path);return path;}catch{throw Error('ENGINE_NOT_READY');}}
 private async assertNoOrphan(directory:string){const rows=await (this.deps.probe??probeProfileProcesses)();if(rows.some(row=>row.commandLine.toLowerCase().includes(directory.toLowerCase())))throw Error('ORPHAN_BROWSER');}
 private async maintenance<T>(executable:string,userDataDir:string,fn:(client:PortableCookieClient)=>Promise<T>):Promise<T>{
  const operation=(async()=>{
   const launched=await (this.deps.launch??launchCookieBrowser)({executable,userDataDir});this.handles.add(launched);
   let primary:unknown;let result!:T;
   try{const session=await openCookieSession(launched as never);result=await fn(session.client as PortableCookieClient);}
   catch(error){primary=error;}
    try{await launched.close();this.handles.delete(launched);}catch{if(primary===undefined)primary=Error('PORTABLE_BROWSER_CLOSE_FAILED');}
   if(primary!==undefined)throw primary;
   return result;
  })();
  this.active.add(operation);try{return await operation;}finally{this.active.delete(operation);}
 }
  async closeAll():Promise<void>{await Promise.allSettled([...this.active]);await Promise.all([...this.handles].map(async handle=>{await handle.close();this.handles.delete(handle);}));}
 async exportFile(id:string,destination:string):Promise<void>{
  await this.lease.withStopped(id,async()=>{
   const source=profilePath(this.profiles.root,id);if(inside(source,destination))throw Error('PORTABLE_DESTINATION_INSIDE_PROFILE');
   const rows=await (this.deps.probe??probeProfileProcesses)();if(rows.some(row=>row.commandLine.toLowerCase().includes(source.toLowerCase())))throw Error('ORPHAN_BROWSER');
   const executable=await this.executable();
    const profile=this.profiles.get(id);const session=await this.sessions.read(id);
   const cookies=portableCookiesSchema.parse(await this.maintenance(executable,source,client=>readPortableCookies(client)));
    const proxy=profile.proxy?{name:profile.proxy.name,kind:profile.proxy.kind,host:profile.proxy.host,port:profile.proxy.port,...(profile.proxy.username?{username:profile.proxy.username}:{}),hasPassword:profile.proxy.hasPassword||profile.proxy.requiresPassword===true}:null;
   const manifest=portableManifestSchema.parse({format:'exodus-portable',version:1,profile:{name:profile.name,note:profile.note,startUrls:profile.startUrls,languages:profile.languages,fingerprint:profile.fingerprint,fingerprintSeed:profile.fingerprintSeed,restoreLastSession:profile.restoreLastSession,proxy},session});
   const manifestBytes=Buffer.from(JSON.stringify(manifest));const cookieBytes=Buffer.from(JSON.stringify(cookies));
   if(manifestBytes.length>MAX_MANIFEST)throw Error('PORTABLE_MANIFEST_TOO_LARGE');if(cookieBytes.length>MAX_COOKIES||cookies.length>20000)throw Error('PORTABLE_COOKIE_LIMIT');
   const zip=new ZipFile();zip.addBuffer(manifestBytes,'manifest.json');zip.addBuffer(cookieBytes,'cookies.json');zip.addEmptyDirectory('data');
   let count=3,bytes=manifestBytes.length+cookieBytes.length;
   const walk=async(directory:string,prefix:string):Promise<void>=>{
    for(const name of await readdir(directory)){const file=join(directory,name);const entry=prefix+name;const info=await lstat(file);
     if(info.isSymbolicLink()||(!info.isDirectory()&&!info.isFile()))throw Error('UNSAFE_PROFILE_FILE');
     if(!isPortableDataPath(entry))continue;
     if(++count>MAX_ENTRIES)throw Error('PORTABLE_ARCHIVE_LIMIT');
     if(info.isDirectory()){zip.addEmptyDirectory(entry);await walk(file,entry+'/');}
     else{bytes+=info.size;if(bytes>MAX_BYTES)throw Error('PORTABLE_ARCHIVE_LIMIT');zip.addFile(file,entry);}
    }
   };
   await walk(source,'data/');
   const partial=`${destination}.partial-${randomUUID()}`;
   try{
    if(this.deps.writeArchive)await this.deps.writeArchive(zip,partial);
    else{const written=pipeline(zip.outputStream,createWriteStream(partial,{flags:'wx'}));zip.end();await written;}
    await rename(partial,destination);
   }
   catch(error){zip.end();await rm(partial,{force:true}).catch(()=>undefined);throw error;}
  });
 }
 async importFile(source:string):Promise<Profile>{
  const stage=join(this.profiles.root,'.portable-import-'+randomUUID());await mkdir(stage,{recursive:false});
  try{
   const parsed=await (this.deps.extract??extractPortableArchive)(source,stage);const manifest=portableManifestSchema.parse(parsed.manifest);const cookies=portableCookiesSchema.parse(parsed.cookies);
   const executable=await this.executable();
   await this.maintenance(executable,parsed.dataDirectory,async client=>{
    await writePortableCookies(client,cookies);this.fault('after-cookie-restore');
    const actual=await readPortableCookies(client);assertCookieRoundtrip(cookies,actual);
   });
   const proxy=manifest.profile.proxy?{name:manifest.profile.proxy.name,kind:manifest.profile.proxy.kind,host:manifest.profile.proxy.host,port:manifest.profile.proxy.port,...(manifest.profile.proxy.username?{username:manifest.profile.proxy.username}:{})}:null;
   const {proxy:_archiveProxy,...profileInput}=manifest.profile;
   const restored=await this.profiles.restoreProfile(profileInput,proxy,parsed.dataDirectory,{
    requiresProxyPassword:manifest.profile.proxy?.hasPassword===true,
    session:manifest.session,
    prepareSession:(id,snapshot)=>this.sessions.prepare(id,snapshot),
    onStage:stageName=>{if(stageName==='after-directory-rename')this.fault('after-directory-rename');if(stageName==='after-session-publication')this.fault('after-session-publication');if(stageName==='after-database-writes')this.fault('after-database-writes');},
   });
   return restored;
  }finally{await rm(stage,{recursive:true,force:true});}
 }
}

function assertCookieRoundtrip(expected:PortableCookie[],actual:PortableCookie[]){
 if(expected.length!==actual.length)throw Error('PORTABLE_COOKIE_ROUNDTRIP_FAILED');
 const fields=['name','value','domain','path','session','httpOnly','secure','sameSite','priority','sourceScheme','sourcePort','partitionKey'] as const;
 const sort=(items:PortableCookie[])=>[...items].sort((a,b)=>`${a.domain}\0${a.path}\0${a.name}`.localeCompare(`${b.domain}\0${b.path}\0${b.name}`));
 const left=sort(expected);const right=sort(actual);
 for(let i=0;i<left.length;i++){
  for(const field of fields)if(JSON.stringify(left[i][field]??null)!==JSON.stringify(right[i][field]??null))throw Error('PORTABLE_COOKIE_ROUNDTRIP_FAILED');
  const a=left[i].expires;const b=right[i].expires;if(a===null?b!==null:b===null||Math.abs(a-b)>1)throw Error('PORTABLE_COOKIE_ROUNDTRIP_FAILED');
 }
}
