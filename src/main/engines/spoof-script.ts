import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
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
// Everything the injected code needs from the platform is captured here, before any page script runs.
// Looking a built-in up when a wrapper runs would let a page replace it first and watch the wrapper
// call it, or read the map from wrappers to native functions through WeakMap.prototype.has
// (DECISIONS #87). Calls go through RA, never through .call/.apply, and no hot path uses regular
// expressions, spread, iteration or Math, because each of those looks something up on the page's side.
const RA=Reflect.apply,GOPD=Object.getOwnPropertyDescriptor,DP=Object.defineProperty;
const $Object=Object,$String=String,$isFinite=isFinite,$isView=ArrayBuffer.isView;
const $WeakMap=WeakMap,$Set=Set,$U8=Uint8Array,$U32=Uint32Array,$U8C=Uint8ClampedArray;
const imul=Math.imul,mround=Math.round,mtrunc=Math.trunc,mceil=Math.ceil;
const WM_HAS=WeakMap.prototype.has,WM_GET=WeakMap.prototype.get,WM_SET=WeakMap.prototype.set;
const SET_HAS=Set.prototype.has,SET_ADD=Set.prototype.add;
const wmHas=(m,k)=>RA(WM_HAS,m,[k]),wmGet=(m,k)=>RA(WM_GET,m,[k]),wmSet=(m,k,v)=>RA(WM_SET,m,[k,v]);
const setHas=(s,k)=>RA(SET_HAS,s,[k]),setAdd=(s,k)=>RA(SET_ADD,s,[k]);
const strValueOf=String.prototype.valueOf;
const TA_TAG=(()=>{try{return GOPD(Object.getPrototypeOf(Uint8Array.prototype),Symbol.toStringTag).get;}catch(e){return null;}})();
const accessor=(proto,name)=>{try{return proto?GOPD(proto,name)||null:null;}catch(e){return null;}};
const getter=(proto,name)=>{const d=accessor(proto,name),g=d&&d.get;return g?(o)=>RA(g,o,[]):null;};
const setter=(proto,name)=>{const d=accessor(proto,name),s=d&&d.set;return s?(o,v)=>{RA(s,o,[v]);}:null;};
const H=(x,y)=>{let h=(c.seed^imul(x|0,374761393)^imul(y|0,668265263))>>>0;h=imul(h^h>>>13,1274126177);h^=h>>>16;return(h>>>0)/4294967296};
const nativeToString=Function.prototype.toString;
const HANDSHAKE=__NONCE__;
const ownMap=new $WeakMap();
let rootMap=ownMap;
const childMaps=[];
const topFrame=(()=>{try{return typeof window==='undefined'||window.parent===window;}catch(e){return false;}})();
const getMap=()=>{
  if(topFrame||rootMap!==ownMap)return rootMap;
  try{
    let cur=window;
    while(cur.parent&&cur.parent!==cur){
      try{
        const m=RA(cur.parent.Function.prototype.toString,$Object(HANDSHAKE),[]);
        wmHas(m,nativeToString);
        rootMap=m;break;
      }catch(e){}
      cur=cur.parent;
    }
  }catch(e){}
  return rootMap;
};
const mask=(fn,orig)=>{
  try{
    if(orig&&orig.name)DP(fn,'name',{value:orig.name,configurable:true});
    if(orig&&typeof orig.length==='number')DP(fn,'length',{value:orig.length,configurable:true});
  }catch(e){}
  if(orig){wmSet(ownMap,fn,orig);wmSet(getMap(),fn,orig);}
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
// The cross-frame handshake is a String wrapper. String.prototype.valueOf checks the internal slot
// natively, so an arbitrary object passed to Function.prototype.toString never runs page code.
const isHandshake=(v)=>{if(!v||typeof v!=='object')return false;try{return RA(strValueOf,v,[])===HANDSHAKE;}catch(e){return false;}};
// Accessor syntax gives a getter that, like the browser's own, cannot be constructed and has no
// prototype. Calling the original first keeps its receiver check (TypeError: Illegal invocation).
const asGetter=(orig,compute,name)=>{
  const g=GOPD({get x(){if(orig){try{RA(orig,this,[]);}catch(e){throw cleanStack(e);}}return RA(compute,this,[]);}},'x').get;
  if(!orig&&name)try{DP(g,'name',{value:name,configurable:true});}catch(e){}
  return mask(g,orig);
};
// Method syntax: not constructible and no prototype, like a native method.
const asMethod=(orig,impl)=>mask({x(){try{return RA(impl,this,arguments);}catch(e){throw cleanStack(e);}}}.x,orig);
/** True when an argument must reach the browser untouched: converting it can only throw. */
const nzOdd=(v)=>typeof v==='symbol'||typeof v==='bigint';
/**
 * The browser's own receiver check for a method of proto, run before any argument is converted,
 * as Chrome's bindings do; null when proto has no attribute to check with.
 */
const brandOf=(proto,attr)=>{const d=GOPD(proto,attr);return d&&d.get?d.get:null;};
const resolveOrig=(fn)=>{
  const m=getMap();
  let cur=fn;
  for(;;){
    if(wmHas(ownMap,cur)){cur=wmGet(ownMap,cur);continue;}
    if(wmHas(m,cur)){cur=wmGet(m,cur);continue;}
    let found=false;
    for(let i=0;i<childMaps.length;i++){const cm=childMaps[i];if(wmHas(cm,cur)){cur=wmGet(cm,cur);found=true;break;}}
    if(!found)break;
  }
  return cur;
};
// Method syntax again: Function.prototype.toString is not a Proxy, so setting a prototype cycle on it
// throws like it does for any native function, and it has no prototype and is not constructible.
const makeToString=(fts)=>{
  const f={toString(){
    if(isHandshake(this))return ownMap;
    try{return RA(fts,resolveOrig(this),[]);}catch(e){throw cleanStack(e);}
  }}.toString;
  wmSet(ownMap,f,fts);wmSet(getMap(),f,fts);
  return f;
};
try{DP(Function.prototype,'toString',{value:makeToString(nativeToString),writable:true,configurable:true,enumerable:false});}catch(e){}
const frameHooks=[];
const patchFrame=(w)=>{
  try{
    if(!w||!w.Function)return;
    const m=getMap();
    const fts=w.Function.prototype.toString;
    let cm=null;
    try{const r=RA(fts,$Object(HANDSHAKE),[]);wmHas(r,fts);cm=r;}catch(e){}
    if(cm){
      let known=false;for(let i=0;i<childMaps.length;i++)if(childMaps[i]===cm)known=true;
      if(!known)childMaps[childMaps.length]=cm;
      wmSet(m,fts,wmGet(cm,fts)||fts);
    }
    if(!wmHas(m,fts)&&!wmHas(ownMap,fts)){
      DP(w.Function.prototype,'toString',{value:makeToString(fts),writable:true,configurable:true,enumerable:false});
    }
    if(c.hardware&&w.Navigator){
      const d=(k,v)=>{const o=GOPD(w.Navigator.prototype,k);if(o&&o.get&&!wmHas(m,o.get)&&!wmHas(ownMap,o.get)){const g=asGetter(o.get,()=>v);DP(w.Navigator.prototype,k,{get:g,configurable:true,enumerable:true});}};
      d('hardwareConcurrency',c.hardware.cores);
      d('deviceMemory',c.hardware.memoryGb);
    }
    for(let i=0;i<frameHooks.length;i++)try{frameHooks[i](w);}catch(e){}
  }catch(e){}
};
if(typeof HTMLIFrameElement!=='undefined'){
  try{
    const cwDesc=GOPD(HTMLIFrameElement.prototype,'contentWindow');
    if(cwDesc&&cwDesc.get){
      const origCw=cwDesc.get;
      const getCw=asGetter(origCw,function(){const w=RA(origCw,this,[]);patchFrame(w);return w;});
      DP(HTMLIFrameElement.prototype,'contentWindow',{get:getCw,configurable:true,enumerable:true});
    }
  }catch(e){}
}
const keep=(o,p,w)=>{const f=o[p];if(!f)return;o[p]=asMethod(f,w(f));return f};`;

const NOISE_CORE = `// Canvas and WebGL noise (DECISIONS #81). Only pixels on an edge change, so a uniform area stays
// uniform and cannot be used to read the mask. The key is the pixel and the sums of its opposite
// neighbours, all without their lowest bit: the same picture gets the same noise anywhere on the
// surface and in either row order (readPixels is bottom-up), and noising a noised image changes
// nothing, as a getImageData/putImageData round trip does in Chrome. Only the lowest bit of one
// colour channel of an opaque pixel is ever set.
const nzMix=(h)=>{h=imul(h^(h>>>16),2246822507);h=imul(h^(h>>>13),3266489909);return (h^(h>>>16))>>>0;};
// ext holds the region one pixel larger on every side (es bytes per row); ext columns li..hi-1 and
// rows lj..hj-1 lie on the surface, a neighbour outside it counts as equal to the pixel.
const nzApply=(ext,es,w,h,out,os,base,li,hi,lj,hj)=>{
  const changed=[],ew=w+2,m=new $U32(ew*(h+2));
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
      if((out[o]&1)!==bit){out[o]=(out[o]&254)|bit;const n=changed.length;changed[n]=i;changed[n+1]=j;changed[n+2]=(k>>>1)%3;}
    }
  }
  return changed;
};
// A context flavour holds the platform accessors of one kind of 2D context (canvas element or
// OffscreenCanvas), captured now: the size of its surface, the pixels of an ImageData, putImageData.
const idData=typeof ImageData!=='undefined'?getter(ImageData.prototype,'data'):null;
const idW=typeof ImageData!=='undefined'?getter(ImageData.prototype,'width'):null;
const idH=typeof ImageData!=='undefined'?getter(ImageData.prototype,'height'):null;
const idCS=typeof ImageData!=='undefined'?getter(ImageData.prototype,'colorSpace'):null;
const idPF=typeof ImageData!=='undefined'?getter(ImageData.prototype,'pixelFormat'):null;
const flavor=(ctxCtor,cvCtor)=>{
  if(!idData||!idW||!idH||typeof ctxCtor==='undefined'||typeof cvCtor==='undefined')return null;
  const cg=getter(ctxCtor.prototype,'canvas'),w=getter(cvCtor.prototype,'width'),h=getter(cvCtor.prototype,'height'),put=accessor(ctxCtor.prototype,'putImageData');
  if(!cg||!w||!h||!put||typeof put.value!=='function')return null;
  const PUT=put.value;
  return {surface:(ctx)=>{const cv=cg(ctx);return [w(cv),h(cv)];},put:(ctx,img,dx,dy,sx,sy,sw,sh)=>{RA(PUT,ctx,[img,dx,dy,sx,sy,sw,sh]);}};
};
const F2D=flavor(typeof CanvasRenderingContext2D!=='undefined'?CanvasRenderingContext2D:undefined,typeof HTMLCanvasElement!=='undefined'?HTMLCanvasElement:undefined);
const FOFF=flavor(typeof OffscreenCanvasRenderingContext2D!=='undefined'?OffscreenCanvasRenderingContext2D:undefined,typeof OffscreenCanvas!=='undefined'?OffscreenCanvas:undefined);
const nzTag=(a)=>TA_TAG?RA(TA_TAG,a,[]):undefined;
/** Noises ImageData that getImageData returned for the already converted (x,y,w,h). Byte and
 * floating-point pixel formats get the same noise: float values are compared as the bytes they
 * stand for, and a changed channel is set to the float of its new byte. */
