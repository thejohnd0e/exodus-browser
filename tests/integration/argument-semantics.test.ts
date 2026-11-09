import {itWithGpu} from '../fixtures/gpu';
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

// The audit recheck of 2026-11-08 read the real GPU and the original canvas pixels by passing
// arguments the spoof did not convert like Chrome (a string, an object whose valueOf changes, a
// foreign receiver) and through other read paths (float16 ImageData, WebGL 2 pack settings).
// Every probe below runs in Chrome without overrides and in a spoofed profile; apart from the
// spoofed values themselves the answers, errors, conversion counts and GL state must agree.
const renderer='ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)';

const glProbe=`(make)=>{
  const out={};const err=(f)=>{try{const v=f();return v===null?'null':typeof v==='string'?'string':typeof v;}catch(e){return 'threw '+(e&&e.constructor&&e.constructor.name);}};
  const fresh=make();out.beforeExtension=fresh?fresh.getParameter(37446):'no context';
  const gl=make();if(!gl)return {context:false};
  gl.getExtension('WEBGL_debug_renderer_info');
  const P=Object.getPrototypeOf(gl).getParameter;
  let calls=0;const obj={valueOf(){calls++;return 37446;}};
  let foreignCalls=0;const foreignObj={valueOf(){foreignCalls++;return 37446;}};
  out.values=[gl.getParameter(37446),gl.getParameter('37446'),gl.getParameter(new String('37446')),gl.getParameter(obj),gl.getParameter(37446+2**32),gl.getParameter(37445),gl.getParameter('37445')];
  out.calls=calls;
  out.errors=[err(()=>P.call({},37446)),err(()=>P.call({},foreignObj)),err(()=>gl.getParameter()),err(()=>gl.getParameter(Symbol())),err(()=>gl.getParameter(1n)),err(()=>P.call(null,37446))];
  out.foreignCalls=foreignCalls;
  out.glError=gl.getError();
  return out;
}`;

