import type { Fingerprint } from '../../shared/fingerprint';

export interface SpoofConfig {
  seed: number;
  canvas: 'off' | 'real' | 'noise';
  webgl: 'off' | 'real' | 'noise';
  webglInfo: { vendor: string; renderer: string } | null;
  webgpuOff: boolean;
  clientRectsNoise: boolean;
  audioNoise: boolean;
  hardware: { cores: number; memoryGb: number } | null;
  screen: { width: number; height: number } | null;
  webRtc: 'off' | 'altered' | null;
}

export function spoofConfig(fingerprint: Fingerprint, seed: number): SpoofConfig {
  return {
    seed,
    canvas: fingerprint.canvas,
    webgl: fingerprint.webgl,
    webglInfo: fingerprint.webglInfo.mode === 'manual' ? { vendor: fingerprint.webglInfo.vendor, renderer: fingerprint.webglInfo.renderer } : null,
    webgpuOff: fingerprint.webgpu === 'off',
    clientRectsNoise: fingerprint.clientRects === 'noise',
    audioNoise: fingerprint.audio === 'noise',
    hardware: fingerprint.hardware.mode === 'manual' ? { cores: fingerprint.hardware.cores, memoryGb: fingerprint.hardware.memoryGb } : null,
    screen: fingerprint.screen.mode === 'manual' ? { width: fingerprint.screen.width, height: fingerprint.screen.height } : null,
    webRtc: fingerprint.webRtc === 'off' || fingerprint.webRtc === 'altered' ? fingerprint.webRtc : null,
  };
}

const PRELUDE = `if(window.__LP_FP__)return;window.__LP_FP__=1;const c=__CFG__;const H=(x,y)=>{let h=(c.seed^Math.imul(x|0,374761393)^Math.imul(y|0,668265263))>>>0;h=Math.imul(h^h>>>13,1274126177);h^=h>>>16;return(h>>>0)/4294967296};
const rect=(r)=>{const d=H(Math.round(r.x*100),Math.round(r.y*100))*0.04-0.02;const o={x:r.x+d,y:r.y+d,width:r.width,height:r.height+d*0.5,top:r.top+d,bottom:r.bottom+d,left:r.left+d,right:r.right+d,toJSON:()=>({x:o.x,y:o.y,width:o.width,height:o.height,top:o.top,bottom:o.bottom,left:o.left,right:o.right})};Object.setPrototypeOf(o,DOMRect.prototype);return o};
const keep=(o,p,w)=>{const f=o[p];if(!f)return;o[p]=w(f);try{Object.defineProperty(o[p],'toString',{value:()=>Function.prototype.toString.call(f),configurable:true});}catch(e){}return f};`;

const CANVAS = `if(c.canvas){
const empty=(w,h)=>new ImageData(new Uint8ClampedArray(Math.max(0,w*h*4)),w,h);
const realGet=keep(CanvasRenderingContext2D.prototype,'getImageData',f=>function(x,y,w,h){const d=f.call(this,x,y,w,h);if(c.canvas==='off')return empty(d.width,d.height);const a=d.data;for(let i=0;i<a.length;i+=4)if(H(x+(i>>2),y)<0.5)a[i]^=1;return d;});
const realTo=keep(HTMLCanvasElement.prototype,'toDataURL',f=>function(type,quality){const cv=document.createElement('canvas');cv.width=this.width;cv.height=this.height;if(c.canvas!=='off')cv.getContext('2d').drawImage(this,0,0);if(c.canvas==='noise'&&realGet){const x=cv.getContext('2d');const d=x.getImageData(0,0,cv.width,cv.height);x.putImageData(d,0,0);}return f.call(cv,type,quality);});
keep(HTMLCanvasElement.prototype,'toBlob',f=>function(cb,type,quality){const cv=document.createElement('canvas');cv.width=this.width;cv.height=this.height;if(c.canvas!=='off'){const x=cv.getContext('2d');x.drawImage(this,0,0);if(c.canvas==='noise'){const d=x.getImageData(0,0,cv.width,cv.height);x.putImageData(d,0,0);}}return f.call(cv,cb,type,quality);});}`;

