import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {ChromiumAdapter} from '../../src/main/engines/chromium';
import {tempRoot,cleanup} from '../fixtures/profiles';
import {DEFAULT_FINGERPRINT} from '../../src/shared/fingerprint';

const base=join(process.env.LOCALAPPDATA??'','ms-playwright');const candidates=existsSync(base)?readdirSync(base).filter(n=>n.startsWith('chromium-')).sort().reverse():[];const exe=process.env.LOCAL_PROFILES_TEST_CHROMIUM??join(base,candidates[0]??'missing','chrome-win64','chrome.exe');

it('never reaches the origin directly when the proxy is unreachable',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  let originHits=0;
  const origin=createServer((_req,res)=>{originHits++;res.end('origin');});
  origin.listen(0,'127.0.0.1');await once(origin,'listening');
  const originPort=(origin.address() as AddressInfo).port;
  const probe=createServer(()=>{});
  probe.listen(0,'127.0.0.1');await once(probe,'listening');
  const deadPort=(probe.address() as AddressInfo).port;
  probe.closeAllConnections();probe.close();
  const root=tempRoot();
  try{
    const p=await new ChromiumAdapter(exe).launch({profileId:'proxy-dead',userDataDir:root,languages:['en-US'],startUrls:[`http://127.0.0.1:${originPort}/`],fingerprint:DEFAULT_FINGERPRINT,proxyUrl:`http://127.0.0.1:${deadPort}`});
    try{await new Promise(r=>setTimeout(r,3000));expect(originHits,'a dead proxy must not fall back to a direct connection').toBe(0);}
    finally{await p.stop();}
  }finally{cleanup(root);origin.closeAllConnections();origin.close();}
},120000);

it('does not bypass a proxy that answers with an error',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  let originHits=0,proxyHits=0;
  const origin=createServer((_req,res)=>{originHits++;res.end('origin');});
  origin.listen(0,'127.0.0.1');await once(origin,'listening');
  const originPort=(origin.address() as AddressInfo).port;
  const proxy=createServer((_req,res)=>{proxyHits++;res.statusCode=502;res.end('proxy unavailable');});
  proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
  const proxyPort=(proxy.address() as AddressInfo).port;
  const root=tempRoot();
  try{
    const p=await new ChromiumAdapter(exe).launch({profileId:'proxy-error',userDataDir:root,languages:['en-US'],startUrls:[`http://127.0.0.1:${originPort}/`],fingerprint:DEFAULT_FINGERPRINT,proxyUrl:`http://127.0.0.1:${proxyPort}`});
    try{
      const deadline=Date.now()+5000;
      while(proxyHits===0&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
      await new Promise(r=>setTimeout(r,1000));
      expect(proxyHits,'the browser must send the request to the proxy').toBeGreaterThan(0);
      expect(originHits,'a failing proxy must not fall back to a direct connection').toBe(0);
    }finally{await p.stop();}
  }finally{cleanup(root);origin.closeAllConnections();origin.close();proxy.closeAllConnections();proxy.close();}
},120000);
