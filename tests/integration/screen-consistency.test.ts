import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {ChromiumAdapter} from '../../src/main/engines/chromium';
import {CdpClient} from '../../src/main/cdp/client';
import {deriveScreenAvailability} from '../../src/main/engines/spoof-script';
import {tempRoot,cleanup} from '../fixtures/profiles';
import {DEFAULT_FINGERPRINT,type Fingerprint} from '../../src/shared/fingerprint';

const base=join(process.env.LOCALAPPDATA??'','ms-playwright');const candidates=existsSync(base)?readdirSync(base).filter(n=>n.startsWith('chromium-')).sort().reverse():[];const exe=process.env.LOCAL_PROFILES_TEST_CHROMIUM??join(base,candidates[0]??'missing','chrome-win64','chrome.exe');

interface RealScreen{width:number;height:number;availWidth:number;availHeight:number;dpr:number}
interface ScreenReport{
  tag:string;
  screen:[number,number,number,number];
  dpr:number;
  inner:[number,number];
  vv:[number,number,number];
  mqSpoof:boolean;
  mqReal:boolean;
  mqMinSpoof:boolean;
  mqResolution:boolean;
}

/**
 * The page reports values relative to the requested spoof: the spoof width/height are embedded by
 * the test, so nothing depends on a particular monitor resolution or scale factor.
 */
function pageFor(tag:string,spoof:{width:number;height:number},realWidth:number,dpr:number,frame?:string){
  const attributes=`screen:[screen.width,screen.height,screen.availWidth,screen.availHeight],dpr:devicePixelRatio,inner:[innerWidth,innerHeight],vv:[visualViewport.width,visualViewport.height,visualViewport.scale],mqSpoof:matchMedia('(device-width: ${spoof.width}px)').matches,mqReal:matchMedia('(device-width: ${realWidth}px)').matches,mqMinSpoof:matchMedia('(min-device-width: ${spoof.width}px)').matches,mqResolution:matchMedia('(resolution: ${dpr}dppx)').matches`;
  const report=`const measure=()=>fetch('/report?value='+encodeURIComponent(JSON.stringify({tag:'${tag}',${attributes}})));measure();addEventListener('resize',measure);`;
  return `<!doctype html><body>${frame??''}<script>${report}</script>`;
}

function listen(server:ReturnType<typeof createServer>){return new Promise<number>(resolve=>{server.listen(0,'127.0.0.1',()=>resolve((server.address() as AddressInfo).port));});}
function withTimeout(deadline:number){return {get expired(){return Date.now()>deadline;}};}

/** Reads the host display of a fresh profile so tests never assume a fixed resolution. */
async function readRealScreen():Promise<RealScreen>{
  const reports:Array<{screen:[number,number,number,number];dpr:number}>=[];
  const server=createServer((req,res)=>{if(req.url?.startsWith('/report')){reports.push(JSON.parse(new URL(req.url,'http://local').searchParams.get('value')!));res.end('ok');return;}res.setHeader('Content-Type','text/html');res.end(`<!doctype html><script>fetch('/report?value='+encodeURIComponent(JSON.stringify({screen:[screen.width,screen.height,screen.availWidth,screen.availHeight],dpr:devicePixelRatio})));</script>`);});
  const port=await listen(server);const root=tempRoot();
  try{
    const p=await new ChromiumAdapter(exe).launch({profileId:'screen-real-reference',userDataDir:root,languages:['en-US'],startUrls:[`http://127.0.0.1:${port}`],fingerprint:{...DEFAULT_FINGERPRINT,screen:{mode:'real'}}});
    try{for(let i=0;i<100&&reports.length===0;i++)await new Promise(r=>setTimeout(r,100));expect(reports,'the host screen did not report').toHaveLength(1);}
    finally{await p.stop();}
  }finally{cleanup(root);server.closeAllConnections();server.close();}
  const [width,height,availWidth,availHeight]=reports[0]!.screen;
  return {width,height,availWidth,availHeight,dpr:reports[0]!.dpr};
}

/** Picks an emulated screen that provably differs from the host display. */
function pickSpoof(real:RealScreen){return {width:real.width-640>=800?real.width-640:real.width+640,height:real.height-360>=600?real.height-360:real.height+360};}

