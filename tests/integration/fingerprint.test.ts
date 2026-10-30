import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {ChromiumAdapter} from '../../src/main/engines/chromium';
import {CdpClient} from '../../src/main/cdp/client';
import {tempRoot,cleanup} from '../fixtures/profiles';
import {DEFAULT_FINGERPRINT,type Fingerprint} from '../../src/shared/fingerprint';

const base=join(process.env.LOCALAPPDATA??'','ms-playwright');const candidates=existsSync(base)?readdirSync(base).filter(n=>n.startsWith('chromium-')).sort().reverse():[];const exe=process.env.LOCAL_PROFILES_TEST_CHROMIUM??join(base,candidates[0]??'missing','chrome-win64','chrome.exe');
const macUa='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.80 Safari/537.36';
const fingerprint:Fingerprint={...DEFAULT_FINGERPRINT,userAgent:macUa,timezone:{mode:'manual',value:'America/New_York'},screen:{mode:'manual',width:1512,height:982,dpr:2},canvas:'noise',webgl:'noise',clientRects:'noise',hardware:{mode:'manual',cores:12,memoryGb:8}};

interface Report{ua:string;tz:string;lang:string;w:number;h:number;cores:number;mem:number;ch:string;tag?:string|null;fp?:boolean;canvasSample?:number[];pixels?:number;vendor?:string|null;renderer?:string|null;gpu?:string;rtc?:string;sdpPrivate?:boolean|null;errorCode?:number;lat?:number;lon?:number;accuracy?:number;error?:string}

async function waitForReports<T>(reports:T[],count:number,predicate:(report:T)=>boolean=()=>true){
  const matching=()=>reports.filter(predicate).length;
  for(let i=0;i<300&&matching()<count;i++)await new Promise(r=>setTimeout(r,100));
  expect(matching(),'browser did not report before timeout').toBeGreaterThanOrEqual(count);
}

function page(){return `<!doctype html><meta charset="utf-8"><script>const c=document.createElement('canvas');c.width=32;c.height=32;const x=c.getContext('2d');x.fillStyle='#1a2b3c';x.fillRect(0,0,32,32);const value=JSON.stringify({ua:navigator.userAgent,tz:Intl.DateTimeFormat().resolvedOptions().timeZone,lang:navigator.language,w:screen.width,h:screen.height,cores:navigator.hardwareConcurrency,mem:navigator.deviceMemory,ch:c.toDataURL().slice(-48)});fetch('/report?value='+encodeURIComponent(value))</script>`;}

it('applies fingerprint before first navigation in real Chromium',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const reports:Report[]=[];const server=createServer((req,res)=>{if(req.url?.startsWith('/report')){reports.push(JSON.parse(new URL(req.url,'http://local').searchParams.get('value')!));res.end('ok');return;}res.setHeader('Content-Type','text/html');res.end(page());});
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const root=tempRoot();const engine=new ChromiumAdapter(exe);
  try{
    const p=await engine.launch({profileId:'fp-a',userDataDir:root,languages:['en-US'],startUrls:[url],fingerprint});
    try{for(let i=0;i<300&&reports.length===0;i++)await new Promise(r=>setTimeout(r,100));
      expect(reports,'browser did not report').toHaveLength(1);
      expect(reports[0].ua).toBe(macUa);
      expect(reports[0].tz).toBe('America/New_York');
      expect(reports[0].lang).toBe('en-US');
      expect(reports[0].w).toBe(1512);expect(reports[0].h).toBe(982);
      expect(reports[0].cores).toBe(12);expect(reports[0].mem).toBe(8);
    }finally{await p.stop();}
  }finally{cleanup(root);server.closeAllConnections();server.close();}
},120000);

