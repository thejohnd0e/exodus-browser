import {it,expect} from 'vitest';
import Database from 'better-sqlite3';
import {join} from 'node:path';
import {ProfileService} from '../../src/main/profiles/service';
import {DEFAULT_FINGERPRINT} from '../../src/shared/fingerprint';
import {tempRoot,cleanup} from '../fixtures/profiles';
const ids=['d31bb0d8-7bfa-4341-a12a-83a801e8cb4a','8c6dbed2-8067-43ec-b5fd-3cb482d965ea'];
function legacy(root:string,corrupt=false){const db=new Database(join(root,'profiles.sqlite'));db.exec('CREATE TABLE profiles(id TEXT PRIMARY KEY,data TEXT NOT NULL,secret BLOB);PRAGMA user_version=1');
 for(let i=0;i<2;i++)db.prepare('INSERT INTO profiles VALUES(?,?,?)').run(ids[i],JSON.stringify({id:ids[i],name:'Old '+i,note:'',language:corrupt&&i===1?'bad_locale':'en-NZ',startUrls:['about:blank'],proxy:{kind:'http',host:'localhost',port:8080,hasPassword:true},createdAt:'old',updatedAt:'old'}),Buffer.from('cipher-'+i));db.close();}
it('migrates v1 records and secret bytes without decrypting or merging equal proxy addresses',async()=>{
 const root=tempRoot();legacy(root);const secrets={seal(){throw Error('must not encrypt');},open(){throw Error('must not decrypt');}};
 let s:ProfileService|undefined;
  try{s=new ProfileService(root,secrets);const profiles=await s.list();expect(profiles.map(p=>p.languages)).toEqual([['en-NZ'],['en-NZ']]);expect(profiles.map(p=>p.fingerprint)).toEqual([DEFAULT_FINGERPRINT,DEFAULT_FINGERPRINT]);expect(profiles.map(p=>p.id)).toEqual(ids);
 expect(profiles[0].proxyId).not.toBe(profiles[1].proxyId);expect(await s.listProxies()).toHaveLength(2);s.close();
 const db=new Database(join(root,'profiles.sqlite'));expect(db.pragma('user_version',{simple:true})).toBe(3);const rows=db.prepare('SELECT secret FROM proxies ORDER BY rowid').all() as {secret:Buffer}[];expect(rows.map(r=>r.secret.toString())).toEqual(['cipher-0','cipher-1']);db.close();
 s=new ProfileService(root,secrets);expect(await s.listProxies()).toHaveLength(2);
 }finally{s?.close();cleanup(root);}
});
it('rolls back the whole v1 migration if one old record is malformed',()=>{
  const root=tempRoot();legacy(root,true);
 let unexpected:ProfileService|undefined;
 try{expect(()=>{unexpected=new ProfileService(root,{seal:()=>Buffer.from(''),open:()=>''});}).toThrow();const db=new Database(join(root,'profiles.sqlite'));try{expect(db.pragma('user_version',{simple:true})).toBe(1);expect(db.prepare('SELECT * FROM profiles').all()).toHaveLength(2);expect(db.prepare("SELECT name FROM sqlite_master WHERE name='proxies'").get()).toBeUndefined();}finally{db.close();}}finally{unexpected?.close();cleanup(root);}
});
