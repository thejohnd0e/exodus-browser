import {it,expect,vi} from 'vitest';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {join} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {ZipFile} from 'yazl';
import {PortableProfileService} from '../../src/main/portable/service';
import {createPortableOperations} from '../../src/main/portable/operations';
import {extractPortableArchive} from '../../src/main/portable/archive';
import {ProfileService} from '../../src/main/profiles/service';
import {SessionStore} from '../../src/main/sessions/store';
import {profilePath} from '../../src/main/profiles/paths';
import {DEFAULT_FINGERPRINT} from '../../src/shared/fingerprint';
import {valid,tempRoot,testSecrets,cleanup} from '../fixtures/profiles';

const portable={format:'exodus-portable',version:1,profile:{name:'Portable work',note:'',startUrls:['about:blank'],languages:['en-US'],fingerprint:DEFAULT_FINGERPRINT,fingerprintSeed:123,restoreLastSession:true,proxy:null},session:{version:1,urls:['https://tabs.example/'],updatedAt:new Date().toISOString()}};
const cookie={name:'sid',value:'secret-cookie',domain:'example.com',path:'/',expires:null,session:true,httpOnly:true,secure:true,sameSite:'Strict'};

async function makeArchive(root:string,manifest:any=portable,cookies:any[]=[cookie]){
 const file=join(root,'input.portable.zip');const zip=new ZipFile();zip.addBuffer(Buffer.from(JSON.stringify(manifest)),'manifest.json');zip.addBuffer(Buffer.from(JSON.stringify(cookies)),'cookies.json');zip.addEmptyDirectory('data');zip.addBuffer(Buffer.from('site-data'),'data/Default/Preferences');
 const done=pipeline(zip.outputStream,createWriteStream(file,{flags:'wx'}));zip.end();await done;return file;
}
function setup(options:any={}){
 const root=tempRoot();const profiles=new ProfileService(root,testSecrets());const sessions=new SessionStore(root);const stored:any[]=[];const closed=vi.fn();
  const service=new PortableProfileService(profiles,{withStopped:async<T>(_id:string,fn:()=>Promise<T>)=>fn()}, {resolveExecutable:async()=>process.execPath},sessions,{
  probe:options.probe??(async()=>[]),launch:options.launch??(async()=>({client:{send:async(method:string,params:any={})=>{
   if(method==='Storage.getCookies')return {cookies:stored};
   if(method==='Storage.setCookies'){stored.splice(0,stored.length,...params.cookies);return {};}
   return {};
  },close:vi.fn()},close:async()=>{closed();}})),...options,
 });
 return {root,profiles,sessions,service,stored,closed};
}

it('exports a bounded portable archive without profile UUID, native cookie databases, or proxy secrets',async()=>{
 const {root,profiles,service,stored,closed,sessions}=setup();
 try{
  const proxy=await profiles.createProxy({name:'Private proxy',kind:'http',host:'proxy.example',port:8080,username:'user',password:'never-export'});
  const profile=await profiles.create({...valid,proxyId:proxy.id,restoreLastSession:true,fingerprintSeed:987});
  const directory=profilePath(root,profile.id);await mkdir(join(directory,'Default'));await writeFile(join(directory,'Default','Preferences'),'safe data');await writeFile(join(directory,'Default','Cookies'),'native-cookie-db');await writeFile(join(directory,'Local State'),'native state');stored.push(cookie);
  await sessions.write(profile.id,{version:1,urls:['https://saved.example/'],updatedAt:new Date().toISOString()});
  const archive=join(root,'portable.zip');await service.exportFile(profile.id,archive);
  const unpacked=join(root,'unpacked');await mkdir(unpacked);const result=await extractPortableArchive(archive,unpacked);
  const manifest=JSON.parse(await readFile(join(unpacked,'manifest.json'),'utf8'));
  expect(manifest.profile).toMatchObject({name:profile.name,fingerprintSeed:987,restoreLastSession:true,proxy:{username:'user',hasPassword:true}});
  expect(JSON.stringify(manifest)).not.toContain(profile.id);expect(JSON.stringify(manifest)).not.toContain('never-export');
  expect(result.cookies).toMatchObject([{name:'sid',value:'secret-cookie'}]);
  expect(await readFile(join(unpacked,'data/Default/Preferences'),'utf8')).toBe('safe data');
  expect(await readdir(join(unpacked,'data/Default'))).toEqual(['Preferences']);
  expect(closed).toHaveBeenCalledOnce();
 }finally{profiles.close();cleanup(root);}
});

