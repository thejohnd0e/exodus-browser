import {it,expect} from 'vitest';
import {existsSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {ZipFile} from 'yazl';
import {join} from 'node:path';
import {ChromiumAdapter} from '../../src/main/engines/chromium';
import {ProfileService} from '../../src/main/profiles/service';
import {ExtensionLibrary} from '../../src/main/extensions/library';
import {DEFAULT_FINGERPRINT} from '../../src/shared/fingerprint';
import {tempRoot,cleanup,testSecrets,valid} from '../fixtures/profiles';
import type {EngineProcess} from '../../src/main/engines/types';

const base=join(process.env.LOCALAPPDATA??'','ms-playwright');
const candidates=existsSync(base)?readdirSync(base).filter(name=>name.startsWith('chromium-')).sort().reverse():[];
const executable=process.env.LOCAL_PROFILES_TEST_CHROMIUM??join(base,candidates[0]??'missing','chrome-win64','chrome.exe');

function fixture(root:string,version:string){
  const dir=join(root,'fixture-'+version.replace(/\./g,'_'));
  mkdirSync(dir,{recursive:true});
  writeFileSync(join(dir,'manifest.json'),JSON.stringify({
    manifest_version:3,name:'Fixture extension',version,
    permissions:['storage'],background:{service_worker:'background.js'},
  }));
  writeFileSync(join(dir,'background.js'),"chrome.runtime.onInstalled.addListener(()=>chrome.storage.local.set({marker:'installed'}));");
  return dir;
}

// Google Chrome ignores --load-extension, so the engine loads extensions through the pipe
// (Extensions.loadUnpacked). These tests go through the engine's own launch, the same path the
// application uses, and read the extension's service worker over CDP.
const launchProfile=(svc:ProfileService,library:ExtensionLibrary,root:string,profileId:string)=>{
  const input=svc.getLaunchInput(profileId);
  return new ChromiumAdapter(executable).launch({profileId,userDataDir:join(root,'profiles',profileId),languages:input.languages,startUrls:['about:blank'],fingerprint:DEFAULT_FINGERPRINT,
    extensionDirs:input.extensionIds.map(extensionId=>library.directoryFor(extensionId))});
};

/** Evaluates an expression in the fixture's service worker; null when no such worker appears. */
async function inWorker(process:EngineProcess,expression:string,waitMs=10000):Promise<unknown>{
  const browser=process.browser!;const deadline=Date.now()+waitMs;
  for(;;){
    const {targetInfos}=await browser.send<{targetInfos:Array<{targetId:string;type:string;url:string}>}>('Target.getTargets',{},'');
    const target=targetInfos.find(item=>item.type==='service_worker'&&item.url.startsWith('chrome-extension://')&&item.url.includes('background.js'));
    if(target){
      const {sessionId}=await browser.send<{sessionId:string}>('Target.attachToTarget',{targetId:target.targetId,flatten:true},'');
      const result=await browser.send<{result:{value?:unknown};exceptionDetails?:unknown}>('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);
      // The extension APIs appear a moment after the worker global exists: retry until they do.
      if(!result.exceptionDetails)return result.result.value;
    }
    if(Date.now()>=deadline)return null;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
}

async function crxOf(version:string){
  const zip=new ZipFile();
  zip.addBuffer(Buffer.from(JSON.stringify({manifest_version:3,name:'Store fixture',version,permissions:['storage'],background:{service_worker:'background.js'}})),'manifest.json');
  zip.addBuffer(Buffer.from("chrome.runtime.onInstalled.addListener(()=>undefined);"),'background.js');
  const chunks:Buffer[]=[];zip.outputStream.on('data',chunk=>chunks.push(chunk));
  const body=await new Promise<Buffer>((resolve,reject)=>{zip.outputStream.on('end',()=>resolve(Buffer.concat(chunks)));zip.outputStream.on('error',reject);zip.end();});
  const header=Buffer.alloc(8);const prefix=Buffer.alloc(12);prefix.write('Cr24',0,'latin1');prefix.writeUInt32LE(3,4);prefix.writeUInt32LE(header.length,8);
  return Buffer.concat([prefix,header,body]);
}
const manifestVersion='chrome.runtime.getManifest().version';

it('installs a store package into the library and loads it in Chromium',async()=>{
  if(!existsSync(executable))throw Error('BLOCKED: no local Chromium');
  const root=tempRoot();let service:ProfileService|undefined;
  try{
    const svc=service=new ProfileService(root,testSecrets());
    const download=async(_url:string,destination:string)=>{writeFileSync(destination,await crxOf('5.1.0'));};
    const library=new ExtensionLibrary(root,svc.database,download);
    const entry=await library.addFromStore('https://chromewebstore.google.com/detail/fixture/lieogkinebikhdchceieedcigeafdkid');
    expect(entry).toMatchObject({name:'Store fixture',version:'5.1.0',source:'store'});
    const profile=await svc.create({...valid,name:'Store profile',extensionIds:[entry.id]});
    const process=await launchProfile(svc,library,root,profile.id);
    try{expect(await inWorker(process,manifestVersion)).toBe('5.1.0');}finally{await process.stop();}
  }finally{
    service?.close();
    for(let attempt=0;attempt<10;attempt++){
      try{cleanup(root);break;}catch{await new Promise(resolve=>setTimeout(resolve,200));}
    }
  }
},180000);

it('loads enabled extensions only in the chosen profile, keeps their storage and applies updates on relaunch',async()=>{
  if(!existsSync(executable))throw Error('BLOCKED: no local Chromium');
  const root=tempRoot();let service:ProfileService|undefined;
  try{
    const svc=service=new ProfileService(root,testSecrets());
    const library=new ExtensionLibrary(root,svc.database);
    const entry=await library.addFromFolder(fixture(root,'1.0.0'));
    const withExtension=await svc.create({...valid,name:'With extension',extensionIds:[entry.id]});
    const without=await svc.create({...valid,name:'Without extension'});

    const first=await launchProfile(svc,library,root,withExtension.id);
    try{
      expect(await inWorker(first,manifestVersion)).toBe('1.0.0');
      await inWorker(first,"chrome.storage.local.set({token:'profile-a'})");
    }finally{await first.stop();}

    const restarted=await launchProfile(svc,library,root,withExtension.id);
    try{expect(await inWorker(restarted,"chrome.storage.local.get('token').then(value=>value.token)")).toBe('profile-a');}finally{await restarted.stop();}

    const plain=await launchProfile(svc,library,root,without.id);
    try{expect(await inWorker(plain,manifestVersion,2500)).toBeNull();}finally{await plain.stop();}

    await library.updateFromFolder(entry.id,fixture(root,'2.0.0'));
    const updated=await launchProfile(svc,library,root,withExtension.id);
    try{expect(await inWorker(updated,manifestVersion)).toBe('2.0.0');}finally{await updated.stop();}

    const copy=library.directoryFor(entry.id);
    await library.remove(entry.id);
    expect(existsSync(copy)).toBe(false);
    expect(svc.getLaunchInput(withExtension.id).extensionIds).toEqual([]);
  }finally{
    service?.close();
    for(let attempt=0;attempt<10;attempt++){
      try{cleanup(root);break;}catch{await new Promise(resolve=>setTimeout(resolve,200));}
    }
  }
},180000);

it('refuses to start a profile whose extension cannot be loaded',async()=>{
  if(!existsSync(executable))throw Error('BLOCKED: no local Chromium');
  const root=tempRoot();
  try{
    mkdirSync(join(root,'broken'),{recursive:true});writeFileSync(join(root,'broken','manifest.json'),'{not json');
    await expect(new ChromiumAdapter(executable).launch({profileId:'broken-extension',userDataDir:join(root,'profiles','x'),languages:['en-US'],startUrls:['about:blank'],fingerprint:DEFAULT_FINGERPRINT,extensionDirs:[join(root,'broken')]}))
      .rejects.toThrow('EXTENSION_LOAD_FAILED');
  }finally{cleanup(root);}
},120000);
