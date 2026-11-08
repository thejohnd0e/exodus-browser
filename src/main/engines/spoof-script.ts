import { randomUUID } from 'node:crypto';
import type { Fingerprint } from '../../shared/fingerprint';
import { navigatorPlatformByOs } from '../../shared/user-agent';

export interface WebgpuAdapterIdentity {
  vendor: string;
  architecture: string;
}

export function webgpuInfoFor(vendor: string, renderer: string): WebgpuAdapterIdentity {
  const v = `${vendor} ${renderer}`.toLowerCase();
  if (v.includes('nvidia')) {
    const architecture = /rtx\s*40/.test(v) ? 'lovelace' : /rtx\s*30/.test(v) ? 'ampere' : /(rtx\s*20|gtx\s*16)/.test(v) ? 'turing' : 'ampere';
    return { vendor: 'nvidia', architecture };
  }
  if (v.includes('amd') || v.includes('radeon')) {
    const architecture = /rx\s*7/.test(v) ? 'rdna-3' : /rx\s*6/.test(v) ? 'rdna-2' : /rx\s*5\d{3}/.test(v) ? 'rdna-1' : /rx\s*5\d{2}/.test(v) ? 'gcn-4' : 'rdna-2';
    return { vendor: 'amd', architecture };
  }
  if (v.includes('intel')) {
    const architecture = /(iris.*xe|uhd.*7\d\d)/.test(v) ? 'gen-12lp' : /(uhd.*6\d\d|iris.*plus)/.test(v) ? 'gen-9' : 'gen-12lp';
    return { vendor: 'intel', architecture };
  }
  if (v.includes('apple')) {
    return { vendor: 'apple', architecture: 'common-3' };
  }
  return { vendor: '', architecture: '' };
}

export interface SpoofConfig {
  seed: number;
  canvas: 'off' | 'real' | 'noise';
  webgl: 'off' | 'real' | 'noise';
  webglInfo: { vendor: string; renderer: string } | null;
  webgpuInfo: WebgpuAdapterIdentity | null;
  webgpuOff: boolean;
  clientRectsNoise: boolean;
  audioNoise: boolean;
  hardware: { cores: number; memoryGb: number } | null;
  screen: { width: number; height: number; availWidth: number; availHeight: number } | null;
  /** Set only for an out-of-process iframe, where Chromium's screen emulation does not reach. */
  frameScreen: { dpr: number | null } | null;
  webRtc: 'off' | null;
}

export interface ScreenAvailability { width: number; height: number }

/**
 * The spoofed screen keeps the host display's work-area inset (taskbar/dock) instead of an
 * arbitrary constant, so window.screen.avail* stays plausible for the emulated resolution.
 */
export function deriveScreenAvailability(spoof: { width: number; height: number }, real: { width: number; height: number; availWidth: number; availHeight: number }): ScreenAvailability {
  const inset = (full: number, available: number) => Math.min(Math.max(0, full - available), Math.max(0, full - 1));
  return {
    width: Math.max(1, spoof.width - inset(real.width, real.availWidth)),
    height: Math.max(1, spoof.height - inset(real.height, real.availHeight)),
  };
}

export function spoofConfig(fingerprint: Fingerprint, seed: number, available?: ScreenAvailability, outOfProcessFrame = false): SpoofConfig {
  const webglInfo = fingerprint.webglInfo.mode === 'manual' ? { vendor: fingerprint.webglInfo.vendor, renderer: fingerprint.webglInfo.renderer } : null;
  const webgpuOff = fingerprint.webgpu === 'off';
  const webgpuCandidate = webglInfo && !webgpuOff ? webgpuInfoFor(webglInfo.vendor, webglInfo.renderer) : null;
  const webgpuInfo = webgpuCandidate && webgpuCandidate.vendor ? webgpuCandidate : null;
  return {
    seed,
    canvas: fingerprint.canvas,
    webgl: fingerprint.webgl,
    webglInfo,
    webgpuInfo,
    webgpuOff,
    clientRectsNoise: fingerprint.clientRects === 'noise',
    audioNoise: fingerprint.audio === 'noise',
    hardware: fingerprint.hardware.mode === 'manual' ? { cores: fingerprint.hardware.cores, memoryGb: fingerprint.hardware.memoryGb } : null,
    screen: fingerprint.screen.mode === 'manual' ? {
      width: fingerprint.screen.width,
      height: fingerprint.screen.height,
      availWidth: available?.width ?? fingerprint.screen.width,
      availHeight: available?.height ?? fingerprint.screen.height,
    } : null,
    frameScreen: outOfProcessFrame && fingerprint.screen.mode === 'manual' ? { dpr: fingerprint.screen.dpr ?? null } : null,
    webRtc: fingerprint.webRtc === 'off' ? 'off' : null,
  };
}