const pageProbe=`(async()=>{
  const out={};const glProbe=${glProbe};
  out.gl1=glProbe(()=>document.createElement('canvas').getContext('webgl'));
  out.gl2=glProbe(()=>document.createElement('canvas').getContext('webgl2'));
  out.crossContext=(()=>{const a=document.createElement('canvas').getContext('webgl'),b=document.createElement('canvas').getContext('webgl2');if(!a||!b)return 'no context';try{WebGLRenderingContext.prototype.getParameter.call(b,37446);return 'returned';}catch(e){return 'threw '+e.constructor.name;}})();
  // Canvas: an object coordinate that answers 0 once and then 100000.
  const W=48,H=32;const cv=document.createElement('canvas');cv.width=W;cv.height=H;const x=cv.getContext('2d');
  x.fillStyle='#fff';x.fillRect(0,0,W,H);x.fillStyle='#d13';x.font='16px Arial';x.fillText('Ex 1',2,18);x.strokeStyle='#0a7';x.strokeRect(30.5,4.5,12,20);
  const plain=Array.from(x.getImageData(0,0,W,H).data);
  let coordCalls=0;const tricky={valueOf(){return coordCalls++===0?0:100000;}};
  let settingsCalls=0;const settings={get colorSpace(){settingsCalls++;return 'srgb';}};
  const viaObject=Array.from(x.getImageData(tricky,0,W,H,settings).data);
  out.canvas={plain,objectAgrees:JSON.stringify(viaObject)===JSON.stringify(plain),coordCalls,settingsCalls};
  // Float16 pixels, compared as the bytes they stand for.
  try{const f=x.getImageData(0,0,W,H,{pixelFormat:'rgba-float16'});out.canvas.float16=Object.prototype.toString.call(f.data);out.canvas.floatAgrees=Array.from(f.data).every((v,i)=>Math.round(v*255)===plain[i]);}catch(e){out.canvas.float16='threw '+e.constructor.name;}
  // WebGL 2 reads with pack settings and into a pixel pack buffer.
  const g=document.createElement('canvas');g.width=24;g.height=16;const gl=g.getContext('webgl2',{preserveDrawingBuffer:true,antialias:false});
  if(gl){
    gl.enable(gl.SCISSOR_TEST);gl.clearColor(1,1,1,1);gl.clear(gl.COLOR_BUFFER_BIT);
    [[1,0,0],[0,.5,1],[.2,.8,.1]].forEach((col,n)=>{gl.scissor(2+n*6,3+n*2,7,8);gl.clearColor(col[0],col[1],col[2],1);gl.clear(gl.COLOR_BUFFER_BIT);});
    gl.disable(gl.SCISSOR_TEST);
    const tight=new Uint8Array(24*16*4);gl.readPixels(0,0,24,16,gl.RGBA,gl.UNSIGNED_BYTE,tight);
    const rowLen=29,skipRows=2,skipPix=3;gl.pixelStorei(gl.PACK_ROW_LENGTH,rowLen);gl.pixelStorei(gl.PACK_SKIP_ROWS,skipRows);gl.pixelStorei(gl.PACK_SKIP_PIXELS,skipPix);gl.pixelStorei(gl.PACK_ALIGNMENT,8);
    const stride=Math.ceil(rowLen*4/8)*8,packed=new Uint8Array(stride*(16+skipRows)+64);gl.readPixels(0,0,24,16,gl.RGBA,gl.UNSIGNED_BYTE,packed,8);
    const state=[gl.getParameter(gl.PACK_ROW_LENGTH),gl.getParameter(gl.PACK_SKIP_ROWS),gl.getParameter(gl.PACK_SKIP_PIXELS),gl.getParameter(gl.PACK_ALIGNMENT)];
    let packedAgrees=true;for(let j=0;j<16;j++)for(let i=0;i<24*4;i++)if(packed[8+skipRows*stride+skipPix*4+j*stride+i]!==tight[j*24*4+i])packedAgrees=false;
    gl.pixelStorei(gl.PACK_ROW_LENGTH,0);gl.pixelStorei(gl.PACK_SKIP_ROWS,0);gl.pixelStorei(gl.PACK_SKIP_PIXELS,0);gl.pixelStorei(gl.PACK_ALIGNMENT,4);
    const pbo=gl.createBuffer();gl.bindBuffer(gl.PIXEL_PACK_BUFFER,pbo);gl.bufferData(gl.PIXEL_PACK_BUFFER,24*16*4+16,gl.STREAM_READ);gl.readPixels(0,0,24,16,gl.RGBA,gl.UNSIGNED_BYTE,16);
    const fromBuffer=new Uint8Array(24*16*4);gl.getBufferSubData(gl.PIXEL_PACK_BUFFER,16,fromBuffer);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);
    let readCalls=0;const w={valueOf(){return readCalls++===0?24:1;}};const viaObject=new Uint8Array(24*16*4);gl.readPixels(0,0,w,16,gl.RGBA,gl.UNSIGNED_BYTE,viaObject);
    out.webgl2={tight:Array.from(tight),packedAgrees,state,bufferAgrees:fromBuffer.every((v,i)=>v===tight[i]),objectAgrees:viaObject.every((v,i)=>v===tight[i]),readCalls,glError:gl.getError(),
      boundAfter:gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING)===null};
  }
  // Audio: the channel is converted once.
  const buf=new AudioBuffer({length:16,sampleRate:8000});let channelCalls=0;buf.getChannelData({valueOf(){channelCalls++;return 0;}});out.channelCalls=channelCalls;
  out.worker=await new Promise(res=>{const w=new Worker(URL.createObjectURL(new Blob(['const glProbe='+${JSON.stringify(glProbe)}+';postMessage({gl1:glProbe(()=>new OffscreenCanvas(4,4).getContext("webgl")),gl2:glProbe(()=>new OffscreenCanvas(4,4).getContext("webgl2"))})'])));w.onmessage=e=>res(e.data);setTimeout(()=>res('timeout'),8000);});
  return out;
})()`;

const offProbe=`(async()=>{
  const c=()=>document.createElement('canvas');
  const page=[c().getContext('webgl'),c().getContext('webgl2'),c().getContext('experimental-webgl'),c().getContext(new String('webgl')),c().getContext({toString(){return 'webgl2';}}),new OffscreenCanvas(4,4).getContext('webgl')].map(v=>v===null);
  const oc=()=>new OffscreenCanvas(4,4);let conversions=0;
  page.push(oc().getContext(new String('webgl2'))===null,oc().getContext({toString(){conversions++;return 'webgl';}})===null);
  const errorOf=(f)=>{try{f();return 'none';}catch(e){return e.constructor.name;}};
  const errors=[errorOf(()=>oc().getContext('experimental-webgl')),errorOf(()=>oc().getContext('bogus')),errorOf(()=>OffscreenCanvas.prototype.getContext.call({},'webgl')),errorOf(()=>oc().getContext())];
  const twoD=Boolean(c().getContext('2d'))&&Boolean(oc().getContext('2d'));
  const native=Function.prototype.toString.call(HTMLCanvasElement.prototype.getContext);
  const worker=await new Promise(res=>{const w=new Worker(URL.createObjectURL(new Blob(["postMessage([new OffscreenCanvas(4,4).getContext('webgl'),new OffscreenCanvas(4,4).getContext(new String('webgl2'))].map(v=>v===null))"])));w.onmessage=e=>res(e.data);setTimeout(()=>res('timeout'),8000);});
  return {page,twoD,native,worker,errors,conversions};
})()`;

