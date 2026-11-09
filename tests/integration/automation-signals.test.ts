import {itWithGpu} from '../fixtures/gpu';
import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {ChromiumAdapter} from '../../src/main/engines/chromium';
import {tempRoot,cleanup} from '../fixtures/profiles';
import {DEFAULT_FINGERPRINT,type Fingerprint} from '../../src/shared/fingerprint';
import {uaForOs} from '../../src/shared/user-agent';

const base=join(process.env.LOCALAPPDATA??'','ms-playwright');const candidates=existsSync(base)?readdirSync(base).filter(n=>n.startsWith('chromium-')).sort().reverse():[];const exe=process.env.LOCAL_PROFILES_TEST_CHROMIUM??join(base,candidates[0]??'missing','chrome-win64','chrome.exe');

/** Serves `body` as a page script and returns the first JSON value the page reports. */
async function probe<T>(profileId:string,fingerprint:Fingerprint,body:string):Promise<T>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const reports:T[]=[];
  const server=createServer((req,res)=>{if(req.url?.startsWith('/report')){reports.push(JSON.parse(new URL(req.url,'http://local').searchParams.get('value')!));res.end('ok');return;}res.setHeader('Content-Type','text/html');res.end(`<!doctype html><meta charset="utf-8"><body><script>const report=v=>fetch('/report?value='+encodeURIComponent(JSON.stringify(v)));(async()=>{try{${body}}catch(e){report({error:String(e&&e.stack||e)});}})();</script></body>`);});
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const root=tempRoot();
  try{
    const p=await new ChromiumAdapter(exe).launch({profileId,userDataDir:root,languages:['en-US'],startUrls:[url],fingerprint});
    try{for(let i=0;i<300&&reports.length===0;i++)await new Promise(r=>setTimeout(r,100));expect(reports.length,'browser did not report').toBeGreaterThanOrEqual(1);return reports[0];}
    finally{await p.stop();}
  }finally{cleanup(root);server.closeAllConnections();server.close();}
}

const FRESH_FRAME="const ifr=document.createElement('iframe');document.body.appendChild(ifr);const fw=ifr.contentWindow;";
const spoofed:Fingerprint={...DEFAULT_FINGERPRINT,canvas:'noise',webgl:'noise',clientRects:'noise',hardware:{mode:'manual',cores:8,memoryGb:8}};

it('navigator.webdriver is natively false in the page, a fresh iframe and a worker',async()=>{
  const r=await probe<{page:boolean;frame:boolean;worker:boolean;getter:string;error?:string}>('wd-native',DEFAULT_FINGERPRINT,`${FRESH_FRAME}
    const getter=Object.getOwnPropertyDescriptor(Navigator.prototype,'webdriver').get;
    const w=new Worker(URL.createObjectURL(new Blob(['postMessage(Boolean(navigator.webdriver))'],{type:'text/javascript'})));
    const worker=await new Promise(res=>{w.onmessage=e=>res(e.data);});
    report({page:navigator.webdriver,frame:fw.navigator.webdriver,worker,getter:fw.Function.prototype.toString.call(getter)});`);
  expect(r.error).toBeUndefined();
  expect(r.page).toBe(false);expect(r.frame).toBe(false);expect(r.worker).toBe(false);
  expect(r.getter).toBe('function get webdriver() { [native code] }');
},120000);

it('reports Chrome-branded Client Hints for a profile without a custom User-Agent',async()=>{
  const r=await probe<{ua:string;brands:Array<{brand:string}>;hints:{fullVersionList:Array<{brand:string}>;platformVersion:string};error?:string}>('brands-default',DEFAULT_FINGERPRINT,`
    const hints=await navigator.userAgentData.getHighEntropyValues(['fullVersionList','platformVersion']);
    report({ua:navigator.userAgent,brands:navigator.userAgentData.brands,hints});`);
  expect(r.error).toBeUndefined();
  expect(r.brands.map(b=>b.brand)).toContain('Google Chrome');
  expect(r.hints.fullVersionList.map(b=>b.brand)).toContain('Google Chrome');
  expect(r.ua).toMatch(/Chrome\/\d+\.0\.0\.0 /);
  expect(r.hints.platformVersion).not.toBe('');
},120000);