const nz2d=(f,ctx,d,x,y,w,h,F)=>{
  const a=idData(d),tag=nzTag(a);
  const bytes=tag==='Uint8ClampedArray'||tag==='Uint8Array',float=tag==='Float16Array'||tag==='Float32Array';
  if(!bytes&&!float)return null;
  let sx=x,sy=y;if(w<0)sx+=w;if(h<0)sy+=h;
  const dw=idW(d),dh=idH(d),sz=F.surface(ctx),cw=sz[0],chh=sz[1];
  // The neighbours are read with the settings of the returned image, never the page's object again.
  const settings={};const cs=idCS?idCS(d):undefined,pf=idPF?idPF(d):undefined;if(cs)settings.colorSpace=cs;if(pf)settings.pixelFormat=pf;
  const ext=idData(RA(f,ctx,[sx-1,sy-1,dw+2,dh+2,settings]));
  if(bytes)return nzApply(ext,(dw+2)*4,dw,dh,a,dw*4,0,1-sx,cw+1-sx,1-sy,chh+1-sy);
  const q=(arr)=>{const b=new $U8(arr.length);for(let k=0;k<arr.length;k++){const v=mround(arr[k]*255);b[k]=v>255?255:v>0?v:0;}return b;};
  const ob=q(a),changed=nzApply(q(ext),(dw+2)*4,dw,dh,ob,dw*4,0,1-sx,cw+1-sx,1-sy,chh+1-sy);
  for(let k=0;k<changed.length;k+=3){const o=changed[k+1]*dw*4+changed[k]*4+changed[k+2];a[o]=ob[o]/255;}
  return changed;
};
/** Noises a private copy of a canvas in place, writing only the pixels that changed. */
const nzCopy=(f,ctx,F)=>{
  const sz=F.surface(ctx),w=sz[0],h=sz[1];const img=RA(f,ctx,[-1,-1,w+2,h+2]);const a=idData(img);
  if(!$isView(a)||a.BYTES_PER_ELEMENT!==1)return;
  // One read: the enlarged image is noised in place and its changed pixels are written back.
  const changed=nzApply(a,(w+2)*4,w,h,a,(w+2)*4,(w+2)*4+4,1,w+1,1,h+1);
  for(let k=0;k<changed.length;k+=3)F.put(ctx,img,-1,-1,changed[k]+1,changed[k+1]+1,1,1);
};
/**
 * WebGL readPixels with RGBA/UNSIGNED_BYTE, into a byte view or a pixel pack buffer, honouring
 * PACK_ALIGNMENT, PACK_ROW_LENGTH, PACK_SKIP_ROWS, PACK_SKIP_PIXELS and the destination offset:
 * the same noise as the 2D canvas, with the drawing buffer as the surface. The neighbours are read
 * tightly packed into private memory and every pack setting is restored. G holds the context
 * type's own methods, captured before any wrapper replaced them.
 */