it('manual screen mode keeps JS, CSS media queries and the real viewport consistent',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const real=await readRealScreen();
  const spoof=pickSpoof(real);
  const expected=deriveScreenAvailability(spoof,real);
  const dpr=real.dpr===1?2:1;
  const fingerprint:Fingerprint={...DEFAULT_FINGERPRINT,screen:{mode:'manual',width:spoof.width,height:spoof.height,dpr}};
  const reports:ScreenReport[]=[];
  const child=pageFor('child',spoof,real.width,dpr);
  const parent=pageFor('parent',spoof,real.width,dpr,'<iframe src="/child"></iframe>');
  const server=createServer((req,res)=>{
    if(req.url?.startsWith('/report')){reports.push(JSON.parse(new URL(req.url,'http://local').searchParams.get('value')!));res.end('ok');return;}
    res.setHeader('Content-Type','text/html');res.end(req.url?.startsWith('/child')?child:parent);
  });
  const port=await listen(server);const url=`http://127.0.0.1:${port}`;
  const root=tempRoot();let client:CdpClient|null=null;
  const engine=new ChromiumAdapter(exe,(inStream,outStream)=>{client=CdpClient.fromPipe(inStream,outStream);return client;});
  const last=(tag:string)=>reports.filter(r=>r.tag===tag).at(-1);
  try{
    const p=await engine.launch({profileId:'screen-consistency',userDataDir:root,languages:['en-US'],startUrls:[url],fingerprint});
    try{
      for(let i=0;i<100&&!last('parent');i++)await new Promise(r=>setTimeout(r,100));
      const first=last('parent');expect(first,'page did not report').toBeTruthy();
      expect(first!.screen.slice(0,2)).toEqual([spoof.width,spoof.height]);
      expect(first!.screen.slice(2)).toEqual([expected.width,expected.height]);
      expect(first!.dpr).toBe(dpr);
      expect(first!.mqSpoof).toBe(true);
      expect(first!.mqReal).toBe(false);
      expect(first!.mqMinSpoof).toBe(true);
      expect(first!.mqResolution).toBe(true);
      expect(first!.vv.slice(0,2)).toEqual(first!.inner.slice(0,2));
      expect(first!.vv[2]).toBe(1);
      const frame=last('child');expect(frame,'same-origin frame did not report').toBeTruthy();
      expect(frame!.screen.slice(0,2)).toEqual([spoof.width,spoof.height]);
      expect(frame!.mqSpoof).toBe(true);
      const baseline=first!.inner[0];
      const {targetInfos}=await client!.send<{targetInfos:Array<{targetId:string;type:string}>}>('Target.getTargets',{});
      const page=targetInfos.find(t=>t.type==='page')!;
      const {windowId}=await client!.send<{windowId:number}>('Browser.getWindowForTarget',{targetId:page.targetId});
      await client!.send('Browser.setWindowBounds',{windowId,bounds:{width:900,height:650}});
      const deadline=withTimeout(Date.now()+6000);
      let resized=first;
      while(resized!.inner[0]>=baseline&&!deadline.expired){await new Promise(r=>setTimeout(r,100));resized=last('parent');}
      expect(resized!.inner[0],'the emulated screen must not freeze the viewport').toBeLessThan(baseline);
      expect(resized!.vv.slice(0,2)).toEqual(resized!.inner.slice(0,2));
      expect(resized!.screen.slice(0,2)).toEqual([spoof.width,spoof.height]);
      expect(resized!.mqSpoof).toBe(true);
      const beforeReload=reports.filter(r=>r.tag==='parent').length;
      const {sessionId}=await client!.send<{sessionId:string}>('Target.attachToTarget',{targetId:page.targetId,flatten:true});
      await client!.send('Page.reload',{},sessionId);
      for(let i=0;i<100&&reports.filter(r=>r.tag==='parent').length<=beforeReload;i++)await new Promise(r=>setTimeout(r,100));
      const reloaded=last('parent');
      expect(reports.filter(r=>r.tag==='parent').length).toBeGreaterThan(beforeReload);
      expect(reloaded!.screen.slice(0,2)).toEqual([spoof.width,spoof.height]);
      expect(reloaded!.mqSpoof).toBe(true);
    }finally{await p.stop();}
    const beforeRestart=reports.filter(r=>r.tag==='parent').length;
    const restarted=await engine.launch({profileId:'screen-consistency',userDataDir:root,languages:['en-US'],startUrls:[url],fingerprint});
    try{
      for(let i=0;i<100&&reports.filter(r=>r.tag==='parent').length<=beforeRestart;i++)await new Promise(r=>setTimeout(r,100));
      const after=last('parent');
      expect(reports.filter(r=>r.tag==='parent').length).toBeGreaterThan(beforeRestart);
      expect(after!.screen.slice(0,2)).toEqual([spoof.width,spoof.height]);
      expect(after!.mqSpoof).toBe(true);
    }finally{await restarted.stop();}
  }finally{cleanup(root);server.closeAllConnections();server.close();}
},120000);

