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

const fingerprint:Fingerprint={...DEFAULT_FINGERPRINT,canvas:'noise',webgl:'noise',clientRects:'noise',audio:'noise',
  webglInfo:{mode:'manual',vendor:'Google Inc. (NVIDIA)',renderer:'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)'},
  hardware:{mode:'manual',cores:8,memoryGb:8},screen:{mode:'manual',width:1366,height:768}};

/** Serves `body` as an async page script and returns the first JSON value the page reports. */
async function probe<T>(profileId:string,body:string):Promise<T>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const reports:T[]=[];
  const server=createServer((req,res)=>{
    if(req.url?.startsWith('/report')){const chunks:Buffer[]=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{reports.push(JSON.parse(Buffer.concat(chunks).toString()));res.end('ok');});return;}
    if(req.url==='/page.js'){res.setHeader('Content-Type','text/javascript');res.end(`const report=v=>fetch('/report',{method:'POST',body:JSON.stringify(v)});(async()=>{try{${body}}catch(e){report({error:String(e&&e.stack||e)});}})();`);return;}
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><body><script src="/page.js"></script></body>');
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/`;const root=tempRoot();
  try{
    const p=await new ChromiumAdapter(exe).launch({profileId,userDataDir:root,languages:['en-US'],startUrls:[url],fingerprint});
    try{for(let i=0;i<300&&reports.length===0;i++)await new Promise(r=>setTimeout(r,100));expect(reports.length,'browser did not report').toBeGreaterThanOrEqual(1);return reports[0];}
    finally{await p.stop();}
  }finally{cleanup(root);server.closeAllConnections();server.close();}
}

// Everything the spoofed APIs need is prepared before any hook is armed, and the armed window contains
// only direct calls of the spoofed APIs, so a hook can only fire when injected code calls it.
const HOSTILE=String.raw`
const RA=Reflect.apply;
const cv=document.createElement('canvas');cv.width=40;cv.height=40;
const ctx=cv.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#f80';ctx.fillRect(2,2,20,20);ctx.fillStyle='#08f';ctx.fillRect(14,14,20,20);
const gl=document.createElement('canvas').getContext('webgl');
const glBuf=new Uint8Array(2*2*4);
const el=document.createElement('div');el.style.cssText='position:absolute;left:3.3px;top:4.4px;width:50.5px;height:20.2px';document.body.appendChild(el);
const ab=new AudioBuffer({length:400,sampleRate:8000});{const d=ab.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.sin(i/7);}
const dest=new Float32Array(64);
const oc=new OffscreenCanvas(30,30);const octx=oc.getContext('2d');octx.fillRect(1,1,10,10);
const analyser=new AudioContext().createAnalyser();const freq=new Float32Array(analyser.frequencyBinCount),bytes=new Uint8Array(analyser.frequencyBinCount);
const hcGetter=Object.getOwnPropertyDescriptor(Navigator.prototype,'hardwareConcurrency').get;
const calls={
  hardwareConcurrency:()=>navigator.hardwareConcurrency, deviceMemory:()=>navigator.deviceMemory,
  screenWidth:()=>screen.width, availHeight:()=>screen.availHeight, outerWidth:()=>outerWidth,
  toDataURL:()=>cv.toDataURL(), toBlob:()=>cv.toBlob(()=>{}), getImageData:()=>ctx.getImageData(0,0,8,8),
  glParameter:()=>gl&&gl.getParameter(37446), glReadPixels:()=>gl&&gl.readPixels(0,0,2,2,6408,5121,glBuf),
  rect:()=>el.getBoundingClientRect(), rects:()=>el.getClientRects(),
  channel:()=>ab.getChannelData(0), copyFrom:()=>ab.copyFromChannel(dest,0),
  freqF:()=>analyser.getFloatFrequencyData(freq), freqB:()=>analyser.getByteFrequencyData(bytes),
  offscreen:()=>{oc.convertToBlob();}, offscreenData:()=>octx.getImageData(0,0,8,8),
  source:()=>cv.toDataURL.toString(), sourceOfGetter:()=>hcGetter.toString(),
};
const methods=[
  [Function.prototype,'call'],[Function.prototype,'apply'],[Function.prototype,'bind'],
  [Reflect,'apply'],[Reflect,'get'],[Reflect,'set'],[Reflect,'construct'],[Reflect,'defineProperty'],[Reflect,'ownKeys'],[Reflect,'getOwnPropertyDescriptor'],[Reflect,'getPrototypeOf'],
  [WeakMap.prototype,'has'],[WeakMap.prototype,'get'],[WeakMap.prototype,'set'],
  [Map.prototype,'get'],[Map.prototype,'set'],[Map.prototype,'has'],[Set.prototype,'has'],[Set.prototype,'add'],
  [Array.prototype,'push'],[Array.prototype,'slice'],[Array.prototype,'filter'],[Array.prototype,'join'],[Array.prototype,'map'],[Array.prototype,'indexOf'],[Array.prototype,'concat'],[Array.prototype,Symbol.iterator],
  [String.prototype,'split'],[String.prototype,'replace'],[String.prototype,'indexOf'],[String.prototype,'slice'],[String.prototype,'valueOf'],
  [RegExp.prototype,'test'],[RegExp.prototype,'exec'],
  [Object,'defineProperty'],[Object,'getOwnPropertyDescriptor'],[Object,'getPrototypeOf'],[Object,'setPrototypeOf'],[Object,'getOwnPropertyNames'],[Object,'keys'],[Object,'create'],[Object.prototype,'toString'],
  [Math,'round'],[Math,'min'],[Math,'max'],[Math,'imul'],[Math,'floor'],[Math,'trunc'],[Math,'ceil'],
  [Document.prototype,'createElement'],[HTMLCanvasElement.prototype,'getContext'],[CanvasRenderingContext2D.prototype,'drawImage'],[CanvasRenderingContext2D.prototype,'putImageData'],
  [WebGLRenderingContext.prototype,'pixelStorei'],[WebGLRenderingContext.prototype,'isContextLost'],
  [OffscreenCanvas.prototype,'getContext'],
];
const getters=[
  [HTMLCanvasElement.prototype,'width'],[HTMLCanvasElement.prototype,'height'],[ImageData.prototype,'data'],[ImageData.prototype,'width'],[ImageData.prototype,'height'],
  [CanvasRenderingContext2D.prototype,'canvas'],[WebGLRenderingContext.prototype,'drawingBufferWidth'],[OffscreenCanvas.prototype,'width'],[AudioBuffer.prototype,'length'],
  [DOMRect.prototype,'x'],[DOMRect.prototype,'width'],[DOMRectList.prototype,'length'],
];
const hooked=[];
const arm=(o,p,kind)=>{
  const d=Object.getOwnPropertyDescriptor(o,p);if(!d)return null;
  const slot={name:(o.constructor&&o.constructor.name||'')+'.'+String(p)+(kind==='get'?'#get':''),count:0,armed:false};
  const orig=kind==='get'?d.get:d.value;if(typeof orig!=='function')return null;
  const hook=function(){if(slot.armed)slot.count++;return RA(orig,this,arguments);};
  Object.defineProperty(o,p,kind==='get'?{...d,get:hook}:{...d,value:hook});
  slot.restore=()=>Object.defineProperty(o,p,d);hooked.push(slot);return slot;
};
for(const [o,p] of methods)arm(o,p,'value');
for(const [o,p] of getters)arm(o,p,'get');
const fired={};
for(const name of Object.keys(calls)){
  // Index loops: a for-of loop would itself call the Array iterator while hooks are armed.
  for(let i=0;i<hooked.length;i++)hooked[i].armed=true;
  try{calls[name]();}catch(e){fired[name+'!throws']=String(e);}
  for(let i=0;i<hooked.length;i++)hooked[i].armed=false;
  for(let i=0;i<hooked.length;i++){const s=hooked[i];if(s.count){(fired[name]??=[]).push(s.name+' x'+s.count);s.count=0;}}
}
for(const s of hooked)s.restore();
report({hooks:hooked.length,fired});
`;

it('no spoofed API calls a built-in that the page can replace',async()=>{
  const r=await probe<{hooks:number;fired:Record<string,string[]|string>;error?:string}>('hostile-hooks',HOSTILE);
  expect(r.error).toBeUndefined();
  expect(r.hooks).toBeGreaterThan(50);
  expect(r.fired).toEqual({});
},120000);

// Noise is a function of the picture and the profile seed only. These values were recorded from the
// implementation before the spoof script stopped looking up built-ins at call time (2026-11-11); a
// rewrite must not change a single byte.
const SNAPSHOT=String.raw`
const hash=async(bytes)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('').slice(0,16);
const out={};
const cv=document.createElement('canvas');cv.width=64;cv.height=64;const ctx=cv.getContext('2d',{willReadFrequently:true});
const g=ctx.createLinearGradient(0,0,64,64);g.addColorStop(0,'#f80');g.addColorStop(1,'#08f');ctx.fillStyle=g;ctx.fillRect(0,0,64,64);ctx.fillStyle='#123';ctx.fillRect(10,10,30,30);ctx.beginPath();ctx.arc(32,32,20,0,6.28);ctx.stroke();
out.image=await hash(ctx.getImageData(0,0,64,64).data);
out.url=await hash(new TextEncoder().encode(cv.toDataURL()));
out.blob=await hash(await new Promise(r=>cv.toBlob(b=>b.arrayBuffer().then(r))));
const oc=new OffscreenCanvas(64,64);const o2=oc.getContext('2d');o2.fillStyle='#f80';o2.fillRect(0,0,64,64);o2.fillStyle='#123';o2.fillRect(10,10,30,30);o2.beginPath();o2.arc(32,32,20,0,6.28);o2.stroke();
out.offscreen=await hash(o2.getImageData(0,0,64,64).data);
out.offscreenBlob=await hash(await (await oc.convertToBlob()).arrayBuffer());
const el=document.createElement('div');el.style.cssText='position:absolute;left:3.3px;top:4.4px;width:50.5px;height:20.2px';document.body.appendChild(el);
const r=el.getBoundingClientRect();out.rect=[r.x,r.y,r.width,r.height];
const lr=el.getClientRects()[0];out.rects=[lr.x,lr.y,lr.width,lr.height];
const audio=new OfflineAudioContext(1,2000,8000);const osc=audio.createOscillator();osc.type='triangle';osc.frequency.value=440;osc.connect(audio.destination);osc.start();
const rendered=await audio.startRendering();
out.audio=await hash(rendered.getChannelData(0).buffer.slice(0));
const ab=new AudioBuffer({length:1000,sampleRate:8000});{const d=ab.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.sin(i/7);}
const copy=new Float32Array(1000);ab.copyFromChannel(copy,0);out.channelCopy=await hash(copy.buffer);
out.channel=await hash(ab.getChannelData(0).buffer.slice(0));
out.major=/Chrome\/(\d+)/.exec(navigator.userAgent)[1];
report(out);
`;
const EXPECTED:Record<string,Record<string,unknown>>={
  '156':{"image": "73fca4a0a3da6b7b", "url": "388893e91b01fbd5", "blob": "f2f60a604fb7fc54", "offscreen": "1f601e0393b3d1ba", "offscreenBlob": "4de3590bf9e8fb59", "rect": [3.277496619485319, 4.371246619485318, 50.49031080974266, 20.17781080974266], "rects": [3.277496619485319, 4.371246619485318, 50.49031080974266, 20.17781080974266], "audio": "f8d11fd0444d6264", "channelCopy": "a2615525ccfef24c", "channel": "a2615525ccfef24c", "major": "156"},
  '157':{"image": "73fca4a0a3da6b7b", "url": "388893e91b01fbd5", "blob": "f2f60a604fb7fc54", "offscreen": "c019468778b49bae", "offscreenBlob": "7b147bb52a09cc19", "rect": [3.277496619485319, 4.371246619485318, 50.49031080974266, 20.17781080974266], "rects": [3.277496619485319, 4.371246619485318, 50.49031080974266, 20.17781080974266], "audio": "f8d11fd0444d6264", "channelCopy": "a2615525ccfef24c", "channel": "a2615525ccfef24c", "major": "157"},
};

it('canvas, ClientRects and audio noise is unchanged by the script rewrite',async()=>{
  const r=await probe<Record<string,unknown>>('noise-snapshot',SNAPSHOT);
  expect(r.error).toBeUndefined();
  if(process.env.EXODUS_RECORD_SNAPSHOT)console.log('SNAPSHOT '+JSON.stringify(r));
  const expected=EXPECTED[String(r.major)];
  // Only majors with a recorded snapshot are compared; a new Chrome major needs its own recording.
  if(!expected){console.warn('no noise snapshot for Chrome '+r.major);return;}
  expect(r).toEqual(expected);
},120000);
