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

// Canvas noise must not be removable by calibration and must not be visible as tampering
// (audit 2026-11-08). Each probe has an exact answer in Chrome without noise.
const probe=`(async()=>{
  const W=64,H=48;
  const draw=(x)=>{x.fillStyle='#fff';x.fillRect(0,0,W,H);x.fillStyle='#e23';x.font='18px Arial';x.fillText('Exodus 1',3,20);
    x.strokeStyle='rgb(10,120,200)';x.lineWidth=1.5;x.beginPath();x.arc(46,32,11,0,Math.PI*2);x.stroke();x.fillStyle='rgba(0,90,0,1)';x.fillRect(5,30,17,9);};
  const make=()=>{const c=document.createElement('canvas');c.width=W;c.height=H;const x=c.getContext('2d');draw(x);return {c,x};};
  const list=(d)=>Array.from(d.data);
  const {c,x}=make();const full=list(x.getImageData(0,0,W,H));
  // A uniform canvas, read whole and in part.
  const u=document.createElement('canvas');u.width=40;u.height=40;const ux=u.getContext('2d');ux.fillStyle='#1a2b3c';ux.fillRect(0,0,40,40);
  const ud=list(ux.getImageData(0,0,40,40));const uniform=ud.every((v,i)=>v===[26,43,60,255][i%4]);
  // A part of the picture equals the same part of the whole picture.
  const part=list(x.getImageData(9,7,30,25));let partAgrees=true;
  for(let j=0;j<25;j++)for(let i=0;i<30;i++)for(let k=0;k<4;k++)if(part[(j*30+i)*4+k]!==full[((j+7)*W+i+9)*4+k])partAgrees=false;
  // Writing the read pixels back and reading them again gives the same pixels.
  const r=document.createElement('canvas');r.width=W;r.height=H;const rx=r.getContext('2d');rx.putImageData(x.getImageData(0,0,W,H),0,0);
  const roundTrip=JSON.stringify(list(rx.getImageData(0,0,W,H)))===JSON.stringify(full);
  // The same picture drawn elsewhere carries the same pixels.
  const big=document.createElement('canvas');big.width=W+30;big.height=H+20;const bx=big.getContext('2d');bx.fillStyle='#fff';bx.fillRect(0,0,big.width,big.height);bx.translate(17,11);draw(bx);
  const moved=list(bx.getImageData(17,11,W,H));const translated=JSON.stringify(moved)===JSON.stringify(full);
  // The encoded image decodes to the pixels getImageData reports.
  const img=new Image();img.src=c.toDataURL();await img.decode();const dc=document.createElement('canvas');dc.width=W;dc.height=H;const dx=dc.getContext('2d');dx.drawImage(img,0,0);
  const encoded=JSON.stringify(list(dx.getImageData(0,0,W,H)))===JSON.stringify(full);
  const blob=await new Promise(res=>c.toBlob(res));const bmp=await createImageBitmap(blob);const bc=document.createElement('canvas');bc.width=W;bc.height=H;bc.getContext('2d').drawImage(bmp,0,0);
  const blobbed=JSON.stringify(list(bc.getContext('2d').getImageData(0,0,W,H)))===JSON.stringify(full);
  // OffscreenCanvas gets the same pixels.
  const oc=new OffscreenCanvas(W,H);const ox=oc.getContext('2d');draw(ox);const offscreen=JSON.stringify(list(ox.getImageData(0,0,W,H)))===JSON.stringify(full);
  // WebGL: readPixels agrees with the same buffer drawn into a 2D canvas (rows bottom-up).
  const g=document.createElement('canvas');g.width=32;g.height=24;const gl=g.getContext('webgl',{preserveDrawingBuffer:true,antialias:false});
  gl.enable(gl.SCISSOR_TEST);const colors=[[1,0,0],[0,.5,1],[.2,.8,.1],[1,1,0]];
  gl.clearColor(1,1,1,1);gl.clear(gl.COLOR_BUFFER_BIT);
  colors.forEach((col,n)=>{gl.scissor(3+n*6,4+n*3,7,9);gl.clearColor(col[0],col[1],col[2],1);gl.clear(gl.COLOR_BUFFER_BIT);});
  const px=new Uint8Array(32*24*4);gl.readPixels(0,0,32,24,gl.RGBA,gl.UNSIGNED_BYTE,px);
  const gc=document.createElement('canvas');gc.width=32;gc.height=24;const gx=gc.getContext('2d');gx.drawImage(g,0,0);const gd=gx.getImageData(0,0,32,24).data;
  let glAgrees=true;for(let j=0;j<24;j++)for(let i=0;i<32*4;i++)if(px[(23-j)*32*4+i]!==gd[j*32*4+i])glAgrees=false;
  const glUniform=(()=>{const p=new Uint8Array(3*3*4);gl.readPixels(0,0,3,3,gl.RGBA,gl.UNSIGNED_BYTE,p);return p.every(v=>v===255);})();
  return {full,uniform,partAgrees,roundTrip,translated,encoded,blobbed,offscreen,glAgrees,glUniform,gl:Array.from(px)};
})()`;

