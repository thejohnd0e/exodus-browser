import {it,expect} from 'vitest';
import {itWithGpu} from '../fixtures/gpu';
import {createServer} from 'node:http';
import type {IncomingMessage,ServerResponse} from 'node:http';
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

// One profile with every spoof on at once, the way a user runs it, probed from the page, a nested
// worker chain and a cross-origin frame. Individual features have their own tests; this one catches
// interactions between them (acceptance 1.3.8).
const renderer='ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)';
const fingerprint:Fingerprint={...DEFAULT_FINGERPRINT,os:'macos',hardware:{mode:'manual',cores:4,memoryGb:4},screen:{mode:'manual',width:1512,height:982,dpr:2},
  timezone:{mode:'manual',value:'America/New_York'},canvas:'noise',webgl:'noise',clientRects:'noise',audio:'noise',webgpu:'off',
  webglInfo:{mode:'manual',vendor:'Google Inc. (Apple)',renderer},strictProtection:true};

// What each worker level reports about itself; the deepest also reports its WebGL renderer.
const describeSelf=`({cores:navigator.hardwareConcurrency,mem:navigator.deviceMemory,platform:navigator.platform,tz:Intl.DateTimeFormat().resolvedOptions().timeZone,
  renderer:(()=>{try{const g=new OffscreenCanvas(4,4).getContext('webgl');const x=g&&g.getExtension('WEBGL_debug_renderer_info');return x?g.getParameter(x.UNMASKED_RENDERER_WEBGL):null;}catch(e){return null;}})()})`;
const leaf=`postMessage([${describeSelf}])`;
const middle=`self.__leaf=${JSON.stringify(leaf)};const w=new Worker(URL.createObjectURL(new Blob([self.__leaf])));w.onmessage=e=>postMessage([${describeSelf},...e.data]);`;
const top=`self.__middle=${JSON.stringify(middle)};const w=new Worker(URL.createObjectURL(new Blob([self.__middle])));w.onmessage=e=>postMessage([${describeSelf},...e.data]);`;

const pageProbe=`(async()=>{
  const out={};const t=(f)=>{try{return f();}catch(e){return 'threw '+(e&&e.constructor&&e.constructor.name);}};
  out.cores=navigator.hardwareConcurrency;out.mem=navigator.deviceMemory;out.platform=navigator.platform;out.webdriver=navigator.webdriver;
  out.ua=navigator.userAgent.includes('Macintosh');out.uaDataPlatform=navigator.userAgentData&&navigator.userAgentData.platform;
  out.tz=Intl.DateTimeFormat().resolvedOptions().timeZone;
  out.screen=[screen.width,screen.height];out.dpr=devicePixelRatio;
  out.mq=[matchMedia('(device-width: 1512px)').matches,matchMedia('(device-width: 1511px)').matches];
  const gl=document.createElement('canvas').getContext('webgl');const e=gl&&gl.getExtension('WEBGL_debug_renderer_info');out.renderer=e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):null;
  out.gpu=[typeof navigator.gpu,navigator.gpu?await navigator.gpu.requestAdapter():'none'];
  const g=Object.getOwnPropertyDescriptor(Navigator.prototype,'hardwareConcurrency').get;
  out.nativeGetter=Function.prototype.toString.call(g);out.construct=t(()=>new g());out.illegal=t(()=>g.call({}));out.hasPrototype='prototype' in g;
  out.toStringOfObject=t(()=>Function.prototype.toString.call({valueOf(){window.__called=true;return 'x'}}));out.valueOfCalled=Boolean(window.__called);
  const u=document.createElement('canvas');u.width=40;u.height=40;const ux=u.getContext('2d');ux.fillStyle='#1a2b3c';ux.fillRect(0,0,40,40);
  out.uniform=Array.from(ux.getImageData(0,0,40,40).data).every((v,i)=>v===[26,43,60,255][i%4]);
  const buf=await new OfflineAudioContext(1,4000,44100).startRendering();out.silence=Array.from(buf.getChannelData(0)).every(v=>v===0);
  const box=document.getElementById('box');const r1=box.getBoundingClientRect(),r2=box.getBoundingClientRect(),l=box.getClientRects();out.rects=[r1.x===r2.x,l[0].x===l.item(0).x,l instanceof DOMRectList];
  out.workers=await new Promise(res=>{const w=new Worker(URL.createObjectURL(new Blob([${JSON.stringify(top)}])));w.onmessage=e=>res(e.data);setTimeout(()=>res('timeout'),8000);});
  return out;
})()`;