it('rejects archive output inside the source profile, orphan browsers, a missing engine, and preserves no partial output',async()=>{
 const {root,profiles,service}=setup();
 try{
  const profile=await profiles.create(valid);const inside=join(profilePath(root,profile.id),'inside.zip');
  await expect(service.exportFile(profile.id,inside)).rejects.toThrow('PORTABLE_DESTINATION_INSIDE_PROFILE');
  const orphan=new PortableProfileService(profiles,{withStopped:async<T>(_id:string,fn:()=>Promise<T>)=>fn()},{resolveExecutable:async()=>process.execPath},new SessionStore(root),{probe:async()=>[{pid:5,executable:process.execPath,createdAt:'',commandLine:`--user-data-dir=${profilePath(root,profile.id)}`}],launch:async()=>{throw Error('unexpected launch');}});
  await expect(orphan.exportFile(profile.id,join(root,'orphan.zip'))).rejects.toThrow('ORPHAN_BROWSER');
  const missing=new PortableProfileService(profiles,{withStopped:async<T>(_id:string,fn:()=>Promise<T>)=>fn()},{resolveExecutable:async()=>join(root,'missing.exe')},new SessionStore(root),{probe:async()=>[]});
  await expect(missing.exportFile(profile.id,join(root,'missing.zip'))).rejects.toThrow('ENGINE_NOT_READY');
  await expect(service.exportFile(profile.id,join(root,'missing-parent','out.zip'))).rejects.toThrow();
  expect(await readdir(root)).not.toContain('missing-parent');
 }finally{profiles.close();cleanup(root);}
});

it('imports into a new UUID while preserving profile seed, session, cookies, and requiring missing proxy credentials',async()=>{
 const {root,profiles,sessions,service,stored,closed}=setup();
 try{
  const manifest={...portable,profile:{...portable.profile,proxy:{name:'Authenticated',kind:'http',host:'proxy.example',port:8080,username:'alice',hasPassword:true}}};
  const archive=await makeArchive(root,manifest,[cookie]);const imported=await service.importFile(archive);
  expect(imported.id).not.toBe('');expect(imported.fingerprintSeed).toBe(123);expect(imported.restoreLastSession).toBe(true);expect(imported.proxy?.requiresPassword).toBe(true);
  expect(imported.proxy?.hasPassword).toBe(false);expect(await sessions.read(imported.id)).toMatchObject({urls:['https://tabs.example/']});
  expect(stored).toHaveLength(1);expect(await readFile(join(profilePath(root,imported.id),'Default/Preferences'),'utf8')).toBe('site-data');
  expect(()=>profiles.getLaunchInput(imported.id)).toThrow('PROXY_PASSWORD_REQUIRED');
  const reexport=join(root,'reexport.zip');await service.exportFile(imported.id,reexport);const unpack=join(root,'reexported');await mkdir(unpack);const reexported=await extractPortableArchive(reexport,unpack);
  expect(reexported.manifest.profile.proxy?.hasPassword).toBe(true);
  await profiles.updateProxy(imported.proxy!.id,{name:'Authenticated',kind:'http',host:'proxy.example',port:8080,username:'alice',password:'new-secret'});
  expect(profiles.getLaunchInput(imported.id).proxy?.password).toBe('new-secret');expect(profiles.getProxy(imported.proxy!.id).requiresPassword).toBeFalsy();
  expect(closed).toHaveBeenCalledTimes(2);
 }finally{profiles.close();cleanup(root);}
});

it('rejects a busy profile and does not leave import staging after malformed input',async()=>{
 const {root,profiles,service}=setup();
 try{
  const profile=await profiles.create(valid);
  const busy=new PortableProfileService(profiles,{withStopped:async<T>():Promise<T>=>{throw Error('PROFILE_BUSY');}},{resolveExecutable:async()=>process.execPath},new SessionStore(root));
  await expect(busy.exportFile(profile.id,join(root,'busy.zip'))).rejects.toThrow('PROFILE_BUSY');
  const bad=join(root,'bad.zip');await writeFile(bad,'not a zip');await expect(service.importFile(bad)).rejects.toThrow();
  expect((await readdir(root)).filter(name=>name.startsWith('.portable-import-'))).toEqual([]);
 }finally{profiles.close();cleanup(root);}
});

it('does not publish a partial archive when writing the staged ZIP fails',async()=>{
 const {root,profiles}=setup();
 try{
  const profile=await profiles.create(valid);const destination=join(root,'partial.zip');
  const service=new PortableProfileService(profiles,{withStopped:async<T>(_id:string,fn:()=>Promise<T>)=>fn()},{resolveExecutable:async()=>process.execPath},new SessionStore(root),{
   probe:async()=>[],launch:async()=>({client:{send:async()=>({cookies:[]})},close:async()=>undefined}),
   writeArchive:async(_zip,path)=>{await writeFile(path,'partial archive bytes');throw Error('DISK_FULL');},
  });
  await expect(service.exportFile(profile.id,destination)).rejects.toThrow();
  expect(await readdir(root)).not.toContain('partial.zip');expect((await readdir(root)).filter(name=>name.includes('.partial-'))).toEqual([]);
 }finally{profiles.close();cleanup(root);}
});

