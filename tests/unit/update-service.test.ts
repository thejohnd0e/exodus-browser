import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {access,mkdir,mkdtemp,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {UpdateService} from '../../src/main/update/service';
import type {UpdateState} from '../../src/shared/update';

const payload=Buffer.from('new-installer');
const body=()=>new Uint8Array(payload);
const digest=createHash('sha256').update(payload).digest('hex');
const apiUrl='https://api.github.com/repos/thejohnd0e/exodus-browser/releases/latest';
const base='https://github.com/thejohnd0e/exodus-browser/releases/download/v1.1.78/';
const installerUrl=base+'ExodusBrowser-Setup-1.1.78.exe';
const checksumsUrl=base+'SHA256SUMS';

function releaseJson(){
  return {tag_name:'v1.1.78',draft:false,prerelease:false,assets:[
    {name:'ExodusBrowser-Setup-1.1.78.exe',browser_download_url:installerUrl,size:payload.length},
    {name:'SHA256SUMS',browser_download_url:checksumsUrl,size:80},
  ]};
}

let root:string;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'exodus-update-svc-'));});
afterEach(async()=>{await rm(root,{recursive:true,force:true});});

function service(overrides:Partial<ConstructorParameters<typeof UpdateService>[0]>={}){
  const states:UpdateState[]=[];
  const runInstaller:string[]=[];
  const svc=new UpdateService({
    appVersion:'0.1.78',
    root,
    apiUrl,
    fetch:async(url:string)=>{
      if(url===apiUrl)return new Response(JSON.stringify(releaseJson()),{status:200});
      if(url===checksumsUrl)return new Response(`${digest}  ExodusBrowser-Setup-1.1.78.exe\n`,{status:200});
      if(url===installerUrl)return new Response(body(),{status:200});
      throw new Error('unexpected '+url);
    },
    busy:async()=>false,
    runInstaller:async path=>{runInstaller.push(path);},
    onState:state=>{states.push(state);},
    ...overrides,
  });
  return {svc,states,runInstaller};
}