it('a new popup window receives the same UA and timezone',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const reports:Array<{path:string;ua:string;tz:string}>=[];
  const page=(tag:string)=>`<!doctype html><meta charset="utf-8"><script>fetch('/report?value='+encodeURIComponent(JSON.stringify({path:'${tag}',ua:navigator.userAgent,tz:Intl.DateTimeFormat().resolvedOptions().timeZone})))</script>`;
  const server=createServer((req,res)=>{if(req.url?.startsWith('/report')){const value=JSON.parse(new URL(req.url!,'http://local').searchParams.get('value')!);reports.push({path:value.path,ua:value.ua,tz:value.tz});res.end('ok');return;}res.setHeader('Content-Type','text/html');
    res.end(page(req.url?.startsWith('/popup')?'popup':'main'));});
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const root=tempRoot();
  let client:CdpClient|null=null;const engine=new ChromiumAdapter(exe,async devtools=>{client=await CdpClient.connect(devtools);return client;});
  try{
    const p=await engine.launch({profileId:'fp-pop',userDataDir:root,languages:['en-US'],startUrls:[url],fingerprint});
    try{
      for(let i=0;i<300&&reports.length<1;i++)await new Promise(r=>setTimeout(r,100));
      expect(reports.map(r=>r.path)).toEqual(['main']);
      await client!.send('Target.createTarget',{url:url+'/popup',newWindow:true});
      for(let i=0;i<300&&!reports.some(r=>r.path==='popup'&&r.tz==='America/New_York');i++)await new Promise(r=>setTimeout(r,100));
      const popupReports=reports.filter(r=>r.path==='popup');
      expect(popupReports.length,'popup reloaded after overrides').toBeGreaterThanOrEqual(1);
      expect(popupReports.some(r=>r.ua===macUa&&r.tz==='America/New_York')).toBe(true);
      expect(reports[0].ua).toBe(macUa);expect(reports[0].tz).toBe('America/New_York');
    }finally{await p.stop();}
  }finally{cleanup(root);server.closeAllConnections();server.close();}
},120000);

it('workers and internal targets do not terminate the session',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const reports:string[]=[];
  const server=createServer((req,res)=>{if(req.url?.startsWith('/report')){reports.push(new URL(req.url!,'http://local').searchParams.get('stage')!);res.end('ok');return;}res.setHeader('Content-Type','text/html');
    res.end(`<!doctype html><meta charset="utf-8"><script>const w=new Worker(URL.createObjectURL(new Blob(["self.onmessage=()=>postMessage('done')"])));w.onmessage=()=>fetch('/report?stage=after-worker');w.postMessage('go');fetch('/report?stage=before-worker')</script>`);});
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const root=tempRoot();const engine=new ChromiumAdapter(exe);
  try{
    const p=await engine.launch({profileId:'fp-work',userDataDir:root,languages:['en-US'],startUrls:[url],fingerprint});
    try{for(let i=0;i<300&&!reports.includes('after-worker');i++)await new Promise(r=>setTimeout(r,100));
      expect(reports.sort()).toEqual(['after-worker','before-worker']);
      const done=await Promise.race([p.exit,new Promise(r=>setTimeout(()=>r('alive'),2000))]);
      expect(done).toBe('alive');
    }finally{await p.stop();}
  }finally{cleanup(root);server.closeAllConnections();server.close();}
},120000);

const spoofReport=()=>`<!doctype html><meta charset="utf-8"><script>
const c=document.createElement('canvas');c.width=32;c.height=32;const x=c.getContext('2d');x.fillStyle='#1a2b3c';x.fillRect(0,0,32,32);
const gl=document.createElement('canvas').getContext('webgl');
const pc=typeof RTCPeerConnection==='function'?new RTCPeerConnection({iceServers:[]}):null;
const value=Promise.resolve().then(async()=>{let sdp=null;
if(pc){pc.createDataChannel('x');const o=await pc.createOffer();await pc.setLocalDescription(o);sdp=pc.localDescription.sdp;}
 const pixels=x.getImageData(0,0,4,4).data;
 return {ch:c.toDataURL(),tag:new URL(location.href).searchParams.get('tag'),fp:window.__LP_FP__===1,canvasSample:Array.from(pixels.slice(0,32)),pixels:Array.from(pixels).reduce((sum,value)=>sum+value,0),
vendor:gl?gl.getParameter(37445):null,renderer:gl?gl.getParameter(37446):null,
gpu:typeof navigator.gpu,rtc:typeof RTCPeerConnection,
sdpPrivate:sdp?/^(10\\.|192\\.168\\.|172\\.(1[6-9]|2\\d|3[01])\\.)/m.test(sdp):null};})
.then(v=>fetch('/report?value='+encodeURIComponent(JSON.stringify(v)))).catch(e=>fetch('/report?value='+encodeURIComponent(JSON.stringify({error:String(e)}))));
</script>`;

