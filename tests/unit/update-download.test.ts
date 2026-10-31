import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {access,mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {downloadInstaller,fetchAllowedRedirects,isAllowedHost} from '../../src/main/update/download';

const fileName='ExodusBrowser-Setup-1.1.78.exe';
const payload=Buffer.from('installer-bytes-for-test');
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const url='https://github.com/thejohnd0e/exodus-browser/releases/download/v1.1.78/'+fileName;

let dir:string;
beforeEach(async()=>{dir=await mkdtemp(join(tmpdir(),'exodus-update-'));});
afterEach(async()=>{await rm(dir,{recursive:true,force:true});});

function bodyResponse(bytes:Buffer,status=200,headers:Record<string,string>={}){
  return new Response(new Uint8Array(bytes),{status,headers});
}

function options(overrides:Partial<Parameters<typeof downloadInstaller>[0]>={}){
  return {
    url,
    expectedSize:payload.length,
    expectedSha256:sha(payload),
    destinationDir:dir,
    fileName,
    fetch:async()=>bodyResponse(payload),
    signal:new AbortController().signal,
    onProgress:()=>undefined,
    ...overrides,
  };
}

async function entries(){return (await readdir(dir)).sort();}

describe('isAllowedHost',()=>{
  it('allows only https GitHub hosts',()=>{
    expect(isAllowedHost('https://github.com/a')).toBe(true);
    expect(isAllowedHost('https://objects.githubusercontent.com/a')).toBe(true);
    expect(isAllowedHost('http://github.com/a')).toBe(false);
    expect(isAllowedHost('https://github.com.evil.example/a')).toBe(false);
    expect(isAllowedHost('https://127.0.0.1/a')).toBe(false);
    expect(isAllowedHost('not a url')).toBe(false);
  });
});

describe('downloadInstaller',()=>{
  it('writes the verified installer and leaves no partial file',async()=>{
    const path=await downloadInstaller(options());
    expect(path).toBe(join(dir,fileName));
    expect(await entries()).toEqual([fileName]);
  });

  it('follows a redirect only to an allowed host',async()=>{
    const seen:string[]=[];
    const path=await downloadInstaller(options({fetch:async(target:string)=>{
      seen.push(target);
      if(seen.length===1)return bodyResponse(Buffer.alloc(0),302,{location:'https://objects.githubusercontent.com/asset'});
      return bodyResponse(payload);
    }}));
    expect(seen[1]).toBe('https://objects.githubusercontent.com/asset');
    expect(path).toBe(join(dir,fileName));
  });

  it('refuses a redirect to an untrusted host before writing anything',async()=>{
    await expect(downloadInstaller(options({fetch:async()=>bodyResponse(Buffer.alloc(0),302,{location:'https://evil.example/x'})})))
      .rejects.toThrow('UPDATE_UNTRUSTED_REDIRECT');
    expect(await entries()).toEqual([]);
  });

  it('refuses a starting URL outside the allowed hosts',async()=>{
    await expect(downloadInstaller(options({url:'http://github.com/x'}))).rejects.toThrow('UPDATE_UNTRUSTED_REDIRECT');
  });

  it('rejects a body larger than the expected size and removes the partial file',async()=>{
    await expect(downloadInstaller(options({expectedSize:4,fetch:async()=>bodyResponse(payload)})))
      .rejects.toThrow('UPDATE_TOO_LARGE');
    expect(await entries()).toEqual([]);
  });

  it('rejects a truncated body and removes the partial file',async()=>{
    await expect(downloadInstaller(options({expectedSize:payload.length+10})))
      .rejects.toThrow('UPDATE_DOWNLOAD_FAILED');
    expect(await entries()).toEqual([]);
  });

  it('rejects a checksum mismatch without leaving an installable file',async()=>{
    await expect(downloadInstaller(options({expectedSha256:'0'.repeat(64)})))
      .rejects.toThrow('UPDATE_CHECKSUM_MISMATCH');
    expect(await entries()).toEqual([]);
  });

  it('reports progress and cancels cleanly mid-stream',async()=>{
    const controller=new AbortController();
    const progress:number[]=[];
    const body=new ReadableStream({
      start(streamController){streamController.enqueue(new Uint8Array(10));},
      pull(){return new Promise(()=>undefined);},
    });
    const promise=downloadInstaller(options({
      expectedSize:1000,
      expectedSha256:'0'.repeat(64),
      signal:controller.signal,
      fetch:async()=>new Response(body),
      onProgress:({received})=>{progress.push(received);controller.abort();},
    }));
    await expect(promise).rejects.toThrow('UPDATE_CANCELLED');
    expect(progress).toEqual([10]);
    expect(await entries()).toEqual([]);
  });

  it('fails with a network error code when fetch rejects',async()=>{
    await expect(downloadInstaller(options({fetch:async()=>{throw new Error('ECONNRESET');}})))
      .rejects.toThrow('UPDATE_DOWNLOAD_FAILED');
  });

  it('keeps an existing final file untouched when verification fails',async()=>{
    const {writeFile}=await import('node:fs/promises');
    await writeFile(join(dir,fileName),'old');
    await expect(downloadInstaller(options({expectedSha256:'0'.repeat(64)}))).rejects.toThrow('UPDATE_CHECKSUM_MISMATCH');
    await access(join(dir,fileName));
    expect(await entries()).toEqual([fileName]);
  });

  it('stops when no data arrives before the idle timeout', async () => {
    await expect(downloadInstaller(options({idleTimeoutMs: 50, fetch: async () => new Response(new ReadableStream({start() {}, pull() { return new Promise(() => undefined); }}), {status: 200})}))).rejects.toThrow('UPDATE_DOWNLOAD_STALLED');
    expect(await entries()).toEqual([]);
  });

  it('cancels the response body when a size violation stops the download',async()=>{
    let cancelled=false;
    const body=new ReadableStream<Uint8Array>({
      start(controller){controller.enqueue(new Uint8Array(100));},
      cancel(){cancelled=true;},
    });
    await expect(downloadInstaller(options({expectedSize:4,fetch:async()=>new Response(body)}))).rejects.toThrow('UPDATE_TOO_LARGE');
    expect(cancelled).toBe(true);
    expect(await entries()).toEqual([]);
  });
});

describe('fetchAllowedRedirects',()=>{
  it.each([
    {status:302,location:'https://objects.githubusercontent.com/asset',error:null},
    {status:302,location:'https://evil.example/asset',error:'UPDATE_UNTRUSTED_REDIRECT'},
    {status:302,location:undefined,error:'UPDATE_DOWNLOAD_FAILED'},
    {status:503,location:undefined,error:'UPDATE_DOWNLOAD_FAILED'},
  ])('cancels a discarded $status body before following or rejecting its response ($location)',async({status,location,error})=>{
    let cancelled=false;
    const stream=new ReadableStream<Uint8Array>({
      start(controller){controller.enqueue(new Uint8Array(16));},
      cancel(){cancelled=true;},
    });
    let calls=0;
    const result=fetchAllowedRedirects({
      url,signal:new AbortController().signal,isAllowedUrl:isAllowedHost,
      fetch:async()=>++calls===1?new Response(stream,{status,headers:location?{location}:{}}):bodyResponse(payload),
    });
    if(error)await expect(result).rejects.toThrow(error);
    else expect(await (await result).text()).toBe('installer-bytes-for-test');
    expect(cancelled).toBe(true);
    expect(calls).toBe(error?1:2);
  });
});