const PRELUDE = `const c=__CFG__;
const H=(x,y)=>{let h=(c.seed^Math.imul(x|0,374761393)^Math.imul(y|0,668265263))>>>0;h=Math.imul(h^h>>>13,1274126177);h^=h>>>16;return(h>>>0)/4294967296};
const nativeToString=Function.prototype.toString;
const HANDSHAKE=__NONCE__;
const ownMap=new WeakMap();
let rootMap=ownMap;
const childMaps=new Set();
const getMap=()=>{
  if(rootMap!==ownMap)return rootMap;
  try{
    if(typeof window!=='undefined'){
      let cur=window;
      while(cur.parent&&cur.parent!==cur){
        try{
          const m=cur.parent.Function.prototype.toString.call(Object(HANDSHAKE));
          if(m&&typeof m.has==='function'){rootMap=m;break;}
        }catch(e){}
        cur=cur.parent;
      }
    }
  }catch(e){}
  return rootMap;
};
const mask=(fn,orig)=>{
  try{
    if(orig&&orig.name)Object.defineProperty(fn,'name',{value:orig.name,configurable:true});
    if(orig&&typeof orig.length==='number')Object.defineProperty(fn,'length',{value:orig.length,configurable:true});
  }catch(e){}
  if(orig){ownMap.set(fn,orig);getMap().set(fn,orig);}
  return fn;
};
const cleanStack=(e)=>{
  try{
    if(e&&typeof e.stack==='string'){
      e.stack=e.stack.split('\\n').filter(l=>!/<anonymous>:\\d+:\\d+/.test(l)).join('\\n').replace('at Object.toString (<anonymous>)','at Function.toString (<anonymous>)');
    }
  }catch(_){}
  return e;
};
const strValueOf=String.prototype.valueOf;
// The cross-frame handshake is a String wrapper. String.prototype.valueOf checks the internal slot
// natively, so an arbitrary object passed to Function.prototype.toString never runs page code.
const isHandshake=(v)=>{if(!v||typeof v!=='object')return false;try{return Reflect.apply(strValueOf,v,[])===HANDSHAKE;}catch(e){return false;}};
// Accessor syntax gives a getter that, like the browser's own, cannot be constructed and has no
// prototype. Calling the original first keeps its receiver check (TypeError: Illegal invocation).
const asGetter=(orig,compute,name)=>{
  const g=Object.getOwnPropertyDescriptor({get x(){if(orig){try{Reflect.apply(orig,this,[]);}catch(e){throw cleanStack(e);}}return Reflect.apply(compute,this,[]);}},'x').get;
  if(!orig&&name)try{Object.defineProperty(g,'name',{value:name,configurable:true});}catch(e){}
  return mask(g,orig);
};
// Method syntax: not constructible and no prototype, like a native method.
const asMethod=(orig,impl)=>mask({x(){try{return Reflect.apply(impl,this,arguments);}catch(e){throw cleanStack(e);}}}.x,orig);
/** True when an argument must reach the browser untouched: converting it can only throw. */
const nzOdd=(v)=>typeof v==='symbol'||typeof v==='bigint';
/**
 * The browser's own receiver check for a method of proto, run before any argument is converted,
 * as Chrome's bindings do; null when proto has no attribute to check with.
 */
const brandOf=(proto,attr)=>{const d=Object.getOwnPropertyDescriptor(proto,attr);return d&&d.get?d.get:null;};
const resolveOrig=(fn)=>{
  const m=getMap();
  let cur=fn;
  for(;;){
    if(ownMap.has(cur)){cur=ownMap.get(cur);continue;}
    if(m.has(cur)){cur=m.get(cur);continue;}
    let found=false;
    for(const cm of childMaps){if(cm.has(cur)){cur=cm.get(cur);found=true;break;}}
    if(!found)break;
  }
  return cur;
};
const makeToString=(fts)=>{
  const p=new Proxy(fts,{
    apply(target,thisArg,args){
      if(isHandshake(thisArg))return ownMap;
      try{
        return Reflect.apply(target,resolveOrig(thisArg),args);
      }catch(e){
        throw cleanStack(e);
      }
    }
  });
  ownMap.set(p,fts);
  getMap().set(p,fts);
  return p;
};
try{Function.prototype.toString=makeToString(nativeToString);}catch(e){}
const frameHooks=[];
const patchFrame=(w)=>{
  try{
    if(!w||!w.Function)return;
    const m=getMap();
    const fts=w.Function.prototype.toString;
    try{
      const cm=fts.call(Object(HANDSHAKE));
      if(cm&&typeof cm.has==='function'){childMaps.add(cm);m.set(fts,cm.get(fts)||fts);}
    }catch(e){}
    if(!m.has(fts)&&!ownMap.has(fts)){
      w.Function.prototype.toString=makeToString(fts);
    }
    if(c.hardware&&w.Navigator){
      const d=(k,v)=>{const o=w.Object.getOwnPropertyDescriptor(w.Navigator.prototype,k);if(o&&o.get&&!m.has(o.get)&&!ownMap.has(o.get)){const g=asGetter(o.get,()=>v);w.Object.defineProperty(w.Navigator.prototype,k,{get:g,configurable:true,enumerable:true});}};
      d('hardwareConcurrency',c.hardware.cores);
      d('deviceMemory',c.hardware.memoryGb);
    }
    for(const h of frameHooks)try{h(w);}catch(e){}
  }catch(e){}
};
if(typeof HTMLIFrameElement!=='undefined'){
  try{
    const cwDesc=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'contentWindow');
    if(cwDesc&&cwDesc.get){
      const origCw=cwDesc.get;
      const getCw=asGetter(origCw,function(){const w=origCw.call(this);patchFrame(w);return w;});
      Object.defineProperty(HTMLIFrameElement.prototype,'contentWindow',{get:getCw,configurable:true,enumerable:true});
    }
  }catch(e){}
}
const keep=(o,p,w)=>{const f=o[p];if(!f)return;o[p]=asMethod(f,w(f));return f};
// ClientRects noise moves the values of the rects the browser returned, in place. DOMRectList holds
// mutable DOMRect objects, so indexing, item(), descriptors, iteration and the native methods all
// read the same noised numbers and the list stays a real DOMRectList (audit 2026-11-08: a Proxy
// over the list leaked the real values through descriptors and broke native item/length).
const noiseRect=(r)=>{if(!r)return r;const d=H(Math.round(r.x*100),Math.round(r.y*100))*0.04-0.02;r.x=r.x+d;r.y=r.y+d;r.width=r.width+d*0.5;r.height=r.height+d*0.5;return r};
const noiseRectList=(list)=>{if(list)for(let i=0;i<list.length;i++)noiseRect(list[i]);return list};`;

