import {it,expect} from 'vitest';
import Database from 'better-sqlite3';
import {mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {ProfileService} from '../../src/main/profiles/service';
import {openRepository} from '../../src/main/profiles/repository';
import {ExtensionLibrary} from '../../src/main/extensions/library';
import {valid,tempRoot,testSecrets,cleanup} from '../fixtures/profiles';

const manifest=(version:string)=>JSON.stringify({manifest_version:3,name:'Fixture',version});
function folder(root:string,name:string,version='1.0.0'){
  const dir=join(root,name);mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'manifest.json'),manifest(version));writeFileSync(join(dir,'background.js'),'console.log(1)');return dir;
}

it('opens a fresh repository at schema version 3 with an extensions table',()=>{
  const root=tempRoot();try{
    const db=openRepository(root);
    expect(db.pragma('user_version',{simple:true})).toBe(3);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='extensions'").get()).toBeTruthy();
    db.close();
  }finally{cleanup(root);}
});

it('migrates an existing version 2 database without losing profiles',()=>{
  const root=tempRoot();try{
    const raw=new Database(join(root,'profiles.sqlite'));
    raw.exec("CREATE TABLE proxies(id TEXT PRIMARY KEY,data TEXT NOT NULL,secret BLOB); CREATE TABLE profiles(id TEXT PRIMARY KEY,data TEXT NOT NULL,proxy_id TEXT REFERENCES proxies(id) ON DELETE RESTRICT);");
    raw.prepare('INSERT INTO profiles VALUES(?,?,?)').run('d31bb0d8-7bfa-4341-a12a-83a801e8cb4a',JSON.stringify({name:'Kept',note:'',startUrls:['about:blank'],languages:['en-US']}),null);
    raw.pragma('user_version = 2');raw.close();
    const db=openRepository(root);
    expect(db.pragma('user_version',{simple:true})).toBe(3);
    expect(db.prepare('SELECT COUNT(*) AS n FROM profiles').get()).toEqual({n:1});
    db.close();
  }finally{cleanup(root);}
});

it('copies a folder into the library and keeps the copy independent of the source',async()=>{
  const root=tempRoot();try{
    const service=new ProfileService(root,testSecrets());const library=new ExtensionLibrary(root,service.database);
    const source=folder(root,'source');
    const entry=await library.addFromFolder(source);
    expect(entry).toMatchObject({name:'Fixture',version:'1.0.0'});
    writeFileSync(join(source,'manifest.json'),manifest('9.9.9'));
    expect(JSON.parse(readFileSync(join(library.directoryFor(entry.id),'manifest.json'),'utf8')).version).toBe('1.0.0');
    expect(library.list().map(item=>item.id)).toEqual([entry.id]);
    service.close();
  }finally{cleanup(root);}
});

it('leaves no row or staging directory when a folder is invalid',async()=>{
  const root=tempRoot();try{
    const service=new ProfileService(root,testSecrets());const library=new ExtensionLibrary(root,service.database);
    const empty=join(root,'empty');mkdirSync(empty);
    await expect(library.addFromFolder(empty)).rejects.toThrow('EXTENSION_INVALID_MANIFEST');
    expect(library.list()).toEqual([]);
    const extensionsDir=join(root,'extensions');
    expect(existsSync(extensionsDir)?readdirSync(extensionsDir).filter(name=>name.startsWith('.staging-')):[]).toEqual([]);
    service.close();
  }finally{cleanup(root);}
});

it('updates an entry in place: same identifier and directory, new version',async()=>{
  const root=tempRoot();try{
    const service=new ProfileService(root,testSecrets());const library=new ExtensionLibrary(root,service.database);
    const entry=await library.addFromFolder(folder(root,'v1','1.0.0'));
    const updated=await library.updateFromFolder(entry.id,folder(root,'v2','2.0.0'));
    expect(updated).toMatchObject({id:entry.id,version:'2.0.0'});
    expect(JSON.parse(readFileSync(join(library.directoryFor(entry.id),'manifest.json'),'utf8')).version).toBe('2.0.0');
    service.close();
  }finally{cleanup(root);}
});

it('removes an entry from the library and from every profile that enabled it',async()=>{
  const root=tempRoot();try{
    const service=new ProfileService(root,testSecrets());const library=new ExtensionLibrary(root,service.database);
    const entry=await library.addFromFolder(folder(root,'source'));
    const profile=await service.create({...valid});
    service.database.prepare('UPDATE profiles SET data=? WHERE id=?').run(JSON.stringify({...JSON.parse((service.database.prepare('SELECT data FROM profiles WHERE id=?').get(profile.id) as {data:string}).data),extensionIds:[entry.id]}),profile.id);
    await library.remove(entry.id);
    expect(library.list()).toEqual([]);
    expect(existsSync(library.directoryFor(entry.id))).toBe(false);
    const stored=JSON.parse((service.database.prepare('SELECT data FROM profiles WHERE id=?').get(profile.id) as {data:string}).data);
    expect(stored.extensionIds ?? []).toEqual([]);
    service.close();
  }finally{cleanup(root);}
});
