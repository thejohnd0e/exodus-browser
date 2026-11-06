import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {ChromiumAdapter} from '../../src/main/engines/chromium';
import {tempRoot,cleanup} from '../fixtures/profiles';
import {DEFAULT_FINGERPRINT,type Fingerprint} from '../../src/shared/fingerprint';

const playwrightRoot=join(process.env.LOCALAPPDATA??'','ms-playwright');
const playwrightCandidates=existsSync(playwrightRoot)?readdirSync(playwrightRoot).filter(n=>n.startsWith('chromium-')).sort().reverse():[];
const managedEngine=join(process.env.APPDATA??'','Local Profiles','engine','current','chrome-win64','chrome.exe');
const exe=process.env.LOCAL_PROFILES_TEST_CHROMIUM??(existsSync(managedEngine)?managedEngine:join(playwrightRoot,playwrightCandidates[0]??'missing','chrome-win64','chrome.exe'));

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

it('geolocation block is enforced by the browser, not by page-level overrides',async()=>{
  const r=await probe<{perm:{tag:string;state:string;inst:boolean};querySrc:string;geoSrc:string;err:{tag:string;ctor:string;code:number};error?:string}>(
    'geo-native',{...DEFAULT_FINGERPRINT,geolocation:{mode:'block'}},`
    const out={};
    const p=await navigator.permissions.query({name:'geolocation'});
    out.perm={tag:Object.prototype.toString.call(p),state:p.state,inst:p instanceof PermissionStatus};
    out.querySrc=Function.prototype.toString.call(Permissions.prototype.query);
    out.geoSrc=Function.prototype.toString.call(navigator.geolocation.getCurrentPosition);
    const e=await new Promise(r=>navigator.geolocation.getCurrentPosition(()=>r({ok:true}),r));
    out.err={tag:Object.prototype.toString.call(e),ctor:e.constructor.name,code:e.code};
    report(out);`);
  expect(r.error).toBeUndefined();
  expect(r.perm).toEqual({tag:'[object PermissionStatus]',state:'denied',inst:true});
  expect(r.querySrc).toBe('function query() { [native code] }');
  expect(r.geoSrc).toBe('function getCurrentPosition() { [native code] }');
  expect(r.err).toEqual({tag:'[object GeolocationPositionError]',ctor:'GeolocationPositionError',code:1});
},180000);

it('WebRTC off removes the peer connection constructors without inventing accessors',async()=>{
  const r=await probe<{type:string;accessor:boolean;hasValue:boolean;descriptorKind:string;error?:string}>(
    'webrtc-off',{...DEFAULT_FINGERPRINT,webRtc:'off'},`
    const d=Object.getOwnPropertyDescriptor(window,'RTCPeerConnection');
    report({type:typeof window.RTCPeerConnection,accessor:Boolean(d&&d.get),hasValue:Boolean(d&&'value' in d),descriptorKind:d?('get' in d?'accessor':'data'):'missing'});`);
  expect(r.error).toBeUndefined();
  expect(r.type).toBe('undefined');
  expect(r.accessor).toBe(false);
  expect(r.hasValue).toBe(true);
  expect(r.descriptorKind).toBe('data');
},180000);

it('manual screen keeps the window size accessors native',async()=>{
  const r=await probe<{width:number;height:number;widthSrc:string;heightSrc:string;widthEnumerable:boolean;widthConfigurable:boolean;error?:string}>(
    'screen-native',{...DEFAULT_FINGERPRINT,screen:{mode:'manual',width:1920,height:1080,dpr:1}},`
    const w=Object.getOwnPropertyDescriptor(window,'outerWidth');
    const h=Object.getOwnPropertyDescriptor(window,'outerHeight');
    report({width:window.outerWidth,height:window.outerHeight,widthSrc:Function.prototype.toString.call(w.get),heightSrc:Function.prototype.toString.call(h.get),widthEnumerable:w.enumerable,widthConfigurable:w.configurable});`);
  expect(r.error).toBeUndefined();
  expect(r.width).toBe(1920);expect(r.height).toBe(1080);
  expect(r.widthSrc).toBe('function get outerWidth() { [native code] }');
  expect(r.heightSrc).toBe('function get outerHeight() { [native code] }');
  expect(r.widthEnumerable).toBe(true);
  expect(r.widthConfigurable).toBe(true);
},180000);

it('errors thrown by a spoofed canvas method do not expose an injected frame',async()=>{
  const r=await probe<{stack:string;error?:string}>(
    'canvas-stack',{...DEFAULT_FINGERPRINT,canvas:'noise'},`
    let stack='';try{HTMLCanvasElement.prototype.toDataURL.call({})}catch(e){stack=String(e&&e.stack)}
    report({stack});`);
  expect(r.error).toBeUndefined();
  expect(r.stack).not.toMatch(/<anonymous>:\d+:\d+/);
  expect(r.stack).toMatch(/http:\/\/127\.0\.0\.1:\d+\//);
},180000);
