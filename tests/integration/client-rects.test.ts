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

// ClientRects noise must change the numbers, and nothing else: every way of reading a rect list
// has to agree, and the list must stay a real DOMRectList (audit 2026-11-08).
const probe=`(()=>{
  const el=document.getElementById('box');const rects=el.getClientRects();const again=el.getClientRects();
  const outcome=fn=>{try{return fn();}catch(e){return 'threw '+(e&&e.constructor&&e.constructor.name);}};
  const lengthGetter=Object.getOwnPropertyDescriptor(DOMRectList.prototype,'length').get;
  const box=el.getBoundingClientRect();
  return {
    structure:{
      isList:rects instanceof DOMRectList,
      itemIsPrototypeMethod:rects.item===DOMRectList.prototype.item,
      itemStable:rects.item===rects.item,
      iteratorIsNative:rects[Symbol.iterator]===Array.prototype.values,
      nativeItem:outcome(()=>typeof DOMRectList.prototype.item.call(rects,0)),
      nativeLength:outcome(()=>lengthGetter.call(rects)),
      tag:Object.prototype.toString.call(rects),
      boxIsRect:box instanceof DOMRect,
    },
    agree:[()=>rects[0].x,()=>Object.getOwnPropertyDescriptor(rects,'0').value.x,()=>rects.item(0).x,()=>[...rects][0].x,()=>DOMRectList.prototype.item.call(rects,0).x].map(outcome),
    stable:again[0].x===rects[0].x&&el.getBoundingClientRect().x===box.x,
    x:rects[0].x,boxX:box.x,
  };
})()`;

async function run(fingerprint:Fingerprint){
  const reports:Array<Record<string,unknown>>=[];
  const server=createServer((req,res)=>{
    const url=new URL(req.url??'/','http://local');
    if(url.pathname==='/report'){reports.push(JSON.parse(url.searchParams.get('v')!));res.end('ok');return;}
    res.setHeader('Content-Type','text/html');
    res.end(`<!doctype html><body style="margin:0"><div id="box" style="position:absolute;left:8px;top:8px;width:100px;height:20px"></div><script>fetch('/report?v='+encodeURIComponent(JSON.stringify(${probe})))</script>`);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const root=tempRoot();
  try{
    const p=await new ChromiumAdapter(exe).launch({profileId:'client-rects',userDataDir:root,languages:['en-US'],startUrls:[origin+'/'],fingerprint});
    try{for(let i=0;i<80&&reports.length<1;i++)await sleep(100);}finally{await p.stop();}
  }finally{cleanup(root);server.closeAllConnections();server.close();}
  if(!reports.length)throw Error('page did not report');
  return reports[0];
}

it('ClientRects noise changes the values consistently and leaves a real DOMRectList',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const stock=await run(DEFAULT_FINGERPRINT);
  const noisy=await run({...DEFAULT_FINGERPRINT,clientRects:'noise'});
  expect(stock.x).toBe(8);
  expect(noisy.structure).toEqual(stock.structure);
  const agree=noisy.agree as number[];
  expect(new Set(agree).size,'every way of reading the rect must agree: '+JSON.stringify(agree)).toBe(1);
  expect(noisy.x,'the value is noised').not.toBe(8);
  expect(noisy.boxX).not.toBe(8);
  expect(noisy.stable,'repeated reads return the same noised value').toBe(true);
},120000);
