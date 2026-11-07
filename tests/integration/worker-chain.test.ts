import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {ChromiumAdapter} from '../../src/main/engines/chromium';
import {tempRoot,cleanup} from '../fixtures/profiles';
import {DEFAULT_FINGERPRINT,type Fingerprint} from '../../src/shared/fingerprint';

const base=join(process.env.LOCALAPPDATA??'','ms-playwright');
const candidates=existsSync(base)?readdirSync(base).filter(n=>n.startsWith('chromium-')).sort().reverse():[];
const exe=process.env.LOCAL_PROFILES_TEST_CHROMIUM??join(base,candidates[0]??'missing','chrome-win64','chrome.exe');
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const renderer='ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)';
const fingerprint:Fingerprint={...DEFAULT_FINGERPRINT,os:'macos',hardware:{mode:'manual',cores:4,memoryGb:4},timezone:{mode:'manual',value:'America/New_York'},webglInfo:{mode:'manual',vendor:'Google Inc. (Apple)',renderer}};

interface Report{ctx:string;cores:number;mem:number;tz:string;platform:string;renderer:string|null}

// Each worker reports itself and then starts the next one, so a nested worker is created by a worker,
// not by the page. A worker that is never attached keeps the host values (docs/engine-and-antifraud.md).
const workerSource=(kind:'classic'|'module',level:number,depth:number)=>`
const report=()=>{let r=null;try{const gl=new OffscreenCanvas(4,4).getContext('webgl');const e=gl&&gl.getExtension('WEBGL_debug_renderer_info');r=e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):null;}catch(e){}
  return fetch('/report?v='+encodeURIComponent(JSON.stringify({ctx:'${kind}-${level}',cores:navigator.hardwareConcurrency,mem:navigator.deviceMemory,tz:Intl.DateTimeFormat().resolvedOptions().timeZone,platform:navigator.platform,renderer:r})));};
report();
${level<depth?`new Worker('/worker.js?kind=${kind}&level=${level+1}&depth=${depth}'${kind==='module'?",{type:'module'}":''});`:''}
`;

it('applies the profile to every worker in a chain, classic and module, however deeply nested',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const reports:Report[]=[];
  const server=createServer((req,res)=>{
    const url=new URL(req.url??'/','http://local');
    if(url.pathname==='/report'){reports.push(JSON.parse(url.searchParams.get('v')!));res.end('ok');return;}
    if(url.pathname==='/worker.js'){
      res.setHeader('Content-Type','text/javascript');
      res.end(workerSource(url.searchParams.get('kind') as 'classic'|'module',Number(url.searchParams.get('level')),Number(url.searchParams.get('depth'))));
      return;
    }
    res.setHeader('Content-Type','text/html');
    res.end(`<!doctype html><script>new Worker('/worker.js?kind=classic&level=1&depth=3');new Worker('/worker.js?kind=module&level=1&depth=2',{type:'module'});</script>`);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const root=tempRoot();
  try{
    const p=await new ChromiumAdapter(exe).launch({profileId:'worker-chain',userDataDir:root,languages:['en-US'],startUrls:[origin+'/'],fingerprint});
    try{
      const expected=['classic-1','classic-2','classic-3','module-1','module-2'];
      for(let i=0;i<150&&!expected.every(ctx=>reports.some(r=>r.ctx===ctx));i++)await sleep(100);
      expect(reports.map(r=>r.ctx).sort(),'workers that reported').toEqual(expect.arrayContaining(expected));
      for(const ctx of expected){
        const report=reports.find(r=>r.ctx===ctx)!;
        expect(report,ctx).toMatchObject({cores:4,mem:4,tz:'America/New_York',platform:'MacIntel',renderer});
      }
    }finally{await p.stop();}
  }finally{cleanup(root);server.closeAllConnections();server.close();}
},120000);