const NOISE_CORE = `// Canvas and WebGL noise (DECISIONS #81). Only pixels on an edge change, so a uniform area stays
// uniform and cannot be used to read the mask. The key is the pixel and the sums of its opposite
// neighbours, all without their lowest bit: the same picture gets the same noise anywhere on the
// surface and in either row order (readPixels is bottom-up), and noising a noised image changes
// nothing, as a getImageData/putImageData round trip does in Chrome. Only the lowest bit of one
// colour channel of an opaque pixel is ever set.
const nzMix=(h)=>{h=Math.imul(h^(h>>>16),2246822507);h=Math.imul(h^(h>>>13),3266489909);return (h^(h>>>16))>>>0;};
// ext holds the region one pixel larger on every side (es bytes per row); ext columns li..hi-1 and
// rows lj..hj-1 lie on the surface, a neighbour outside it counts as equal to the pixel.
const nzApply=(ext,es,w,h,out,os,base,li,hi,lj,hj)=>{
  const changed=[],ew=w+2,m=new Uint32Array(ew*(h+2));
  for(let j=0;j<h+2;j++){let o=j*es,q=j*ew;for(let i=0;i<ew;i++,o+=4,q++)m[q]=(((ext[o]&254)<<24)|((ext[o+1]&254)<<16)|((ext[o+2]&254)<<8)|(ext[o+3]&254))>>>0;}
  for(let j=0;j<h;j++){
    const up=j>=lj&&j<hj,down=j+2>=lj&&j+2<hj;
    for(let i=0;i<w;i++){
      const q=(j+1)*ew+i+1;if(ext[(j+1)*es+(i+1)*4+3]!==255)continue;
      const vc=m[q],l=i>=li&&i<hi?m[q-1]:vc,r=i+2>=li&&i+2<hi?m[q+1]:vc,u=up?m[q-ew]:vc,d=down?m[q+ew]:vc;
      if(l===vc&&r===vc&&u===vc&&d===vc)continue;
      const k=nzMix((c.seed^nzMix(vc^nzMix(((l+r)>>>0)^nzMix((u+d)>>>0))))>>>0);
      if(k&1)continue;
      const o=base+j*os+i*4+((k>>>1)%3),bit=(k>>>8)&1;
      if((out[o]&1)!==bit){out[o]=(out[o]&254)|bit;changed.push(i,j,(k>>>1)%3);}
    }
  }
  return changed;
};
/** Noises ImageData that getImageData returned for the already converted (x,y,w,h). Byte and
 * floating-point pixel formats get the same noise: float values are compared as the bytes they
 * stand for, and a changed channel is set to the float of its new byte. */
const nzTag=(a)=>Object.prototype.toString.call(a);
const nz2d=(f,ctx,d,x,y,w,h)=>{
  const a=d.data,tag=nzTag(a);
  const bytes=tag==='[object Uint8ClampedArray]'||tag==='[object Uint8Array]',float=tag==='[object Float16Array]'||tag==='[object Float32Array]';
  if(!bytes&&!float)return null;
  let sx=x,sy=y;if(w<0)sx+=w;if(h<0)sy+=h;
  const dw=d.width,dh=d.height,cv=ctx.canvas,cw=cv.width,chh=cv.height;
  // The neighbours are read with the settings of the returned image, never the page's object again.
  const settings={};if(d.colorSpace)settings.colorSpace=d.colorSpace;if(d.pixelFormat)settings.pixelFormat=d.pixelFormat;
  const ext=f.call(ctx,sx-1,sy-1,dw+2,dh+2,settings).data;
  if(bytes)return nzApply(ext,(dw+2)*4,dw,dh,a,dw*4,0,1-sx,cw+1-sx,1-sy,chh+1-sy);
  const q=(arr)=>{const b=new Uint8Array(arr.length);for(let k=0;k<arr.length;k++){const v=Math.round(arr[k]*255);b[k]=v>255?255:v>0?v:0;}return b;};
  const ob=q(a),changed=nzApply(q(ext),(dw+2)*4,dw,dh,ob,dw*4,0,1-sx,cw+1-sx,1-sy,chh+1-sy);
  for(let k=0;k<changed.length;k+=3){const o=changed[k+1]*dw*4+changed[k]*4+changed[k+2];a[o]=ob[o]/255;}
  return changed;
};
/** Noises a private copy of a canvas in place, writing only the pixels that changed. */
const nzCopy=(f,ctx)=>{
  const w=ctx.canvas.width,h=ctx.canvas.height;const ext=f.call(ctx,-1,-1,w+2,h+2);const a=ext.data;
  if(!ArrayBuffer.isView(a)||a.BYTES_PER_ELEMENT!==1)return;
  // One read: the enlarged image is noised in place and its changed pixels are written back.
  const changed=nzApply(a,(w+2)*4,w,h,a,(w+2)*4,(w+2)*4+4,1,w+1,1,h+1);
  for(let k=0;k<changed.length;k+=3)ctx.putImageData(ext,-1,-1,changed[k]+1,changed[k+1]+1,1,1);
};
/**
 * WebGL readPixels with RGBA/UNSIGNED_BYTE, into a byte view or a pixel pack buffer, honouring
 * PACK_ALIGNMENT, PACK_ROW_LENGTH, PACK_SKIP_ROWS, PACK_SKIP_PIXELS and the destination offset:
 * the same noise as the 2D canvas, with the drawing buffer as the surface. The neighbours are read
 * tightly packed into private memory and every pack setting is restored.
 */
const nzGL=(gl,f,gl2,x,y,w,h,format,type,pix,off,pbo)=>{
  if(format!==0x1908||type!==0x1401||!(w>0)||!(h>0)||gl.isContextLost())return;
  const align=gl.getParameter(0x0D05),rowLen=gl2?gl.getParameter(0x0D02):0,skipRows=gl2?gl.getParameter(0x0D03):0,skipPix=gl2?gl.getParameter(0x0D04):0;
  const stride=Math.ceil((rowLen>0?rowLen:w)*4/align)*align,start=skipRows*stride+skipPix*4,need=start+(h-1)*stride+w*4;
  let buffer=null;
  if(pbo<0){if(pix.BYTES_PER_ELEMENT!==1||pix.length-off<need)return;}
  else{buffer=gl.getParameter(0x88ED);if(!buffer||pbo+need>gl.getBufferParameter(0x88EB,0x8764))return;}
  const fbo=gl.getParameter(gl2?0x8CAA:0x8CA6);
  const ew=w+2,eh=h+2,ext=new Uint8Array(ew*eh*4);
  gl.pixelStorei(0x0D05,1);if(gl2){gl.pixelStorei(0x0D02,0);gl.pixelStorei(0x0D03,0);gl.pixelStorei(0x0D04,0);if(buffer)gl.bindBuffer(0x88EB,null);}
  try{f.call(gl,x-1,y-1,ew,eh,format,type,ext);}
  finally{gl.pixelStorei(0x0D05,align);if(gl2){gl.pixelStorei(0x0D02,rowLen);gl.pixelStorei(0x0D03,skipRows);gl.pixelStorei(0x0D04,skipPix);if(buffer)gl.bindBuffer(0x88EB,buffer);}}
  const bw=gl.drawingBufferWidth,bh=gl.drawingBufferHeight;
  const li=fbo?-1:1-x,hi=fbo?ew:bw+1-x,lj=fbo?-1:1-y,hj=fbo?eh:bh+1-y;
  if(!buffer){nzApply(ext,ew*4,w,h,pix,stride,off+start,li,hi,lj,hj);return;}
  // A pixel pack buffer gets the same noise, written byte by byte where it changes.
  const tight=new Uint8Array(w*h*4);for(let j=0;j<h;j++)tight.set(ext.subarray((j+1)*ew*4+4,(j+1)*ew*4+4+w*4),j*w*4);
  const changed=nzApply(ext,ew*4,w,h,tight,w*4,0,li,hi,lj,hj);
  for(let k=0;k<changed.length;k+=3){const t=changed[k+1]*w*4+changed[k]*4+changed[k+2];gl.bufferSubData(0x88EB,pbo+start+changed[k+1]*stride+changed[k]*4+changed[k+2],tight.subarray(t,t+1));}
};
/** getImageData with every argument converted exactly once, in the browser's order. */
const getImageDataOnce=(f,brand,self,a,off)=>{
  if(a.length<4||!brand)return {d:f.apply(self,a)};
  brand.call(self);
  for(let k=0;k<4;k++)if(nzOdd(a[k]))return {d:f.apply(self,a)};
  const x=+a[0],y=+a[1],w=+a[2],h=+a[3];
  const d=a.length>4?f.call(self,x,y,w,h,a[4]):f.call(self,x,y,w,h);
  if(!off)try{nz2d(f,self,d,x|0,y|0,w|0,h|0);}catch(e){}
  return {d};
};
`;

