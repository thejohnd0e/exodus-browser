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
      if((out[o]&1)!==bit){out[o]=(out[o]&254)|bit;changed.push(i,j);}
    }
  }
  return changed;
};
/** Noises ImageData that getImageData returned for (x,y,w,h); null when its pixels are not bytes. */
const nz2d=(f,ctx,d,x,y,w,h,settings)=>{
  const a=d.data;if(!ArrayBuffer.isView(a)||a.BYTES_PER_ELEMENT!==1)return null;
  let sx=Math.trunc(x),sy=Math.trunc(y);if(Math.trunc(w)<0)sx+=Math.trunc(w);if(Math.trunc(h)<0)sy+=Math.trunc(h);
  const dw=d.width,dh=d.height,cv=ctx.canvas,cw=cv.width,chh=cv.height;
  const ext=(settings===undefined?f.call(ctx,sx-1,sy-1,dw+2,dh+2):f.call(ctx,sx-1,sy-1,dw+2,dh+2,settings)).data;
  return nzApply(ext,(dw+2)*4,dw,dh,a,dw*4,0,1-sx,cw+1-sx,1-sy,chh+1-sy);
};
/** Noises a private copy of a canvas in place, writing only the pixels that changed. */
const nzCopy=(f,ctx)=>{
  const w=ctx.canvas.width,h=ctx.canvas.height;const ext=f.call(ctx,-1,-1,w+2,h+2);const a=ext.data;
  if(!ArrayBuffer.isView(a)||a.BYTES_PER_ELEMENT!==1)return;
  // One read: the enlarged image is noised in place and its changed pixels are written back.
  const changed=nzApply(a,(w+2)*4,w,h,a,(w+2)*4,(w+2)*4+4,1,w+1,1,h+1);
  for(let k=0;k<changed.length;k+=2)ctx.putImageData(ext,-1,-1,changed[k]+1,changed[k+1]+1,1,1);
};
/** WebGL readPixels into a byte view: the same noise, with the drawing buffer as the surface. */
const nzGL=(gl,f,gl2,args)=>{
  const x=args[0],y=args[1],w=args[2],h=args[3],format=args[4],type=args[5],pix=args[6];const off=args.length>7?Number(args[7])||0:0;
  if(format!==0x1908||type!==0x1401||!ArrayBuffer.isView(pix)||pix.BYTES_PER_ELEMENT!==1||!(w>0)||!(h>0))return;
  if(gl2&&(gl.getParameter(0x88ED)||gl.getParameter(0x0D02)||gl.getParameter(0x0D03)||gl.getParameter(0x0D04)))return;
  const align=gl.getParameter(0x0D05),os=Math.ceil(w*4/align)*align;
  if(pix.length-off<os*(h-1)+w*4)return;
  const fbo=gl.getParameter(gl2?0x8CAA:0x8CA6);
  const ew=w+2,eh=h+2,ext=new Uint8Array(ew*eh*4);
  gl.pixelStorei(0x0D05,1);try{f.call(gl,x-1,y-1,ew,eh,format,type,ext);}finally{gl.pixelStorei(0x0D05,align);}
  const bw=gl.drawingBufferWidth,bh=gl.drawingBufferHeight;
  if(fbo)nzApply(ext,ew*4,w,h,pix,os,off,-1,ew,-1,eh);else nzApply(ext,ew*4,w,h,pix,os,off,1-x,bw+1-x,1-y,bh+1-y);
};
`;

const CANVAS = `if(c.canvas!=='real'){
const empty=(w,h)=>new ImageData(new Uint8ClampedArray(Math.max(0,w*h*4)),w,h);
const patchCanvas=(C2D,HC)=>{
if(!C2D||!HC||ownMap.has(HC.prototype.toDataURL)||getMap().has(HC.prototype.toDataURL))return;
const realGet=keep(C2D.prototype,'getImageData',f=>function(x,y,w,h){
  const d=f.apply(this,arguments);if(c.canvas==='off')return empty(d.width,d.height);
  try{nz2d(f,this,d,x,y,w,h,arguments.length>4?arguments[4]:undefined);}catch(e){}
  return d;
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

const WEBGL = `if(c.webgl==='off'){
 keep(HTMLCanvasElement.prototype,'getContext',f=>function(t){if(t==='webgl'||t==='webgl2'||t==='experimental-webgl')return null;return f.apply(this,arguments);});
}else{
 if(c.webglInfo){const gp=(proto)=>{const real=proto.getParameter;proto.getParameter=asMethod(real,function(p){if(p===37445)return c.webglInfo.vendor;if(p===37446)return c.webglInfo.renderer;return real.call(this,p);});};gp(WebGLRenderingContext.prototype);if(window.WebGL2RenderingContext)gp(WebGL2RenderingContext.prototype);}
 if(c.webgl==='noise'){const read=(proto,gl2)=>keep(proto,'readPixels',f=>function(x,y,w,h,format,type,pix){const r=f.apply(this,arguments);try{nzGL(this,f,gl2,arguments);}catch(e){}return r;});read(WebGLRenderingContext.prototype,false);if(window.WebGL2RenderingContext)read(WebGL2RenderingContext.prototype,true);}
 }`;

const OFFSCREEN_WEBGL_OFF = `if(c.webgl==='off'&&typeof OffscreenCanvas!=='undefined'){
 keep(OffscreenCanvas.prototype,'getContext',f=>function(t){if(t==='webgl'||t==='webgl2'||t==='experimental-webgl')return null;return f.apply(this,arguments);});
}`;

const WORKER_WEBGL = `if(c.webgl!=='off'&&typeof WebGLRenderingContext!=='undefined'){
 if(c.webglInfo){const gp=(proto)=>{const real=proto.getParameter;proto.getParameter=asMethod(real,function(p){if(p===37445)return c.webglInfo.vendor;if(p===37446)return c.webglInfo.renderer;return real.call(this,p);});};gp(WebGLRenderingContext.prototype);if(typeof WebGL2RenderingContext!=='undefined')gp(WebGL2RenderingContext.prototype);}
 if(c.webgl==='noise'){const read=(proto,gl2)=>keep(proto,'readPixels',f=>function(x,y,w,h,format,type,pix){const r=f.apply(this,arguments);try{nzGL(this,f,gl2,arguments);}catch(e){}return r;});read(WebGLRenderingContext.prototype,false);if(typeof WebGL2RenderingContext!=='undefined')read(WebGL2RenderingContext.prototype,true);}
}`;

const OFFSCREEN_CANVAS = `if(c.canvas!=='real'&&typeof OffscreenCanvasRenderingContext2D!=='undefined'){
 const offGet=keep(OffscreenCanvasRenderingContext2D.prototype,'getImageData',f=>function(x,y,w,h){
  const d=f.apply(this,arguments);if(c.canvas==='off')return new ImageData(new Uint8ClampedArray(d.data.length),d.width,d.height);
  try{nz2d(f,this,d,x,y,w,h,arguments.length>4?arguments[4]:undefined);}catch(e){}
  return d;
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
    keep(AnalyserNode.prototype,'getFloatFrequencyData',f=>function(a){f.call(this,a);for(let i=0;i<a.length;i++)a[i]+=(H(i,0)-0.5)*1e-7;});
    keep(AnalyserNode.prototype,'getByteFrequencyData',f=>function(a){f.call(this,a);for(let i=0;i<a.length;i++)if(H(i,1)<0.1)a[i]^=1;});
  }
  if(typeof AudioBuffer!=='undefined'){
    const seen=new WeakMap();
    const original=AudioBuffer.prototype.getChannelData;
    const apply=(buffer,ch)=>{let channels=seen.get(buffer);if(!channels){channels=new Set();seen.set(buffer,channels);}const data=original.call(buffer,ch);if(!channels.has(ch)){for(let i=0;i<data.length;i+=100)data[i]+=(H(i,ch)-0.5)*1e-5;channels.add(ch);}return data;};
    keep(AudioBuffer.prototype,'getChannelData',f=>function(ch){return apply(this,ch);});
    keep(AudioBuffer.prototype,'copyFromChannel',f=>function(dest,ch,start){apply(this,ch);return f.call(this,dest,ch,start);});
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
  const rewrite=q=>q.replace(/[(][ ]*((?:-webkit-)?(?:min-|max-)?(?:-webkit-)?(?:device-width|device-height|resolution|device-pixel-ratio))[ ]*:[ ]*([0-9]*[.]?[0-9]+)[ ]*([a-zA-Z]*)[ ]*[)]/gi,(m,f,v,u)=>{
    const feature=f.toLowerCase();
    if((feature.indexOf('width')>=0||feature.indexOf('height')>=0)&&u.toLowerCase()!=='px')return m;
    return '('+f+': '+fmt(toHost(feature,parseFloat(v)))+u+')';
  });
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
    config.webgl !== 'real' || config.webglInfo ? WEBGL : null,
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
    config.webgl === 'off' ? OFFSCREEN_WEBGL_OFF : null,
    config.webgl !== 'real' || config.webglInfo ? WORKER_WEBGL : null,
    config.webgpuInfo ? WEBGPU_INFO : null,
    needPlatform ? `try{const defProp=(proto,p,v)=>{try{const orig=Object.getOwnPropertyDescriptor(proto,p);const getter=asGetter(orig&&orig.get,()=>v,'get '+p);Object.defineProperty(proto,p,{get:getter,configurable:true,enumerable:true});}catch(e){}};if(typeof WorkerNavigator!=='undefined')defProp(WorkerNavigator.prototype,'platform',${JSON.stringify(platform)});}catch(e){}` : null,
  ].filter(Boolean);
  if (sections.length === 0) return '';
  const nonce = JSON.stringify(randomUUID());
  return `(()=>{${PRELUDE}${sections.join('')}})();`
    .replace('__NONCE__', nonce)
    .replace('__CFG__', JSON.stringify(config).replace(/</g, '\\u003c'));
}
