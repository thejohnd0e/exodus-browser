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

const base=join(process.env.LOCALAPPDATA??'','ms-playwright');
const candidates=existsSync(base)?readdirSync(base).filter(n=>n.startsWith('chromium-')).sort().reverse():[];
const exe=process.env.LOCAL_PROFILES_TEST_CHROMIUM??join(base,candidates[0]??'missing','chrome-win64','chrome.exe');
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

// A real browser with a real worker whose override fails: the failure is injected into the CDP
// connection (the user-agent override on worker sessions), everything else is Chrome. This checks
// the claims of Decisions #51 and #80 that unit tests can only assume: Chrome refuses to close a
// dedicated worker, the default resumes it, strict protection closes its page instead.
async function run(strict:boolean){
  const reports:Array<{ctx:string;cores:number}>=[];
  const server=createServer((req,res)=>{
    const url=new URL(req.url??'/','http://local');
    if(url.pathname==='/report'){reports.push(JSON.parse(url.searchParams.get('v')!));res.end('ok');return;}
    res.setHeader('Content-Type','text/html');
    // The worker is created after launch has finished, so the page is not closed during startup.
    res.end(`<!doctype html><script>fetch('/report?v='+encodeURIComponent(JSON.stringify({ctx:'page',cores:navigator.hardwareConcurrency})));
      setTimeout(()=>{new Worker(URL.createObjectURL(new Blob(["fetch(location.href.slice(5,location.href.indexOf('/',12))+'/report?v='+encodeURIComponent(JSON.stringify({ctx:'worker',cores:navigator.hardwareConcurrency})))"])))},1500)</script>`);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const root=tempRoot();
  const workerSessions=new Set<string>();const closes:Array<{targetId:string;ok:boolean}>=[];const outcomes:string[]=[];
  const fingerprint:Fingerprint={...DEFAULT_FINGERPRINT,hardware:{mode:'manual',cores:3,memoryGb:4},strictProtection:strict||undefined};
  const adapter=new ChromiumAdapter(exe,async(input,output)=>{
    const client=await CdpClient.fromPipe(input,output);
    client.onEvent(m=>{if(m.method==='Target.attachedToTarget'){const p=m.params as {sessionId:string;targetInfo:{type:string}};if(p.targetInfo.type==='worker')workerSessions.add(p.sessionId);}});
    const send=client.send.bind(client);
    client.send=((method:string,params:Record<string,unknown>={},sessionId?:string,timeoutMs?:number)=>{
      if(method==='Network.setUserAgentOverride'&&sessionId&&workerSessions.has(sessionId))return Promise.reject(Error('injected failure'));
      if(method==='Target.closeTarget')return send(method,params,sessionId,timeoutMs).then(r=>{closes.push({targetId:String(params.targetId),ok:true});return r;},e=>{closes.push({targetId:String(params.targetId),ok:false});throw e;});
      return send(method,params,sessionId,timeoutMs);
    }) as typeof client.send;
    return client;
  });
  try{
    const p=await adapter.launch({profileId:'strict-'+strict,userDataDir:root,languages:['en-US'],startUrls:[origin+'/','about:blank'],fingerprint,onProtectionFailure:o=>outcomes.push(o)});
    try{for(let i=0;i<60&&!outcomes.length;i++)await sleep(100);await sleep(1500);}finally{await p.stop();}
  }finally{cleanup(root);server.closeAllConnections();server.close();}
  return {reports,closes,outcomes,workerRan:reports.some(r=>r.ctx==='worker'),workerCores:reports.find(r=>r.ctx==='worker')?.cores};
}

it('by default a worker that could not be protected runs and is reported as unprotected; Chrome refuses to close it',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const r=await run(false);
  expect(r.reports.find(x=>x.ctx==='page')?.cores,'the page itself is protected').toBe(3);
  expect(r.outcomes).toEqual(['unprotected']);
  expect(r.workerRan,'the worker was resumed').toBe(true);
  expect(r.workerCores,'and it runs with the host value').not.toBe(3);
  expect(r.closes.filter(c=>!c.ok).length,'Chrome refused to close the worker target').toBeGreaterThan(0);
},180000);

it('strict protection closes the page that owns the unprotected worker and never lets the worker run',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const r=await run(true);
  expect(r.outcomes).toEqual(['closed']);
  expect(r.workerRan,'the worker never ran; it ran with '+r.workerCores+' cores').toBe(false);
  expect(r.closes.some(c=>c.ok),'the owning page was closed').toBe(true);
},180000);