const CANVAS = `if(c.canvas!=='real'){
const empty=(w,h)=>new ImageData(new Uint8ClampedArray(Math.max(0,w*h*4)),w,h);
const patchCanvas=(C2D,HC)=>{
if(!C2D||!HC||ownMap.has(HC.prototype.toDataURL)||getMap().has(HC.prototype.toDataURL))return;
const brand=brandOf(C2D.prototype,'canvas');
const realGet=keep(C2D.prototype,'getImageData',f=>function(x,y,w,h){
  const d=getImageDataOnce(f,brand,this,arguments,c.canvas==='off').d;
  return c.canvas==='off'?empty(d.width,d.height):d;
});
// The page's canvas is never changed: the encoders run on a private copy. A zero-sized canvas
// cannot be drawn and is encoded as it is, like Chrome does.
const copyOf=(src)=>{const cv=document.createElement('canvas');cv.width=src.width;cv.height=src.height;
  if(c.canvas!=='off'){const x=cv.getContext('2d',{willReadFrequently:true});x.drawImage(src,0,0);try{nzCopy(realGet,x);}catch(e){}}return cv;};
keep(HC.prototype,'toDataURL',f=>function(type,quality){
  if(!this.width||!this.height)return f.apply(this,arguments);
  return f.apply(copyOf(this),arguments);
});
keep(HC.prototype,'toBlob',f=>function(cb,type,quality){
  if(!this.width||!this.height)return f.apply(this,arguments);
  return f.apply(copyOf(this),arguments);
});};
patchCanvas(CanvasRenderingContext2D,HTMLCanvasElement);
frameHooks.push(w=>patchCanvas(w.CanvasRenderingContext2D,w.HTMLCanvasElement));}`;

