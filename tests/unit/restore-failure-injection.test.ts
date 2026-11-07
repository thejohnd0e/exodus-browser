import {it,expect} from 'vitest';
import {join} from 'node:path';
import {existsSync,mkdirSync,readdirSync,writeFileSync} from 'node:fs';
import {BackupService} from '../../src/main/backups/service';
import {ProfileService} from '../../src/main/profiles/service';
import {SessionStore} from '../../src/main/sessions/store';
import {valid,tempRoot,testSecrets,cleanup} from '../fixtures/profiles';
const lease={withStopped:async<T>(_id:string,fn:()=>Promise<T>)=>fn()};
const proxy={name:'P',kind:'http' as const,host:'localhost',port:80,password:'secret-password'};
function staged(root:string){const dir=join(root,'staged-data');mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'Cookies'),'data');return dir;}
function profileDirectories(root:string){const dir=join(root,'profiles');return existsSync(dir)?readdirSync(dir):[];}

// The profile directory is published by a rename inside the database transaction. A failure at
// either later stage must leave no directory, no profile row and no saved proxy behind.
it.each(['after-directory-rename','after-database-writes'] as const)('leaves nothing behind when a restore fails at %s',async stage=>{
  const root=tempRoot();const s=new ProfileService(root,testSecrets());
  try{
    await expect(s.restoreProfile({...valid},proxy,staged(root),{onStage:name=>{if(name===stage)throw Error('injected');}})).rejects.toThrow('injected');
    expect(profileDirectories(root)).toEqual([]);
    expect(await s.list()).toEqual([]);
    expect(await s.listProxies()).toEqual([]);
    expect(existsSync(join(root,'staged-data'))).toBe(false);
  }finally{s.close();cleanup(root);}
});

it('removes the restored profile and proxy when saving its session fails after the database commit',async()=>{
  const root=tempRoot();const s=new ProfileService(root,testSecrets());const sessions=new SessionStore(root);
  try{
    const source=await s.create({...valid,restoreLastSession:true});
    await sessions.write(source.id,{version:1,urls:['https://saved.example/'],updatedAt:new Date().toISOString()});
    const file=join(root,'backup.zip');await new BackupService(s,lease,undefined,sessions).create(source.id,file);
    const before=(await s.list()).map(p=>p.id);
    const failing={read:()=>sessions.read(source.id),write:async()=>{throw Error('session disk full');},remove:()=>sessions.remove('00000000-0000-4000-8000-000000000000')} as unknown as SessionStore;
    await expect(new BackupService(s,lease,undefined,failing).restore(file)).rejects.toThrow('session disk full');
    expect((await s.list()).map(p=>p.id)).toEqual(before);
    expect(profileDirectories(root)).toEqual([source.id]);
    expect(readdirSync(root).filter(n=>n.startsWith('.restore-'))).toEqual([]);
  }finally{s.close();cleanup(root);}
});
