import { it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { ProfileService } from '../../src/main/profiles/service';
import { DEFAULT_FINGERPRINT } from '../../src/shared/fingerprint';
import { profilePath } from '../../src/main/profiles/paths';
import {seedFor} from '../../src/main/engines/fingerprint';
import {valid,tempRoot,testSecrets,cleanup} from '../fixtures/profiles';
import {parseProfileInput} from '../../src/shared/validation';
it('stores enabled extension identifiers, rejects duplicates and reads older profiles as having none',async()=>{
  const root=tempRoot();const s=new ProfileService(root,testSecrets());
  try{
    const extensionA='3f0f5a2e-1c7b-4c1e-9a55-8e6f2b7d9a10';const extensionB='7b2c9d4e-5a6f-4b8c-8d9e-0f1a2b3c4d5e';
    const profile=await s.create({...valid,extensionIds:[extensionA,extensionB]});
    expect(s.get(profile.id).extensionIds).toEqual([extensionA,extensionB]);
    expect(s.getLaunchInput(profile.id).extensionIds).toEqual([extensionA,extensionB]);
    expect(()=>parseProfileInput({...valid,extensionIds:[extensionA,extensionA]})).toThrow();
    expect(()=>parseProfileInput({...valid,extensionIds:['not-a-uuid']})).toThrow();
    const older=await s.create({...valid});
    expect(s.get(older.id).extensionIds).toEqual([]);
  }finally{s.close();cleanup(root);}
});

it('persists profiles, isolates paths and never writes plaintext proxy password',async()=>{
  const root=tempRoot();const secrets=testSecrets();let s=new ProfileService(root,secrets);
  try{
    const proxy=await s.createProxy({name:'P',kind:'http',host:'localhost',port:8080,password:'proxy-password'});
    const a=await s.create({...valid,proxyId:proxy.id});
    const b=await s.create(valid);
    expect(profilePath(root,a.id)).not.toBe(profilePath(root,b.id));
    expect(JSON.stringify(a)).not.toContain('proxy-password');
    s.close();s=new ProfileService(root,secrets);
    expect((await s.list()).length).toBe(2);
    expect(s.getLaunchInput(a.id).proxy?.password).toBe('proxy-password');
    await s.updateProxy(proxy.id,{name:'P',kind:'http',host:'localhost',port:8080});
    expect(s.getLaunchInput(a.id).proxy?.password).toBe('proxy-password');
    await s.updateProxy(proxy.id,{name:'P',kind:'http',host:'localhost',port:8080,password:''});
    expect(s.getLaunchInput(a.id).proxy?.password).toBeUndefined();
    expect(()=>profilePath(root,'../outside')).toThrow();
    s.close();expect(readFileSync(join(root,'profiles.sqlite')).includes(Buffer.from('proxy-password'))).toBe(false);
  }finally{ s.close();cleanup(root); }
});
it('does not publish a profile if encrypting its secret fails',async()=>{
  const root=tempRoot();const s=new ProfileService(root,{seal(){throw Error('unavailable');},open(){throw Error('unavailable');}});
  try{await expect(s.createProxy({name:'P',kind:'http',host:'localhost',port:80,password:'s'})).rejects.toThrow();expect(await s.listProxies()).toEqual([]);expect(await s.list()).toEqual([]);}finally{s.close();cleanup(root);}
});
it('normalizes a historical multi-language profile to its primary locale without a schema migration',async()=>{
 const root=tempRoot();const secrets=testSecrets();let s=new ProfileService(root,secrets);
 try{
  const p=await s.create(valid);s.close();
  const db=new Database(join(root,'profiles.sqlite'));const row=db.prepare('SELECT data FROM profiles WHERE id=?').get(p.id) as {data:string};const stored=JSON.parse(row.data);stored.languages=['de-DE','fr-FR'];db.prepare('UPDATE profiles SET data=? WHERE id=?').run(JSON.stringify(stored),p.id);const version=db.pragma('user_version',{simple:true});db.close();
  s=new ProfileService(root,secrets);expect(s.get(p.id).languages).toEqual(['de-DE']);expect((await s.list())[0].languages).toEqual(['de-DE']);
  const verify=new Database(join(root,'profiles.sqlite'));expect(verify.pragma('user_version',{simple:true})).toBe(version);verify.close();
 }finally{s.close();cleanup(root);}
});
it('rejects an empty or malformed historical language list instead of inventing a locale',async()=>{
 const root=tempRoot();const secrets=testSecrets();let s=new ProfileService(root,secrets);
 try{
  const p=await s.create(valid);s.close();const db=new Database(join(root,'profiles.sqlite'));const row=db.prepare('SELECT data FROM profiles WHERE id=?').get(p.id) as {data:string};const stored=JSON.parse(row.data);stored.languages=[];db.prepare('UPDATE profiles SET data=? WHERE id=?').run(JSON.stringify(stored),p.id);db.close();s=new ProfileService(root,secrets);expect(()=>s.get(p.id)).toThrow();s.close();
  const malformed=new Database(join(root,'profiles.sqlite'));const next=JSON.parse((malformed.prepare('SELECT data FROM profiles WHERE id=?').get(p.id) as {data:string}).data);next.languages=['not_a_locale'];malformed.prepare('UPDATE profiles SET data=? WHERE id=?').run(JSON.stringify(next),p.id);malformed.close();s=new ProfileService(root,secrets);expect(()=>s.get(p.id)).toThrow();
 }finally{s.close();cleanup(root);}
});

it('reads a legacy profile fingerprint as default without rewriting its stored JSON',async()=>{
 const root=tempRoot();const s=new ProfileService(root,testSecrets());
 try{
  const p=await s.create(valid);const db=new Database(join(root,'profiles.sqlite'));
  const row=db.prepare('SELECT data FROM profiles WHERE id=?').get(p.id) as {data:string};const stored=JSON.parse(row.data);delete stored.fingerprint;
  const legacyJson=JSON.stringify(stored);db.prepare('UPDATE profiles SET data=? WHERE id=?').run(legacyJson,p.id);db.close();
  expect(s.get(p.id).fingerprint).toEqual(DEFAULT_FINGERPRINT);
  expect(s.getLaunchInput(p.id).fingerprint).toEqual(DEFAULT_FINGERPRINT);
  const verify=new Database(join(root,'profiles.sqlite'));
  expect((verify.prepare('SELECT data FROM profiles WHERE id=?').get(p.id) as {data:string}).data).toBe(legacyJson);verify.close();
 }finally{s.close();cleanup(root);}
});

it('persists fingerprint updates and exposes them to the launch input',async()=>{
 const root=tempRoot();const s=new ProfileService(root,testSecrets());
 try{
  const p=await s.create(valid);const fingerprint={...DEFAULT_FINGERPRINT,timezone:{mode:'manual' as const,value:'Europe/Paris'}};
  const updated=await s.update(p.id,{...valid,fingerprint});
  expect(updated.fingerprint).toEqual(fingerprint);
  expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(p.updatedAt));
  expect(s.getLaunchInput(p.id).fingerprint).toEqual(fingerprint);
 }finally{s.close();cleanup(root);}
});

