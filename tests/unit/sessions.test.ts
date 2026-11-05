import {it,expect} from 'vitest';
import {sessionSnapshotSchema} from '../../src/shared/session';
import {SessionStore} from '../../src/main/sessions/store';
import {SessionTracker} from '../../src/main/sessions/tracker';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

const snapshot=(urls:string[])=>({version:1 as const,urls,updatedAt:'2026-10-31T00:00:00.000Z'});

it('accepts only eligible HTTP(S) and blank-tab URLs',()=>{
 expect(sessionSnapshotSchema.safeParse(snapshot(['https://example.com/','about:blank'])).success).toBe(true);
 for(const url of ['file:///secret','chrome://settings','devtools://devtools','chrome-extension://id/page','https://user:pass@example.com'])
  expect(sessionSnapshotSchema.safeParse(snapshot([url])).success,url).toBe(false);
});

it('limits saved tab count and URL length',()=>{
 expect(sessionSnapshotSchema.safeParse(snapshot(Array.from({length:101},()=> 'about:blank'))).success).toBe(false);
 expect(sessionSnapshotSchema.safeParse(snapshot(['https://example.com/'+ 'a'.repeat(8200)])).success).toBe(false);
});

it('rejects malformed snapshots and extra fields',()=>{
 expect(sessionSnapshotSchema.safeParse({...snapshot([]),unexpected:true}).success).toBe(false);
 expect(sessionSnapshotSchema.safeParse({...snapshot([]),updatedAt:'not-a-date'}).success).toBe(false);
});

it('persists snapshots atomically, treats missing and invalid data as absent, and removes them',async()=>{
 const root=await mkdtemp(join(tmpdir(),'exodus-sessions-'));const store=new SessionStore(root);const id=randomUUID();
 try{
  expect(await store.read(id)).toBeNull();
  const value=snapshot(['https://example.com/']);
  await store.write(id,value);
  expect(await store.read(id)).toEqual(value);
  await writeFile(join(root,'sessions',`${id}.json`),'{broken');
  expect(await store.read(id)).toBeNull();
  await store.write(id,value);
  expect(JSON.parse(await readFile(join(root,'sessions',`${id}.json`),'utf8'))).toEqual(value);
  await store.remove(id);expect(await store.read(id)).toBeNull();
 }finally{await rm(root,{recursive:true,force:true});}
});

it('rejects snapshots exceeding the on-disk size limit',async()=>{
 const root=await mkdtemp(join(tmpdir(),'exodus-sessions-'));const store=new SessionStore(root);const id=randomUUID();
 try{
  await mkdir(join(root,'sessions'),{recursive:true});
  await writeFile(join(root,'sessions',`${id}.json`),' '.repeat(1024**2+1));
  await expect(store.read(id)).rejects.toThrow('SESSION_TOO_LARGE');
 }finally{await rm(root,{recursive:true,force:true});}
});

it('tracks page tabs in target order, excludes internal URLs, and flushes immediately',async()=>{
 const saved: string[][]=[];const tracker=new SessionTracker(async value=>{saved.push(value.urls);},()=>0);
 tracker.onEvent({method:'Target.targetCreated',params:{targetInfo:{targetId:'a',type:'page',url:'https://a.example/'}}});
 tracker.onEvent({method:'Target.targetCreated',params:{targetInfo:{targetId:'dev',type:'page',url:'chrome://settings'}}});
 tracker.onEvent({method:'Target.targetCreated',params:{targetInfo:{targetId:'b',type:'page',url:'https://b.example/'}}});
 tracker.onEvent({method:'Target.targetInfoChanged',params:{targetInfo:{targetId:'a',type:'page',url:'https://a.example/next'}}});
 tracker.onEvent({method:'Target.targetDestroyed',params:{targetId:'b'}});
 await tracker.flush();
 expect(saved).toEqual([['https://a.example/next']]);
 tracker.dispose();
});

it('caps snapshots at 100 tabs and does not lose events arriving during a flush',async()=>{
 let release!:()=>void;let calls=0;const gate=new Promise<void>(resolve=>{release=resolve;});const saved:string[][]=[];
 const tracker=new SessionTracker(async value=>{calls++;if(calls===1)await gate;saved.push(value.urls);},()=>0);
 for(let i=0;i<101;i++)tracker.onEvent({method:'Target.targetCreated',params:{targetInfo:{targetId:String(i),type:'page',url:`https://tab${i}.example/`}}});
 const flushing=tracker.flush();
 tracker.onEvent({method:'Target.targetInfoChanged',params:{targetInfo:{targetId:'0',type:'page',url:'https://updated.example/'}}});
 release();await flushing;
 expect(saved).toHaveLength(2);expect(saved[0]).toHaveLength(100);expect(saved[1][0]).toBe('https://updated.example/');tracker.dispose();
});
