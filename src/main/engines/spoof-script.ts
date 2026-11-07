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
      if(thisArg&&typeof thisArg==='object'&&thisArg.valueOf&&thisArg.valueOf()===HANDSHAKE)return ownMap;
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
      const d=(k,v)=>{const o=w.Object.getOwnPropertyDescriptor(w.Navigator.prototype,k);if(o&&o.get&&!m.has(o.get)&&!ownMap.has(o.get)){const g=mask(function(){return v;},o.get);w.Object.defineProperty(w.Navigator.prototype,k,{get:g,configurable:true,enumerable:true});}};
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
      const getCw=mask(function(){const w=origCw.call(this);patchFrame(w);return w;},origCw);
      Object.defineProperty(HTMLIFrameElement.prototype,'contentWindow',{get:getCw,configurable:true,enumerable:true});
    }
  }catch(e){}
}
const keep=(o,p,w)=>{const f=o[p];if(!f)return;const raw=w(f);const wrapped=function(){try{return raw.apply(this,arguments);}catch(e){throw cleanStack(e);}};mask(wrapped,f);o[p]=wrapped;return f};
const rect=(r)=>{const d=H(Math.round(r.x*100),Math.round(r.y*100))*0.04-0.02;return DOMRect.fromRect({x:r.x+d,y:r.y+d,width:r.width+d*0.5,height:r.height+d*0.5})};
const wrapRectList=(list)=>{
  if(!list)return list;
  const out=[];for(let i=0;i<list.length;i++)out.push(rect(list[i]));
  return new Proxy(list,{
    get(t,p,r){
      if(p==='item')return mask((idx)=>out[idx]??null,t.item);
      if(p==='length')return out.length;
      if(p===Symbol.iterator)return function*(){for(const r of out)yield r;};
      if(typeof p==='string'&&!isNaN(p))return out[Number(p)];
      return Reflect.get(t,p,r);
    }
  });
};`;

const CANVAS = `if(c.canvas!=='real'){
const empty=(w,h)=>new ImageData(new Uint8ClampedArray(Math.max(0,w*h*4)),w,h);
const patchCanvas=(C2D,HC)=>{
if(!C2D||!HC||ownMap.has(HC.prototype.toDataURL)||getMap().has(HC.prototype.toDataURL))return;
const realGet=keep(C2D.prototype,'getImageData',f=>function(x,y,w,h){
  const d=f.call(this,x,y,w,h);if(c.canvas==='off')return empty(d.width,d.height);
  const a=d.data;const width=d.width;
  for(let i=0;i<a.length;i+=4){const p=i>>2;const col=p%width;const row=(p/width)|0;if(H(x+col,y+row)<0.5)a[i]^=1;}
  return d;
});
keep(HC.prototype,'toDataURL',f=>function(type,quality){
  const cv=document.createElement('canvas');cv.width=this.width;cv.height=this.height;
  if(c.canvas!=='off')cv.getContext('2d').drawImage(this,0,0);
  if(c.canvas==='noise'&&realGet){const x=cv.getContext('2d');const d=x.getImageData(0,0,cv.width,cv.height);x.putImageData(d,0,0);}
  return f.call(cv,type,quality);
});
keep(HC.prototype,'toBlob',f=>function(cb,type,quality){
  const cv=document.createElement('canvas');cv.width=this.width;cv.height=this.height;
  if(c.canvas!=='off'){const x=cv.getContext('2d');x.drawImage(this,0,0);if(c.canvas==='noise'){const d=x.getImageData(0,0,cv.width,cv.height);x.putImageData(d,0,0);}}
  return f.call(cv,cb,type,quality);
});};
patchCanvas(CanvasRenderingContext2D,HTMLCanvasElement);
frameHooks.push(w=>patchCanvas(w.CanvasRenderingContext2D,w.HTMLCanvasElement));}`;

const WEBGL = `if(c.webgl==='off'){
 keep(HTMLCanvasElement.prototype,'getContext',f=>function(t){if(t==='webgl'||t==='webgl2'||t==='experimental-webgl')return null;return f.apply(this,arguments);});
}else{
 if(c.webglInfo){const gp=(proto)=>{const real=proto.getParameter;proto.getParameter=mask(function(p){if(p===37445)return c.webglInfo.vendor;if(p===37446)return c.webglInfo.renderer;return real.call(this,p);},real);};gp(WebGLRenderingContext.prototype);if(window.WebGL2RenderingContext)gp(WebGL2RenderingContext.prototype);}
 if(c.webgl==='noise'){const read=(proto)=>keep(proto,'readPixels',f=>function(x,y,w,h,fm,ty,pix){f.call(this,x,y,w,h,fm,ty,pix);if(pix&&pix.length&&w>0)for(let i=0;i<pix.length;i+=4)if(H(x+((i>>2)%w),y+Math.floor((i>>2)/w))<0.5)pix[i]^=1;});read(WebGLRenderingContext.prototype);if(window.WebGL2RenderingContext)read(WebGL2RenderingContext.prototype);}
 }`;

const OFFSCREEN_WEBGL_OFF = `if(c.webgl==='off'&&typeof OffscreenCanvas!=='undefined'){
 keep(OffscreenCanvas.prototype,'getContext',f=>function(t){if(t==='webgl'||t==='webgl2'||t==='experimental-webgl')return null;return f.apply(this,arguments);});
}`;

const WORKER_WEBGL = `if(c.webgl!=='off'&&typeof WebGLRenderingContext!=='undefined'){
 if(c.webglInfo){const gp=(proto)=>{const real=proto.getParameter;proto.getParameter=mask(function(p){if(p===37445)return c.webglInfo.vendor;if(p===37446)return c.webglInfo.renderer;return real.call(this,p);},real);};gp(WebGLRenderingContext.prototype);if(typeof WebGL2RenderingContext!=='undefined')gp(WebGL2RenderingContext.prototype);}
 if(c.webgl==='noise'){const read=(proto)=>keep(proto,'readPixels',f=>function(x,y,w,h,fm,ty,pix){f.call(this,x,y,w,h,fm,ty,pix);if(pix&&pix.length&&w>0)for(let i=0;i<pix.length;i+=4)if(H(x+((i>>2)%w),y+Math.floor((i>>2)/w))<0.5)pix[i]^=1;});read(WebGLRenderingContext.prototype);if(typeof WebGL2RenderingContext!=='undefined')read(WebGL2RenderingContext.prototype);}
}`;

const OFFSCREEN_CANVAS = `if(c.canvas!=='real'&&typeof OffscreenCanvasRenderingContext2D!=='undefined'){
 keep(OffscreenCanvasRenderingContext2D.prototype,'getImageData',f=>function(x,y,w,h){
  const d=f.call(this,x,y,w,h);if(c.canvas==='off')return new ImageData(new Uint8ClampedArray(d.data.length),d.width,d.height);
  for(let i=0;i<d.data.length;i+=4){const p=i>>2;if(H(x+(p%d.width),y+((p/d.width)|0))<0.5)d.data[i]^=1;}return d;
 });
 if(typeof OffscreenCanvas!=='undefined')keep(OffscreenCanvas.prototype,'convertToBlob',f=>function(options){
  if(!this.width||!this.height)return f.call(this,options);
  try{const copy=new OffscreenCanvas(this.width,this.height),ctx=copy.getContext('2d');if(c.canvas!=='off'){ctx.drawImage(this,0,0);const image=ctx.getImageData(0,0,copy.width,copy.height);ctx.putImageData(image,0,0);}return f.call(copy,options);}catch(error){return Promise.reject(error);}
 });
}`;

const WEBGPU = `if(c.webgpuOff){try{Object.defineProperty(navigator,'gpu',{get:mask(()=>undefined,function(){return undefined;}),configurable:true});}catch(e){}}`;

const WEBGPU_INFO = `if(c.webgpuInfo&&typeof GPUAdapterInfo!=='undefined'){try{
  const def=(p,v)=>{const o=Object.getOwnPropertyDescriptor(GPUAdapterInfo.prototype,p);if(o&&o.get){const g=mask(function(){return v;},o.get);Object.defineProperty(GPUAdapterInfo.prototype,p,{get:g,configurable:true,enumerable:true});}};
  def('vendor',c.webgpuInfo.vendor);
  def('architecture',c.webgpuInfo.architecture);
}catch(e){}}`;

const CLIENT_RECTS = `if(c.clientRectsNoise){
  keep(Element.prototype,'getBoundingClientRect',f=>function(){const r=f.call(this);return r?rect(r):r;});
  keep(Element.prototype,'getClientRects',f=>function(){return wrapRectList(f.call(this));});
  if(typeof Range!=='undefined'){
    keep(Range.prototype,'getBoundingClientRect',f=>function(){const r=f.call(this);return r?rect(r):r;});
    keep(Range.prototype,'getClientRects',f=>function(){return wrapRectList(f.call(this));});
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
    const getter=mask(function(){return v;},orig?.get||function(){return v;});
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
    const getter=mask(function(){return v;},orig?.get||function(){return v;});
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
  const wg=mask(function(){return w;},(ow&&ow.get)||function outerWidth(){return w;});
  const hg=mask(function(){return h;},(oh&&oh.get)||function outerHeight(){return h;});
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
  if(dd&&dd.get&&D!==realD)Object.defineProperty(window,'devicePixelRatio',{get:mask(function(){return D;},dd.get),set:dd.set,configurable:true,enumerable:dd.enumerable});
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
  if(md&&md.get)Object.defineProperty(MediaQueryList.prototype,'media',{get:mask(function(){const v=md.get.call(this);return written.has(this)?written.get(this):v;},md.get),configurable:true,enumerable:md.enumerable});
  if(typeof MediaQueryListEvent!=='undefined'){const ed=Object.getOwnPropertyDescriptor(MediaQueryListEvent.prototype,'media');
    if(ed&&ed.get)Object.defineProperty(MediaQueryListEvent.prototype,'media',{get:mask(function(){const v=ed.get.call(this);return back.has(v)?back.get(v):v;},ed.get),configurable:true,enumerable:ed.enumerable});}
}catch(e){}}`;

const WEBRTC = `if(c.webRtc==='off'){const kill=(n)=>{try{Object.defineProperty(window,n,{value:undefined,writable:true,configurable:true});}catch(e){}};kill('RTCPeerConnection');kill('webkitRTCPeerConnection');kill('RTCSessionDescription');kill('RTCIceCandidate');}`;
export function buildSpoofScript(fingerprint: Fingerprint, seed: number, available?: ScreenAvailability, options: { outOfProcessFrame?: boolean } = {}): string {
  const config = spoofConfig(fingerprint, seed, available, options.outOfProcessFrame === true);
  const sections = [
    config.canvas !== 'real' ? CANVAS : null,
    config.canvas !== 'real' ? OFFSCREEN_CANVAS : null,
    config.webgl !== 'real' || config.webglInfo ? WEBGL : null,
    config.webgl === 'off' ? OFFSCREEN_WEBGL_OFF : null,
    config.webgpuOff ? WEBGPU : null,
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
    config.canvas !== 'real' ? OFFSCREEN_CANVAS : null,
    config.webgl === 'off' ? OFFSCREEN_WEBGL_OFF : null,
    config.webgl !== 'real' || config.webglInfo ? WORKER_WEBGL : null,
    config.webgpuInfo ? WEBGPU_INFO : null,
    needPlatform ? `try{const defProp=(proto,p,v)=>{try{const orig=Object.getOwnPropertyDescriptor(proto,p);const getter=mask(function(){return v;},orig?.get||function(){return v;});Object.defineProperty(proto,p,{get:getter,configurable:true,enumerable:true});}catch(e){}};if(typeof WorkerNavigator!=='undefined')defProp(WorkerNavigator.prototype,'platform',${JSON.stringify(platform)});}catch(e){}` : null,
  ].filter(Boolean);
  if (sections.length === 0) return '';
  const nonce = JSON.stringify(randomUUID());
  return `(()=>{${PRELUDE}${sections.join('')}})();`
    .replace('__NONCE__', nonce)
    .replace('__CFG__', JSON.stringify(config).replace(/</g, '\\u003c'));
}
