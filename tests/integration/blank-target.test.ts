import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {ChromiumAdapter} from '../../src/main/engines/chromium';
import {tempRoot,cleanup} from '../fixtures/profiles';
import {DEFAULT_FINGERPRINT,type Fingerprint} from '../../src/shared/fingerprint';

const base=join(process.env.LOCALAPPDATA??'','ms-playwright');
const candidates=existsSync(base)?readdirSync(base).filter(n=>n.startsWith('chromium-')).sort().reverse():[];
const exe=process.env.LOCAL_PROFILES_TEST_CHROMIUM??join(base,candidates[0]??'missing','chrome-win64','chrome.exe');
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const macUa='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
const spoofedProfile:Fingerprint={...DEFAULT_FINGERPRINT,os:'macos',userAgent:macUa,timezone:{mode:'manual',value:'America/New_York'},hardware:{mode:'manual',cores:12,memoryGb:8}};

interface Seen{ctx:string;platform:string;cores:number;tz:string;ua:string;sw:number;sh:number;dpr:number;mq:boolean}
interface Hit{method:string;path:string;body:string}
type Browser=NonNullable<Awaited<ReturnType<ChromiumAdapter['launch']>>['browser']>;

const report=(ctx:string)=>`<!doctype html><meta charset="utf-8"><title>${ctx}</title><script>fetch('/report?v='+encodeURIComponent(JSON.stringify({ctx:${JSON.stringify(ctx)},platform:navigator.platform,cores:navigator.hardwareConcurrency,tz:Intl.DateTimeFormat().resolvedOptions().timeZone,ua:navigator.userAgent,sw:screen.width,sh:screen.height,dpr:devicePixelRatio,mq:matchMedia('(device-width: 1512px) and (resolution: 2dppx)').matches})))</script>`;
const mainPage=`<!doctype html><meta charset="utf-8">
<a id="link" href="/link" target="_blank">link</a>
<a id="opener" href="/opener" target="_blank" rel="opener">opener</a>
<form id="post" method="post" action="/post" target="_blank"><input name="a" value="payload"></form>
<form id="get" method="get" action="/getform" target="_blank"><input name="a" value="payload"></form>`;

async function withProfile(fingerprint:Fingerprint,run:(env:{seen:Seen[];hits:Hit[];browser:Browser;click:(expression:string)=>Promise<void>})=>Promise<void>){
  const seen:Seen[]=[];const hits:Hit[]=[];
  const server=createServer((req,res)=>{
    const url=new URL(req.url??'/','http://local');
    if(url.pathname==='/report'){seen.push(JSON.parse(url.searchParams.get('v')!));res.end('ok');return;}
    if(url.pathname==='/favicon.ico'){res.statusCode=404;res.end();return;}
    const chunks:Buffer[]=[];
    req.on('data',chunk=>chunks.push(chunk));
    req.on('end',()=>{
      hits.push({method:req.method??'',path:url.pathname,body:Buffer.concat(chunks).toString()});
      res.setHeader('Content-Type','text/html');
      res.end(url.pathname==='/main'?mainPage:report(url.pathname.slice(1)));
    });
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const root=tempRoot();
  try{
    const p=await new ChromiumAdapter(exe).launch({profileId:'blank-target',userDataDir:root,languages:['en-US'],startUrls:[origin+'/main'],fingerprint});
    try{
      const browser=p.browser!;
      const main=(await browser.pages()).find(page=>page.url?.endsWith('/main'));
      if(!main)throw Error('main page not found');
      const sessionId=await browser.attach(main.targetId);
      const click=async(expression:string)=>{await browser.send('Runtime.evaluate',{expression:`${expression};0`,userGesture:true},sessionId);};
      await run({seen,hits,browser,click});
    }finally{await p.stop();}
  }finally{cleanup(root);server.closeAllConnections();server.close();}
}
async function until(condition:()=>boolean,ms=10000){for(let i=0;i<ms/100&&!condition();i++)await sleep(100);}
const isSpoofed=(entry:Seen)=>entry.platform==='MacIntel'&&entry.cores===12&&entry.tz==='America/New_York'&&entry.ua===macUa;

// A link or form with target="_blank" opens a noopener tab in its own renderer process. Its
// page-level DevTools commands are only answered after the tab is resumed, so the installer must
// not wait for them before resuming: it used to time out and close the tab (docs/engine-and-antifraud.md).
for(const [name,expression,path,method] of [
  ['a target="_blank" link','document.getElementById("link").click()','/link','GET'],
  ['a form posted to target="_blank"','document.getElementById("post").submit()','/post','POST'],
  ['a GET form with target="_blank"','document.getElementById("get").submit()','/getform','GET'],
  ['a target="_blank" link with rel="opener"','document.getElementById("opener").click()','/opener','GET'],
] as const){
  it(`opens ${name} once, with the profile fingerprint from its first document`,async()=>{
    if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
    await withProfile(spoofedProfile,async({seen,hits,browser,click})=>{
      await click(expression);
      const ctx=path.slice(1);
      await until(()=>seen.some(entry=>entry.ctx===ctx));await sleep(1500);
      const requests=hits.filter(hit=>hit.path===path);
      expect(requests.map(hit=>hit.method),`${path} requests`).toEqual([method]);
      if(method==='POST')expect(requests[0].body).toBe('a=payload');
      const documents=seen.filter(entry=>entry.ctx===ctx);
      expect(documents.length,'the new tab never ran its page').toBe(1);
      expect(documents[0],'the first document ran with real values').toSatisfy(isSpoofed);
      expect((await browser.pages()).some(page=>page.url?.includes(path)),'the new tab was closed').toBe(true);
    });
  },60000);
}

it('opens a target="_blank" link in a profile that overrides nothing',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  await withProfile(DEFAULT_FINGERPRINT,async({seen,hits,browser,click})=>{
    await click('document.getElementById("link").click()');
    await until(()=>seen.some(entry=>entry.ctx==='link'));await sleep(1000);
    expect(hits.filter(hit=>hit.path==='/link')).toHaveLength(1);
    expect((await browser.pages()).some(page=>page.url?.endsWith('/link'))).toBe(true);
  });
},60000);

it('applies a manual screen to a target="_blank" tab in JavaScript and in media queries',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  await withProfile({...spoofedProfile,screen:{mode:'manual',width:1512,height:982,dpr:2}},async({seen,click})=>{
    await click('document.getElementById("link").click()');
    await until(()=>seen.some(entry=>entry.ctx==='link'));await sleep(1000);
    const documents=seen.filter(entry=>entry.ctx==='link');
    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({sw:1512,sh:982,dpr:2,mq:true});
    expect(documents[0]).toSatisfy(isSpoofed);
  });
},60000);