async function run(fingerprint:Fingerprint,seed:number){
  const reports:Array<Record<string,unknown>>=[];
  const server=createServer((req,res)=>{
    if(req.method==='POST'){let body='';req.on('data',c=>body+=c);req.on('end',()=>{reports.push(JSON.parse(body));res.end('ok');});return;}
    res.setHeader('Content-Type','text/html');
    res.end(`<!doctype html><body><script>${probe}.then(v=>fetch('/report',{method:'POST',body:JSON.stringify(v)}),e=>fetch('/report',{method:'POST',body:JSON.stringify({error:String(e)})}))</script>`);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const root=tempRoot();
  try{
    const p=await new ChromiumAdapter(exe).launch({profileId:'canvas-noise',userDataDir:root,languages:['en-US'],startUrls:[origin+'/'],fingerprint,fingerprintSeed:seed});
    try{for(let i=0;i<100&&reports.length<1;i++)await sleep(100);}finally{await p.stop();}
  }finally{cleanup(root);server.closeAllConnections();server.close();}
  if(!reports.length)throw Error('page did not report');
  if(reports[0].error)throw Error(String(reports[0].error));
  return reports[0] as {full:number[];gl:number[]}&Record<string,unknown>;
}

const checks=['uniform','partAgrees','roundTrip','translated','encoded','blobbed','offscreen','glAgrees','glUniform'];
/** Differences from stock, which must be lowest-bit changes of colour channels only. */
function diff(a:number[],b:number[]){let changed=0;let onlyLowBit=true;for(let i=0;i<a.length;i++)if(a[i]!==b[i]){changed++;if(i%4===3||(a[i]^b[i])!==1)onlyLowBit=false;}return {changed,onlyLowBit};}

it('canvas and WebGL noise change only edges, consistently on every read path',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const stock=await run(DEFAULT_FINGERPRINT,1);
  const noise={...DEFAULT_FINGERPRINT,canvas:'noise' as const,webgl:'noise' as const};
  const a=await run(noise,1);const again=await run(noise,1);const b=await run(noise,2);
  for(const key of checks){expect(stock[key],'stock '+key).toBe(true);expect(a[key],'noise '+key).toBe(true);}
  const da=diff(stock.full,a.full),db=diff(stock.full,b.full),dg=diff(stock.gl,a.gl);
  expect(da.changed,'the picture is noised').toBeGreaterThan(20);expect(da.onlyLowBit).toBe(true);
  expect(dg.changed,'readPixels is noised').toBeGreaterThan(5);expect(dg.onlyLowBit).toBe(true);
  expect(db.changed).toBeGreaterThan(20);
  expect(again.full,'stable for a profile').toEqual(a.full);
  expect(b.full,'differs between profiles').not.toEqual(a.full);
},240000);
