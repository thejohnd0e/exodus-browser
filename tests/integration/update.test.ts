import {afterAll,beforeAll,beforeEach,afterEach,expect,it} from 'vitest';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {access,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {UpdateService} from '../../src/main/update/service';
import {isAllowedHost} from '../../src/main/update/hosts';

const payload=Buffer.alloc(256*1024,7);
const digest=createHash('sha256').update(payload).digest('hex');
const loopback=(url:string)=>url.startsWith('http://127.0.0.1:')||isAllowedHost(url);

let server:http.Server;
let origin:string;
let mode:'normal'|'bad-digest'|'oversize'|'stall'|'redirect-evil';
let root:string;

beforeAll(async()=>{
  server=http.createServer((request,response)=>{
    const path=request.url??'';
    if(path==='/api'){
      const installer={name:'ExodusBrowser-Setup-1.1.78.exe',browser_download_url:`${origin}/asset/ExodusBrowser-Setup-1.1.78.exe`,size:payload.length};
      response.setHeader('content-type','application/json');
      response.end(JSON.stringify({tag_name:'v1.1.78',draft:false,prerelease:false,assets:[installer,{name:'SHA256SUMS',browser_download_url:`${origin}/asset/SHA256SUMS`,size:90}]}));
      return;
    }
    if(path==='/asset/SHA256SUMS'){
      response.end(`${mode==='bad-digest'?'0'.repeat(64):digest}  ExodusBrowser-Setup-1.1.78.exe\n`);
      return;
    }
    if(path==='/asset/ExodusBrowser-Setup-1.1.78.exe'){
      if(mode==='redirect-evil'){response.statusCode=302;response.setHeader('location','https://evil.example/installer.exe');response.end();return;}
      if(mode==='stall'){response.writeHead(200,{'content-length':String(payload.length)});response.write(payload.subarray(0,1024));return;}
      const body=mode==='oversize'?Buffer.concat([payload,Buffer.alloc(10)]):payload;
      response.writeHead(200,{'content-length':String(body.length)});
      response.end(body);
      return;
    }
    response.statusCode=404;response.end();
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const address=server.address();
  if(!address||typeof address==='string')throw Error('no address');
  origin=`http://127.0.0.1:${address.port}`;
});

afterAll(async()=>{server.close();await once(server,'close').catch(()=>undefined);});

beforeEach(async()=>{mode='normal';root=await mkdtemp(join(tmpdir(),'exodus-update-int-'));});
afterEach(async()=>{await rm(root,{recursive:true,force:true});});

function service(overrides:{appVersion?:string}={}){
  return new UpdateService({
    appVersion:overrides.appVersion??'0.1.78',
    root,
    apiUrl:`${origin}/api`,
    isAllowedUrl:loopback,
    fetch:(url,init)=>fetch(url,init),
    busy:async()=>false,
    runInstaller:async()=>undefined,
    onState:()=>undefined,
  });
}

it('reports an up-to-date installation without downloading anything',async()=>{
  expect(await service({appVersion:'1.1.78'}).check()).toEqual({state:'up-to-date'});
});

it('downloads and verifies a newer installer end to end',async()=>{
  const svc=service();
  expect(await svc.check()).toEqual({state:'available',version:'1.1.78',size:payload.length});
  expect(await svc.download()).toEqual({state:'ready',version:'1.1.78'});
  await access(join(root,'updates','1.1.78','ExodusBrowser-Setup-1.1.78.exe'));
});

it('leaves no installable file when the checksum does not match',async()=>{
  mode='bad-digest';
  const svc=service();
  await svc.check();
  expect(await svc.download()).toEqual({state:'error',code:'UPDATE_CHECKSUM_MISMATCH'});
  await expect(access(join(root,'updates','1.1.78','ExodusBrowser-Setup-1.1.78.exe'))).rejects.toThrow();
});

it('stops an oversize body',async()=>{
  mode='oversize';
  const svc=service();
  await svc.check();
  expect(await svc.download()).toEqual({state:'error',code:'UPDATE_TOO_LARGE'});
});

it('refuses a redirect to an untrusted host',async()=>{
  mode='redirect-evil';
  const svc=service();
  await svc.check();
  expect(await svc.download()).toEqual({state:'error',code:'UPDATE_UNTRUSTED_REDIRECT'});
});

it('cancels a stalled download and removes its partial file',async()=>{
  mode='stall';
  const svc=service();
  await svc.check();
  const running=svc.download();
  await new Promise(resolve=>setTimeout(resolve,200));
  await svc.cancel();
  expect(await running).toEqual({state:'available',version:'1.1.78',size:payload.length});
  await expect(access(join(root,'updates','1.1.78'))).rejects.toThrow();
});
