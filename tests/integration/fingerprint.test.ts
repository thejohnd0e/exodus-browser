import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {createSocket} from 'node:dgram';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {ChromiumAdapter} from '../../src/main/engines/chromium';
import {CdpClient} from '../../src/main/cdp/client';
import {tempRoot,cleanup} from '../fixtures/profiles';
import {DEFAULT_FINGERPRINT,type Fingerprint} from '../../src/shared/fingerprint';

const base=join(process.env.LOCALAPPDATA??'','ms-playwright');const candidates=existsSync(base)?readdirSync(base).filter(n=>n.startsWith('chromium-')).sort().reverse():[];const exe=process.env.LOCAL_PROFILES_TEST_CHROMIUM??join(base,candidates[0]??'missing','chrome-win64','chrome.exe');
const macUa='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
const fingerprint:Fingerprint={...DEFAULT_FINGERPRINT,os:'macos',userAgent:macUa,timezone:{mode:'manual',value:'America/New_York'},screen:{mode:'manual',width:1512,height:982,dpr:2},canvas:'noise',webgl:'noise',clientRects:'noise',hardware:{mode:'manual',cores:12,memoryGb:8}};

interface Report{ua:string;tz:string;lang:string;w:number;h:number;cores:number;mem:number;ch:string;platform?:string;tag?:string|null;fp?:boolean;canvasSample?:number[];pixels?:number;vendor?:string|null;renderer?:string|null;gpu?:string;rtc?:string;sdpPrivate?:boolean|null;errorCode?:number;lat?:number;lon?:number;accuracy?:number;error?:string}

it('audio noise is stable across repeated channel reads and copyFromChannel',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const reports:Array<{first:number;second:number;copy:number}>=[];
  const server=createServer((req,res)=>{if(req.url?.startsWith('/report')){reports.push(JSON.parse(new URL(req.url,'http://local').searchParams.get('value')!));res.end('ok');return;}res.setHeader('Content-Type','text/html');res.end(`<!doctype html><script>const c=new AudioContext();const b=c.createBuffer(1,256,44100);const first=b.getChannelData(0)[0];const second=b.getChannelData(0)[0];const out=new Float32Array(256);b.copyFromChannel(out,0);fetch('/report?value='+encodeURIComponent(JSON.stringify({first,second,copy:out[0]})))</script>`);});
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const root=tempRoot();
  try{const p=await new ChromiumAdapter(exe).launch({profileId:'audio-stability',userDataDir:root,languages:['en-US'],startUrls:[url],fingerprint:{...DEFAULT_FINGERPRINT,audio:'noise'}});try{await waitForReports(reports,1);expect(reports[0].first).toBe(reports[0].second);expect(reports[0].first).toBe(reports[0].copy);}finally{await p.stop();}}finally{cleanup(root);server.closeAllConnections();server.close();}
},120000);

async function waitForReports<T>(reports:T[],count:number,predicate:(report:T)=>boolean=()=>true){
  const matching=()=>reports.filter(predicate).length;
  for(let i=0;i<300&&matching()<count;i++)await new Promise(r=>setTimeout(r,100));
  expect(matching(),'browser did not report before timeout').toBeGreaterThanOrEqual(count);
}

function page(){return `<!doctype html><meta charset="utf-8"><script>const c=document.createElement('canvas');c.width=32;c.height=32;const x=c.getContext('2d');x.fillStyle='#1a2b3c';x.fillRect(0,0,32,32);const value=JSON.stringify({ua:navigator.userAgent,tz:Intl.DateTimeFormat().resolvedOptions().timeZone,lang:navigator.language,platform:navigator.platform,w:screen.width,h:screen.height,cores:navigator.hardwareConcurrency,mem:navigator.deviceMemory,ch:c.toDataURL().slice(-48)});fetch('/report?value='+encodeURIComponent(value))</script>`;}