itWithGpu('one profile with every spoof on is consistent in the page, nested workers and a cross-origin frame',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const reports:Array<{tag:string;v:Record<string,any>}>=[];
  const sink=(req:IncomingMessage,res:ServerResponse)=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{reports.push(JSON.parse(b));res.end('ok');});};
  const child=createServer((req,res)=>{
    if(req.method==='POST'){sink(req,res);return;}
    res.setHeader('Content-Type','text/html');
    res.end(`<!doctype html><script>fetch('/r',{method:'POST',body:JSON.stringify({tag:'frame',v:{screen:[screen.width,screen.height],dpr:devicePixelRatio,cores:navigator.hardwareConcurrency,
      range:[matchMedia('(device-width >= 1512px)').matches,matchMedia('(device-width < 1512px)').matches,matchMedia('(1511px <= device-width <= 1512px)').matches,matchMedia('(min-device-width: 94.5em)').matches,matchMedia('(max-device-width: 90em)').matches],
      native:Function.prototype.toString.call(matchMedia)}})})</script>`);
  });
  child.listen(0,'127.0.0.1');await once(child,'listening');
  const parent=createServer((req,res)=>{
    if(req.method==='POST'){sink(req,res);return;}
    res.setHeader('Content-Type','text/html');
    res.end(`<!doctype html><body style="margin:0"><div id="box" style="position:absolute;left:8px;top:8px;width:100px;height:20px"></div><iframe src="http://localhost:${(child.address() as AddressInfo).port}/"></iframe><script>${pageProbe}.then(v=>fetch('/r',{method:'POST',body:JSON.stringify({tag:'page',v})}),e=>fetch('/r',{method:'POST',body:JSON.stringify({tag:'page',v:{error:String(e)}})}))</script>`);
  });
  parent.listen(0,'127.0.0.1');await once(parent,'listening');
  const root=tempRoot();const outcomes:string[]=[];
  try{
    const p=await new ChromiumAdapter(exe).launch({profileId:'acceptance',userDataDir:root,languages:['en-US'],startUrls:[`http://127.0.0.1:${(parent.address() as AddressInfo).port}/`],fingerprint,fingerprintSeed:7,onProtectionFailure:o=>outcomes.push(o)});
    try{for(let i=0;i<150&&!(reports.some(r=>r.tag==='page')&&reports.some(r=>r.tag==='frame'));i++)await sleep(100);}finally{await p.stop();}
  }finally{cleanup(root);parent.closeAllConnections();parent.close();child.closeAllConnections();child.close();}
  const page=reports.find(r=>r.tag==='page')?.v as Record<string,any>;const frame=reports.find(r=>r.tag==='frame')?.v as Record<string,any>|undefined;
  expect(page,'page did not report').toBeTruthy();expect(page.error,'page probe error').toBeUndefined();
  const failures:string[]=[];const check=(name:string,ok:boolean,got?:unknown)=>{if(!ok)failures.push(name+' -> '+JSON.stringify(got));};
  check('cores',page.cores===4,page.cores);check('memory',page.mem===4,page.mem);check('platform',page.platform==='MacIntel',page.platform);check('webdriver false',page.webdriver===false,page.webdriver);
  check('UA is macOS',page.ua===true,page.ua);check('UA client hints platform',page.uaDataPlatform==='macOS',page.uaDataPlatform);check('time zone',page.tz==='America/New_York',page.tz);
  check('screen',page.screen?.[0]===1512&&page.screen?.[1]===982,page.screen);check('dpr',page.dpr===2,page.dpr);check('media queries',JSON.stringify(page.mq)==='[true,false]',page.mq);
  check('WebGL renderer',page.renderer===renderer,page.renderer);check('WebGPU off',page.gpu?.[0]==='object'&&page.gpu?.[1]===null,page.gpu);
  check('native getter source',page.nativeGetter==='function get hardwareConcurrency() { [native code] }',page.nativeGetter);
  check('getter cannot be constructed',page.construct==='threw TypeError',page.construct);check('getter rejects foreign receiver',page.illegal==='threw TypeError',page.illegal);check('getter has no prototype',page.hasPrototype===false);
  check('toString never calls page valueOf',page.valueOfCalled===false,page.toStringOfObject);
  check('uniform canvas stays exact',page.uniform===true);check('silent audio stays silent',page.silence===true);check('ClientRects consistent',JSON.stringify(page.rects)==='[true,true,true]',page.rects);
  const workers=page.workers as Array<Record<string,unknown>>|string;
  check('three worker levels answered',Array.isArray(workers)&&workers.length===3,workers);
  if(Array.isArray(workers)){
    workers.forEach((w,i)=>check('worker level '+i+' cores, memory, platform and time zone',w.cores===4&&w.mem===4&&w.platform==='MacIntel'&&w.tz==='America/New_York',w));
    if(workers[2])check('deepest worker WebGL renderer',workers[2].renderer===renderer,workers[2].renderer);
  }
  check('cross-origin frame answered',Boolean(frame));
  if(frame){
    check('frame screen',frame.screen?.[0]===1512&&frame.screen?.[1]===982,frame.screen);check('frame dpr',frame.dpr===2,frame.dpr);check('frame cores',frame.cores===4,frame.cores);
    check('frame range and em media queries',JSON.stringify(frame.range)==='[true,false,true,true,false]',frame.range);
    check('frame matchMedia is native',frame.native==='function matchMedia() { [native code] }',frame.native);
  }
  check('no installation failures',outcomes.length===0,outcomes);
  expect(failures,'acceptance failures').toEqual([]);
},180000);
