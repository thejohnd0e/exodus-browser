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

// Audio noise must leave silence silent and agree between read paths (audit 2026-11-08).
const probe=`(async()=>{
  const render=async(tone)=>{const ctx=new OfflineAudioContext(1,8000,44100);if(tone){const o=ctx.createOscillator();o.type='triangle';o.frequency.value=440;o.connect(ctx.destination);o.start();}return ctx.startRendering();};
  const silent=await render(false),tone=await render(true);
  const silentData=Array.from(silent.getChannelData(0));
  const first=Array.from(tone.getChannelData(0));const again=Array.from(tone.getChannelData(0));
  const copy=new Float32Array(8000);tone.copyFromChannel(copy,0,0);
  const ctx=new AudioContext();const an=ctx.createAnalyser();const bytes=new Uint8Array(an.frequencyBinCount);an.getByteFrequencyData(bytes);
  const floats=new Float32Array(an.frequencyBinCount);an.getFloatFrequencyData(floats);
  return {silentZero:silentData.every(v=>v===0),stable:JSON.stringify(first)===JSON.stringify(again),copyAgrees:first.every((v,i)=>v===copy[i]),
    analyserSilentBytes:Array.from(bytes).every(v=>v===0),analyserFloatsSame:Array.from(floats).every(v=>v===-Infinity||v<=-100),
    tone:first.filter((_,i)=>i%100===0)};
})()`;

async function run(fingerprint:Fingerprint,seed:number){
  const reports:Array<Record<string,unknown>>=[];
  const server=createServer((req,res)=>{
    if(req.method==='POST'){let body='';req.on('data',c=>body+=c);req.on('end',()=>{reports.push(JSON.parse(body));res.end('ok');});return;}
    res.setHeader('Content-Type','text/html');
    res.end(`<!doctype html><body><script>${probe}.then(v=>fetch('/r',{method:'POST',body:JSON.stringify(v)}),e=>fetch('/r',{method:'POST',body:JSON.stringify({error:String(e)})}))</script>`);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const root=tempRoot();
  try{
    const p=await new ChromiumAdapter(exe).launch({profileId:'audio-noise',userDataDir:root,languages:['en-US'],startUrls:[origin+'/'],fingerprint,fingerprintSeed:seed});
    try{for(let i=0;i<100&&reports.length<1;i++)await sleep(100);}finally{await p.stop();}
  }finally{cleanup(root);server.closeAllConnections();server.close();}
  if(!reports.length)throw Error('page did not report');
  if(reports[0].error)throw Error(String(reports[0].error));
  return reports[0] as {tone:number[]}&Record<string,unknown>;
}

it('audio noise leaves silence silent and every read path agrees',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const stock=await run(DEFAULT_FINGERPRINT,1);
  const noise={...DEFAULT_FINGERPRINT,audio:'noise' as const};
  const a=await run(noise,1);const b=await run(noise,2);
  for(const key of ['silentZero','stable','copyAgrees','analyserSilentBytes'])expect(a[key],key).toBe(true);
  expect(stock.silentZero).toBe(true);
  expect(a.tone,'the signal is noised').not.toEqual(stock.tone);
  expect(a.tone,'differs between profiles').not.toEqual(b.tone);
  // Noise is relative: tiny compared with the signal.
  a.tone.forEach((v,i)=>expect(Math.abs(v-stock.tone[i])).toBeLessThanOrEqual(Math.abs(stock.tone[i])*1e-4));
},180000);