const WEBGL = `if(c.webgl!=='off'&&typeof WebGLRenderingContext!=='undefined'){
 const glInfo=(proto)=>{if(!proto)return;const real=proto.getParameter,brand=brandOf(proto,'canvas');if(!real||!brand)return;
  // The receiver is checked and the argument converted once, then the browser answers; a value
  // is replaced only where the browser itself returned one, so a missing extension or a lost
  // context still gives null (audit 2026-11-08 recheck: a string or an object reached the real GPU).
  proto.getParameter=asMethod(real,function(p){
    if(arguments.length<1)return real.apply(this,arguments);
    brand.call(this);
    if(nzOdd(p))return real.call(this,p);
    const v=+p,n=v>>>0,r=real.call(this,v);
    if(r!==null&&n===37445)return c.webglInfo.vendor;
    if(r!==null&&n===37446)return c.webglInfo.renderer;
    return r;
  });};
 const glRead=(proto,gl2)=>{if(!proto)return;const brand=brandOf(proto,'canvas');keep(proto,'readPixels',f=>function(){
  const a=arguments;if(a.length<7||!brand)return f.apply(this,a);
  brand.call(this);
  const dst=a[6],view=ArrayBuffer.isView(dst);
  if(!view&&!gl2)return f.apply(this,a);
  for(let k=0;k<a.length&&k<8;k++)if(nzOdd(a[k]))return f.apply(this,a);
  const x=+a[0],y=+a[1],w=+a[2],h=+a[3],format=+a[4],type=+a[5];
  if(view){const off=a.length>7?+a[7]:0;const r=a.length>7?f.call(this,x,y,w,h,format,type,dst,off):f.call(this,x,y,w,h,format,type,dst);
    try{nzGL(this,f,gl2,x|0,y|0,w|0,h|0,format>>>0,type>>>0,dst,off>>>0,-1);}catch(e){}return r;}
  const off=+dst;const r=f.call(this,x,y,w,h,format,type,off);
  try{const o=off===off&&isFinite(off)?Math.trunc(off):0;if(o>=0)nzGL(this,f,gl2,x|0,y|0,w|0,h|0,format>>>0,type>>>0,null,0,o);}catch(e){}
  return r;
 });};
 if(c.webglInfo){glInfo(WebGLRenderingContext.prototype);if(typeof WebGL2RenderingContext!=='undefined')glInfo(WebGL2RenderingContext.prototype);}
 if(c.webgl==='noise'){glRead(WebGLRenderingContext.prototype,false);if(typeof WebGL2RenderingContext!=='undefined')glRead(WebGL2RenderingContext.prototype,true);}
}`;

// WebGL Off: the engine switch covers canvas elements; OffscreenCanvas, in pages and workers,
// still creates a context. The context type is converted once, as Chrome converts the enum.
const OFFSCREEN_WEBGL_OFF = `if(c.webgl==='off'&&typeof OffscreenCanvas!=='undefined'){const brand=brandOf(OffscreenCanvas.prototype,'width');
 keep(OffscreenCanvas.prototype,'getContext',f=>function(t){
  if(arguments.length<1||!brand)return f.apply(this,arguments);
  brand.call(this);
  if(typeof t==='symbol')return f.apply(this,arguments);
  const s=String(t);if(s==='webgl'||s==='webgl2')return null;
  const a=Array.prototype.slice.call(arguments);a[0]=s;return f.apply(this,a);
 });
}`;

const OFFSCREEN_CANVAS = `if(c.canvas!=='real'&&typeof OffscreenCanvasRenderingContext2D!=='undefined'){
 const offBrand=brandOf(OffscreenCanvasRenderingContext2D.prototype,'canvas');
 const offGet=keep(OffscreenCanvasRenderingContext2D.prototype,'getImageData',f=>function(x,y,w,h){
  const d=getImageDataOnce(f,offBrand,this,arguments,c.canvas==='off').d;
  return c.canvas==='off'?new ImageData(new Uint8ClampedArray(d.width*d.height*4),d.width,d.height):d;
 });
 if(typeof OffscreenCanvas!=='undefined')keep(OffscreenCanvas.prototype,'convertToBlob',f=>function(options){
  if(!this.width||!this.height)return f.apply(this,arguments);
  try{const copy=new OffscreenCanvas(this.width,this.height),ctx=copy.getContext('2d',{willReadFrequently:true});if(c.canvas!=='off'){ctx.drawImage(this,0,0);try{nzCopy(offGet,ctx);}catch(e){}}return f.apply(copy,arguments);}catch(error){return Promise.reject(error);}
 });
}`;

