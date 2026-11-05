import {expect,it} from 'vitest';
import {buildSync} from 'esbuild';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import electronPath from 'electron';

async function probe(scenario:'complete'|'cancel'|'untrusted'){
  const dir=mkdtempSync(join(tmpdir(),'exodus-update-node-'));
  try{
    const bundle=join(dir,'service.cjs');
    const output=join(dir,'result.json');
    const runner=join(dir,'runner.cjs');
    mkdirSync(join(dir,'electron'));
    buildSync({entryPoints:['src/main/update/service.ts'],bundle:true,platform:'node',format:'cjs',outfile:bundle});
    writeFileSync(runner,`
const {app}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {createServer}=require('node:http');
const {createHash}=require('node:crypto');
const {UpdateService}=require(${JSON.stringify(bundle)});
app.setPath('userData',${JSON.stringify(join(dir,'electron'))});
const scenario=${JSON.stringify(scenario)};
const result={requests:[],installed:false};
const save=()=>fs.writeFileSync(${JSON.stringify(output)},JSON.stringify(result));
process.on('uncaughtException',error=>{result.error=String(error.stack);save();app.exit(1);});
const timer=setTimeout(()=>{result.error='probe timed out';save();app.exit(2);},15000);
app.whenReady().then(async()=>{
  let base;
  let resolveDownloadClose;
  const downloadClosed=new Promise(resolve=>{resolveDownloadClose=resolve;});
  const name='ExodusBrowser-Setup-1.1.83.exe';
  const payload=Buffer.alloc(8*1024*1024,97);
  const digest=createHash('sha256').update(payload).digest('hex');
  const server=createServer((req,res)=>{
    result.requests.push({url:req.url,version:req.httpVersion});
    if(req.url==='/latest')return res.end(JSON.stringify({tag_name:'v1.1.83',draft:false,prerelease:false,assets:[
      {name,browser_download_url:base+'/installer',size:payload.length},
      {name:'SHA256SUMS',browser_download_url:base+'/checksums',size:100}
    ]}));
    if(req.url==='/checksums'){res.writeHead(302,{location:base+'/sums'});return res.end();}
    if(req.url==='/sums')return res.end(digest+'  '+name+'\\n');
    if(req.url==='/installer'){res.writeHead(302,{location:scenario==='untrusted'?'http://127.0.0.1:1/forbidden':base+'/payload'});return res.end();}
    if(req.url==='/payload'){
      res.writeHead(200,{'content-length':payload.length});
      if(scenario!=='cancel')return res.end(payload);
      const interval=setInterval(()=>res.write(Buffer.alloc(65536,97)),5);
      res.once('close',()=>{clearInterval(interval);result.socketClosed=true;resolveDownloadClose();});
      return;
    }
    res.writeHead(404);res.end();
  });
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    base='http://127.0.0.1:'+server.address().port;
    const service=new UpdateService({
      appVersion:'1.1.82',root:${JSON.stringify(join(dir,'data'))},apiUrl:base+'/latest',
      isAllowedUrl:url=>new URL(url).origin===base,
      busy:async()=>false,runInstaller:async()=>{result.installed=true;},
      onState:state=>{if(scenario==='cancel'&&state.state==='downloading'&&state.received>0)void service.cancel();}
    });
    result.check=await service.check();
    if(result.check.state==='available')result.download=await service.download();
    if(scenario==='cancel'&&result.download){
      let closeTimer;
      try{
        await Promise.race([downloadClosed,new Promise((_,reject)=>{closeTimer=setTimeout(()=>reject(Error('Cancellation did not close the response before cleanup')),2000);})]);
        result.socketClosedBeforeCleanup=true;
      }finally{clearTimeout(closeTimer);}
    }
    const versionDir=path.join(${JSON.stringify(join(dir,'data'))},'updates','1.1.83');
    if(scenario==='complete'&&result.download?.state==='ready'){
      const bytes=fs.readFileSync(path.join(versionDir,name));
      result.matches=bytes.equals(payload);result.sha256=createHash('sha256').update(bytes).digest('hex');
      await service.install();
    }else result.partialRemoved=!fs.existsSync(versionDir);
  }catch(error){result.error=String(error.stack);}
  finally{
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    clearTimeout(timer);save();app.quit();
  }
});
`);
    const exitCode=await new Promise<number|null>((resolve,reject)=>{
      const child=spawn(electronPath as unknown as string,[runner],{stdio:'ignore'});
      const timer=setTimeout(()=>{child.kill();reject(new Error('Electron update probe timed out'));},25000);
      child.once('exit',code=>{clearTimeout(timer);resolve(code);});
      child.once('error',error=>{clearTimeout(timer);reject(error);});
    });
    const result=JSON.parse(readFileSync(output,'utf8'));
    expect(result.error).toBeUndefined();
    expect(exitCode).toBe(0);
    return result;
  }finally{rmSync(dir,{recursive:true,force:true});}
}

it('uses the production default transport inside Electron for HTTP/1.1 redirects, verified readiness and installer-callback invocation',async()=>{
  const result=await probe('complete');
  expect(result.check).toEqual({state:'available',version:'1.1.83',size:8388608});
  expect(result.download).toEqual({state:'ready',version:'1.1.83'});
  expect(result.matches).toBe(true);
  expect(result.installed).toBe(true);
  expect(result.requests.map((request:{url:string})=>request.url)).toEqual(['/latest','/checksums','/sums','/installer','/payload']);
  expect(result.requests.every((request:{version:string})=>request.version==='1.1')).toBe(true);
},30000);

it('cancels a streamed download inside Electron without late-data exceptions or a partial installer',async()=>{
  const result=await probe('cancel');
  expect(result.download).toEqual({state:'available',version:'1.1.83',size:8388608});
  expect(result.partialRemoved).toBe(true);
  expect(result.socketClosed).toBe(true);
  expect(result.socketClosedBeforeCleanup).toBe(true);
  expect(result.installed).toBe(false);
},30000);

it('does not let the production transport automatically follow an untrusted asset redirect',async()=>{
  const result=await probe('untrusted');
  expect(result.download).toEqual({state:'error',code:'UPDATE_UNTRUSTED_REDIRECT'});
  expect(result.partialRemoved).toBe(true);
  expect(result.installed).toBe(false);
},30000);
