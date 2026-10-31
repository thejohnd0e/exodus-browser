import {it,expect} from 'vitest';
import {chromium} from 'playwright';
import {existsSync,readdirSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {chromiumArgs} from '../../src/main/engines/chromium';
import {ProfileService} from '../../src/main/profiles/service';
import {ExtensionLibrary} from '../../src/main/extensions/library';
import {DEFAULT_FINGERPRINT} from '../../src/shared/fingerprint';
import {tempRoot,cleanup,testSecrets,valid} from '../fixtures/profiles';

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

const waitForWorker=async(ctx:Awaited<ReturnType<typeof chromium.launchPersistentContext>>)=>{
  for(let i=0;i<100;i++){
    const worker=ctx.serviceWorkers().find(item=>item.url().includes('background.js'));
    if(worker)return worker;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  return null;
};

it('loads enabled extensions only in the chosen profile, keeps their storage and applies updates on relaunch',async()=>{
  if(!existsSync(executable))throw Error('BLOCKED: no local Chromium');
  const root=tempRoot();let service:ProfileService|undefined;
  try{
    const svc=service=new ProfileService(root,testSecrets());
    const library=new ExtensionLibrary(root,svc.database);
    const entry=await library.addFromFolder(fixture(root,'1.0.0'));
    const withExtension=await svc.create({...valid,name:'With extension',extensionIds:[entry.id]});
    const without=await svc.create({...valid,name:'Without extension'});

    const launch=async (profileId:string)=>{
      const input=svc.getLaunchInput(profileId);
      const args=chromiumArgs({profileId,userDataDir:join(root,'profiles',profileId),languages:input.languages,startUrls:['about:blank'],fingerprint:DEFAULT_FINGERPRINT,extensionDirs:input.extensionIds.map(extensionId=>library.directoryFor(extensionId))})
        .filter(arg=>!arg.startsWith('--remote-debugging-port')&&!arg.startsWith('--user-data-dir')&&arg!=='about:blank');
      mkdirSync(join(root,'profiles',profileId),{recursive:true});
      return chromium.launchPersistentContext(join(root,'profiles',profileId),{executablePath:executable,headless:false,ignoreDefaultArgs:['--disable-extensions'],args});
    };

    const first=await launch(withExtension.id);
    const worker=await waitForWorker(first);
    expect(worker).not.toBeNull();
    expect(await worker!.evaluate(()=>(globalThis as any).chrome.runtime.getManifest().version)).toBe('1.0.0');
    await worker!.evaluate(()=>(globalThis as any).chrome.storage.local.set({token:'profile-a'}));
    await first.close();

    const restarted=await launch(withExtension.id);
    const restartedWorker=await waitForWorker(restarted);
    expect(await restartedWorker!.evaluate(async()=>{const value=await (globalThis as any).chrome.storage.local.get('token');return value.token;})).toBe('profile-a');
    await restarted.close();

    const plain=await launch(without.id);
    await new Promise(resolve=>setTimeout(resolve,2000));
    expect(plain.serviceWorkers().filter(item=>item.url().includes('background.js'))).toEqual([]);
    await plain.close();

    await library.updateFromFolder(entry.id,fixture(root,'2.0.0'));
    const updated=await launch(withExtension.id);
    const updatedWorker=await waitForWorker(updated);
    expect(await updatedWorker!.evaluate(()=>(globalThis as any).chrome.runtime.getManifest().version)).toBe('2.0.0');
    await updated.close();

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
