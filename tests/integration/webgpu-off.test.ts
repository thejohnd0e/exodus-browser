import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {ChromiumAdapter} from '../../src/main/engines/chromium';
import {tempRoot,cleanup} from '../fixtures/profiles';
import {DEFAULT_FINGERPRINT} from '../../src/shared/fingerprint';

const base=join(process.env.LOCALAPPDATA??'','ms-playwright');
const candidates=existsSync(base)?readdirSync(base).filter(n=>n.startsWith('chromium-')).sort().reverse():[];
const exe=process.env.LOCAL_PROFILES_TEST_CHROMIUM??join(base,candidates[0]??'missing','chrome-win64','chrome.exe');
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

// Reads WebGPU every way a page can: the navigator property, the prototype getter directly, and a
// worker. WebGPU Off must give no adapter on all of them, the way Chrome does when no GPU adapter is
// available, without a JavaScript-level patch that a page could step around.
const probe=`(async()=>{
  const proto=typeof Navigator!=='undefined'?Navigator.prototype:WorkerNavigator.prototype;
  const descriptor=Object.getOwnPropertyDescriptor(proto,'gpu');
  const viaProto=descriptor&&descriptor.get?descriptor.get.call(navigator):undefined;
  const adapter=async gpu=>{if(!gpu)return 'no gpu';try{const a=await gpu.requestAdapter();return a?(a.info?a.info.vendor:'adapter'):null;}catch(e){return 'error'}};
  return {type:typeof navigator.gpu,own:Object.prototype.hasOwnProperty.call(navigator,'gpu'),adapter:await adapter(navigator.gpu),protoAdapter:await adapter(viaProto)};
})()`;

it('WebGPU Off leaves no adapter in the page, through the prototype getter, or in a worker',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const reports:Array<Record<string,unknown>>=[];
  const server=createServer((req,res)=>{
    const url=new URL(req.url??'/','http://local');
    if(url.pathname==='/report'){reports.push(JSON.parse(url.searchParams.get('v')!));res.end('ok');return;}
    if(url.pathname==='/worker.js'){res.setHeader('Content-Type','text/javascript');res.end(`${probe}.then(v=>fetch('/report?v='+encodeURIComponent(JSON.stringify({ctx:'worker',...v}))));`);return;}
    res.setHeader('Content-Type','text/html');
    res.end(`<!doctype html><script>${probe}.then(v=>fetch('/report?v='+encodeURIComponent(JSON.stringify({ctx:'page',...v}))));new Worker('/worker.js');</script>`);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const root=tempRoot();
  try{
    const p=await new ChromiumAdapter(exe).launch({profileId:'webgpu-off',userDataDir:root,languages:['en-US'],startUrls:[origin+'/'],fingerprint:{...DEFAULT_FINGERPRINT,webgpu:'off'}});
    try{
      for(let i=0;i<80&&reports.length<2;i++)await sleep(100);
      for(const ctx of ['page','worker']){
        expect(reports.find(r=>r.ctx===ctx),ctx).toEqual({ctx,type:'object',own:false,adapter:null,protoAdapter:null});
      }
    }finally{await p.stop();}
  }finally{cleanup(root);server.closeAllConnections();server.close();}
},60000);
