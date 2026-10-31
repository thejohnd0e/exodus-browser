import Database from 'better-sqlite3';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {legacyStoredSchema,legacyProfileSchema} from '../../shared/validation';
const schema=`CREATE TABLE proxies(id TEXT PRIMARY KEY,data TEXT NOT NULL,secret BLOB);
 CREATE TABLE profiles(id TEXT PRIMARY KEY,data TEXT NOT NULL,proxy_id TEXT REFERENCES proxies(id) ON DELETE RESTRICT);`;
export function openRepository(root:string){
  mkdirSync(root,{recursive:true});const db=new Database(join(root,'profiles.sqlite'));
  try{
    const version=db.pragma('user_version',{simple:true}) as number;
    if(version>3)throw Error('DATABASE_TOO_NEW');
    db.pragma('foreign_keys = ON');db.pragma('journal_mode = WAL');
    if(version<2)db.transaction(()=>{
      const rows=version===1?db.prepare('SELECT id,data,secret FROM profiles ORDER BY rowid').all() as {id:string;data:string;secret:Buffer|null}[]:[];
      const parsed=rows.map(row=>{const p=legacyStoredSchema.parse(JSON.parse(row.data));if(p.id!==row.id)throw Error('INVALID_PROFILE');const {hasPassword:_,...proxy}=p.proxy??{};legacyProfileSchema.parse({name:p.name,note:p.note,startUrls:p.startUrls,language:p.language,proxy:p.proxy?proxy:null});if(!p.proxy&&row.secret)throw Error('INVALID_PROFILE');return {row,p};});
      if(version===1)db.exec('ALTER TABLE profiles RENAME TO profiles_v1');
      db.exec(schema);
      for(const {row,p} of parsed){let proxyId:string|null=null;
        if(p.proxy){proxyId=randomUUID();const {hasPassword,...config}=p.proxy;const data={...config,id:proxyId,name:p.name.slice(0,120),createdAt:p.createdAt,updatedAt:p.updatedAt,hasPassword:!!row.secret};db.prepare('INSERT INTO proxies VALUES(?,?,?)').run(proxyId,JSON.stringify(data),row.secret);}
        const {language,proxy,...rest}=p;const data={...rest,languages:[language],proxyId};db.prepare('INSERT INTO profiles VALUES(?,?,?)').run(p.id,JSON.stringify(data),proxyId);
      }
      if(version===1)db.exec('DROP TABLE profiles_v1');db.pragma('user_version = 2');
    })();
    if(db.pragma('user_version',{simple:true})===2)db.transaction(()=>{
      db.exec('CREATE TABLE extensions(id TEXT PRIMARY KEY,data TEXT NOT NULL)');db.pragma('user_version = 3');
    })();
    return db;
  }catch(error){db.close();throw error;}
}