describe('UpdateService',()=>{
  it('moves from idle to available when a newer release exists',async()=>{
    const {svc,states}=service();
    expect(svc.state()).toEqual({state:'idle'});
    expect(await svc.check()).toEqual({state:'available',version:'1.1.78',size:payload.length});
    expect(states.map(s=>s.state)).toEqual(['checking','available']);
  });

  it('reports up-to-date for the current version',async()=>{
    const {svc}=service({appVersion:'1.1.78'});
    expect(await svc.check()).toEqual({state:'up-to-date'});
  });

  it('downloads, verifies and becomes ready',async()=>{
    const {svc}=service();
    await svc.check();
    const state=await svc.download();
    expect(state).toEqual({state:'ready',version:'1.1.78'});
    await access(join(root,'updates','1.1.78','ExodusBrowser-Setup-1.1.78.exe'));
  });

  it('removes older update folders after a verified download',async()=>{
    await mkdir(join(root,'updates','1.1.0'),{recursive:true});
    await writeFile(join(root,'updates','1.1.0','old.exe'),'x');
    const {svc}=service();
    await svc.check();
    await svc.download();
    expect(await readdir(join(root,'updates'))).toEqual(['1.1.78']);
  });

  it('reports a network failure as an error state',async()=>{
    const {svc}=service({fetch:async()=>{throw new Error('offline');}});
    expect(await svc.check()).toEqual({state:'error',code:'UPDATE_CHECK_FAILED'});
  });

  it('cancels the discarded body when the release API returns an error',async()=>{
    let cancelled=false;
    const stream=new ReadableStream<Uint8Array>({
      start(controller){controller.enqueue(new Uint8Array(16));},
      cancel(){cancelled=true;},
    });
    const {svc}=service({fetch:async()=>new Response(stream,{status:503})});
    expect(await svc.check()).toEqual({state:'error',code:'UPDATE_CHECK_FAILED'});
    expect(cancelled).toBe(true);
  });

  it('keeps the invalid-release code for malformed metadata',async()=>{
    const {svc}=service({fetch:async()=>new Response('{"tag_name":"nope"}',{status:200})});
    expect(await svc.check()).toEqual({state:'error',code:'UPDATE_INVALID_RELEASE'});
  });

  it('refuses a second download while one is running',async()=>{
    let release:()=>void=()=>undefined;
    const {svc}=service({fetch:async(url:string)=>{
      if(url===installerUrl)return new Response(new ReadableStream({start(){},pull(){return new Promise<void>(resolve=>{release=resolve;});}}),{status:200});
      if(url===apiUrl)return new Response(JSON.stringify(releaseJson()),{status:200});
      return new Response(`${digest}  ExodusBrowser-Setup-1.1.78.exe\n`,{status:200});
    }});
    await svc.check();
    const first=svc.download();
    await expect(svc.download()).rejects.toThrow('UPDATE_BUSY');
    await expect(svc.check()).rejects.toThrow('UPDATE_BUSY');
    await svc.cancel();
    await first;
    release();
  });

  it('cancels a running download back to available and removes the partial file',async()=>{
    const {svc}=service({fetch:async(url:string)=>{
      if(url===installerUrl)return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(4));},pull(){return new Promise(()=>undefined);}}),{status:200});
      if(url===apiUrl)return new Response(JSON.stringify(releaseJson()),{status:200});
      return new Response(`${digest}  ExodusBrowser-Setup-1.1.78.exe\n`,{status:200});
    }});
    await svc.check();
    const running=svc.download();
    await svc.cancel();
    expect(await running).toEqual({state:'available',version:'1.1.78',size:payload.length});
    await expect(access(join(root,'updates','1.1.78'))).rejects.toThrow();
  });

  it('follows a SHA256SUMS redirect to an allowed GitHub host',async()=>{
    const {svc}=service({fetch:async(url:string)=>{
      if(url===apiUrl)return new Response(JSON.stringify(releaseJson()),{status:200});
      if(url===checksumsUrl)return new Response(null,{status:302,headers:{location:'https://objects.githubusercontent.com/sums'}});
      if(url==='https://objects.githubusercontent.com/sums')return new Response(`${digest}  ExodusBrowser-Setup-1.1.78.exe\n`,{status:200});
      return new Response(body(),{status:200});
    }});
    await svc.check();
    expect(await svc.download()).toEqual({state:'ready',version:'1.1.78'});
  });

  it('refuses a SHA256SUMS redirect to an untrusted host',async()=>{
    const {svc}=service({fetch:async(url:string)=>{
      if(url===apiUrl)return new Response(JSON.stringify(releaseJson()),{status:200});
      if(url===checksumsUrl)return new Response(null,{status:302,headers:{location:'https://evil.example/sums'}});
      return new Response(body(),{status:200});
    }});
    await svc.check();
    expect(await svc.download()).toEqual({state:'error',code:'UPDATE_UNTRUSTED_REDIRECT'});
  });
  it('refuses installation before a verified download',async()=>{
    const {svc,runInstaller}=service();
    await svc.check();
    await expect(svc.install()).rejects.toThrow('UPDATE_NOT_READY');
    expect(runInstaller).toEqual([]);
  });

  it('refuses installation while any profile work is active and starts nothing',async()=>{
    let busy=false;
    const {svc,runInstaller}=service({busy:async()=>busy});
    await svc.check();
    await svc.download();
    busy=true;
    await expect(svc.install()).rejects.toThrow('UPDATE_BUSY_PROFILES');
    expect(runInstaller).toEqual([]);
  });

  it('starts the verified installer when nothing is busy',async()=>{
    const {svc,runInstaller}=service();
    await svc.check();
    await svc.download();
    await svc.install();
    expect(runInstaller).toEqual([join(root,'updates','1.1.78','ExodusBrowser-Setup-1.1.78.exe')]);
  });
});