it('defaults session restore off and assigns a stable profile fingerprint seed',async()=>{
 const root=tempRoot();let s=new ProfileService(root,testSecrets());
 try{
  const p=await s.create(valid);
  expect(p.restoreLastSession).toBe(false);
  expect(p.fingerprintSeed).toBeGreaterThanOrEqual(0);
  expect(p.fingerprintSeed).toBeLessThanOrEqual(0xffffffff);
  expect(s.getLaunchInput(p.id).fingerprintSeed).toBe(p.fingerprintSeed);
  s.close();s=new ProfileService(root,testSecrets());
  expect(s.get(p.id).fingerprintSeed).toBe(p.fingerprintSeed);
  const updated=await s.update(p.id,{...valid,restoreLastSession:true});
  expect(updated.restoreLastSession).toBe(true);
  expect(updated.fingerprintSeed).toBe(p.fingerprintSeed);
 }finally{s.close();cleanup(root);}
});

it('derives the existing deterministic fingerprint seed for a historical record without rewriting it',async()=>{
 const root=tempRoot();const s=new ProfileService(root,testSecrets());
 try{
  const p=await s.create(valid);const db=new Database(join(root,'profiles.sqlite'));
  const row=db.prepare('SELECT data FROM profiles WHERE id=?').get(p.id) as {data:string};
  const stored=JSON.parse(row.data);delete stored.fingerprintSeed;delete stored.restoreLastSession;
  const legacyJson=JSON.stringify(stored);db.prepare('UPDATE profiles SET data=? WHERE id=?').run(legacyJson,p.id);db.close();
  expect(s.get(p.id).fingerprintSeed).toBe(seedFor(p.id));
  expect(s.get(p.id).restoreLastSession).toBe(false);
  const verify=new Database(join(root,'profiles.sqlite'));
  expect((verify.prepare('SELECT data FROM profiles WHERE id=?').get(p.id) as {data:string}).data).toBe(legacyJson);verify.close();
 }finally{s.close();cleanup(root);}
});
