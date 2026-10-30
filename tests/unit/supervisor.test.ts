import {it,expect,vi} from 'vitest';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Supervisor} from '../../src/main/runtime/supervisor';
import {ProfileService} from '../../src/main/profiles/service';
import {tempRoot,testSecrets,valid,cleanup} from '../fixtures/profiles';
import {DEFAULT_FINGERPRINT} from '../../src/shared/fingerprint';
import type {BrowserEngineAdapter} from '../../src/main/engines/types';
function fixture(){const ends:Array<()=>void>=[];let launches=0;
  const engine:BrowserEngineAdapter={capabilities:{fingerprints:false},validate:async()=>{},launch:async()=>{launches++;let finish!:()=>void;const exit=new Promise<{code:number|null;signal:string|null}>(r=>{finish=()=>r({code:0,signal:null});});ends.push(finish);return {pid:100+launches,executable:'fixture.exe',startedAt:new Date().toISOString(),exit,stop:async()=>finish()};}};
  return {engine,launches:()=>launches,exit:(i=0)=>ends[i]()};}
const wait=async(fn:()=>void)=>{for(let i=0;i<50;i++){try{fn();return;}catch{await new Promise(r=>setTimeout(r,10));}}fn();};
it('prevents duplicate starts, allows different profiles and releases them on exit',async()=>{
  const root=tempRoot();const profiles=new ProfileService(root,testSecrets());const f=fixture();const s=new Supervisor(profiles,f.engine,{probe:async()=>[]});
  try{const a=await profiles.create(valid);const b=await profiles.create(valid);const result=await Promise.allSettled([s.start(a.id),s.start(a.id)]);expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(f.launches()).toBe(1);await s.start(b.id);expect(s.states()[b.id]).toBe('running');await expect(s.assertStopped(a.id)).rejects.toThrow();await s.stop(a.id);expect(s.states()[a.id]).toBe('stopped');await s.stop(b.id);expect(s.states()[b.id]).toBe('stopped');await s.shutdown();}finally{profiles.close();cleanup(root);}
});
it('holds an exclusive stopped-profile lease for backup and editing',async()=>{
  const root=tempRoot();const profiles=new ProfileService(root,testSecrets());const f=fixture();const s=new Supervisor(profiles,f.engine,{probe:async()=>[]});
  try{const a=await profiles.create(valid);await s.withStopped(a.id,async()=>{await expect(s.start(a.id)).rejects.toThrow();});expect(f.launches()).toBe(0);}finally{profiles.close();cleanup(root);}
});
it('keeps a failed stop blocked and does not claim the browser has stopped',async()=>{
  const root=tempRoot();const profiles=new ProfileService(root,testSecrets());const f=fixture();const launch=f.engine.launch;f.engine.launch=async i=>({...await launch(i),stop:async()=>{throw Error('timeout');}});const s=new Supervisor(profiles,f.engine,{probe:async()=>[]});
  try{const a=await profiles.create(valid);await s.start(a.id);await expect(s.stop(a.id)).rejects.toThrow();expect(s.states()[a.id]).toBe('blocked');await expect(s.assertStopped(a.id)).rejects.toThrow();f.exit(0);await new Promise(r=>setTimeout(r,20));}finally{profiles.close();cleanup(root);}
});
it('closes the proxy lease when browser launch fails',async()=>{
  const root=tempRoot();const profiles=new ProfileService(root,testSecrets());const close=vi.fn(async()=>{});
  const engine:BrowserEngineAdapter={capabilities:{fingerprints:false},validate:async()=>{},launch:async()=>{throw Error('LAUNCH_FAILED');}};
  const s=new Supervisor(profiles,engine,{probe:async()=>[],bridge:async()=>({url:'http://127.0.0.1:1',close})});
  try{const p=await profiles.createProxy({name:'P',kind:'http',host:'localhost',port:8080});const a=await profiles.create({...valid,proxyId:p.id});await expect(s.start(a.id)).rejects.toThrow();expect(close).toHaveBeenCalledTimes(1);}finally{profiles.close();cleanup(root);}
});
it('closes the proxy lease when the browser exits on its own',async()=>{
  const root=tempRoot();const profiles=new ProfileService(root,testSecrets());const close=vi.fn(async()=>{});const f=fixture();
  const s=new Supervisor(profiles,f.engine,{probe:async()=>[],bridge:async()=>({url:'http://127.0.0.1:1',close})});
  try{const p=await profiles.createProxy({name:'P',kind:'http',host:'localhost',port:8080});const a=await profiles.create({...valid,proxyId:p.id});await s.start(a.id);f.exit(0);await wait(()=>expect(close).toHaveBeenCalledTimes(1));expect(s.states()[a.id]).toBe('stopped');}finally{profiles.close();cleanup(root);}
});
it('treats a leftover runtime journal as a blocked profile',async()=>{
  const root=tempRoot();const profiles=new ProfileService(root,testSecrets());
  try{const a=await profiles.create(valid);await writeFile(join(root,'runtime-'+a.id+'.json'),'{}');const s=new Supervisor(profiles,fixture().engine,{probe:async()=>[]});await s.recover();expect(s.states()[a.id]).toBe('blocked');}finally{profiles.close();cleanup(root);}
});
it('keeps running proxy snapshots and uses an edited shared proxy only for new launches',async()=>{
 const root=tempRoot();const profiles=new ProfileService(root,testSecrets());const f=fixture();const snapshots:Array<{host:string;password?:string}>=[];
 const s=new Supervisor(profiles,f.engine,{probe:async()=>[],bridge:async input=>{snapshots.push({...input});return {url:'http://127.0.0.1:1',close:async()=>{}};}});
 try{const p=await profiles.createProxy({name:'P',kind:'http',host:'old.example',port:8080,password:'old-secret'});const a=await profiles.create({...valid,proxyId:p.id});const b=await profiles.create({...valid,proxyId:p.id});await s.start(a.id);
 await profiles.updateProxy(p.id,{name:'P',kind:'http',host:'new.example',port:8080,password:'new-secret'});await s.start(b.id);
 expect(snapshots.map(p=>p.host)).toEqual(['old.example','new.example']);expect(snapshots[0].password).toBe('old-secret');expect(s.runningProxyVersions()[a.id]).toBe(p.id+':'+p.updatedAt);expect(s.runningProxyVersions()[b.id]).not.toBe(s.runningProxyVersions()[a.id]);await s.shutdown();
 }finally{profiles.close();cleanup(root);}
});
it('passes the stored fingerprint to the engine',async()=>{
 const root=tempRoot();const profiles=new ProfileService(root,testSecrets());const seen:Array<unknown>=[];
 const engine:BrowserEngineAdapter={capabilities:{fingerprints:true},validate:async()=>{},launch:async input=>{seen.push(input.fingerprint);let finish!:()=>void;const exit=new Promise<{code:number|null;signal:string|null}>(r=>{finish=()=>r({code:0,signal:null});});await Promise.resolve();return {pid:1,executable:'fixture.exe',startedAt:new Date().toISOString(),exit,stop:async()=>finish()};}};
 const s=new Supervisor(profiles,engine,{probe:async()=>[]});
 try{const fingerprint={...DEFAULT_FINGERPRINT,canvas:'noise' as const,timezone:{mode:'manual' as const,value:'Europe/Paris'}};const a=await profiles.create({...valid,fingerprint});await s.start(a.id);expect(seen[0]).toEqual(fingerprint);await s.stop(a.id);}finally{profiles.close();cleanup(root);}
});