it('a profile without spoofed surfaces leaves Function.prototype.toString untouched',async()=>{
  const untouched:Fingerprint={...DEFAULT_FINGERPRINT,geolocation:{mode:'auto'}};
  const r=await probe<{own:string;cross:string;stack:string;error?:string}>('tostring-real',untouched,`${FRESH_FRAME}
    let stack='';try{Function.prototype.toString.call({});}catch(e){stack=e.stack;}
    report({own:Function.prototype.toString.toString(),cross:fw.Function.prototype.toString.call(Function.prototype.toString),stack});`);
  expect(r.error).toBeUndefined();
  expect(r.own).toBe('function toString() { [native code] }');
  expect(r.cross).toBe('function toString() { [native code] }');
  expect(r.stack).not.toMatch(/<anonymous>:\d+:\d+/);
},120000);

it('spoofed methods look native when inspected from a fresh same-origin iframe',async()=>{
  const r=await probe<Record<string,string>>('tostring-cross',spoofed,`${FRESH_FRAME}
    const T=fw.Function.prototype.toString;
    report({
      toDataURL:T.call(HTMLCanvasElement.prototype.toDataURL),
      getImageData:T.call(CanvasRenderingContext2D.prototype.getImageData),
      toString:T.call(Function.prototype.toString),
      cores:T.call(Object.getOwnPropertyDescriptor(Navigator.prototype,'hardwareConcurrency').get),
      reverse:Function.prototype.toString.call(fw.HTMLCanvasElement.prototype.toDataURL),
      frameOwn:T.call(T),
      frameCores:String(fw.navigator.hardwareConcurrency),
    });`);
  expect(r.error).toBeUndefined();
  expect(r.toDataURL).toBe('function toDataURL() { [native code] }');
  expect(r.getImageData).toBe('function getImageData() { [native code] }');
  expect(r.toString).toBe('function toString() { [native code] }');
  expect(r.cores).toBe('function get hardwareConcurrency() { [native code] }');
  expect(r.reverse).toBe('function toDataURL() { [native code] }');
  expect(r.frameOwn).toBe('function toString() { [native code] }');
  expect(r.frameCores).toBe('8');
},120000);

it('the spoof script runs once per document and adds no frames to native errors',async()=>{
  const r=await probe<{stack:string;wrappers:number;error?:string}>('spoof-once',spoofed,`
    let stack='';try{Function.prototype.toString.call({});}catch(e){stack=e.stack;}
    let wrappers=0;try{HTMLCanvasElement.prototype.toDataURL.call({});}catch(e){wrappers=(String(e.stack).match(/<anonymous>:\\d+:\\d+/g)||[]).length;}
    report({stack,wrappers});`);
  expect(r.error).toBeUndefined();
  expect(r.stack).not.toMatch(/<anonymous>:\d+:\d+/);
  expect(r.wrappers,'each wrapper adds one injected frame').toBeLessThanOrEqual(2);
},120000);

it('a Windows user agent keeps high-entropy client hints populated',async()=>{
  const engineVersion=(()=>{try{return execFileSync('powershell.exe',['-NoProfile','-Command',`(Get-Item '${exe}').VersionInfo.ProductVersion`],{encoding:'utf8'}).trim();}catch{return '156.0.0.0';}})();
  const fp:Fingerprint={...DEFAULT_FINGERPRINT,os:'windows11',userAgent:uaForOs('windows11',engineVersion)};
  const r=await probe<{ua:string;hints:Record<string,unknown>;error?:string}>('ua-hints',fp,`
    const hints=await navigator.userAgentData.getHighEntropyValues(['architecture','bitness','platformVersion','uaFullVersion','fullVersionList']);
    report({ua:navigator.userAgent,hints});`);
  expect(r.error).toBeUndefined();
  expect(r.ua).toMatch(/Chrome\/\d+\.0\.0\.0 /);
  expect(r.hints.architecture).toBe('x86');
  expect(r.hints.bitness).toBe('64');
  expect(r.hints.platformVersion).not.toBe('');
  expect(r.hints.uaFullVersion).toBe(engineVersion);
  expect((r.hints.fullVersionList as unknown[]).length).toBeGreaterThan(0);
},120000);

itWithGpu('WebGPU adapter identity follows the configured WebGL vendor',async()=>{
  const fp:Fingerprint={...DEFAULT_FINGERPRINT,webglInfo:{mode:'manual',vendor:'Google Inc. (NVIDIA)',renderer:'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)'}};
  const r=await probe<{available:boolean;vendor?:string;architecture?:string;error?:string}>('webgpu-align',fp,`
    const a=navigator.gpu&&await navigator.gpu.requestAdapter();
    report(a?{available:true,vendor:a.info.vendor,architecture:a.info.architecture}:{available:false});`);
  expect(r.error).toBeUndefined();
  if(!r.available)return; // No adapter on this host: there is nothing to contradict WebGL.
  expect(r.vendor).toBe('nvidia');
  expect(r.architecture).toBe('ampere');
},120000);