const WEBGPU_INFO = `if(c.webgpuInfo&&typeof GPUAdapterInfo!=='undefined'){try{
  const def=(p,v)=>{const o=Object.getOwnPropertyDescriptor(GPUAdapterInfo.prototype,p);if(o&&o.get){const g=asGetter(o.get,()=>v);Object.defineProperty(GPUAdapterInfo.prototype,p,{get:g,configurable:true,enumerable:true});}};
  def('vendor',c.webgpuInfo.vendor);
  def('architecture',c.webgpuInfo.architecture);
}catch(e){}}`;

const CLIENT_RECTS = `if(c.clientRectsNoise){
  keep(Element.prototype,'getBoundingClientRect',f=>function(){return noiseRect(f.call(this));});
  keep(Element.prototype,'getClientRects',f=>function(){return noiseRectList(f.call(this));});
  if(typeof Range!=='undefined'){
    keep(Range.prototype,'getBoundingClientRect',f=>function(){return noiseRect(f.call(this));});
    keep(Range.prototype,'getClientRects',f=>function(){return noiseRectList(f.call(this));});
  }
}`;

const AUDIO = `if(c.audioNoise){
  if(typeof AnalyserNode!=='undefined'){
    keep(AnalyserNode.prototype,'getFloatFrequencyData',f=>function(a){f.call(this,a);for(let i=0;i<a.length;i++)if(isFinite(a[i]))a[i]+=(H(i,0)-0.5)*1e-7;});
    keep(AnalyserNode.prototype,'getByteFrequencyData',f=>function(a){f.call(this,a);for(let i=0;i<a.length;i++)if(a[i]>1&&H(i,1)<0.1)a[i]^=1;});
  }
  if(typeof AudioBuffer!=='undefined'){
    const seen=new WeakMap();
    const original=AudioBuffer.prototype.getChannelData;
    const brand=brandOf(AudioBuffer.prototype,'length');
    const apply=(buffer,ch)=>{let channels=seen.get(buffer);if(!channels){channels=new Set();seen.set(buffer,channels);}const data=original.call(buffer,ch);const n=ch>>>0;if(!channels.has(n)){for(let i=0;i<data.length;i+=100)if(data[i]!==0&&data[i]===data[i])data[i]*=1+(H(i,n)-0.5)*1e-4;channels.add(n);}return data;};
    keep(AudioBuffer.prototype,'getChannelData',f=>function(ch){
      if(arguments.length<1||!brand)return f.apply(this,arguments);brand.call(this);if(nzOdd(ch))return f.call(this,ch);return apply(this,+ch);});
    keep(AudioBuffer.prototype,'copyFromChannel',f=>function(dest,ch,start){
      if(arguments.length<2||!brand)return f.apply(this,arguments);brand.call(this);if(nzOdd(ch)||nzOdd(start))return f.apply(this,arguments);
      const n=+ch,s=arguments.length>2&&start!==undefined?+start:undefined;try{apply(this,n);}catch(e){}return s===undefined?f.call(this,dest,n):f.call(this,dest,n,s);});
  }
}`;

const HARDWARE = `if(c.hardware){try{
  const defProp=(proto,p,v)=>{try{
    const orig=Object.getOwnPropertyDescriptor(proto,p);
    const getter=asGetter(orig&&orig.get,()=>v,'get '+p);
    Object.defineProperty(proto,p,{get:getter,configurable:true,enumerable:true});
  }catch(e){}};
  if(typeof Navigator!=='undefined'){
    defProp(Navigator.prototype,'hardwareConcurrency',c.hardware.cores);
    defProp(Navigator.prototype,'deviceMemory',c.hardware.memoryGb);
  }
  if(typeof WorkerNavigator!=='undefined'){
    defProp(WorkerNavigator.prototype,'hardwareConcurrency',c.hardware.cores);
    defProp(WorkerNavigator.prototype,'deviceMemory',c.hardware.memoryGb);
  }
}catch(e){}}`;

const SCREEN = `if(c.screen){const w=c.screen.width,h=c.screen.height;try{
  const defProp=(proto,p,v)=>{try{
    const orig=Object.getOwnPropertyDescriptor(proto,p);
    const getter=asGetter(orig&&orig.get,()=>v,'get '+p);
    Object.defineProperty(proto,p,{get:getter,configurable:true,enumerable:true});
  }catch(e){}};
  if(typeof Screen!=='undefined'){
    defProp(Screen.prototype,'width',w);
    defProp(Screen.prototype,'height',h);
    defProp(Screen.prototype,'availWidth',c.screen.availWidth);
    defProp(Screen.prototype,'availHeight',c.screen.availHeight);
  }
}catch(e){}
try{
  const ow=Object.getOwnPropertyDescriptor(window,'outerWidth');
  const oh=Object.getOwnPropertyDescriptor(window,'outerHeight');
  const wg=asGetter(ow&&ow.get,()=>w,'get outerWidth');
  const hg=asGetter(oh&&oh.get,()=>h,'get outerHeight');
  Object.defineProperty(window,'outerWidth',{get:wg,configurable:true,enumerable:ow?ow.enumerable:true});
  Object.defineProperty(window,'outerHeight',{get:hg,configurable:true,enumerable:oh?oh.enumerable:true});
}catch(e){}}`;

