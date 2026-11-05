import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {existsSync,readdirSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PortableProfileService} from '../../src/main/portable/service';
import {ProfileService} from '../../src/main/profiles/service';
import {SessionStore} from '../../src/main/sessions/store';
import {ChromiumAdapter} from '../../src/main/engines/chromium';
import {DEFAULT_FINGERPRINT} from '../../src/shared/fingerprint';
import {valid,testSecrets} from '../fixtures/profiles';

const base=join(process.env.LOCALAPPDATA??'','ms-playwright');
const candidates=existsSync(base)?readdirSync(base).filter(name=>name.startsWith('chromium-')).sort().reverse():[];
const executable=process.env.LOCAL_PROFILES_TEST_CHROMIUM??join(base,candidates[0]??'missing','chrome-win64','chrome.exe');

it('transfers site data, cookies, session tabs and seed without linking imported mutations to the source',async()=>{
 if(!existsSync(executable))throw Error('BLOCKED: no local Chromium');
 const reports=new Map<string,{local:string|null;database:string|null;cookie:string}>();
 const ready=new Set<string>();
 const server=createServer((request,response)=>{
  const url=new URL(request.url??'/',`http://${request.headers.host}`);const name=url.searchParams.get('name')??'unknown';
  if(url.pathname==='/seed'){
   response.setHeader('Set-Cookie','portable=source; Path=/; Max-Age=86400; SameSite=Lax');response.setHeader('Content-Type','text/html');
   response.end(`<!doctype html><script>localStorage.setItem('portable','source');const r=indexedDB.open('portable-db',1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onsuccess=()=>{const tx=r.result.transaction('state','readwrite');tx.objectStore('state').put('source','value');tx.oncomplete=()=>fetch('/ready?name=${name}')}</script>`);return;
  }
  if(url.pathname==='/mutate'){
   response.setHeader('Content-Type','text/html');response.end(`<!doctype html><script>localStorage.setItem('portable','imported');document.cookie='portable=imported; Path=/; Max-Age=86400; SameSite=Lax';const r=indexedDB.open('portable-db');r.onsuccess=()=>{const tx=r.result.transaction('state','readwrite');tx.objectStore('state').put('imported','value');tx.oncomplete=()=>fetch('/ready?name=${name}')}</script>`);return;
  }
  if(url.pathname==='/verify'){
   response.setHeader('Content-Type','text/html');response.end(`<!doctype html><script>const r=indexedDB.open('portable-db');r.onsuccess=()=>{const tx=r.result.transaction('state');const q=tx.objectStore('state').get('value');q.onsuccess=()=>fetch('/report?name=${name}&local='+encodeURIComponent(localStorage.getItem('portable'))+'&database='+encodeURIComponent(q.result||''))}</script>`);return;
  }
  if(url.pathname==='/ready')ready.add(name);
  if(url.pathname==='/report')reports.set(name,{local:url.searchParams.get('local'),database:url.searchParams.get('database'),cookie:request.headers.cookie??''});
  response.end('ok');
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=(server.address() as import('node:net').AddressInfo).port;const origin=`http://127.0.0.1:${port}`;
 const sourceRoot=await mkdtemp(join(tmpdir(),'portable-source-app-'));const targetRoot=await mkdtemp(join(tmpdir(),'portable-target-app-'));
 const sourceProfiles=new ProfileService(sourceRoot,testSecrets());const targetProfiles=new ProfileService(targetRoot,testSecrets());
 const sourceSessions=new SessionStore(sourceRoot);const targetSessions=new SessionStore(targetRoot);const engine=new ChromiumAdapter(executable);
 const lease={withStopped:async<T>(_id:string,fn:()=>Promise<T>)=>fn()};
 const sourcePortable=new PortableProfileService(sourceProfiles,lease,{resolveExecutable:async()=>executable},sourceSessions,{probe:async()=>[]});
 const targetPortable=new PortableProfileService(targetProfiles,lease,{resolveExecutable:async()=>executable},targetSessions,{probe:async()=>[]});
 const browsers:Array<{stop:()=>Promise<void>}>=[];
 async function visit(profileId:string,userDataDir:string,path:string,name:string){
  const browser=await engine.launch({profileId,userDataDir,languages:['en-US'],startUrls:[`${origin}${path}?name=${name}`],fingerprint:DEFAULT_FINGERPRINT});browsers.push(browser);
  const completed=path==='/seed'||path==='/mutate'?ready:reports;
  for(let i=0;i<200&&!completed.has(name);i++)await new Promise(resolve=>setTimeout(resolve,50));
  await browser.stop();browsers.splice(browsers.indexOf(browser),1);
 }
 try{
  const source=await sourceProfiles.create({...valid,restoreLastSession:true,fingerprintSeed:987654});
  await visit(source.id,join(sourceRoot,'profiles',source.id),'/seed','seed');
  expect(ready.has('seed')).toBe(true);
  await sourceSessions.write(source.id,{version:1,urls:[`${origin}/verify?name=restored-tab`],updatedAt:new Date().toISOString()});
  const archive=join(sourceRoot,'profile.portable.zip');await sourcePortable.exportFile(source.id,archive);
  const imported=await targetPortable.importFile(archive);
  expect(imported.id).not.toBe(source.id);expect(imported.fingerprintSeed).toBe(source.fingerprintSeed);expect(imported.restoreLastSession).toBe(true);
  expect(await targetSessions.read(imported.id)).toMatchObject({urls:[`${origin}/verify?name=restored-tab`]});
  await visit(imported.id,join(targetRoot,'profiles',imported.id),'/verify','import-before-mutation');
  expect(reports.get('import-before-mutation')).toMatchObject({local:'source',database:'source',cookie:'portable=source'});
  await visit(imported.id,join(targetRoot,'profiles',imported.id),'/mutate','mutate-import');
  await visit(source.id,join(sourceRoot,'profiles',source.id),'/verify','source-after-mutation');
  expect(reports.get('source-after-mutation')).toMatchObject({local:'source',database:'source',cookie:'portable=source'});
 }finally{
  await Promise.allSettled(browsers.map(browser=>browser.stop()));
  await Promise.allSettled([sourcePortable.closeAll(),targetPortable.closeAll()]);
  sourceProfiles.close();targetProfiles.close();await Promise.all([rm(sourceRoot,{recursive:true,force:true}),rm(targetRoot,{recursive:true,force:true})]);
  server.closeAllConnections();server.close();
 }
},120000);