it('propagates an unsafe session snapshot instead of silently exporting without its tabs',async()=>{
 const {root,profiles}=setup();
 try{
  const profile=await profiles.create({...valid,restoreLastSession:true});
  const sessions={read:async()=>{throw Error('UNSAFE_SESSION_PATH');}} as unknown as SessionStore;
  const service=new PortableProfileService(profiles,{withStopped:async<T>(_id:string,fn:()=>Promise<T>)=>fn()},{resolveExecutable:async()=>process.execPath},sessions,{probe:async()=>[],launch:async()=>({client:{send:async()=>({cookies:[]})},close:async()=>undefined})});
  await expect(service.exportFile(profile.id,join(root,'unsafe-session.zip'))).rejects.toThrow('UNSAFE_SESSION_PATH');
 }finally{profiles.close();cleanup(root);}
});

it('keeps a failed maintenance close tracked so shutdown cleanup can retry it',async()=>{
 const {root,profiles}=setup();let attempts=0;
 try{
  const profile=await profiles.create(valid);
  const service=new PortableProfileService(profiles,{withStopped:async<T>(_id:string,fn:()=>Promise<T>)=>fn()},{resolveExecutable:async()=>process.execPath},new SessionStore(root),{
   probe:async()=>[],launch:async()=>({client:{send:async()=>({cookies:[]})},close:async()=>{if(++attempts===1)throw Error('first close failed');}}),
  });
  await expect(service.exportFile(profile.id,join(root,'close-failure.zip'))).rejects.toThrow('PORTABLE_BROWSER_CLOSE_FAILED');
  await service.closeAll();
  expect(attempts).toBe(2);
 }finally{profiles.close();cleanup(root);}
});

it.each(['after-cookie-restore','after-directory-rename','after-session-publication','after-database-writes'] as const)('compensates import failure at %s without publishing profile, proxy, session, or data',async(stage)=>{
 const {root,profiles,sessions,service}=setup({failAt:stage});
 try{
  const archive=await makeArchive(root,{...portable,profile:{...portable.profile,proxy:{name:'Proxy',kind:'http',host:'proxy.example',port:80,hasPassword:true}}});
  await expect(service.importFile(archive)).rejects.toThrow('INJECTED_PORTABLE_FAILURE');
  expect(await profiles.list()).toEqual([]);expect(profiles.listProxies()).toEqual([]);
  expect(await readdir(join(root,'profiles')).catch(()=>[])).toEqual([]);
  expect(await readdir(join(root,'sessions')).catch(()=>[])).toEqual([]);
  expect((await readdir(root)).filter(name=>name.startsWith('.portable-import-'))).toEqual([]);
 }finally{profiles.close();cleanup(root);}
});

it('reports rollback uncertainty without exposing cleanup details when session compensation fails',async()=>{
 const {root,profiles}=setup();const staged=join(root,'staged-profile');
 try{
  await mkdir(staged);await writeFile(join(staged,'Preferences'),'fixture');
  await expect(profiles.restoreProfile({...valid,fingerprint:DEFAULT_FINGERPRINT,restoreLastSession:false,fingerprintSeed:8},null,staged,{
   session:{version:1,urls:['about:blank'],updatedAt:new Date().toISOString()},
   prepareSession:async()=>({publish:()=>undefined,rollback:()=>{throw Error('private cleanup path');}}),
   onStage:stage=>{if(stage==='after-directory-rename')throw Error('safe primary failure');},
  })).rejects.toThrow('PORTABLE_ROLLBACK_FAILED');
  expect(await profiles.list()).toEqual([]);expect(await profiles.listProxies()).toEqual([]);
 }finally{profiles.close();cleanup(root);}
});

it('cancels export confirmation/save and import selection before any archive operation',async()=>{
 const portable= {exportFile:vi.fn(),importFile:vi.fn()};
  const ops=createPortableOperations({portable,showOpen:vi.fn(async()=>({canceled:true,filePaths:[]})),showSave:vi.fn(async()=>({canceled:true}))} as any);
 await expect(ops.exportProfile('00000000-0000-4000-8000-000000000001')).resolves.toBeNull();
 await expect(ops.importProfile()).resolves.toBeNull();
 expect(portable.exportFile).not.toHaveBeenCalled();expect(portable.importFile).not.toHaveBeenCalled();
});

it('shows the native destination dialog after renderer confirmation',async()=>{
  const portable={exportFile:vi.fn(async()=>undefined),importFile:vi.fn()};const showSave=vi.fn(async()=>({canceled:false,filePath:'C:\\safe\\profile.zip'}));
  const ops=createPortableOperations({portable,showOpen:vi.fn(),showSave} as any);
 await expect(ops.exportProfile('00000000-0000-4000-8000-000000000001')).resolves.toEqual({fileName:'profile.zip'});
  expect(showSave).toHaveBeenCalledOnce();expect(portable.exportFile).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001','C:\\safe\\profile.zip');
});