// Out-of-process iframes only (DECISIONS #74). Chromium cannot emulate the screen there, so the frame
// renders with the host display: devicePixelRatio and matchMedia would contradict the spoofed
// window.screen. The real values are read before SCREEN patches them; screen queries in matchMedia
// are rewritten from the profile's screen to the host's, so they answer as the top page does, and
// MediaQueryList(Event).media still return the query as written. Stylesheet @media rules are not
// affected and keep following the host display.
const FRAME_SCREEN = `if(c.frameScreen&&c.screen){try{
  const sw=Object.getOwnPropertyDescriptor(Screen.prototype,'width'),sh=Object.getOwnPropertyDescriptor(Screen.prototype,'height');
  const realW=sw.get.call(screen),realH=sh.get.call(screen);
  const dd=Object.getOwnPropertyDescriptor(window,'devicePixelRatio');
  const realD=dd&&dd.get?dd.get.call(window):1;
  const W=c.screen.width,Hs=c.screen.height,D=c.frameScreen.dpr||realD;
  if(dd&&dd.get&&D!==realD)Object.defineProperty(window,'devicePixelRatio',{get:asGetter(dd.get,()=>D),set:dd.set,configurable:true,enumerable:dd.enumerable});
  const fmt=v=>String(Math.round(v*1e6)/1e6);
  const toHost=(feature,value)=>feature.indexOf('width')>=0?value*realW/W:feature.indexOf('height')>=0?value*realH/Hs:value*realD/D;
  // The query is parsed, not pattern-matched (audit recheck 2026-11-08: a tab, calc() or inches
  // slipped past regular expressions). Comments become spaces; every parenthesised block that holds
  // a single screen feature (colon or range form, any whitespace) gets its values converted for the
  // host display; everything else is kept as written. The browser itself evaluates each value with
  // CSS Typed OM, so calc() and every absolute unit work; em and rem are 16px in media queries.
  const parseNum=CSSNumericValue.parse,toUnit=CSSNumericValue.prototype.to;
  const unitValue=(text,unit)=>{try{return Reflect.apply(toUnit,Reflect.apply(parseNum,CSSNumericValue,[text]),[unit]).value;}catch(e){return null;}};
  // Whitespace in a media query (space, tab, line feed, carriage return, form feed), built without
  // escapes because this script is a template literal.
  const WS=new RegExp('['+String.fromCharCode(32,9,10,13,12)+']+','g');
  const ZERO=/^[+-]?(?:0+[.]?0*|[.]0+)$/;
  const toPx=v=>ZERO.test(v)?0:unitValue(v.replace(/([0-9.]+(?:e[+-]?[0-9]+)?)r?em(?![a-z])/gi,(m,n)=>(parseFloat(n)*16)+'px'),'px');
  const toDppx=v=>unitValue(v.replace(/([0-9.])x(?![a-z])/gi,'$1dppx'),'dppx');
  const conv=(feature,v)=>{
    if(feature.indexOf('width')>=0||feature.indexOf('height')>=0){const n=toPx(v);return n===null?null:fmt(toHost(feature,n))+'px';}
    if(feature.indexOf('device-pixel-ratio')>=0){if(!/^[+-]?(?:[0-9]+[.]?[0-9]*|[.][0-9]+)(?:e[+-]?[0-9]+)?$/i.test(v))return null;return fmt(toHost(feature,Number(v)));}
    const n=toDppx(v);return n===null?null:fmt(toHost(feature,n))+'dppx';
  };
  const NAMED=/^(?:-webkit-)?(?:min-|max-)?(?:-webkit-)?(?:device-width|device-height|resolution|device-pixel-ratio)$/i,RANGED=/^(?:device-width|device-height|resolution)$/i;
  const feature=content=>{
    const t=content.replace(WS,' ').trim();
    if(!/[<>=]/.test(t)){
      const at=t.indexOf(':');if(at<=0)return content;
      const name=t.slice(0,at).trim();if(!NAMED.test(name))return content;
      const v=conv(name.toLowerCase(),t.slice(at+1).trim());return v===null?content:name+': '+v;
    }
    const parts=t.split(/(<=|>=|<|>|=)/);if(parts.length!==3&&parts.length!==5)return content;
    const terms=parts.filter((_,k)=>k%2===0).map(x=>x.trim());
    const at=terms.findIndex(x=>RANGED.test(x));if(at<0||terms.filter(x=>RANGED.test(x)).length!==1)return content;
    const name=terms[at].toLowerCase();const values=terms.map((x,k)=>k===at?terms[at]:conv(name,x));
    if(values.some(x=>x===null))return content;
    let out='';for(let k=0;k<values.length;k++){out+=values[k];if(k<values.length-1)out+=' '+parts[2*k+1]+' ';}
    return out;
  };
  const rewrite=query=>{
    const q=String(query).replace(/[/][*][^]*?[*][/]/g,' ');
    // Returns the text up to the closing parenthesis that matches the opening one before position from.
    const block=(from,inParens)=>{
      let text='',j=from,plain=true;
      while(j<q.length){
        const ch=q[j];
        if(ch==='('){const fn=/[A-Za-z0-9_-]$/.test(text);const inner=block(j+1,!fn);if(!fn)plain=false;text+='('+inner.text+')';j=inner.end+1;continue;}
        if(ch===')'&&inParens!==null)return {text:inParens&&plain?feature(text):text,end:j};
        text+=ch;j++;
      }
      return {text,end:j};
    };
    return block(0,null).text;
  };
  const written=new WeakMap(),back=new Map();
  keep(window,'matchMedia',f=>function(q){
    if(arguments.length===0)return f.apply(this,arguments);
    const query=String(q),host=rewrite(query);const list=f.call(this,host);
    if(host!==query){try{written.set(list,query);back.set(host,query);}catch(e){}}
    return list;
  });
  const md=Object.getOwnPropertyDescriptor(MediaQueryList.prototype,'media');
  if(md&&md.get)Object.defineProperty(MediaQueryList.prototype,'media',{get:asGetter(md.get,function(){const v=md.get.call(this);return written.has(this)?written.get(this):v;}),configurable:true,enumerable:md.enumerable});
  if(typeof MediaQueryListEvent!=='undefined'){const ed=Object.getOwnPropertyDescriptor(MediaQueryListEvent.prototype,'media');
    if(ed&&ed.get)Object.defineProperty(MediaQueryListEvent.prototype,'media',{get:asGetter(ed.get,function(){const v=ed.get.call(this);return back.has(v)?back.get(v):v;}),configurable:true,enumerable:ed.enumerable});}
}catch(e){}}`;

