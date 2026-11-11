import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {CdpClient} from '../../src/main/cdp/client';
import {ChromiumAdapter} from '../../src/main/engines/chromium';
import {tempRoot,cleanup} from '../fixtures/profiles';
import {DIFFERENTIAL_PROBE} from '../fixtures/differential-probe';
import {DEFAULT_FINGERPRINT,type Fingerprint} from '../../src/shared/fingerprint';
import {newFingerprint} from '../../src/shared/fingerprint-presets';
import {hasTestGpu} from '../fixtures/gpu';

const base=join(process.env.LOCALAPPDATA??'','ms-playwright');
const candidates=existsSync(base)?readdirSync(base).filter(n=>n.startsWith('chromium-')).sort().reverse():[];
const exe=process.env.LOCAL_PROFILES_TEST_CHROMIUM??join(base,candidates[0]??'missing','chrome-win64','chrome.exe');
const LANGUAGE='en-US';

type Capture={values:Record<string,string>;headers:Record<string,string>};

/** Serves the probe; the header set of the document request and of the follow-up request is recorded. */
async function capture(start:(url:string)=>Promise<()=>Promise<void>>):Promise<Capture>{
  let result:Capture|null=null;const seen:Record<string,string>={};
  const record=(prefix:string,req:import('node:http').IncomingMessage)=>{
    const names:string[]=[];
    for(let i=0;i<req.rawHeaders.length;i+=2){const n=req.rawHeaders[i].toLowerCase();names.push(n);
      if(/^(accept|accept-encoding|accept-language|user-agent|sec-ch-.*|sec-fetch-.*|upgrade-insecure-requests|cache-control|pragma)$/.test(n))seen[`${prefix}.${n}`]=String(req.headers[n]);}
    seen[`${prefix}.order`]=names.filter(n=>!['host','connection','content-length','content-type','origin','referer','cookie'].includes(n)).join(',');
  };
  const server=createServer((req,res)=>{
    if(req.url==='/report'&&req.method==='POST'){const chunks:Buffer[]=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{result={values:JSON.parse(Buffer.concat(chunks).toString()),headers:{...seen}};res.end('ok');});return;}
    if(req.url==='/probe.js'){res.setHeader('Content-Type','text/javascript');res.end(`(async()=>{${DIFFERENTIAL_PROBE}})().catch(e=>fetch('/report',{method:'POST',body:JSON.stringify({error:String(e&&e.stack||e)})}));`);return;}
    if(req.url==='/sub'){record('sub',req);res.end('ok');return;}
    if(req.url==='/favicon.ico'){res.statusCode=404;res.end();return;}
    record('doc',req);
    res.setHeader('Content-Type','text/html');
    res.setHeader('Accept-CH','Sec-CH-UA-Form-Factors, Sec-CH-UA-Full-Version-List, Sec-CH-UA-Platform-Version, Sec-CH-UA-Arch, Sec-CH-UA-Bitness, Sec-CH-UA-Model, Sec-CH-UA-WoW64');
    res.end('<!doctype html><meta charset="utf-8"><body><script src="/probe.js"></script></body>');
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const stop=await start(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
  try{for(let i=0;i<300&&!result;i++)await new Promise(r=>setTimeout(r,100));}finally{await stop();server.closeAllConnections();server.close();}
  if(!result)throw Error('browser did not report');
  return result;
}

/**
 * The same executable and the same launch switches, with no overrides: a bare DevTools pipe that only
 * navigates. It must not enable any domain, so the page sees what an unmodified browser shows.
 */
const control=():Promise<Capture>=>{
  const root=tempRoot();
  return capture(async url=>{
    const child=spawn(exe,['--user-data-dir='+root,'--lang='+LANGUAGE,'--no-first-run','--no-default-browser-check','--remote-debugging-pipe','--disable-blink-features=AutomationControlled','--test-type','--disable-infobars',...(process.env.EXODUS_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]),'about:blank'],{shell:false,stdio:['ignore','ignore','pipe','pipe','pipe']});
    const client=await CdpClient.fromPipe(child.stdio[3] as NodeJS.WritableStream,child.stdio[4] as NodeJS.ReadableStream);
    let page:{targetId:string}|undefined;
    for(let i=0;i<100&&!page;i++){const {targetInfos}=await client.send<{targetInfos:Array<{targetId:string;type:string}>}>('Target.getTargets',{});page=targetInfos.find(t=>t.type==='page');if(!page)await new Promise(r=>setTimeout(r,100));}
    if(!page)throw Error('control: no page');
    const {sessionId}=await client.send<{sessionId:string}>('Target.attachToTarget',{targetId:page.targetId,flatten:true});
    await client.send('Page.navigate',{url},sessionId);
    return async()=>{try{await client.send('Browser.close',{});}catch{/* closing */}client.close();await new Promise(r=>setTimeout(r,1000));if(child.exitCode===null)child.kill();cleanup(root);};
  });
};
const profile=(fingerprint:Fingerprint):Promise<Capture>=>{
  const root=tempRoot();
  return capture(async url=>{
    const p=await new ChromiumAdapter(exe).launch({profileId:'differential',userDataDir:root,languages:[LANGUAGE],startUrls:[url],fingerprint});
    return async()=>{await p.stop();cleanup(root);};
  });
};

const flatten=(c:Capture)=>({...c.values,...Object.fromEntries(Object.entries(c.headers).map(([k,v])=>['header.'+k,v]))});
/** Keys whose value differs between the control and the profile, or exist on one side only. */
const diff=(a:Record<string,string>,b:Record<string,string>)=>Object.keys({...a,...b}).filter(k=>a[k]!==b[k]).sort();

/** Differences that are intended, with the reason. Everything else is a regression. */
const ALLOWED_DEFAULT:Array<[RegExp,string]>=[
  [/^uach\.he\.platformVersion$|^header\..*\.sec-ch-ua-platform-version$/,'Windows 11 is claimed by the default fingerprint; the host may be Windows 10'],
];
const ALLOWED_GENERATED:Array<[RegExp,string]>=[
  ...ALLOWED_DEFAULT,
  [/^navigator\.(hardwareConcurrency|deviceMemory)$|^worker$/,'manual hardware'],
  [/^screen\.(width|height|availWidth|availHeight)$|^mq\./,'manual screen'],
  [/^webgl\.(vendor|renderer)$/,'manual WebGL identity'],
  [/^fn\..*\.construct$/,'KNOWN LIMIT: V8 prints the source of a JavaScript wrapper in "is not a constructor" when it is passed as newTarget; a wrapper cannot have a native-looking source'],
  [/^fn\.toString\.cycle$/,'TODO(task 5b): Function.prototype.toString is still a Proxy; remove this entry when it is not'],
];
/** A control that is not Google Chrome (Playwright Chromium) lacks the Chrome brand and its hints. */
const BRAND_KEYS=/^uach\.(he\.)?brands$|^uach\.he\.fullVersionList$|^header\..*\.sec-ch-ua(-full-version-list)?$|^uach\.he\.uaFullVersion$/;
const unexpected=(keys:string[],allowed:Array<[RegExp,string]>,controlIsChrome:boolean)=>keys.filter(k=>!allowed.some(([re])=>re.test(k))&&(controlIsChrome||!BRAND_KEYS.test(k)));
const report=(bad:string[],a:Record<string,string>,b:Record<string,string>)=>bad.map(k=>`${k}\n   control: ${a[k]}\n   profile: ${b[k]}`);

it('a default profile differs from unmodified Chrome only in the intended values',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const reference=await control();const mine=await profile(DEFAULT_FINGERPRINT);
  expect(reference.values.error,'control probe failed').toBeUndefined();expect(mine.values.error,'profile probe failed').toBeUndefined();
  const a=flatten(reference),b=flatten(mine);
  const bad=unexpected(diff(a,b),ALLOWED_DEFAULT,String(a['uach.brands']).includes('Google Chrome'));
  expect(report(bad,a,b),'unexpected differences').toEqual([]);
},240000);

it('a generated Windows profile differs from unmodified Chrome only in the overridden values',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  let n=0;const random=()=>{n+=0.37;return n%1;};
  const reference=await control();
  // The profile claims the version of the engine under test, so the user agent is not a difference.
  const chromeVersion=/Chrome\/([\d.]+)/.exec(reference.values['navigator.userAgent'])![1];
  const fingerprint=newFingerprint({os:'windows11',chromeVersion,random});
  const mine=await profile(fingerprint);
  expect(mine.values.error,'profile probe failed').toBeUndefined();
  const a=flatten(reference),b=flatten(mine);
  const allowed=hasTestGpu?ALLOWED_GENERATED:[...ALLOWED_GENERATED,[/^webgl\./,'no GPU on this runner'] as [RegExp,string]];
  const bad=unexpected(diff(a,b),allowed,String(a['uach.brands']).includes('Google Chrome'));
  expect(report(bad,a,b),'unexpected differences').toEqual([]);
},240000);