async function launchReport(engine:ChromiumAdapter,root:string,profileId:string,fingerprint:Fingerprint,url:string){
  const p=await engine.launch({profileId,userDataDir:root,languages:['en-US'],startUrls:[`${url}?tag=${profileId}`],fingerprint});return p;
}

it('noise is stable within a profile and differs between profiles',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const reports:Report[]=[];const server=createServer((req,res)=>{if(req.url?.startsWith('/report')){reports.push(JSON.parse(new URL(req.url!,'http://local').searchParams.get('value')!));res.end('ok');return;}res.setHeader('Content-Type','text/html');res.end(spoofReport());});
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const engine=new ChromiumAdapter(exe);
  const noise:Fingerprint={...fingerprint,canvas:'noise'};
  try{
    const rootA=tempRoot();const a1=await launchReport(engine,rootA,'profile-a',noise,url);await waitForReports(reports,1,r=>r.tag==='profile-a'&&r.fp===true);
    const a1Sample=reports.find(r=>r.tag==='profile-a'&&r.fp===true)!.canvasSample;await a1.stop();
    const previousA=reports.filter(r=>r.tag==='profile-a'&&r.fp===true).length;
    const a2=await launchReport(engine,rootA,'profile-a',noise,url);await waitForReports(reports,previousA+1,r=>r.tag==='profile-a'&&r.fp===true);await a2.stop();
    const a2Sample=reports.filter(r=>r.tag==='profile-a'&&r.fp===true)[previousA]?.canvasSample;
    expect(a2Sample,'stable across restarts').toEqual(a1Sample);
    cleanup(rootA);
    const rootB=tempRoot();const b=await launchReport(engine,rootB,'profile-b',noise,url);await waitForReports(reports,1,r=>r.tag==='profile-b'&&r.fp===true);await b.stop();
    const bReport=reports.find(r=>r.tag==='profile-b'&&r.fp===true);
    expect(bReport?.canvasSample,'differs between profiles').not.toEqual(a1Sample);
    cleanup(rootB);
  }finally{server.closeAllConnections();server.close();}
},180000);

it('webgl exposes the configured vendor and renderer, webgpu is disabled and canvas off does not crash the page',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const reports:Report[]=[];const server=createServer((req,res)=>{if(req.url?.startsWith('/report')){reports.push(JSON.parse(new URL(req.url!,'http://local').searchParams.get('value')!));res.end('ok');return;}res.setHeader('Content-Type','text/html');res.end(spoofReport());});
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const engine=new ChromiumAdapter(exe);
  try{
    const manual:Fingerprint={...fingerprint,webglInfo:{mode:'manual',vendor:'Google Inc. (NVIDIA)',renderer:'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)'},webgpu:'off',canvas:'off'};
    const root=tempRoot();const p=await launchReport(engine,root,'fp-webgl',manual,url);
    try{await waitForReports(reports,1);
      expect(reports,'browser did not report').toHaveLength(1);
      expect(reports[0].vendor).toBe('Google Inc. (NVIDIA)');
      expect(reports[0].renderer).toContain('ANGLE (NVIDIA');
      expect(reports[0].gpu).toBe('undefined');
      expect(reports[0].pixels,'canvas off returns transparent black pixels').toBe(0);
    }finally{await p.stop();cleanup(root);}
  }finally{server.closeAllConnections();server.close();}
},120000);

