import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {ChromiumAdapter} from '../../src/main/engines/chromium';
import {CdpClient} from '../../src/main/cdp/client';
import {SessionStore} from '../../src/main/sessions/store';
import {ProfileService} from '../../src/main/profiles/service';
import {Supervisor} from '../../src/main/runtime/supervisor';
import {DEFAULT_FINGERPRINT} from '../../src/shared/fingerprint';
import {tempRoot,cleanup,testSecrets,valid} from '../fixtures/profiles';

const base=join(process.env.LOCALAPPDATA??'','ms-playwright');
const candidates=existsSync(base)?readdirSync(base).filter(name=>name.startsWith('chromium-')).sort().reverse():[];
const executable=process.env.LOCAL_PROFILES_TEST_CHROMIUM??join(base,candidates[0]??'missing','chrome-win64','chrome.exe');

it('tracks real page tabs and flushes their ordered URLs before graceful stop',async()=>{
 if(!existsSync(executable))throw Error('BLOCKED: no local Chromium');
 const requests:string[]=[];
 const server=createServer((request,response)=>{requests.push(request.url??'');response.setHeader('Content-Type','text/html');response.end('<!doctype html><title>Session test</title>');});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const urls=[`${origin}/first`,`${origin}/second`];
 const root=tempRoot();const store=new SessionStore(root);const engine=new ChromiumAdapter(executable);const profileId='123e4567-e89b-42d3-a456-426614174000';
 try{
  const browser=await engine.launch({profileId,userDataDir:root,languages:['en-US'],startUrls:urls,fingerprint:DEFAULT_FINGERPRINT,fingerprintSeed:42,onSessionSnapshot:value=>store.write(profileId,value)});
  for(let i=0;i<100&&(!requests.includes('/first')||!requests.includes('/second'));i++)await new Promise(resolve=>setTimeout(resolve,50));
  await new Promise(resolve=>setTimeout(resolve,500));
  await browser.stop();await browser.exit;
  const snapshot=await store.read(profileId);
  expect(snapshot?.urls).toEqual(urls);
  expect(requests).toContain('/first');expect(requests).toContain('/second');
 }finally{server.closeAllConnections();server.close();cleanup(root);}
},30000);

it('flushes the latest tabs after Chromium exits outside the managed stop path',async()=>{
 if(!existsSync(executable))throw Error('BLOCKED: no local Chromium');
 const server=createServer((_request,response)=>{response.setHeader('Content-Type','text/html');response.end('<!doctype html><title>Unexpected exit</title>');});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const root=tempRoot();const store=new SessionStore(root);const profileId='123e4567-e89b-42d3-a456-426614174001';
 let client:CdpClient|undefined;
 const engine=new ChromiumAdapter(executable,async url=>{client=await CdpClient.connect(url);return client;});
 try{
  const browser=await engine.launch({profileId,userDataDir:root,languages:['en-US'],startUrls:[`${origin}/unexpected`],fingerprint:DEFAULT_FINGERPRINT,onSessionSnapshot:value=>store.write(profileId,value)});
  await new Promise(resolve=>setTimeout(resolve,400));
  await client!.send('Browser.close',{});await browser.exit;
  expect((await store.read(profileId))?.urls).toEqual([`${origin}/unexpected`]);
 }finally{server.closeAllConnections();server.close();cleanup(root);}
},30000);

it('restores saved tabs only when enabled and falls back to start pages for empty sessions',async()=>{
 if(!existsSync(executable))throw Error('BLOCKED: no local Chromium');
 const requests:string[]=[];
 const server=createServer((request,response)=>{requests.push(request.url??'');response.setHeader('Content-Type','text/html');response.end('<!doctype html><title>Restore test</title>');});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const root=tempRoot();const profiles=new ProfileService(root,testSecrets());const sessions=new SessionStore(root);
 const supervisor=new Supervisor(profiles,new ChromiumAdapter(executable),{probe:async()=>[],sessions});
 try{
  const run=async(restoreLastSession:boolean,savedUrls:string[]|null,expectedPath:string)=>{
   const before=requests.length;
   const profile=await profiles.create({...valid,name:expectedPath,restoreLastSession,startUrls:[`${origin}/start`]});
   if(savedUrls)await sessions.write(profile.id,{version:1,urls:savedUrls.map(path=>`${origin}/${path}`),updatedAt:new Date().toISOString()});
   await supervisor.start(profile.id);
   for(let i=0;i<100&&!requests.slice(before).includes(`/${expectedPath}`);i++)await new Promise(resolve=>setTimeout(resolve,50));
   await supervisor.stop(profile.id);
   expect(requests.slice(before)).toContain(`/${expectedPath}`);
  };
  await run(true,['saved'],'saved');
  await run(false,['ignored'],'start');
  await run(true,null,'start');
 }finally{profiles.close();server.closeAllConnections();server.close();cleanup(root);}
},45000);
