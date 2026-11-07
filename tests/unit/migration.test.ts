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

// Failure injection after the migration has already written to the database.
function snapshot(root:string){const db=new Database(join(root,'profiles.sqlite'));try{
  return {version:db.pragma('user_version',{simple:true}),
    objects:db.prepare("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all(),
    rows:JSON.stringify(db.prepare('SELECT * FROM profiles ORDER BY rowid').all())};
}finally{db.close();}}
it('restores the v1 database exactly when an INSERT fails after the schema was rebuilt and rows were written',async()=>{
  // The legacy table has no primary key, so two rows can share an id. The new table rejects the
  // second one only after the proxies and the first profile were already written.
  const root=tempRoot();const db=new Database(join(root,'profiles.sqlite'));
  db.exec('CREATE TABLE profiles(id TEXT,data TEXT NOT NULL,secret BLOB);PRAGMA user_version=1');
  for(const secret of ['cipher-a','cipher-b'])db.prepare('INSERT INTO profiles VALUES(?,?,?)').run(ids[0],JSON.stringify({id:ids[0],name:'Dup',note:'',language:'en-NZ',startUrls:['about:blank'],proxy:{kind:'http',host:'localhost',port:8080,hasPassword:true},createdAt:'old',updatedAt:'old'}),Buffer.from(secret));
  db.close();
  const before=snapshot(root);let unexpected:ProfileService|undefined;
  try{
    expect(()=>{unexpected=new ProfileService(root,{seal:()=>Buffer.from(''),open:()=>''});}).toThrow(/UNIQUE|constraint/i);
    expect(snapshot(root)).toEqual(before);
    expect(before.version).toBe(1);
    const check=new Database(join(root,'profiles.sqlite'));try{expect(check.prepare("SELECT name FROM sqlite_master WHERE name IN('proxies','profiles_v1')").all()).toEqual([]);check.prepare('DELETE FROM profiles WHERE rowid=2').run();}finally{check.close();}
    // Once the cause is removed the untouched data migrates on the next start.
    const retry=new ProfileService(root,{seal:()=>Buffer.from(''),open:()=>''});try{expect(await retry.list()).toHaveLength(1);}finally{retry.close();}
  }finally{unexpected?.close();cleanup(root);}
});
it('keeps a v2 database at v2 with its data when the v3 step fails',()=>{
  const root=tempRoot();const db=new Database(join(root,'profiles.sqlite'));
  db.exec(`CREATE TABLE proxies(id TEXT PRIMARY KEY,data TEXT NOT NULL,secret BLOB);
    CREATE TABLE profiles(id TEXT PRIMARY KEY,data TEXT NOT NULL,proxy_id TEXT REFERENCES proxies(id) ON DELETE RESTRICT);
    CREATE TABLE extensions(id TEXT PRIMARY KEY,data TEXT NOT NULL);PRAGMA user_version=2`);
  db.prepare('INSERT INTO profiles VALUES(?,?,NULL)').run(ids[0],JSON.stringify({id:ids[0],name:'Keep'}));db.close();
  const before=snapshot(root);let unexpected:ProfileService|undefined;
  try{
    expect(()=>{unexpected=new ProfileService(root,{seal:()=>Buffer.from(''),open:()=>''});}).toThrow(/already exists/i);
    expect(snapshot(root)).toEqual(before);expect(before.version).toBe(2);
  }finally{unexpected?.close();cleanup(root);}
});
