import {it,expect,vi} from 'vitest';
import {join} from 'node:path';
import {writeFile,readFile} from 'node:fs/promises';
import {CookieService} from '../../src/main/cookies/service';
import {ProfileService} from '../../src/main/profiles/service';
import {tempRoot,testSecrets,valid,cleanup} from '../fixtures/profiles';
const cookie={domain:'.example.com',name:'sid',path:'/',value:'v',expirationDate:1893456000,httpOnly:true,secure:true,sameSite:'lax' as const,storeId:'0'};
function setup(extra:any={}){
  const root=tempRoot();const profiles=new ProfileService(root,testSecrets());
  const stored:any[]=[cookie];const closed=vi.fn();
  const service=new CookieService(profiles,{withStopped:async(_id,fn)=>fn()},{resolveExecutable:async()=>process.execPath},
    {probe:async()=>[],launch:(async()=>({client:{send:async(method:string,p:any)=>{
      if(method==='Target.getTargets')return {targetInfos:[{targetId:'t1',type:'page'}]};
      if(method==='Target.attachToTarget')return {sessionId:'s1'};
       if(method==='Network.setCookies'){stored.push(p.cookies[0]);return {};}
       if(method==='Storage.clearCookies'){stored.length=0;return {};}
      if(method==='Storage.getCookies')return {cookies:stored};return {};
    },close:vi.fn()},close:async()=>{closed();}})) as any,...extra});
  return {root,profiles,service,stored,closed};
}
it('imports a file and verifies persistence by reading it back',async()=>{
  const {root,profiles,service,closed}=setup();
  try{const p=await profiles.create(valid);const file=join(root,'cookies.json');await writeFile(file,JSON.stringify([cookie]));
    await expect(service.importFile(p.id,file)).resolves.toEqual({count:1,fileName:'cookies.json'});
    expect(closed).toHaveBeenCalledOnce();
  }finally{profiles.close();cleanup(root);}
});
it('reports when Chromium does not confirm persistence',async()=>{
  const {root,profiles}=setup();
  try{const p=await profiles.create(valid);const file=join(root,'cookies.json');await writeFile(file,JSON.stringify([cookie]));
    const failing=new CookieService(profiles,{withStopped:async(_id,fn)=>fn()},{resolveExecutable:async()=>process.execPath},
      {probe:async()=>[],launch:(async()=>({client:{send:async(method:string)=>method==='Target.getTargets'?{targetInfos:[{targetId:'t1',type:'page'}]}:method==='Target.attachToTarget'?{sessionId:'s1'}:method==='Storage.getCookies'?{cookies:[]}:{},close:vi.fn()},close:async()=>{}})) as any});
    await expect(failing.importFile(p.id,file)).rejects.toThrow('COOKIES_NOT_PERSISTED');
  }finally{profiles.close();cleanup(root);}
});
it('exports JSON and Netscape without expired cookies',async()=>{
  const {root,profiles,service}=setup();
  try{const p=await profiles.create(valid);const json=join(root,'out.json');
    await expect(service.exportFile(p.id,json,'json')).resolves.toEqual({count:1,fileName:'out.json'});
    expect(JSON.parse(await readFile(json,'utf8'))[0]).toMatchObject({name:'sid',httpOnly:true});
    const txt=join(root,'out.txt');await service.exportFile(p.id,txt,'netscape');expect(await readFile(txt,'utf8')).toContain('#HttpOnly_.example.com');
  }finally{profiles.close();cleanup(root);}
});
it('rejects a busy profile and an orphan browser',async()=>{
  const {root,profiles}=setup();
  try{const p=await profiles.create(valid);const file=join(root,'x.json');await writeFile(file,JSON.stringify([cookie]));
    const busy=new CookieService(profiles,{withStopped:async()=>{throw Error('PROFILE_BUSY');}},{resolveExecutable:async()=>process.execPath},{probe:async()=>[],launch:async()=>{throw Error('must not launch');}});
    await expect(busy.importFile(p.id,file)).rejects.toThrow('PROFILE_BUSY');
    const dir=join(root,'profiles',p.id);
    const orphan=new CookieService(profiles,{withStopped:async(_id,fn)=>fn()},{resolveExecutable:async()=>process.execPath},{probe:(async()=>[{pid:1,executable:process.execPath,createdAt:'',commandLine:'--user-data-dir='+dir}]) as any,launch:async()=>{throw Error('must not launch');}});
    await expect(orphan.exportFile(p.id,join(root,'x.json'),'json')).rejects.toThrow('ORPHAN_BROWSER');
  }finally{profiles.close();cleanup(root);}
});
it('reports ENGINE_NOT_READY when the engine is missing',async()=>{
  const {root,profiles}=setup();
  try{const p=await profiles.create(valid);const file=join(root,'x.json');await writeFile(file,JSON.stringify([cookie]));
    const service=new CookieService(profiles,{withStopped:async(_id,fn)=>fn()},{resolveExecutable:async()=>join(root,'missing.exe')},{probe:async()=>[],launch:async()=>{throw Error('must not launch');}});
    await expect(service.importFile(p.id,file)).rejects.toThrow('ENGINE_NOT_READY');
  }finally{profiles.close();cleanup(root);}
});
it('closes the browser if shutdown occurs during session startup',async()=>{
  const {root,profiles}=setup();
  try{const p=await profiles.create(valid);const file=join(root,'x.json');await writeFile(file,JSON.stringify([cookie]));
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const closed=vi.fn();
    const service=new CookieService(profiles,{withStopped:async(_id,fn)=>fn()},{resolveExecutable:async()=>process.execPath},
      {probe:async()=>[],launch:(async()=>{await gate;return {client:{send:async(method:string)=>method==='Target.getTargets'?{targetInfos:[{targetId:'t1',type:'page'}]}:method==='Target.attachToTarget'?{sessionId:'s1'}:method==='Storage.getCookies'?{cookies:[cookie]}:{},close:vi.fn()},close:async()=>{closed();}};}) as any});
    const importing=service.importFile(p.id,file);
    await new Promise(r=>setTimeout(r,10));
    const closing=service.closeAll();
    release();
    await closing;
    expect(closed).toHaveBeenCalled();
    await importing;
  }finally{profiles.close();cleanup(root);}
});
it('does not export expired cookies',async()=>{
  const {root,profiles}=setup({now:()=>1893456000*1000+1000});
  try{
    const p=await profiles.create(valid);const out=join(root,'expired.json');
    const service=new CookieService(profiles,{withStopped:async(_id,fn)=>fn()},{resolveExecutable:async()=>process.execPath},
      {probe:async()=>[],now:()=>1893456000*1000+1000,launch:(async()=>({client:{send:async(method:string)=>method==='Target.getTargets'?{targetInfos:[{targetId:'t1',type:'page'}]}:method==='Target.attachToTarget'?{sessionId:'s1'}:method==='Storage.getCookies'?{cookies:[{name:'sid',value:'v',domain:'.example.com',path:'/',secure:true,httpOnly:true,expires:1893456000,sameSite:'Lax'}]}:{},close:vi.fn()},close:async()=>{}})) as any});
    await expect(service.exportFile(p.id,out,'json')).resolves.toEqual({count:0,fileName:'expired.json'});
    expect(JSON.parse(await readFile(out,'utf8'))).toEqual([]);
  }finally{profiles.close();cleanup(root);}
});
it('clears cookies and requires both zero raw readback and successful browser closure',async()=>{
 const {root,profiles,stored,closed}=setup();
 try{
  const p=await profiles.create(valid);const service=new CookieService(profiles,{withStopped:async(_id,fn)=>fn()},{resolveExecutable:async()=>process.execPath},
   {probe:async()=>[],launch:(async()=>({client:{send:async(method:string)=>{
     if(method==='Storage.clearCookies'){stored.length=0;return {};}
     if(method==='Storage.getCookies')return {cookies:stored};
     return {targetInfos:[{targetId:'t1',type:'page'}],sessionId:'s1'};
   },close:vi.fn()},close:async()=>{closed();}})) as any});
  await expect(service.clear(p.id)).resolves.toEqual({cleared:true});expect(closed).toHaveBeenCalledOnce();expect(stored).toEqual([]);
  const remaining=new CookieService(profiles,{withStopped:async(_id,fn)=>fn()},{resolveExecutable:async()=>process.execPath},
   {probe:async()=>[],launch:(async()=>({client:{send:async(method:string)=>method==='Storage.getCookies'?{cookies:[cookie]}:method==='Target.getTargets'?{targetInfos:[{targetId:'t1',type:'page'}]}:{sessionId:'s1'},close:vi.fn()},close:async()=>{}})) as any});
  await expect(remaining.clear(p.id)).rejects.toThrow('COOKIES_NOT_CLEARED');
  const cdpFailure=new CookieService(profiles,{withStopped:async(_id,fn)=>fn()},{resolveExecutable:async()=>process.execPath},
   {probe:async()=>[],launch:(async()=>({client:{send:async(method:string)=>{if(method==='Storage.clearCookies')throw Error('secret cookie value');if(method==='Target.getTargets')return {targetInfos:[{targetId:'t1',type:'page'}]};if(method==='Storage.getCookies')return {cookies:[]};return {sessionId:'s1'};},close:vi.fn()},close:async()=>{}})) as any});
  await expect(cdpFailure.clear(p.id)).rejects.toThrow('COOKIE_CLEAR_FAILED');
  const closeFailure=new CookieService(profiles,{withStopped:async(_id,fn)=>fn()},{resolveExecutable:async()=>process.execPath},
   {probe:async()=>[],launch:(async()=>({client:{send:async(method:string)=>method==='Storage.getCookies'?{cookies:[]}:method==='Target.getTargets'?{targetInfos:[{targetId:'t1',type:'page'}]}:{sessionId:'s1'},close:vi.fn()},close:async()=>{throw Error('close failed');}})) as any});
  await expect(closeFailure.clear(p.id)).rejects.toThrow('COOKIE_SESSION_CLOSE_FAILED');
 }finally{profiles.close();cleanup(root);}
});