it('real screen mode keeps JS and CSS media queries consistent without emulation',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const reports:ScreenReport[]=[];
  const server=createServer((req,res)=>{if(req.url?.startsWith('/report')){reports.push(JSON.parse(new URL(req.url,'http://local').searchParams.get('value')!));res.end('ok');return;}res.setHeader('Content-Type','text/html');res.end(`<!doctype html><script>(()=>{const v={tag:'parent',screen:[screen.width,screen.height,screen.availWidth,screen.availHeight],dpr:devicePixelRatio,inner:[innerWidth,innerHeight],vv:[visualViewport.width,visualViewport.height,visualViewport.scale],mqSpoof:matchMedia('(device-width: '+screen.width+'px)').matches,mqReal:false,mqMinSpoof:true,mqResolution:matchMedia('(resolution: '+devicePixelRatio+'dppx)').matches};fetch('/report?value='+encodeURIComponent(JSON.stringify(v)))})()</script>`);});
  const port=await listen(server);const url=`http://127.0.0.1:${port}`;
  const root=tempRoot();
  try{
    const p=await new ChromiumAdapter(exe).launch({profileId:'screen-real',userDataDir:root,languages:['en-US'],startUrls:[url],fingerprint:{...DEFAULT_FINGERPRINT,screen:{mode:'real'}}});
    try{
      for(let i=0;i<100&&reports.length===0;i++)await new Promise(r=>setTimeout(r,100));
      expect(reports,'page did not report').toHaveLength(1);
      expect(reports[0]!.mqSpoof,'the real screen must match its own media query').toBe(true);
      expect(reports[0]!.mqResolution,'device pixel ratio must match its own media query').toBe(true);
      expect(reports[0]!.screen[2]).toBeLessThanOrEqual(reports[0]!.screen[0]);
      expect(reports[0]!.screen[3]).toBeLessThanOrEqual(reports[0]!.screen[1]);
    }finally{await p.stop();}
  }finally{cleanup(root);server.closeAllConnections();server.close();}
},120000);

/**
 * Chromium rejects Emulation.setDeviceMetricsOverride on an iframe target ("Command can only be
 * executed on top-level targets") and does not propagate the page's emulation into out-of-process
 * iframes, so a cross-origin frame renders with the host display. Its script therefore also
 * reports the profile's devicePixelRatio and answers matchMedia screen queries (device-width,
 * device-height, resolution, -webkit-device-pixel-ratio) for the profile's screen, so the frame's
 * JavaScript agrees with itself and with the top page. Stylesheet @media rules cannot be changed
 * this way and still follow the host display; the last expectation keeps that limitation visible.
 */