const WEBGL = `if(c.webgl==='off'){
 keep(HTMLCanvasElement.prototype,'getContext',f=>function(t){if(t==='webgl'||t==='webgl2'||t==='experimental-webgl')return null;return f.apply(this,arguments);});
}else{
 if(c.webglInfo){const gp=(proto)=>{const real=proto.getParameter;proto.getParameter=function(p){if(p===37445)return c.webglInfo.vendor;if(p===37446)return c.webglInfo.renderer;return real.call(this,p)};};gp(WebGLRenderingContext.prototype);if(window.WebGL2RenderingContext)gp(WebGL2RenderingContext.prototype);}
 if(c.webgl==='noise'){const read=(proto)=>keep(proto,'readPixels',f=>function(x,y,w,h,fm,ty,pix){f.call(this,x,y,w,h,fm,ty,pix);if(pix&&pix.length&&w>0)for(let i=3;i<pix.length;i+=4)if(H(x+((i>>2)%w),y+Math.floor((i>>2)/w))<0.5)pix[i]^=1;});read(WebGLRenderingContext.prototype);if(window.WebGL2RenderingContext)read(WebGL2RenderingContext.prototype);}
}`;

const WEBGPU = `if(c.webgpuOff){try{Object.defineProperty(navigator,'gpu',{get:()=>undefined,configurable:true});}catch(e){}}`;

const CLIENT_RECTS = `if(c.clientRectsNoise){keep(Element.prototype,'getBoundingClientRect',f=>function(){const r=f.call(this);return r?rect(r):r;});
keep(Element.prototype,'getClientRects',f=>function(){const list=f.call(this);const out=[];for(let i=0;i<list.length;i++)out.push(rect(list[i]));return out;});}`;

const AUDIO = `if(c.audioNoise){keep(AnalyserNode.prototype,'getFloatFrequencyData',f=>function(a){f.call(this,a);for(let i=0;i<a.length;i++)a[i]+=(H(i,0)-0.5)*1e-7;});}`;

const HARDWARE = `if(c.hardware){try{Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>c.hardware.cores,configurable:true});Object.defineProperty(navigator,'deviceMemory',{get:()=>c.hardware.memoryGb,configurable:true});}catch(e){}}`;

const SCREEN = `if(c.screen){const w=c.screen.width,h=c.screen.height;const def=(o,p,v)=>{try{Object.defineProperty(o,p,{get:()=>v,configurable:true});}catch(e){}};def(screen,'width',w);def(screen,'height',h);def(screen,'availWidth',w);def(screen,'availHeight',h-40);def(window,'outerWidth',w);def(window,'outerHeight',h);}`;

const WEBRTC = `if(c.webRtc){
if(c.webRtc==='off'){const kill=(n)=>{try{Object.defineProperty(window,n,{get:()=>undefined,configurable:true});}catch(e){}};kill('RTCPeerConnection');kill('RTCSessionDescription');kill('RTCIceCandidate');}
else{const real=window.RTCPeerConnection;const fake=128+(c.seed%100);const fix=(sdp)=>typeof sdp==='string'?sdp.replace(/(\\d{1,3}\\.){3}\\d{1,3}/g,ip=>/^(10\\.|192\\.168\\.|172\\.(1[6-9]|2\\d|3[01])\\.)/.test(ip)?'192.168.'+(fake%255)+'.'+((fake*7)%255):ip):sdp;
if(real)window.RTCPeerConnection=function(s,r){const pc=new real(s,r);keep(pc,'createOffer',f=>async()=>{const o=await f.call(pc);o.sdp=fix(o.sdp);return o;});keep(pc,'setLocalDescription',f=>async d=>{if(d&&d.sdp)d.sdp=fix(d.sdp);return f.call(pc,d);});return pc;};window.RTCPeerConnection.prototype=real.prototype;}}`;

export function buildSpoofScript(fingerprint: Fingerprint, seed: number): string {
  const config = spoofConfig(fingerprint, seed);
  const sections = [
    config.canvas !== 'real' ? CANVAS : null,
    config.webgl !== 'real' || config.webglInfo ? WEBGL : null,
    config.webgpuOff ? WEBGPU : null,
    config.clientRectsNoise ? CLIENT_RECTS : null,
    config.audioNoise ? AUDIO : null,
    config.hardware ? HARDWARE : null,
    config.screen ? SCREEN : null,
    config.webRtc ? WEBRTC : null,
  ].filter(Boolean);
  return `(()=>{${PRELUDE}${sections.join('')}})();`.replace('__CFG__', JSON.stringify(config).replace(/</g, '\\u003c'));
}