const nzGL=(gl,f,G,gl2,x,y,w,h,format,type,pix,off,pbo)=>{
  if(format!==0x1908||type!==0x1401||!(w>0)||!(h>0)||RA(G.isContextLost,gl,[]))return;
  const gp=(p)=>RA(G.getParameter,gl,[p]),ps=(p,v)=>{RA(G.pixelStorei,gl,[p,v]);},bb=(t,b)=>{RA(G.bindBuffer,gl,[t,b]);};
  const align=gp(0x0D05),rowLen=gl2?gp(0x0D02):0,skipRows=gl2?gp(0x0D03):0,skipPix=gl2?gp(0x0D04):0;
  const stride=mceil((rowLen>0?rowLen:w)*4/align)*align,start=skipRows*stride+skipPix*4,need=start+(h-1)*stride+w*4;
  let buffer=null;
  if(pbo<0){if(pix.BYTES_PER_ELEMENT!==1||pix.length-off<need)return;}
  else{buffer=gp(0x88ED);if(!buffer||pbo+need>RA(G.getBufferParameter,gl,[0x88EB,0x8764]))return;}
  const fbo=gp(gl2?0x8CAA:0x8CA6);
  const ew=w+2,eh=h+2,ext=new $U8(ew*eh*4);
  ps(0x0D05,1);if(gl2){ps(0x0D02,0);ps(0x0D03,0);ps(0x0D04,0);if(buffer)bb(0x88EB,null);}
  try{RA(f,gl,[x-1,y-1,ew,eh,format,type,ext]);}
  finally{ps(0x0D05,align);if(gl2){ps(0x0D02,rowLen);ps(0x0D03,skipRows);ps(0x0D04,skipPix);if(buffer)bb(0x88EB,buffer);}}
  const bw=G.dbw(gl),bh=G.dbh(gl);
  const li=fbo?-1:1-x,hi=fbo?ew:bw+1-x,lj=fbo?-1:1-y,hj=fbo?eh:bh+1-y;
  if(!buffer){nzApply(ext,ew*4,w,h,pix,stride,off+start,li,hi,lj,hj);return;}
  // A pixel pack buffer gets the same noise, written byte by byte where it changes.
  const tight=new $U8(w*h*4);for(let j=0;j<h;j++)tight.set(ext.subarray((j+1)*ew*4+4,(j+1)*ew*4+4+w*4),j*w*4);
  const changed=nzApply(ext,ew*4,w,h,tight,w*4,0,li,hi,lj,hj);
  for(let k=0;k<changed.length;k+=3){const t=changed[k+1]*w*4+changed[k]*4+changed[k+2];RA(G.bufferSubData,gl,[0x88EB,pbo+start+changed[k+1]*stride+changed[k]*4+changed[k+2],tight.subarray(t,t+1)]);}
};
/** getImageData with every argument converted exactly once, in the browser's order. */
const getImageDataOnce=(f,brand,self,a,off,F)=>{
  if(a.length<4||!brand||!F)return {d:RA(f,self,a)};
  RA(brand,self,[]);
  for(let k=0;k<4;k++)if(nzOdd(a[k]))return {d:RA(f,self,a)};
  const x=+a[0],y=+a[1],w=+a[2],h=+a[3];
  const d=a.length>4?RA(f,self,[x,y,w,h,a[4]]):RA(f,self,[x,y,w,h]);
  if(!off)try{nz2d(f,self,d,x|0,y|0,w|0,h|0,F);}catch(e){}
  return {d};
};
`;

const CANVAS = `if(c.canvas!=='real'){
const $ImageData=ImageData,CE=Document.prototype.createElement;
const empty=(w,h)=>new $ImageData(new $U8C(w*h>0?w*h*4:0),w,h);
const patchCanvas=(C2D,HC)=>{
if(!C2D||!HC||wmHas(ownMap,HC.prototype.toDataURL)||wmHas(getMap(),HC.prototype.toDataURL))return;
const brand=brandOf(C2D.prototype,'canvas');
const cvW=getter(HC.prototype,'width'),cvH=getter(HC.prototype,'height'),setW=setter(HC.prototype,'width'),setH=setter(HC.prototype,'height');
const HC_CTX=HC.prototype.getContext,DRAW=C2D.prototype.drawImage;
const realGet=keep(C2D.prototype,'getImageData',f=>function(x,y,w,h){
  const d=getImageDataOnce(f,brand,this,arguments,c.canvas==='off',F2D).d;
  return c.canvas==='off'?empty(idW(d),idH(d)):d;
});
// The page's canvas is never changed: the encoders run on a private copy. A zero-sized canvas
// cannot be drawn and is encoded as it is, like Chrome does. A receiver that is not a canvas goes
// to the browser, which reports it in its own words.
const sizeOf=(self)=>{try{return [cvW(self),cvH(self)];}catch(e){return null;}};
const copyOf=(src,sz)=>{const cv=RA(CE,document,['canvas']);setW(cv,sz[0]);setH(cv,sz[1]);
  if(c.canvas!=='off'){const x=RA(HC_CTX,cv,['2d',{willReadFrequently:true}]);RA(DRAW,x,[src,0,0]);try{nzCopy(realGet,x,F2D);}catch(e){}}return cv;};
keep(HC.prototype,'toDataURL',f=>function(type,quality){
  const sz=sizeOf(this);if(!sz||!sz[0]||!sz[1])return RA(f,this,arguments);
  return RA(f,copyOf(this,sz),arguments);
});
keep(HC.prototype,'toBlob',f=>function(cb,type,quality){
  const sz=sizeOf(this);if(!sz||!sz[0]||!sz[1])return RA(f,this,arguments);
  return RA(f,copyOf(this,sz),arguments);
});};
patchCanvas(CanvasRenderingContext2D,HTMLCanvasElement);
frameHooks[frameHooks.length]=w=>patchCanvas(w.CanvasRenderingContext2D,w.HTMLCanvasElement);}`;

const WEBGL = `if(c.webgl!=='off'&&typeof WebGLRenderingContext!=='undefined'){
 // The context type's own methods, captured before glInfo replaces getParameter.
 const prim=(proto)=>proto?{getParameter:proto.getParameter,pixelStorei:proto.pixelStorei,bindBuffer:proto.bindBuffer,getBufferParameter:proto.getBufferParameter,bufferSubData:proto.bufferSubData,isContextLost:proto.isContextLost,dbw:getter(proto,'drawingBufferWidth'),dbh:getter(proto,'drawingBufferHeight')}:null;
 const G1=prim(WebGLRenderingContext.prototype),G2=typeof WebGL2RenderingContext!=='undefined'?prim(WebGL2RenderingContext.prototype):null;
 const glInfo=(proto)=>{if(!proto)return;const real=proto.getParameter,brand=brandOf(proto,'canvas');if(!real||!brand)return;
  // The receiver is checked and the argument converted once, then the browser answers; a value
  // is replaced only where the browser itself returned one, so a missing extension or a lost
  // context still gives null (audit 2026-11-08 recheck: a string or an object reached the real GPU).
  proto.getParameter=asMethod(real,function(p){
    if(arguments.length<1)return RA(real,this,arguments);
    RA(brand,this,[]);
    if(nzOdd(p))return RA(real,this,[p]);
    const v=+p,n=v>>>0,r=RA(real,this,[v]);
    if(r!==null&&n===37445)return c.webglInfo.vendor;
    if(r!==null&&n===37446)return c.webglInfo.renderer;
    return r;
  });};
 const glRead=(proto,gl2,G)=>{if(!proto||!G)return;const brand=brandOf(proto,'canvas');keep(proto,'readPixels',f=>function(){
  const a=arguments;if(a.length<7||!brand)return RA(f,this,a);
  RA(brand,this,[]);
  const dst=a[6],view=$isView(dst);
  if(!view&&!gl2)return RA(f,this,a);
  for(let k=0;k<a.length&&k<8;k++)if(nzOdd(a[k]))return RA(f,this,a);
  const x=+a[0],y=+a[1],w=+a[2],h=+a[3],format=+a[4],type=+a[5];
  if(view){const off=a.length>7?+a[7]:0;const r=a.length>7?RA(f,this,[x,y,w,h,format,type,dst,off]):RA(f,this,[x,y,w,h,format,type,dst]);
    try{nzGL(this,f,G,gl2,x|0,y|0,w|0,h|0,format>>>0,type>>>0,dst,off>>>0,-1);}catch(e){}return r;}
  const off=+dst;const r=RA(f,this,[x,y,w,h,format,type,off]);
  try{const o=off===off&&$isFinite(off)?mtrunc(off):0;if(o>=0)nzGL(this,f,G,gl2,x|0,y|0,w|0,h|0,format>>>0,type>>>0,null,0,o);}catch(e){}
  return r;
 });};
 if(c.webglInfo){glInfo(WebGLRenderingContext.prototype);if(typeof WebGL2RenderingContext!=='undefined')glInfo(WebGL2RenderingContext.prototype);}
 if(c.webgl==='noise'){glRead(WebGLRenderingContext.prototype,false,G1);if(typeof WebGL2RenderingContext!=='undefined')glRead(WebGL2RenderingContext.prototype,true,G2);}
}`;

// WebGL Off: the engine switch covers canvas elements; OffscreenCanvas, in pages and workers,
// still creates a context. The context type is converted once, as Chrome converts the enum.
const OFFSCREEN_WEBGL_OFF = `if(c.webgl==='off'&&typeof OffscreenCanvas!=='undefined'){const brand=brandOf(OffscreenCanvas.prototype,'width');
 keep(OffscreenCanvas.prototype,'getContext',f=>function(t){
  if(arguments.length<1||!brand)return RA(f,this,arguments);
  RA(brand,this,[]);
  if(typeof t==='symbol')return RA(f,this,arguments);
  const s=$String(t);if(s==='webgl'||s==='webgl2')return null;
  const a=[];for(let i=0;i<arguments.length;i++)a[i]=arguments[i];a[0]=s;return RA(f,this,a);
 });
}`;

const OFFSCREEN_CANVAS = `if(c.canvas!=='real'&&typeof OffscreenCanvasRenderingContext2D!=='undefined'){
 const $ImageData=ImageData,$OC=OffscreenCanvas,PR=Promise.reject,$Promise=Promise;
 const offBrand=brandOf(OffscreenCanvasRenderingContext2D.prototype,'canvas');
 const ocW=getter(OffscreenCanvas.prototype,'width'),ocH=getter(OffscreenCanvas.prototype,'height'),OC_CTX=OffscreenCanvas.prototype.getContext,OFF_DRAW=OffscreenCanvasRenderingContext2D.prototype.drawImage;
 const offGet=keep(OffscreenCanvasRenderingContext2D.prototype,'getImageData',f=>function(x,y,w,h){
  const d=getImageDataOnce(f,offBrand,this,arguments,c.canvas==='off',FOFF).d;
  const dw=idW(d),dh=idH(d);
  return c.canvas==='off'?new $ImageData(new $U8C(dw*dh>0?dw*dh*4:0),dw,dh):d;
 });
 if(ocW&&ocH)keep(OffscreenCanvas.prototype,'convertToBlob',f=>function(options){
  let w,h;try{w=ocW(this);h=ocH(this);}catch(e){return RA(f,this,arguments);}
  if(!w||!h)return RA(f,this,arguments);
  try{const copy=new $OC(w,h),ctx=RA(OC_CTX,copy,['2d',{willReadFrequently:true}]);if(c.canvas!=='off'){RA(OFF_DRAW,ctx,[this,0,0]);try{nzCopy(offGet,ctx,FOFF);}catch(e){}}return RA(f,copy,arguments);}catch(error){return RA(PR,$Promise,[error]);}
 });
}`;

const WEBGPU_INFO = `if(c.webgpuInfo&&typeof GPUAdapterInfo!=='undefined'){try{
  const def=(p,v)=>{const o=Object.getOwnPropertyDescriptor(GPUAdapterInfo.prototype,p);if(o&&o.get){const g=asGetter(o.get,()=>v);Object.defineProperty(GPUAdapterInfo.prototype,p,{get:g,configurable:true,enumerable:true});}};
  def('vendor',c.webgpuInfo.vendor);
  def('architecture',c.webgpuInfo.architecture);
}catch(e){}}`;

const CLIENT_RECTS = `if(c.clientRectsNoise){
  // ClientRects noise moves the values of the rects the browser returned, in place. DOMRectList holds
  // mutable DOMRect objects, so indexing, item(), descriptors, iteration and the native methods all
  // read the same noised numbers and the list stays a real DOMRectList (audit 2026-11-08: a Proxy
  // over the list leaked the real values through descriptors and broke native item/length).
  const rg={x:getter(DOMRect.prototype,'x'),y:getter(DOMRect.prototype,'y'),w:getter(DOMRect.prototype,'width'),h:getter(DOMRect.prototype,'height')};
  const rs={x:setter(DOMRect.prototype,'x'),y:setter(DOMRect.prototype,'y'),w:setter(DOMRect.prototype,'width'),h:setter(DOMRect.prototype,'height')};
  const listLen=getter(DOMRectList.prototype,'length');
  const rectOk=rg.x&&rg.y&&rg.w&&rg.h&&rs.x&&rs.y&&rs.w&&rs.h&&listLen;
  const noiseRect=(r)=>{if(!r)return r;
    const x=rg.x(r),y=rg.y(r),w=rg.w(r),h=rg.h(r);const d=H(mround(x*100),mround(y*100))*0.04-0.02;
    rs.x(r,x+d);rs.y(r,y+d);rs.w(r,w+d*0.5);rs.h(r,h+d*0.5);return r};
  const noiseRectList=(list)=>{if(list){const n=listLen(list);for(let i=0;i<n;i++)noiseRect(list[i]);}return list};
  if(rectOk){
  keep(Element.prototype,'getBoundingClientRect',f=>function(){return noiseRect(RA(f,this,[]));});
  keep(Element.prototype,'getClientRects',f=>function(){return noiseRectList(RA(f,this,[]));});
  if(typeof Range!=='undefined'){
    keep(Range.prototype,'getBoundingClientRect',f=>function(){return noiseRect(RA(f,this,[]));});
    keep(Range.prototype,'getClientRects',f=>function(){return noiseRectList(RA(f,this,[]));});
  }}
}`;

const AUDIO = `if(c.audioNoise){
  if(typeof AnalyserNode!=='undefined'){
    keep(AnalyserNode.prototype,'getFloatFrequencyData',f=>function(a){RA(f,this,arguments);for(let i=0;i<a.length;i++)if($isFinite(a[i]))a[i]+=(H(i,0)-0.5)*1e-7;});
    keep(AnalyserNode.prototype,'getByteFrequencyData',f=>function(a){RA(f,this,arguments);for(let i=0;i<a.length;i++)if(a[i]>1&&H(i,1)<0.1)a[i]^=1;});
  }
  if(typeof AudioBuffer!=='undefined'){
    const seen=new $WeakMap();
    const original=AudioBuffer.prototype.getChannelData;
    const brand=brandOf(AudioBuffer.prototype,'length');
    const apply=(buffer,ch)=>{let channels=wmGet(seen,buffer);if(!channels){channels=new $Set();wmSet(seen,buffer,channels);}const data=RA(original,buffer,[ch]);const n=ch>>>0;if(!setHas(channels,n)){for(let i=0;i<data.length;i+=100)if(data[i]!==0&&data[i]===data[i])data[i]*=1+(H(i,n)-0.5)*1e-4;setAdd(channels,n);}return data;};
    keep(AudioBuffer.prototype,'getChannelData',f=>function(ch){
      if(arguments.length<1||!brand)return RA(f,this,arguments);RA(brand,this,[]);if(nzOdd(ch))return RA(f,this,[ch]);return apply(this,+ch);});
    keep(AudioBuffer.prototype,'copyFromChannel',f=>function(dest,ch,start){
      if(arguments.length<2||!brand)return RA(f,this,arguments);RA(brand,this,[]);if(nzOdd(ch)||nzOdd(start))return RA(f,this,arguments);
      const n=+ch,s=arguments.length>2&&start!==undefined?+start:undefined;try{apply(this,n);}catch(e){}return s===undefined?RA(f,this,[dest,n]):RA(f,this,[dest,n,s]);});
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
/**
 * A script that does not compile is registered by the browser without an error and then runs nowhere,
 * so the page would load with no script-based overrides. Failing here fails the launch closed.
 */
export function assertCompiles(source: string): string {
  try { new vm.Script(source); } catch { throw Error('FINGERPRINT_UNAVAILABLE'); }
  return source;
}

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
  const configJson = JSON.stringify(config).replace(/</g, '\\u003c');
  // Function replacers: the config holds user-editable text, and "$&" or "$'" in a replacement string are patterns.
  return assertCompiles(`(()=>{${PRELUDE}${sections.join('')}})();`
    .replace('__NONCE__', () => nonce)
    .replace('__CFG__', () => configJson));
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
  const configJson = JSON.stringify(config).replace(/</g, '\\u003c');
  // Function replacers: the config holds user-editable text, and "$&" or "$'" in a replacement string are patterns.
  return assertCompiles(`(()=>{${PRELUDE}${sections.join('')}})();`
    .replace('__NONCE__', () => nonce)
    .replace('__CFG__', () => configJson));
}