it('applies fingerprint before first navigation in real Chromium',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const reports:Report[]=[];const server=createServer((req,res)=>{if(req.url?.startsWith('/report')){reports.push(JSON.parse(new URL(req.url,'http://local').searchParams.get('value')!));res.end('ok');return;}res.setHeader('Content-Type','text/html');res.end(page());});
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const root=tempRoot();const engine=new ChromiumAdapter(exe);
  try{
    const p=await engine.launch({profileId:'fp-a',userDataDir:root,languages:['en-US'],startUrls:[url],fingerprint});
    try{for(let i=0;i<300&&reports.length===0;i++)await new Promise(r=>setTimeout(r,100));
      expect(reports,'browser did not report').toHaveLength(1);
      expect(reports[0].ua).toBe(macUa);
      expect(reports[0].platform).toBe('MacIntel');
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
  let client:CdpClient|null=null;const engine=new ChromiumAdapter(exe,(inStream,outStream)=>{client=CdpClient.fromPipe(inStream,outStream);return client;});
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

it('workers match the page for hardware, timezone, platform and GPU',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  type Probe={cores:number;mem:number;tz:string;platform:string;vendor:string|null;renderer:string|null};
  const reports:Array<{page:Probe;worker:Probe}>=[];
  const gpuRead="const c=new OffscreenCanvas(4,4);const gl=c.getContext('webgl');const e=gl&&gl.getExtension('WEBGL_debug_renderer_info');return {vendor:e?gl.getParameter(e.UNMASKED_VENDOR_WEBGL):null,renderer:e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):null};";
  const workerSrc=`self.onmessage=()=>{${gpuRead.replace('return','const g=')}postMessage(Object.assign({cores:navigator.hardwareConcurrency,mem:navigator.deviceMemory,tz:Intl.DateTimeFormat().resolvedOptions().timeZone,platform:navigator.platform},g))}`;
  const pageRead=`(()=>{const g=(()=>{const c=document.createElement('canvas');const gl=c.getContext('webgl');const e=gl&&gl.getExtension('WEBGL_debug_renderer_info');return {vendor:e?gl.getParameter(e.UNMASKED_VENDOR_WEBGL):null,renderer:e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):null};})();return {cores:navigator.hardwareConcurrency,mem:navigator.deviceMemory,tz:Intl.DateTimeFormat().resolvedOptions().timeZone,platform:navigator.platform,...g};})()`;
  const server=createServer((req,res)=>{
    if(req.url?.startsWith('/report')){reports.push(JSON.parse(new URL(req.url!,'http://local').searchParams.get('value')!));res.end('ok');return;}
    res.setHeader('Content-Type','text/html');
    res.end(`<!doctype html><meta charset="utf-8"><script>const page=${pageRead};const w=new Worker(URL.createObjectURL(new Blob([${JSON.stringify(workerSrc)}])));w.onmessage=e=>fetch('/report?value='+encodeURIComponent(JSON.stringify({page,worker:e.data})));w.postMessage('go');</script>`);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const root=tempRoot();const engine=new ChromiumAdapter(exe);
  try{
    const p=await engine.launch({profileId:'fp-work',userDataDir:root,languages:['en-US'],startUrls:[url],fingerprint:{...fingerprint,webglInfo:{mode:'manual',vendor:'Google Inc. (NVIDIA)',renderer:'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)'}}});
    try{for(let i=0;i<300&&reports.length<1;i++)await new Promise(r=>setTimeout(r,50));
      expect(reports).toHaveLength(1);
      const {page,worker:workerValues}=reports[0];
      expect(page).toMatchObject({cores:12,mem:8,tz:'America/New_York',platform:'MacIntel'});
      expect(workerValues).toEqual(page);
      expect(workerValues.renderer).toContain('RTX 3060');
    }finally{await p.stop();}
  }finally{cleanup(root);server.closeAllConnections();server.close();}
},120000);

it('cross-origin iframe observes the configured hardware and timezone',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const reports:Array<{cores:number;tz:string}>=[];
  const server=createServer((req,res)=>{
    if(req.url?.startsWith('/report')){reports.push(JSON.parse(new URL(req.url,'http://local').searchParams.get('value')!));res.end('ok');return;}
    res.setHeader('Content-Type','text/html');
    if(req.url==='/frame')res.end(`<!doctype html><script>fetch('/report?value='+encodeURIComponent(JSON.stringify({cores:navigator.hardwareConcurrency,tz:Intl.DateTimeFormat().resolvedOptions().timeZone})))</script>`);
    else res.end(`<!doctype html><iframe src="http://localhost:${(server.address() as AddressInfo).port}/frame"></iframe>`);
  });
  server.listen(0,'::');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const root=tempRoot();
  try{const p=await new ChromiumAdapter(exe).launch({profileId:'cross-frame',userDataDir:root,languages:['en-US'],startUrls:[url],fingerprint});try{await waitForReports(reports,1);expect(reports[0]).toEqual({cores:12,tz:'America/New_York'});}finally{await p.stop();}}finally{cleanup(root);server.closeAllConnections();server.close();}
},120000);

it('shared worker observes the configured hardware, platform and timezone',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const reports:Array<{cores:number;tz:string;platform:string}>=[];
  const server=createServer((req,res)=>{
    if(req.url?.startsWith('/report')){reports.push(JSON.parse(new URL(req.url,'http://local').searchParams.get('value')!));res.end('ok');return;}
    if(req.url==='/worker.js'){res.setHeader('Content-Type','text/javascript');res.end(`onconnect=e=>{e.ports[0].postMessage({cores:navigator.hardwareConcurrency,tz:Intl.DateTimeFormat().resolvedOptions().timeZone,platform:navigator.platform})}`);return;}
    res.setHeader('Content-Type','text/html');res.end(`<!doctype html><script>const w=new SharedWorker('/worker.js');w.port.onmessage=e=>fetch('/report?value='+encodeURIComponent(JSON.stringify(e.data)));w.port.start()</script>`);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const root=tempRoot();
  try{const p=await new ChromiumAdapter(exe).launch({profileId:'shared-worker',userDataDir:root,languages:['en-US'],startUrls:[url],fingerprint});try{await waitForReports(reports,1);expect(reports[0]).toEqual({cores:12,tz:'America/New_York',platform:'MacIntel'});}finally{await p.stop();}}finally{cleanup(root);server.closeAllConnections();server.close();}
},120000);

it('webgl off also disables OffscreenCanvas WebGL in a worker',async()=>{
 if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');const reports:Array<{available:boolean}>=[];
 const worker="postMessage({available:!!new OffscreenCanvas(4,4).getContext('webgl')})";
 const server=createServer((req,res)=>{if(req.url?.startsWith('/report')){reports.push(JSON.parse(new URL(req.url,'http://local').searchParams.get('value')!));res.end('ok');return;}res.setHeader('Content-Type','text/html');res.end(`<!doctype html><script>const w=new Worker(URL.createObjectURL(new Blob([${JSON.stringify(worker)}])));w.onmessage=e=>fetch('/report?value='+encodeURIComponent(JSON.stringify(e.data)))</script>`);});
 server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const root=tempRoot();
 try{const p=await new ChromiumAdapter(exe).launch({profileId:'offscreen-off',userDataDir:root,languages:['en-US'],startUrls:[url],fingerprint:{...DEFAULT_FINGERPRINT,webgl:'off'}});try{await waitForReports(reports,1);expect(reports[0].available).toBe(false);}finally{await p.stop();}}finally{cleanup(root);server.closeAllConnections();server.close();}
},120000);

it('worker OffscreenCanvas noise is coordinate-consistent and differs by seed',async()=>{
 if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');const reports:Array<{full:number[];single:number}>=[];
 const worker="const c=new OffscreenCanvas(16,16),x=c.getContext('2d');x.fillStyle='#808080';x.fillRect(0,0,16,16);const full=Array.from(x.getImageData(0,0,16,16).data).filter((_,i)=>i%4===0);const single=x.getImageData(5,7,1,1).data[0];postMessage({full,single})";
 const server=createServer((req,res)=>{if(req.url?.startsWith('/report')){reports.push(JSON.parse(new URL(req.url,'http://local').searchParams.get('value')!));res.end('ok');return;}res.setHeader('Content-Type','text/html');res.end(`<!doctype html><script>const w=new Worker(URL.createObjectURL(new Blob([${JSON.stringify(worker)}])));w.onmessage=e=>fetch('/report?value='+encodeURIComponent(JSON.stringify(e.data)))</script>`);});
 server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const roots=[tempRoot(),tempRoot()];
 try{for(let i=0;i<2;i++){const p=await new ChromiumAdapter(exe).launch({profileId:'offscreen-'+i,userDataDir:roots[i],languages:['en-US'],startUrls:[url],fingerprint:{...DEFAULT_FINGERPRINT,canvas:'noise'},fingerprintSeed:i+1});try{await waitForReports(reports,i+1);}finally{await p.stop();}}expect(reports[0].single).toBe(reports[0].full[7*16+5]);expect(reports[0].full).not.toEqual(reports[1].full);}finally{for(const root of roots)cleanup(root);server.closeAllConnections();server.close();}
},120000);

it('worker OffscreenCanvas serialization is stable and differs by seed',async()=>{
 if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');const reports:Array<{first:number[];second:number[]}>=[];
 const worker="(async()=>{const c=new OffscreenCanvas(16,16),x=c.getContext('2d');x.fillStyle='#808080';x.fillRect(0,0,16,16);const first=Array.from(new Uint8Array(await (await c.convertToBlob()).arrayBuffer()));const second=Array.from(new Uint8Array(await (await c.convertToBlob()).arrayBuffer()));postMessage({first,second})})()";
 const server=createServer((req,res)=>{if(req.url?.startsWith('/report')){reports.push(JSON.parse(new URL(req.url,'http://local').searchParams.get('value')!));res.end('ok');return;}res.setHeader('Content-Type','text/html');res.end(`<!doctype html><script>const w=new Worker(URL.createObjectURL(new Blob([${JSON.stringify(worker)}])));w.onmessage=e=>fetch('/report?value='+encodeURIComponent(JSON.stringify(e.data)))</script>`);});
 server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const roots=[tempRoot(),tempRoot()];
 try{for(let i=0;i<2;i++){const p=await new ChromiumAdapter(exe).launch({profileId:'offscreen-blob-'+i,userDataDir:roots[i],languages:['en-US'],startUrls:[url],fingerprint:{...DEFAULT_FINGERPRINT,canvas:'noise'},fingerprintSeed:i+1});try{await waitForReports(reports,i+1);}finally{await p.stop();}}expect(reports[0].first).toEqual(reports[0].second);expect(reports[0].first).not.toEqual(reports[1].first);}finally{for(const root of roots)cleanup(root);server.closeAllConnections();server.close();}
},120000);

it('worker OffscreenCanvas WebGL reports the configured vendor and renderer',async()=>{
 if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');const reports:Array<{vendor:string|null;renderer:string|null}>=[];
 const worker="const gl=new OffscreenCanvas(4,4).getContext('webgl');const e=gl&&gl.getExtension('WEBGL_debug_renderer_info');postMessage({vendor:e?gl.getParameter(e.UNMASKED_VENDOR_WEBGL):null,renderer:e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):null})";
 const server=createServer((req,res)=>{if(req.url?.startsWith('/report')){reports.push(JSON.parse(new URL(req.url,'http://local').searchParams.get('value')!));res.end('ok');return;}res.setHeader('Content-Type','text/html');res.end(`<!doctype html><script>const w=new Worker(URL.createObjectURL(new Blob([${JSON.stringify(worker)}])));w.onmessage=e=>fetch('/report?value='+encodeURIComponent(JSON.stringify(e.data)))</script>`);});
 const fp={...DEFAULT_FINGERPRINT,webgl:'noise' as const,webglInfo:{mode:'manual' as const,vendor:'Google Inc. (NVIDIA)',renderer:'ANGLE (NVIDIA, Test GPU)'}};
 server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const root=tempRoot();
 try{const p=await new ChromiumAdapter(exe).launch({profileId:'offscreen-webgl',userDataDir:root,languages:['en-US'],startUrls:[url],fingerprint:fp});try{await waitForReports(reports,1);expect(reports[0].vendor).toBe('Google Inc. (NVIDIA)');expect(reports[0].renderer).toBe('ANGLE (NVIDIA, Test GPU)');}finally{await p.stop();}}finally{cleanup(root);server.closeAllConnections();server.close();}
},120000);

it('service worker observes the configured hardware, platform and timezone',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const reports:Array<{cores:number;tz:string;platform:string}>=[];
  const server=createServer((req,res)=>{
    if(req.url?.startsWith('/report')){reports.push(JSON.parse(new URL(req.url,'http://local').searchParams.get('value')!));res.end('ok');return;}
    if(req.url==='/sw.js'){res.setHeader('Content-Type','text/javascript');res.end(`self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('message',e=>e.source.postMessage({cores:navigator.hardwareConcurrency,tz:Intl.DateTimeFormat().resolvedOptions().timeZone,platform:navigator.platform}))`);return;}
    res.setHeader('Content-Type','text/html');res.end(`<!doctype html><script>navigator.serviceWorker.addEventListener('message',e=>fetch('/report?value='+encodeURIComponent(JSON.stringify(e.data))));navigator.serviceWorker.register('/sw.js').then(()=>navigator.serviceWorker.ready).then(r=>r.active.postMessage('go'))</script>`);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const root=tempRoot();
  const failures:string[]=[];const engine=new ChromiumAdapter(exe,(input,output)=>{const client=CdpClient.fromPipe(input,output);client.onEvent(message=>{if(message.method==='Target.attachedToTarget'){const p=message.params as any;failures.push('attach '+p.targetInfo?.type+' '+p.sessionId+' parent '+message.sessionId);}});const send=client.send.bind(client);client.send=async(method,params,sessionId)=>{try{return await send(method,params,sessionId);}catch(error){failures.push(method+' '+sessionId+': '+String(error));throw error;}};return client;});
  try{for(let launch=0;launch<2;launch++){const p=await engine.launch({profileId:'service-worker',userDataDir:root,languages:['en-US'],startUrls:[url],fingerprint});try{await waitForReports(reports,launch+1).catch(()=>{throw Error('No service worker report; CDP errors: '+JSON.stringify(failures));});expect(reports[launch]).toEqual({cores:12,tz:'America/New_York',platform:'MacIntel'});}finally{await p.stop();}}}finally{cleanup(root);server.closeAllConnections();server.close();}
},120000);

const spoofReport=()=>`<!doctype html><meta charset="utf-8"><script>
const c=document.createElement('canvas');c.width=32;c.height=32;const x=c.getContext('2d');x.fillStyle='#1a2b3c';x.fillRect(0,0,32,32);
const gl=document.createElement('canvas').getContext('webgl');
const pc=typeof RTCPeerConnection==='function'?new RTCPeerConnection({iceServers:[]}):null;
const value=Promise.resolve().then(async()=>{let sdp=null;
if(pc){pc.createDataChannel('x');const o=await pc.createOffer();await pc.setLocalDescription(o);sdp=pc.localDescription.sdp;}
 const pixels=x.getImageData(0,0,4,4).data;
 return {ch:c.toDataURL(),tag:new URL(location.href).searchParams.get('tag'),fp:!('__LP_FP__' in window)&&pixels.length>0,canvasSample:Array.from(pixels.slice(0,32)),pixels:Array.from(pixels).reduce((sum,value)=>sum+value,0),
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

it('webrtc off removes the constructor and the legacy webkit alias',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const reports:Array<{rtc:string;sdpPrivate:boolean|null;webkit:string}>=[];const server=createServer((req,res)=>{if(req.url?.startsWith('/report')){reports.push(JSON.parse(new URL(req.url!,'http://local').searchParams.get('value')!));res.end('ok');return;}res.setHeader('Content-Type','text/html');res.end(`<!doctype html><script>fetch('/report?value='+encodeURIComponent(JSON.stringify({rtc:typeof RTCPeerConnection,sdpPrivate:null,webkit:typeof webkitRTCPeerConnection})))</script>`);});
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const engine=new ChromiumAdapter(exe);
  try{
    const off:Fingerprint={...fingerprint,webRtc:'off'};
    const root=tempRoot();const p=await launchReport(engine,root,'fp-rtc-off',off,url);
    try{for(let i=0;i<300&&reports.length===0;i++)await new Promise(r=>setTimeout(r,100));
      expect(reports,'browser did not report').toHaveLength(1);
      expect(reports[0].rtc).toBe('undefined');
      expect(reports[0].webkit).toBe('undefined');
    }finally{await p.stop();cleanup(root);}
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

it('block geolocation immediately denies permission and reports code 1',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const reports:Array<{errorCode?:number;state?:string}>=[];
  const server=createServer((req,res)=>{
    if(req.url?.startsWith('/report')){reports.push(JSON.parse(new URL(req.url,'http://local').searchParams.get('value')!));res.end('ok');return;}
    res.setHeader('Content-Type','text/html');
    res.end(`<!doctype html><meta charset="utf-8"><script>navigator.permissions.query({name:'geolocation'}).then(status=>{navigator.geolocation.getCurrentPosition(p=>fetch('/report?value='+encodeURIComponent(JSON.stringify({state:status.state,lat:p.coords.latitude}))),e=>fetch('/report?value='+encodeURIComponent(JSON.stringify({state:status.state,errorCode:e.code}))))})</script>`);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const root=tempRoot();const engine=new ChromiumAdapter(exe);
  try{
    const block:Fingerprint={...fingerprint,geolocation:{mode:'block'}};
    const p=await engine.launch({profileId:'fp-geo-block',userDataDir:root,languages:['en-US'],startUrls:[url],fingerprint:block});
    try{await waitForReports(reports,1);expect(reports[0]).toEqual({state:'denied',errorCode:1});}
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

it('a proxied profile does not send STUN packets over UDP',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const lan=(await import('node:os')).networkInterfaces();
  const address=Object.values(lan).flat().find(entry=>entry&&entry.family==='IPv4'&&!entry.internal)?.address;
  if(!address)throw Error('BLOCKED: no non-loopback IPv4 address');
  const udp=createSocket('udp4');let packets=0;udp.on('message',()=>{packets++;});
  await new Promise<void>(resolve=>udp.bind(0,address,resolve));
  const port=(udp.address() as {port:number}).port;const root=tempRoot();
  const holder:{client?:CdpClient}={};
  const engine=new ChromiumAdapter(exe,(input,output)=>{holder.client=CdpClient.fromPipe(input,output);return holder.client;});
  try{
    const p=await engine.launch({profileId:'fp-stun',userDataDir:root,languages:['en-US'],startUrls:['about:blank'],fingerprint:{...DEFAULT_FINGERPRINT,webRtc:'real'},proxyUrl:'http://127.0.0.1:9'});
    try{
      const c=holder.client!;
      const {targetInfos}=await c.send<{targetInfos:Array<{targetId:string;type:string}>}>('Target.getTargets',{});
      const page=targetInfos.find(target=>target.type==='page')!;
      const {sessionId}=await c.send<{sessionId:string}>('Target.attachToTarget',{targetId:page.targetId,flatten:true});
      await c.send('Runtime.evaluate',{expression:`(async()=>{const pc=new RTCPeerConnection({iceServers:[{urls:'stun:${address}:${port}'}]});pc.createDataChannel('x');const o=await pc.createOffer();await pc.setLocalDescription(o);await new Promise(r=>setTimeout(r,2500));pc.close();})()`,awaitPromise:true},sessionId);
      await new Promise(resolve=>setTimeout(resolve,1000));
      expect(packets).toBe(0);
    }finally{await p.stop();}
  }finally{cleanup(root);udp.close();holder.client?.close();}
},120000);
