import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {writeFile,readFile} from 'node:fs/promises';
import {CookieService} from '../../src/main/cookies/service';
import {ProfileService} from '../../src/main/profiles/service';
import {Supervisor} from '../../src/main/runtime/supervisor';
import {ChromiumAdapter} from '../../src/main/engines/chromium';
import type {BrowserEngineAdapter} from '../../src/main/engines/types';
import {DEFAULT_FINGERPRINT} from '../../src/shared/fingerprint';
import {tempRoot,testSecrets,valid,cleanup} from '../fixtures/profiles';

const base=join(process.env.LOCALAPPDATA??'','ms-playwright');
const candidates=existsSync(base)?readdirSync(base).filter(n=>n.startsWith('chromium-')).sort().reverse():[];
const exe=process.env.LOCAL_PROFILES_TEST_CHROMIUM??join(base,candidates[0]??'missing','chrome-win64','chrome.exe');
const future=Math.floor(Date.now()/1000)+86400;

function cookieFile(domain:string){
  return JSON.stringify([
    {domain,name:'sid',path:'/',value:'hidden',httpOnly:true,secure:false,expirationDate:future},
    {domain,name:'plain',path:'/',value:'1',httpOnly:false,secure:false,expirationDate:future},
  ]);
}

function fakeEngine():BrowserEngineAdapter{
  return {capabilities:{fingerprints:false},validate:async()=>{},launch:async()=>{
    let finish!:()=>void;const exit=new Promise<{code:number|null;signal:string|null}>(r=>{finish=()=>r({code:0,signal:null});});
    return {pid:1,executable:'fixture.exe',startedAt:new Date().toISOString(),exit,stop:async()=>finish()};
  }};
}

it('imports and exports cookies in a headless session without network requests',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const requests:string[]=[];
  const server=createServer((req,res)=>{requests.push(req.url??'');res.end('x');});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const root=tempRoot();const profiles=new ProfileService(root,testSecrets());
  const service=new CookieService(profiles,{withStopped:async(_id,fn)=>fn()},{resolveExecutable:async()=>exe},{probe:async()=>[]});
  try{
    const p=await profiles.create(valid);const input=join(root,'in.json');await writeFile(input,cookieFile('127.0.0.1'));
    await expect(service.importFile(p.id,input)).resolves.toEqual({count:2,fileName:'in.json'});
    const json=join(root,'out.json');await expect(service.exportFile(p.id,json,'json')).resolves.toEqual({count:2,fileName:'out.json'});
    const exported=JSON.parse(await readFile(json,'utf8')) as Array<{name:string;httpOnly:boolean}>;
    expect(exported.map(cookie=>cookie.name).sort()).toEqual(['plain','sid']);
    expect(exported.find(cookie=>cookie.name==='sid')?.httpOnly).toBe(true);
    const txt=join(root,'out.txt');await service.exportFile(p.id,txt,'netscape');
    expect(await readFile(txt,'utf8')).toContain('#HttpOnly_127.0.0.1');
    const p2=await profiles.create(valid);
    await expect(service.importFile(p2.id,json)).resolves.toMatchObject({count:2});
    await expect(service.importFile(p2.id,txt)).resolves.toMatchObject({count:2});
    const round=join(root,'round.json');await service.exportFile(p2.id,round,'json');
    expect((JSON.parse(await readFile(round,'utf8')) as Array<{name:string}>).map(item=>item.name).sort()).toEqual(['plain','sid']);
    expect(requests).toEqual([]);
  }finally{profiles.close();cleanup(root);server.closeAllConnections();server.close();}
},120000);

it('sends httpOnly cookies to the server but not to document.cookie',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  let cookieHeader='';
  const reports:string[]=[];
  const server=createServer((req,res)=>{
    if(req.url?.startsWith('/report')){reports.push(new URL(req.url,'http://local').searchParams.get('value')??'');res.end('ok');return;}
    cookieHeader=req.headers.cookie??'';res.setHeader('Content-Type','text/html');
    res.end('<!doctype html><meta charset="utf-8"><script>fetch(\'/report?value=\'+encodeURIComponent(document.cookie))</script>');
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=(server.address() as AddressInfo).port;
  const root=tempRoot();const profiles=new ProfileService(root,testSecrets());
  const service=new CookieService(profiles,{withStopped:async(_id,fn)=>fn()},{resolveExecutable:async()=>exe},{probe:async()=>[]});
  const engine=new ChromiumAdapter(exe);
  try{
    const p=await profiles.create(valid);const input=join(root,'in.json');await writeFile(input,cookieFile('127.0.0.1'));
    await service.importFile(p.id,input);
    const browser=await engine.launch({profileId:p.id,userDataDir:join(root,'profiles',p.id),languages:['ru-RU'],startUrls:[`http://127.0.0.1:${port}/`],fingerprint:DEFAULT_FINGERPRINT});
    try{
      for(let i=0;i<300&&reports.length===0;i++)await new Promise(r=>setTimeout(r,100));
      expect(reports).toHaveLength(1);
      expect(reports[0]).toContain('plain=1');expect(reports[0]).not.toContain('sid');
      expect(cookieHeader).toContain('sid=hidden');expect(cookieHeader).toContain('plain=1');
    }finally{await browser.stop();}
  }finally{profiles.close();cleanup(root);server.closeAllConnections();server.close();}
},120000);

it('import and export are independent of the proxy, while launch with an unreachable proxy is rejected',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const root=tempRoot();const profiles=new ProfileService(root,testSecrets());
  const supervisor=new Supervisor(profiles,fakeEngine(),{probe:async()=>[]});
  const service=new CookieService(profiles,supervisor,{resolveExecutable:async()=>exe});
  try{
    const proxy=await profiles.createProxy({name:'Dead',kind:'http',host:'127.0.0.1',port:1});
    const p=await profiles.create({...valid,proxyId:proxy.id});
    await expect(supervisor.start(p.id)).rejects.toThrow('PROXY_UNREACHABLE');
    const input=join(root,'in.json');await writeFile(input,cookieFile('example.com'));
    await expect(service.importFile(p.id,input)).resolves.toEqual({count:2,fileName:'in.json'});
    const out=join(root,'out.json');await expect(service.exportFile(p.id,out,'json')).resolves.toEqual({count:2,fileName:'out.json'});
  }finally{profiles.close();cleanup(root);}
},120000);

it('rejects import for a running profile',async()=>{
  const root=tempRoot();const profiles=new ProfileService(root,testSecrets());
  const supervisor=new Supervisor(profiles,fakeEngine(),{probe:async()=>[]});
  const service=new CookieService(profiles,supervisor,{resolveExecutable:async()=>'missing.exe'});
  try{
    const p=await profiles.create(valid);await supervisor.start(p.id);
    const input=join(root,'in.json');await writeFile(input,cookieFile('example.com'));
    await expect(service.importFile(p.id,input)).rejects.toThrow('PROFILE_BUSY');
    await supervisor.stop(p.id);
  }finally{profiles.close();cleanup(root);}
});