it('webrtc off removes the constructor and altered does not expose private addresses',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const reports:Report[]=[];const server=createServer((req,res)=>{if(req.url?.startsWith('/report')){reports.push(JSON.parse(new URL(req.url!,'http://local').searchParams.get('value')!));res.end('ok');return;}res.setHeader('Content-Type','text/html');res.end(spoofReport());});
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const engine=new ChromiumAdapter(exe);
  try{
    const off:Fingerprint={...fingerprint,webRtc:'off'};
    const root=tempRoot();const p=await launchReport(engine,root,'fp-rtc-off',off,url);
    try{for(let i=0;i<300&&reports.length===0;i++)await new Promise(r=>setTimeout(r,100));
      expect(reports,'browser did not report').toHaveLength(1);
      expect(reports[0].rtc).toBe('undefined');
      expect(reports[0].sdpPrivate).toBe(null);
    }finally{await p.stop();cleanup(root);}
    reports.length=0;
    const altered:Fingerprint={...fingerprint,webRtc:'altered'};
    const root2=tempRoot();const p2=await launchReport(engine,root2,'fp-rtc-alt',altered,url);
    try{for(let i=0;i<300&&reports.length===0;i++)await new Promise(r=>setTimeout(r,100));
      expect(reports,'browser did not report').toHaveLength(1);
      expect(reports[0].rtc).toBe('function');
      expect(reports[0].sdpPrivate,'no private ips in sdp').toBe(false);
    }finally{await p2.stop();cleanup(root2);}
  }finally{server.closeAllConnections();server.close();}
},180000);