it('a cross-origin iframe reports the profile screen in JavaScript, including devicePixelRatio and matchMedia',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const real=await readRealScreen();
  const spoof=pickSpoof(real);
  const spoofDpr=real.dpr===2?1:2;
  const reports:Array<Record<string,unknown>>=[];
  const childPage=`<!doctype html><style>#p{width:1px}@media (device-width: ${spoof.width}px){#p{width:7px}}</style><div id="p"></div><script>
    const q='(device-width: ${spoof.width}px)';const mql=matchMedia(q);
    fetch('/report?value='+encodeURIComponent(JSON.stringify({tag:'child',
      screen:[screen.width,screen.height],dpr:devicePixelRatio,
      mqSpoof:mql.matches,media:mql.media,
      mqReal:matchMedia('(device-width: ${real.width}px)').matches,
      mqMinSpoof:matchMedia('(min-device-width: ${spoof.width}px)').matches,
      mqMaxBelow:matchMedia('(max-device-width: ${spoof.width-1}px)').matches,
      mqHeight:matchMedia('(device-height: ${spoof.height}px)').matches,
      mqResolution:matchMedia('(resolution: ${spoofDpr}dppx)').matches,
      mqWebkit:matchMedia('(-webkit-min-device-pixel-ratio: ${spoofDpr})').matches,
      mqUnrelated:matchMedia('all').matches,
      mqEq:matchMedia('(device-width = ${spoof.width}px)').matches,
      mqGe:matchMedia('(device-width >= ${spoof.width}px)').matches,
      mqLt:matchMedia('(device-width < ${spoof.width}px)').matches,
      mqFlipped:matchMedia('(${spoof.width}px <= device-width)').matches,
      mqChain:matchMedia('(${spoof.width-1}px <= device-width <= ${spoof.width}px)').matches,
      mqHeightRange:matchMedia('(device-height > ${spoof.height-1}px)').matches,
      mqEm:matchMedia('(min-device-width: ${spoof.width/16}em)').matches,
      mqEmBelow:matchMedia('(max-device-width: ${(spoof.width-16)/16}em)').matches,
      mqRem:matchMedia('(device-width = ${spoof.width/16}rem)').matches,
      mqNotRange:matchMedia('not all and (device-width = ${spoof.width}px)').matches,
      mqTab:matchMedia('(device-width:'+String.fromCharCode(9)+'${spoof.width}px)').matches,
      mqNewline:matchMedia('(device-width'+String.fromCharCode(10)+': ${spoof.width}px)').matches,
      mqCalc:matchMedia('(device-width:calc(${spoof.width}px))').matches,
      mqCalcMixed:matchMedia('(device-width: calc(${spoof.width-16}px + 1em))').matches,
      mqCalcBelow:matchMedia('(device-width: calc(${spoof.width}px - 1px))').matches,
      mqInches:matchMedia('(device-width: ${spoof.width/96}in)').matches,
      mqComment:matchMedia('(/*a*/device-width/*b*/:/*c*/${spoof.width}px)').matches,
      mqUpper:matchMedia('(DEVICE-WIDTH: ${spoof.width}PX)').matches,
      mqCalcRange:matchMedia('(device-width >= calc(${spoof.width}px - 1px))').matches,
      mqNested:matchMedia('((device-width: ${spoof.width}px) and (device-height: ${spoof.height}px))').matches,
      mqList:matchMedia('print, (device-width: ${spoof.width}px)').matches,
      matchMediaSource:Function.prototype.toString.call(matchMedia),
      cssWidth:getComputedStyle(document.getElementById('p')).width})));</script>`;
  const childServer=createServer((req,res)=>{
    if(req.url?.startsWith('/report')){reports.push(JSON.parse(new URL(req.url,'http://local').searchParams.get('value')!));res.end('ok');return;}
    res.setHeader('Content-Type','text/html');res.end(childPage);
  });
  const childPort=await listen(childServer);
  const parentServer=createServer((req,res)=>{
    if(req.url?.startsWith('/report')){reports.push(JSON.parse(new URL(req.url,'http://local').searchParams.get('value')!));res.end('ok');return;}
    res.setHeader('Content-Type','text/html');
    res.end(`<!doctype html><iframe src="http://localhost:${childPort}/child"></iframe><script>fetch('/report?value='+encodeURIComponent(JSON.stringify({tag:'parent',dpr:devicePixelRatio,mqSpoof:matchMedia('(device-width: ${spoof.width}px)').matches,mqResolution:matchMedia('(resolution: ${spoofDpr}dppx)').matches})))</script>`);
  });
  const parentPort=await listen(parentServer);const url=`http://127.0.0.1:${parentPort}`;
  const root=tempRoot();
  try{
    const p=await new ChromiumAdapter(exe).launch({profileId:'screen-oopif',userDataDir:root,languages:['en-US'],startUrls:[url],fingerprint:{...DEFAULT_FINGERPRINT,screen:{mode:'manual',width:spoof.width,height:spoof.height,dpr:spoofDpr}}});
    try{
      for(let i=0;i<100&&!reports.some(r=>r.tag==='child');i++)await new Promise(r=>setTimeout(r,100));
      const parent=reports.find(r=>r.tag==='parent');const frame=reports.filter(r=>r.tag==='child').at(-1);
      expect(frame,'cross-origin frame did not report').toBeTruthy();
      expect(parent).toMatchObject({dpr:spoofDpr,mqSpoof:true,mqResolution:true});
      expect(frame).toMatchObject({
        screen:[spoof.width,spoof.height],dpr:spoofDpr,
        mqSpoof:true,media:`(device-width: ${spoof.width}px)`,mqReal:false,mqMinSpoof:true,mqMaxBelow:false,mqHeight:true,
        mqResolution:true,mqWebkit:true,mqUnrelated:true,
        mqEq:true,mqGe:true,mqLt:false,mqFlipped:true,mqChain:true,mqHeightRange:true,mqEm:true,mqEmBelow:false,mqRem:true,mqNotRange:false,
        mqTab:true,mqNewline:true,mqCalc:true,mqCalcMixed:true,mqCalcBelow:false,mqInches:true,mqComment:true,mqUpper:true,mqCalcRange:true,mqNested:true,mqList:true,
        matchMediaSource:'function matchMedia() { [native code] }',
      });
      // Known limitation: stylesheet media queries in the frame still follow the host display.
      expect(frame!.cssWidth,'limitation changed: stylesheets in the frame now see the emulated screen').toBe('1px');
    }finally{await p.stop();}
  }finally{cleanup(root);parentServer.closeAllConnections();parentServer.close();childServer.closeAllConnections();childServer.close();}
},120000);