const WEBRTC = `if(c.webRtc==='off'){const kill=(n)=>{try{Object.defineProperty(window,n,{value:undefined,writable:true,configurable:true});}catch(e){}};kill('RTCPeerConnection');kill('webkitRTCPeerConnection');kill('RTCSessionDescription');kill('RTCIceCandidate');}`;
export function buildSpoofScript(fingerprint: Fingerprint, seed: number, available?: ScreenAvailability, options: { outOfProcessFrame?: boolean } = {}): string {
  const config = spoofConfig(fingerprint, seed, available, options.outOfProcessFrame === true);
  const sections = [
    config.canvas !== 'real' || config.webgl === 'noise' ? NOISE_CORE : null,
    config.canvas !== 'real' ? CANVAS : null,
    config.canvas !== 'real' ? OFFSCREEN_CANVAS : null,
    config.webgl === 'noise' || (config.webgl !== 'off' && config.webglInfo) ? WEBGL : null,
    config.webgl === 'off' ? OFFSCREEN_WEBGL_OFF : null,
    config.webgpuInfo ? WEBGPU_INFO : null,
    config.clientRectsNoise ? CLIENT_RECTS : null,
    config.audioNoise ? AUDIO : null,
    config.hardware ? HARDWARE : null,
    // Reads the real display, so it must run before SCREEN replaces the getters.
    config.frameScreen ? FRAME_SCREEN : null,
    config.screen ? SCREEN : null,
    config.webRtc ? WEBRTC : null,
  ].filter(Boolean);
  if (sections.length === 0) return '';
  const nonce = JSON.stringify(randomUUID());
  return `(()=>{${PRELUDE}${sections.join('')}})();`
    .replace('__NONCE__', nonce)
    .replace('__CFG__', JSON.stringify(config).replace(/</g, '\\u003c'));
}

export function buildWorkerSpoofScript(fingerprint: Fingerprint, seed: number): string {
  const config = spoofConfig(fingerprint, seed);
  const platform = navigatorPlatformByOs[fingerprint.os];
  const needPlatform = fingerprint.os === 'macos' || fingerprint.os === 'linux';
  const sections = [
    config.hardware ? HARDWARE : null,
    config.canvas !== 'real' || config.webgl === 'noise' ? NOISE_CORE : null,
    config.canvas !== 'real' ? OFFSCREEN_CANVAS : null,
    config.webgl === 'noise' || (config.webgl !== 'off' && config.webglInfo) ? WEBGL : null,
    config.webgl === 'off' ? OFFSCREEN_WEBGL_OFF : null,
    config.webgpuInfo ? WEBGPU_INFO : null,
    needPlatform ? `try{const defProp=(proto,p,v)=>{try{const orig=Object.getOwnPropertyDescriptor(proto,p);const getter=asGetter(orig&&orig.get,()=>v,'get '+p);Object.defineProperty(proto,p,{get:getter,configurable:true,enumerable:true});}catch(e){}};if(typeof WorkerNavigator!=='undefined')defProp(WorkerNavigator.prototype,'platform',${JSON.stringify(platform)});}catch(e){}` : null,
  ].filter(Boolean);
  if (sections.length === 0) return '';
  const nonce = JSON.stringify(randomUUID());
  return `(()=>{${PRELUDE}${sections.join('')}})();`
    .replace('__NONCE__', nonce)
    .replace('__CFG__', JSON.stringify(config).replace(/</g, '\\u003c'));
}
