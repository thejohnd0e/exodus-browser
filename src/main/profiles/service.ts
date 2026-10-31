import {randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,renameSync,rmSync,existsSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {join} from 'node:path';
import type {Profile,ProfileInput,SavedProxy,SavedProxyInput,ProxyInput,LaunchInput} from '../../shared/contracts';
import {normalizeStoredLanguages,parseProfileInput,parseProfileId,parseSavedProxyInput} from '../../shared/validation';
import {normalizeFingerprint} from '../../shared/fingerprint';
import {seedFor} from '../engines/fingerprint';
import type {Secrets} from '../security/secrets';
import {profilePath} from './paths';
import {openRepository} from './repository';
import type {SessionSnapshot} from '../../shared/session';
type ProxyRow={data:string;secret:Buffer|null};
type RestoreStage='after-directory-rename'|'after-session-publication'|'after-database-writes';
type RestoreOptions={requiresProxyPassword?:boolean;session?:SessionSnapshot|null;prepareSession?:(id:string,snapshot:SessionSnapshot)=>Promise<{publish:()=>void;rollback:()=>void}>;onStage?:(stage:RestoreStage)=>void};
export class ProfileService {
  private db;private closed=false;
  constructor(readonly root:string,private secrets:Secrets,private assertStopped:(id:string)=>Promise<void>=async()=>{}){this.db=openRepository(root);}
  get database(){return this.db;}
  async list():Promise<Profile[]>{return (this.db.prepare('SELECT id FROM profiles ORDER BY rowid').all() as {id:string}[]).map(r=>this.get(r.id));}
  get(id:string):Profile{
    const row=this.db.prepare('SELECT data,proxy_id FROM profiles WHERE id=?').get(parseProfileId(id)) as {data:string;proxy_id:string|null}|undefined;
    if(!row)throw Error('PROFILE_NOT_FOUND');
     const data=JSON.parse(row.data);return {...data,languages:normalizeStoredLanguages(data.languages),fingerprint:normalizeFingerprint(data.fingerprint),restoreLastSession:data.restoreLastSession===true,fingerprintSeed:Number.isInteger(data.fingerprintSeed)&&data.fingerprintSeed>=0&&data.fingerprintSeed<=0xffffffff?data.fingerprintSeed:seedFor(id),proxyId:row.proxy_id,proxy:row.proxy_id?this.getProxy(row.proxy_id):null};
  }
  listProxies():SavedProxy[]{return (this.db.prepare('SELECT id FROM proxies ORDER BY rowid').all() as {id:string}[]).map(r=>this.getProxy(r.id));}
  private proxyRow(id:string){const row=this.db.prepare('SELECT data,secret FROM proxies WHERE id=?').get(parseProfileId(id)) as ProxyRow|undefined;if(!row)throw Error('PROXY_NOT_FOUND');return row;}
  getProxy(id:string):SavedProxy{const row=this.proxyRow(id);return {...JSON.parse(row.data),profileIds:(this.db.prepare('SELECT id FROM profiles WHERE proxy_id=? ORDER BY rowid').all(id) as {id:string}[]).map(r=>r.id)};}
   getProxyInput(id:string):ProxyInput{const row=this.proxyRow(id);const p=JSON.parse(row.data) as SavedProxy;if(p.requiresPassword&&!row.secret)throw Error('PROXY_PASSWORD_REQUIRED');return {kind:p.kind,host:p.host,port:p.port,...(p.username?{username:p.username}:{}),...(row.secret?{password:this.secrets.open(row.secret)}:{})};}
  getLaunchInput(id:string):LaunchInput{const p=this.get(id);return {name:p.name,note:p.note,startUrls:p.startUrls,languages:p.languages,fingerprint:p.fingerprint,restoreLastSession:p.restoreLastSession,fingerprintSeed:p.fingerprintSeed,proxy:p.proxyId?this.getProxyInput(p.proxyId):null,proxyVersion:p.proxy?`${p.proxy.id}:${p.proxy.updatedAt}`:null};}
  private timestamp(previous?:string){return new Date(Math.max(Date.now(),previous?Date.parse(previous)+1:0)).toISOString();}
  private prepareProxy(input:SavedProxyInput,id:string,old?:SavedProxy){
    const value=parseSavedProxyInput(input);let secret:Buffer|null=null;
    if(value.password)secret=this.secrets.seal(value.password);
    else if(value.password===undefined&&old&&['kind','host','port','username'].every(k=>old[k as keyof SavedProxy]===value[k as keyof SavedProxyInput]))secret=this.proxyRow(id).secret;
    const {password:_,...publicValue}=value;const now=this.timestamp(old?.updatedAt);
     const requiresPassword=old?.requiresPassword===true&&value.password===undefined;
     return {data:{...publicValue,id,hasPassword:!!secret,...(requiresPassword?{requiresPassword:true}:{}),createdAt:old?.createdAt??now,updatedAt:now},secret};
  }
  async createProxy(input:SavedProxyInput):Promise<SavedProxy>{const id=randomUUID();const {data,secret}=this.prepareProxy(input,id);this.db.prepare('INSERT INTO proxies VALUES(?,?,?)').run(id,JSON.stringify(data),secret);return this.getProxy(id);}
  async updateProxy(id:string,input:SavedProxyInput):Promise<SavedProxy>{const old=this.getProxy(id);const {data,secret}=this.prepareProxy(input,id,old);this.db.prepare('UPDATE proxies SET data=?,secret=? WHERE id=?').run(JSON.stringify(data),secret,id);return this.getProxy(id);}
  async removeProxy(id:string){const p=this.getProxy(id);if(p.profileIds.length)throw Error('PROXY_IN_USE');this.db.prepare('DELETE FROM proxies WHERE id=?').run(id);}
  async create(input:ProfileInput,stagedData?:string):Promise<Profile>{
    const value=parseProfileInput(input);if(value.proxyId)this.getProxy(value.proxyId);
    const id=randomUUID();const now=this.timestamp();const data={...value,fingerprintSeed:value.fingerprintSeed??randomBytes(4).readUInt32BE(0),id,createdAt:now,updatedAt:now};const dir=profilePath(this.root,id);
    if(stagedData)renameSync(stagedData,dir);else mkdirSync(dir,{recursive:true});
    try{this.db.prepare('INSERT INTO profiles VALUES(?,?,?)').run(id,JSON.stringify(data),value.proxyId);}catch(error){rmSync(dir,{recursive:true,force:true});throw error;}return this.get(id);
  }
  async update(id:string,input:ProfileInput):Promise<Profile>{await this.assertStopped(id);const old=this.get(id);const value=parseProfileInput(input);if(value.proxyId)this.getProxy(value.proxyId);const data={...value,fingerprintSeed:old.fingerprintSeed,id,createdAt:old.createdAt,updatedAt:this.timestamp(old.updatedAt)};this.db.prepare('UPDATE profiles SET data=?,proxy_id=? WHERE id=?').run(JSON.stringify(data),value.proxyId,id);return this.get(id);}
  async remove(id:string){await this.assertStopped(id);this.get(id);const dir=profilePath(this.root,id);const trash=join(this.root,'trash-'+randomUUID());const present=existsSync(dir);if(present)renameSync(dir,trash);try{this.db.prepare('DELETE FROM profiles WHERE id=?').run(id);}catch(error){if(present)renameSync(trash,dir);throw error;}if(present)await rm(trash,{recursive:true,force:true}).catch(()=>{});}
   async restoreProfile(input:Omit<ProfileInput,'proxyId'>,proxy:SavedProxyInput|null,stagedData:string,options:RestoreOptions={}):Promise<Profile>{
     const id=randomUUID();const proxyId=proxy?randomUUID():null;const value=parseProfileInput({...input,proxyId});const now=this.timestamp();const dir=profilePath(this.root,id);let published=false;let sessionPublication:{publish:()=>void;rollback:()=>void}|undefined;
     const prepared=proxy?this.prepareProxy(proxy,proxyId!):null;if(prepared&&options.requiresProxyPassword)prepared.data.requiresPassword=true;
     try{
       if(options.session&&options.prepareSession)sessionPublication=await options.prepareSession(id,options.session);
       this.db.transaction(()=>{
         if(prepared)this.db.prepare('INSERT INTO proxies VALUES(?,?,?)').run(proxyId,JSON.stringify(prepared.data),prepared.secret);
         mkdirSync(join(this.root,'profiles'),{recursive:true});renameSync(stagedData,dir);published=true;options.onStage?.('after-directory-rename');
         sessionPublication?.publish();options.onStage?.('after-session-publication');
         this.db.prepare('INSERT INTO profiles VALUES(?,?,?)').run(id,JSON.stringify({...value,fingerprintSeed:value.fingerprintSeed??seedFor(id),id,createdAt:now,updatedAt:now}),proxyId);
         options.onStage?.('after-database-writes');
       })();
       return this.get(id);
     }catch(error){
       let cleanupFailed=false;try{if(published)rmSync(dir,{recursive:true,force:true});}catch{cleanupFailed=true;}
       try{sessionPublication?.rollback();}catch{cleanupFailed=true;}
       if(cleanupFailed)throw Object.assign(Error('PORTABLE_ROLLBACK_FAILED'),{cause:error});
       throw error;
     }
  }
  close(){if(!this.closed){this.db.close();this.closed=true;}}
}
