import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import type {AddressInfo} from 'node:net';
import {ChromiumAdapter} from '../../src/main/engines/chromium';
import {CdpClient} from '../../src/main/cdp/client';
import {DEFAULT_FINGERPRINT,type Fingerprint} from '../../src/shared/fingerprint';
import {tempRoot,cleanup} from '../fixtures/profiles';

const base=join(process.env.LOCALAPPDATA??'','ms-playwright');
const candidates=existsSync(base)?readdirSync(base).filter(n=>n.startsWith('chromium-')).sort().reverse():[];
const exe=process.env.LOCAL_PROFILES_TEST_CHROMIUM??join(base,candidates[0]??'missing','chrome-win64','chrome.exe');
it.each(['chrome://newtab/','chrome://settings/','chrome://history/'])('protects the first web document after %s',async internalUrl=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const reports:Array<{path:string;tz:string;platform:string;cores:number;screen:number;rtc:string;geo:number|null}>=[];
  const server=createServer((req,res)=>{
    if(req.url?.startsWith('/report?')){reports.push(JSON.parse(new URL(req.url,'http://local').searchParams.get('value')!));res.end('ok');return;}
    res.setHeader('Content-Type','text/html');
    res.end(`<!doctype html><script>const first={path:location.pathname,tz:Intl.DateTimeFormat().resolvedOptions().timeZone,platform:navigator.platform,cores:navigator.hardwareConcurrency,screen:screen.width,rtc:typeof RTCPeerConnection};navigator.geolocation.getCurrentPosition(p=>report(p.coords.latitude),()=>report(null),{timeout:1500});function report(geo){fetch('/report?value='+encodeURIComponent(JSON.stringify({...first,geo})))}</script>`);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const fp:Fingerprint={...DEFAULT_FINGERPRINT,os:'macos',userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',timezone:{mode:'manual',value:'America/New_York'},hardware:{mode:'manual',cores:3,memoryGb:4},screen:{mode:'manual',width:1512,height:982},geolocation:{mode:'manual',latitude:40.7,longitude:-74,accuracy:25},webRtc:'off'};
  const root=tempRoot();
  try{
    const attached=new Map<string,string>();
    let cdp:CdpClient|undefined;
    const p=await new ChromiumAdapter(exe,(input,output)=>{const c=CdpClient.fromPipe(input,output);cdp=c;c.onEvent(m=>{if(m.method==='Target.attachedToTarget'&&!m.sessionId){const params=m.params as {sessionId:string;targetInfo:{targetId:string}};attached.set(params.targetInfo.targetId,params.sessionId);}});return c;}).launch({profileId:'new-tab-test',userDataDir:root,languages:['en-US'],startUrls:[url+'/baseline'],fingerprint:fp});
    try{
      const b=p.browser!;for(let i=0;i<600&&!reports.some(r=>r.path==='/baseline');i++)await new Promise(r=>setTimeout(r,50));
      expect(reports.find(r=>r.path==='/baseline'),'baseline document did not report').toBeDefined();
      const {targetId}=await cdp!.send<{targetId:string}>('Target.createTarget',{url:internalUrl});
      for(let i=0;i<100&&!attached.has(targetId);i++)await new Promise(r=>setTimeout(r,50));
      const sessionId=attached.get(targetId);if(!sessionId)throw Error('New-tab auto-attachment missing');
      await new Promise(r=>setTimeout(r,1000));
      await b.send('Page.navigate',{url:url+'/newtab'},sessionId);
      for(let i=0;i<200&&!reports.some(r=>r.path==='/newtab');i++)await new Promise(r=>setTimeout(r,50));
      const expected={tz:'America/New_York',platform:'MacIntel',cores:3,screen:1512,rtc:'undefined',geo:40.7};
      expect(reports.find(r=>r.path==='/baseline')).toMatchObject(expected);
      expect(reports.find(r=>r.path==='/newtab')).toMatchObject(expected);
      await b.send('Page.reload',{},sessionId);
      for(let i=0;i<200&&reports.filter(r=>r.path==='/newtab').length<2;i++)await new Promise(r=>setTimeout(r,50));
      expect(reports.filter(r=>r.path==='/newtab')).toHaveLength(2);
      expect(reports.filter(r=>r.path==='/newtab')[1]).toMatchObject(expected);
    }finally{await p.stop();}
  }finally{server.closeAllConnections();server.close();cleanup(root);}
},120000);

it('loads a page that contains its own debugger statement while manual geolocation is armed',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const reports:Array<{tz:string;geo:number|null}>=[];
  const server=createServer((req,res)=>{
    if(req.url?.startsWith('/report?')){reports.push(JSON.parse(new URL(req.url,'http://local').searchParams.get('value')!));res.end('ok');return;}
    res.setHeader('Content-Type','text/html');
    res.end(`<!doctype html><script>debugger;const tz=Intl.DateTimeFormat().resolvedOptions().timeZone;navigator.geolocation.getCurrentPosition(p=>fetch('/report?value='+encodeURIComponent(JSON.stringify({tz,geo:p.coords.latitude}))),()=>fetch('/report?value='+encodeURIComponent(JSON.stringify({tz,geo:null}))),{timeout:2000})</script>`);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const fp:Fingerprint={...DEFAULT_FINGERPRINT,timezone:{mode:'manual',value:'America/New_York'},geolocation:{mode:'manual',latitude:40.7,longitude:-74,accuracy:25}};
  const root=tempRoot();
  try{
    const p=await new ChromiumAdapter(exe).launch({profileId:'anti-debug-page',userDataDir:root,languages:['en-US'],startUrls:[url+'/page'],fingerprint:fp});
    try{
      for(let i=0;i<300&&!reports.length;i++)await new Promise(r=>setTimeout(r,50));
      expect(reports,'the page never reported: it stayed paused').toHaveLength(1);
      expect(reports[0]).toEqual({tz:'America/New_York',geo:40.7});
    }finally{await p.stop();}
  }finally{server.closeAllConnections();server.close();cleanup(root);}
},120000);
