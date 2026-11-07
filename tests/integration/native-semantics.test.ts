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

// Every function the spoof script replaces, read the way a detector would. The same probe runs in a
// profile without overrides (the script is empty there, so these are Chrome's own functions) and in
// a profile that overrides them; any difference is a behavioural tell (audit 2026-11-08).
const probe=`(()=>{
  const getter=(o,p)=>{const d=Object.getOwnPropertyDescriptor(o,p);return d&&d.get;};
  const targets={
    'Navigator.hardwareConcurrency':getter(Navigator.prototype,'hardwareConcurrency'),
    'Navigator.deviceMemory':getter(Navigator.prototype,'deviceMemory'),
    'Screen.width':getter(Screen.prototype,'width'),
    'Screen.availHeight':getter(Screen.prototype,'availHeight'),
    'window.outerWidth':getter(window,'outerWidth'),
    'HTMLIFrameElement.contentWindow':getter(HTMLIFrameElement.prototype,'contentWindow'),
    'HTMLCanvasElement.toDataURL':HTMLCanvasElement.prototype.toDataURL,
    'CanvasRenderingContext2D.getImageData':CanvasRenderingContext2D.prototype.getImageData,
    'WebGLRenderingContext.getParameter':WebGLRenderingContext.prototype.getParameter,
    'Element.getClientRects':Element.prototype.getClientRects,
    'AudioBuffer.getChannelData':AudioBuffer.prototype.getChannelData,
    'Function.prototype.toString':Function.prototype.toString,
  };
  const outcome=fn=>{try{fn();return 'ok';}catch(e){return e&&e.constructor?e.constructor.name:'thrown';}};
  const out={};
  for(const [key,fn] of Object.entries(targets)){
    if(typeof fn!=='function'){out[key]='missing';continue;}
    out[key]={
      construct:outcome(()=>Reflect.construct(fn,[])),
      ownPrototype:Object.prototype.hasOwnProperty.call(fn,'prototype'),
      callOnPlainObject:outcome(()=>fn.call({})),
      name:fn.name,length:fn.length,
      source:Function.prototype.toString.call(fn),
      ownKeys:Reflect.ownKeys(fn).map(String).sort().join(','),
    };
  }
  let touched=false;
  out.toStringOnObject={result:outcome(()=>Function.prototype.toString.call({valueOf(){touched=true;return 1;}})),touchedValueOf:false};
  out.toStringOnObject.touchedValueOf=touched;
  return out;
})()`;

const workerProbe=`(()=>{const out={};const outcome=fn=>{try{fn();return 'ok';}catch(e){return e&&e.constructor?e.constructor.name:'thrown';}};
  for(const p of ['hardwareConcurrency','deviceMemory','platform']){const d=Object.getOwnPropertyDescriptor(WorkerNavigator.prototype,p);const fn=d&&d.get;
    out[p]=fn?{construct:outcome(()=>Reflect.construct(fn,[])),ownPrototype:Object.prototype.hasOwnProperty.call(fn,'prototype'),callOnPlainObject:outcome(()=>fn.call({})),name:fn.name,source:Function.prototype.toString.call(fn)}:'missing';}
  return out;})()`;

async function run(fingerprint:Fingerprint){
  const reports:unknown[]=[];
  const server=createServer((req,res)=>{
    const url=new URL(req.url??'/','http://local');
    if(url.pathname==='/report'){reports.push(JSON.parse(url.searchParams.get('v')!));res.end('ok');return;}
    if(url.pathname==='/worker.js'){res.setHeader('Content-Type','text/javascript');res.end(`fetch('/report?v='+encodeURIComponent(JSON.stringify({worker:${workerProbe}})))`);return;}
    res.setHeader('Content-Type','text/html');
    res.end(`<!doctype html><script>fetch('/report?v='+encodeURIComponent(JSON.stringify(${probe})));new Worker('/worker.js');</script>`);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const root=tempRoot();
  try{
    const p=await new ChromiumAdapter(exe).launch({profileId:'native-semantics',userDataDir:root,languages:['en-US'],startUrls:[origin+'/'],fingerprint});
    try{for(let i=0;i<80&&reports.length<2;i++)await sleep(100);}finally{await p.stop();}
  }finally{cleanup(root);server.closeAllConnections();server.close();}
  const page=reports.find(r=>!(r as {worker?:unknown}).worker) as Record<string,unknown>|undefined;
  const worker=reports.find(r=>(r as {worker?:unknown}).worker) as {worker:unknown}|undefined;
  if(!page||!worker)throw Error('page or worker did not report');
  return {...page,worker:worker.worker} as Record<string,unknown>;
}

it('replaced functions behave like the browser’s own: not constructible, no prototype, receiver checks, no foreign valueOf',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const stock=await run(DEFAULT_FINGERPRINT);
  const spoofed=await run({...DEFAULT_FINGERPRINT,os:'macos',
    hardware:{mode:'manual',cores:4,memoryGb:4},screen:{mode:'manual',width:1512,height:982,dpr:2},
    canvas:'noise',webgl:'noise',clientRects:'noise',audio:'noise',
    webglInfo:{mode:'manual',vendor:'Google Inc. (Apple)',renderer:'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)'}});
  const differences:Record<string,{stock:unknown;spoofed:unknown}>={};
  for(const key of Object.keys(stock))if(JSON.stringify(spoofed[key])!==JSON.stringify(stock[key]))differences[key]={stock:stock[key],spoofed:spoofed[key]};
  expect(differences).toEqual({});
},120000);
