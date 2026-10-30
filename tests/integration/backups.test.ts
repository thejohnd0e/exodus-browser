import {it,expect} from 'vitest';
import {join} from 'node:path';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {ZipFile} from 'yazl';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {BackupService} from '../../src/main/backups/service';
import {extractArchive} from '../../src/main/backups/archive';
import {ProfileService} from '../../src/main/profiles/service';
import {DEFAULT_FINGERPRINT} from '../../src/shared/fingerprint';
import {profilePath} from '../../src/main/profiles/paths';
import {valid,tempRoot,testSecrets,cleanup} from '../fixtures/profiles';
it('roundtrips closed profile data to new UUID without proxy password',async()=>{
 const root=tempRoot();const s=new ProfileService(root,testSecrets());const backup=new BackupService(s,{withStopped:async(_id,fn)=>fn()});
 try{const proxy=await s.createProxy({name:'P',kind:'http',host:'localhost',port:80,password:'never-export'});const a=await s.create({...valid,languages:['ru-RU'],proxyId:proxy.id});await writeFile(join(profilePath(root,a.id),'Cookies'),'synthetic-cookie');const file=join(root,'backup.zip');await backup.create(a.id,file);const unpacked=join(root,'unpacked');await mkdir(unpacked);await extractArchive(file,unpacked);expect(JSON.parse(await readFile(join(unpacked,'manifest.json'),'utf8')).profile.languages).toEqual(['ru-RU']);const b=await backup.restore(file);expect(b.id).not.toBe(a.id);expect(b.proxyId).not.toBe(a.proxyId);expect(b.languages).toEqual(['ru-RU']);expect(await readFile(join(profilePath(root,b.id),'Cookies'),'utf8')).toBe('synthetic-cookie');expect(b.proxy?.hasPassword).toBe(false);expect(s.getLaunchInput(b.id).proxy?.password).toBeUndefined();}finally{s.close();cleanup(root);}
});
it('writes a version 3 backup with the profile fingerprint and restores it',async()=>{
 const root=tempRoot();const s=new ProfileService(root,testSecrets());const backup=new BackupService(s,{withStopped:async(_id,fn)=>fn()});
 try{
  const fingerprint={...DEFAULT_FINGERPRINT,timezone:{mode:'manual' as const,value:'Europe/Paris'}};
  const profile=await s.create({...valid,fingerprint});const file=join(root,'fingerprint-v3.zip');await backup.create(profile.id,file);
  const unpacked=join(root,'fingerprint-unpacked');await mkdir(unpacked);await extractArchive(file,unpacked);
  const manifest=JSON.parse(await readFile(join(unpacked,'manifest.json'),'utf8'));
  expect(manifest.version).toBe(3);expect(manifest.profile.fingerprint).toEqual(fingerprint);
  const restored=await backup.restore(file);expect(restored.fingerprint).toEqual(fingerprint);
 }finally{s.close();cleanup(root);}
});
it('refuses backup while profile lease is unavailable',async()=>{const root=tempRoot();const s=new ProfileService(root,testSecrets());try{const a=await s.create(valid);const backup=new BackupService(s,{withStopped:async()=>{throw Error('PROFILE_BUSY');}});await expect(backup.create(a.id,join(root,'b.zip'))).rejects.toThrow('PROFILE_BUSY');}finally{s.close();cleanup(root);}});
it('does not publish or leave staging after an extraction disk failure',async()=>{
 const root=tempRoot();const s=new ProfileService(root,testSecrets());try{const backup=new BackupService(s,{withStopped:async(_id,fn)=>fn()},async(_file,stage)=>{await writeFile(join(stage,'partial'),'x');throw Object.assign(Error('full'),{code:'ENOSPC'});});const before=await s.list();await expect(backup.restore('fixture.zip')).rejects.toThrow();expect(await s.list()).toEqual(before);expect((await readdir(root)).filter(n=>n.startsWith('.restore-'))).toEqual([]);}finally{s.close();cleanup(root);}
});
it('rejects duplicate entries, symlinks and oversized actual extraction',async()=>{
 const root=tempRoot();try{for(const kind of ['duplicate','symlink','size']){const file=join(root,kind+'.zip');const z=new ZipFile();z.addBuffer(Buffer.from('abcdef'),'file',{mode:kind==='symlink'?0o120777:0o100600});if(kind==='duplicate')z.addBuffer(Buffer.from('x'),'file');const done=pipeline(z.outputStream,createWriteStream(file));z.end();await done;const out=join(root,kind);await mkdir(out);await expect(extractArchive(file,out,{entries:10,bytes:kind==='size'?2:1000})).rejects.toThrow();}}finally{cleanup(root);}
});
it('restores a version 1 archive with a new saved proxy and its original locale',async()=>{
 const root=tempRoot();const s=new ProfileService(root,testSecrets());try{const z=new ZipFile();z.addBuffer(Buffer.from(JSON.stringify({version:1,profile:{name:'Legacy',note:'',language:'en-NZ',startUrls:['about:blank'],proxy:{kind:'http',host:'localhost',port:8080}}})),'manifest.json');const file=join(root,'v1.zip');const done=pipeline(z.outputStream,createWriteStream(file));z.end();await done;
  const p=await new BackupService(s,{withStopped:async(_id,fn)=>fn()}).restore(file);expect(p.languages).toEqual(['en-NZ']);expect(p.fingerprint).toEqual(DEFAULT_FINGERPRINT);expect(p.proxyId).toBeTruthy();expect(p.proxy?.name).toBe('Legacy');expect(p.proxy?.hasPassword).toBe(false);
 }finally{s.close();cleanup(root);}
});
it('restores an old version 2 archive with multiple languages using its primary locale',async()=>{
 const root=tempRoot();const s=new ProfileService(root,testSecrets());try{const z=new ZipFile();z.addBuffer(Buffer.from(JSON.stringify({version:2,profile:{name:'Legacy v2',note:'',startUrls:['about:blank'],languages:['de-DE','fr-FR'],proxy:null}})),'manifest.json');const file=join(root,'v2-multiple.zip');const done=pipeline(z.outputStream,createWriteStream(file));z.end();await done;
   const p=await new BackupService(s,{withStopped:async(_id,fn)=>fn()}).restore(file);expect(p.languages).toEqual(['de-DE']);expect(p.fingerprint).toEqual(DEFAULT_FINGERPRINT);
  const invalid=new ZipFile();invalid.addBuffer(Buffer.from(JSON.stringify({version:2,profile:{name:'Broken',note:'',startUrls:['about:blank'],languages:[],proxy:null}})),'manifest.json');const invalidFile=join(root,'v2-empty.zip');const invalidDone=pipeline(invalid.outputStream,createWriteStream(invalidFile));invalid.end();await invalidDone;await expect(new BackupService(s,{withStopped:async(_id,fn)=>fn()}).restore(invalidFile)).rejects.toThrow();
 }finally{s.close();cleanup(root);}
});
it('does not leave a saved proxy when restoring metadata with missing staged data fails',async()=>{
 const root=tempRoot();const s=new ProfileService(root,testSecrets());try{await expect(s.restoreProfile({...valid}, {name:'P',kind:'http',host:'localhost',port:80},join(root,'missing'))).rejects.toThrow();expect(await s.listProxies()).toEqual([]);expect(await s.list()).toEqual([]);}finally{s.close();cleanup(root);}
});