async function run(fingerprint:Fingerprint,probe:string){
  const reports:Array<Record<string,any>>=[];
  const server=createServer((req,res)=>{
    if(req.method==='POST'){let b='';req.on('data',c=>b+=c);req.on('end',()=>{reports.push(JSON.parse(b));res.end('ok');});return;}
    res.setHeader('Content-Type','text/html');
    res.end(`<!doctype html><script>${probe}.then(v=>fetch('/r',{method:'POST',body:JSON.stringify(v)}),e=>fetch('/r',{method:'POST',body:JSON.stringify({error:String(e&&e.stack||e)})}))</script>`);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');const root=tempRoot();
  try{
    const p=await new ChromiumAdapter(exe).launch({profileId:'argument-semantics',userDataDir:root,languages:['en-US'],startUrls:[`http://127.0.0.1:${(server.address() as AddressInfo).port}/`],fingerprint,fingerprintSeed:5});
    try{for(let i=0;i<120&&!reports.length;i++)await sleep(100);}finally{await p.stop();}
  }finally{cleanup(root);server.closeAllConnections();server.close();}
  if(!reports.length)throw Error('page did not report');
  if(reports[0].error)throw Error(reports[0].error);
  return reports[0];
}

/** What a spoofed probe must equal: the stock answer with the configured GPU strings in place of the real ones. */
function expectedGl(stock:Record<string,any>){
  if(!stock||stock.context===false)return stock;
  const spoofed=(v:unknown,name:string)=>v===null?null:name;
  return {...stock,beforeExtension:stock.beforeExtension===null?null:renderer,
    values:stock.values.map((v:unknown,i:number)=>spoofed(v,i>=5?'Google Inc. (Apple)':renderer))};
}

itWithGpu('spoofed WebGL and canvas methods convert arguments, check receivers and read pixels like Chrome',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const stock=await run(DEFAULT_FINGERPRINT,pageProbe);
  const spoof=await run({...DEFAULT_FINGERPRINT,canvas:'noise',webgl:'noise',audio:'noise',webglInfo:{mode:'manual',vendor:'Google Inc. (Apple)',renderer}},pageProbe);
  // The real renderer is visible in stock, so a leak would show up as that string.
  expect(stock.gl1.values[0]).not.toBe(renderer);
  for(const ctx of ['gl1','gl2'])expect(spoof[ctx],ctx).toEqual(expectedGl(stock[ctx]));
  for(const ctx of ['gl1','gl2'])expect(spoof.worker[ctx],'worker '+ctx).toEqual(expectedGl(stock.worker[ctx]));
  expect(spoof.crossContext).toBe(stock.crossContext);
  expect(spoof.channelCalls).toBe(stock.channelCalls);
  // Canvas: same conversions, every path returns the noised pixels.
  expect({...spoof.canvas,plain:undefined}).toEqual({...stock.canvas,plain:undefined});
  expect(spoof.canvas.plain,'the canvas is noised').not.toEqual(stock.canvas.plain);
  // WebGL 2: pack settings, pixel pack buffer and object arguments agree with the tight read.
  expect({...spoof.webgl2,tight:undefined}).toEqual({...stock.webgl2,tight:undefined});
  expect(spoof.webgl2.tight,'readPixels is noised').not.toEqual(stock.webgl2.tight);
},240000);

itWithGpu('WebGL Off is the engine switch: no context in pages, workers or OffscreenCanvas, whatever the argument',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const stock=await run(DEFAULT_FINGERPRINT,offProbe);
  const off=await run({...DEFAULT_FINGERPRINT,webgl:'off'},offProbe);
  expect(stock.page.every((v:boolean)=>!v),'stock Chrome creates WebGL contexts').toBe(true);
  expect(off.page).toEqual([true,true,true,true,true,true,true,true]);
  expect(off.errors,'invalid types and receivers fail as in Chrome').toEqual(stock.errors);
  expect(off.conversions).toBe(stock.conversions);
  expect(off.worker).toEqual([true,true]);
  expect(off.twoD).toBe(true);
  expect(off.native).toBe('function getContext() { [native code] }');
},120000);