it('manual geolocation returns the configured coordinates',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const reports:Report[]=[];
  const server=createServer((req,res)=>{
    if(req.url?.startsWith('/report')){reports.push(JSON.parse(new URL(req.url,'http://local').searchParams.get('value')!));res.end('ok');return;}
    res.setHeader('Content-Type','text/html');
    res.end(`<!doctype html><meta charset="utf-8"><script>navigator.geolocation.getCurrentPosition(p=>fetch('/report?value='+encodeURIComponent(JSON.stringify({lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy}))),e=>fetch('/report?value='+encodeURIComponent(JSON.stringify({errorCode:e.code}))),{timeout:2500})</script>`);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const root=tempRoot();const engine=new ChromiumAdapter(exe);
  try{
    const manual:Fingerprint={...fingerprint,geolocation:{mode:'manual',latitude:55.75,longitude:37.61,accuracy:25}};
    const p=await engine.launch({profileId:'fp-geo-manual',userDataDir:root,languages:['en-US'],startUrls:[url],fingerprint:manual});
    try{await waitForReports(reports,1);expect(reports[0]).toEqual({lat:55.75,lon:37.61,accuracy:25});}
    finally{await p.stop();cleanup(root);}
  }finally{server.closeAllConnections();server.close();}
},120000);

it('auto geolocation does not return coordinates without permission',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const reports:Report[]=[];
  const server=createServer((req,res)=>{
    if(req.url?.startsWith('/report')){reports.push(JSON.parse(new URL(req.url,'http://local').searchParams.get('value')!));res.end('ok');return;}
    res.setHeader('Content-Type','text/html');
    res.end(`<!doctype html><meta charset="utf-8"><script>navigator.geolocation.getCurrentPosition(p=>fetch('/report?value='+encodeURIComponent(JSON.stringify({lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy}))),e=>fetch('/report?value='+encodeURIComponent(JSON.stringify({errorCode:e.code}))),{timeout:2500})</script>`);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const root=tempRoot();const engine=new ChromiumAdapter(exe);
  try{
    const auto:Fingerprint={...fingerprint,geolocation:{mode:'auto'}};
    const p=await engine.launch({profileId:'fp-geo-auto',userDataDir:root,languages:['en-US'],startUrls:[url],fingerprint:auto});
    try{await waitForReports(reports,1);expect(reports[0]).toHaveProperty('errorCode');expect(reports[0]).not.toHaveProperty('lat');}
    finally{await p.stop();cleanup(root);}
  }finally{server.closeAllConnections();server.close();}
},120000);

it('fails closed and leaves no browser behind when CDP is unavailable',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const root=tempRoot();const engine=new ChromiumAdapter(exe,async()=>{throw Error('no cdp');});
  await expect(engine.launch({profileId:'fp-b',userDataDir:root,languages:['en-US'],startUrls:['about:blank'],fingerprint})).rejects.toThrow('FINGERPRINT_UNAVAILABLE');
  const engine2=new ChromiumAdapter(exe);
  const p=await engine2.launch({profileId:'fp-b',userDataDir:root,languages:['en-US'],startUrls:['about:blank'],fingerprint});
  await p.stop();cleanup(root);
},120000);

it('canvas noise is stable on repeat reads and toBlob decodes as an image',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const reports:Array<{same:boolean;pixels:boolean;decoded:[number,number]|string}>=[];
  const server=createServer((req,res)=>{
    if(req.url?.startsWith('/report')){reports.push(JSON.parse(new URL(req.url,'http://local').searchParams.get('value')!));res.end('ok');return;}
    res.setHeader('Content-Type','text/html');
    res.end(`<!doctype html><meta charset="utf-8"><body><script>const c=document.createElement('canvas');c.width=32;c.height=32;const x=c.getContext('2d');x.fillStyle='#1a2b3c';x.fillRect(0,0,32,32);const d1=Array.from(x.getImageData(0,0,8,8).data);const d2=Array.from(x.getImageData(0,0,8,8).data);const a=c.toDataURL();for(let i=0;i<5;i++)document.body.getBoundingClientRect();const b=c.toDataURL();c.toBlob(async blob=>{let decoded;try{const bmp=await createImageBitmap(blob);decoded=[bmp.width,bmp.height];}catch(e){decoded=String(e);}fetch('/report?value='+encodeURIComponent(JSON.stringify({same:a===b,pixels:JSON.stringify(d1)===JSON.stringify(d2),decoded})))})</script></body>`);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const root=tempRoot();const engine=new ChromiumAdapter(exe);
  try{
    const p=await engine.launch({profileId:'fp-canvas-stable',userDataDir:root,languages:['en-US'],startUrls:[url],fingerprint});
    try{await waitForReports(reports,1);expect(reports[0].same).toBe(true);expect(reports[0].pixels).toBe(true);expect(reports[0].decoded).toEqual([32,32]);}
    finally{await p.stop();cleanup(root);}
  }finally{server.closeAllConnections();server.close();}
},120000);

it('webgl Off does not return a context or crash the page',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const reports:Array<{gl:boolean;error:string|null}>=[];
  const server=createServer((req,res)=>{
    if(req.url?.startsWith('/report')){reports.push(JSON.parse(new URL(req.url,'http://local').searchParams.get('value')!));res.end('ok');return;}
    res.setHeader('Content-Type','text/html');
    res.end(`<!doctype html><meta charset="utf-8"><script>let gl=null,error=null;try{const c=document.createElement('canvas');gl=c.getContext('webgl')||c.getContext('experimental-webgl');}catch(e){error=String(e)}fetch('/report?value='+encodeURIComponent(JSON.stringify({gl:gl!==null,error})))</script>`);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const root=tempRoot();const engine=new ChromiumAdapter(exe);
  try{
    const off:Fingerprint={...DEFAULT_FINGERPRINT,webgl:'off'};
    const p=await engine.launch({profileId:'fp-webgl-off',userDataDir:root,languages:['en-US'],startUrls:[url],fingerprint:off});
    try{await waitForReports(reports,1);expect(reports[0]).toEqual({gl:false,error:null});}
    finally{await p.stop();cleanup(root);}
  }finally{server.closeAllConnections();server.close();}
},120000);
