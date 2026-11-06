import {it,expect,vi} from 'vitest';
import {mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {installBrandedEngine,BRANDED_ENGINE_URL} from '../../src/main/engines/branded';
import {EngineInstaller} from '../../src/main/engines/installation';
import {tempRoot,cleanup} from '../fixtures/profiles';

/** A fake 7-Zip that materialises the nested Google installer layout. */
function fakeExtractor(){
  return async (_exe:string,args:string[])=>{
    const out=args.find(a=>a.startsWith('-o'))!.slice(2);
    const archive=args[1];
    if(archive.endsWith('.msi'))await writeFile(join(out,'Binary.GoogleChromeInstaller'),'payload');
    else if(archive.endsWith('Binary.GoogleChromeInstaller'))await writeFile(join(out,'updater.7z'),'updater');
    else if(archive.endsWith('updater.7z'))await writeFile(join(out,'157.0.8103.39_chrome_installer.exe'),'installer');
    else if(archive.endsWith('_chrome_installer.exe'))await writeFile(join(out,'chrome.7z'),'chrome');
    else if(archive.endsWith('chrome.7z')){
      await mkdir(join(out,'Chrome-bin'),{recursive:true});
      await writeFile(join(out,'Chrome-bin','chrome.exe'),'MZ fake chrome');
    } else throw new Error('unexpected archive '+archive);
  };
}

async function fakeDownload(versionBytes=60*1024**2){
  return async (url:string,destination:string)=>{
    expect(url).toBe(BRANDED_ENGINE_URL);
    await writeFile(destination,Buffer.alloc(versionBytes));
  };
}

it('unpacks Google Chrome from the official installer and pins the result',async()=>{
  const root=tempRoot();
  try{
    const verify=vi.fn(async()=>({trusted:true,version:'157.0.8103.39'}));
    const record=await installBrandedEngine(root,{download:await fakeDownload(),sevenZip:'7za',run:fakeExtractor(),verify});
    expect(verify).toHaveBeenCalledTimes(1);
    const verifiedPath=(verify.mock.calls[0] as unknown[])[0];
    expect(String(verifiedPath)).toMatch(/Chrome-bin[\\/]chrome\.exe$/);
    expect(record.version).toBe('157.0.8103.39');
    expect(record.executable).toBe(join(root,'branded','157.0.8103.39','Chrome-bin','chrome.exe'));
    expect((await stat(record.executable)).isFile()).toBe(true);
    const saved=JSON.parse(await readFile(join(root,'branded.json'),'utf8'));
    expect(saved).toEqual(record);
  }finally{cleanup(root);}
},30000);

it('refuses an unpacked browser that is not signed by Google',async()=>{
  const root=tempRoot();
  try{
    const verify=vi.fn(async()=>({trusted:false,version:null}));
    await expect(installBrandedEngine(root,{download:await fakeDownload(),sevenZip:'7za',run:fakeExtractor(),verify})).rejects.toThrow('ENGINE_UNTRUSTED');
    await expect(readFile(join(root,'branded.json'),'utf8')).rejects.toThrow();
  }finally{cleanup(root);}
},30000);

it('rejects an archive that is too small to be Google Chrome',async()=>{
  const root=tempRoot();
  try{
    const verify=vi.fn(async()=>({trusted:true,version:'157.0.8103.39'}));
    await expect(installBrandedEngine(root,{download:await fakeDownload(1024),sevenZip:'7za',run:fakeExtractor(),verify})).rejects.toThrow('ENGINE_DOWNLOAD_FAILED');
  }finally{cleanup(root);}
},30000);

it('prefers the downloaded branded engine over a linked one and over Chrome for Testing',async()=>{
  const root=tempRoot();
  try{
    await mkdir(join(root,'branded','157.0.8103.39','Chrome-bin'),{recursive:true});
    await writeFile(join(root,'branded','157.0.8103.39','Chrome-bin','chrome.exe'),'MZ branded');
    const {createHash}=await import('node:crypto');
    const hash=createHash('sha256').update('MZ branded').digest('hex');
    await writeFile(join(root,'branded.json'),JSON.stringify({version:'157.0.8103.39',executable:join(root,'branded','157.0.8103.39','Chrome-bin','chrome.exe'),sha256:hash}));
    const installer=new EngineInstaller(root,async()=>{});
    expect(await installer.resolveExecutable()).toBe(join(root,'branded','157.0.8103.39','Chrome-bin','chrome.exe'));
    const status=await installer.status();
    expect(status).toEqual({state:'ready',version:'157.0.8103.39',source:'branded'});
  }finally{cleanup(root);}
},30000);

it('ignores a branded record whose binary was replaced',async()=>{
  const root=tempRoot();
  try{
    await mkdir(join(root,'branded','157.0.8103.39','Chrome-bin'),{recursive:true});
    await writeFile(join(root,'branded','157.0.8103.39','Chrome-bin','chrome.exe'),'MZ tampered');
    await writeFile(join(root,'branded.json'),JSON.stringify({version:'157.0.8103.39',executable:join(root,'branded','157.0.8103.39','Chrome-bin','chrome.exe'),sha256:'0'.repeat(64)}));
    const installer=new EngineInstaller(root,async()=>{});
    expect(await installer.resolveExecutable()).toBe(installer.packagedExecutable);
    expect((await installer.status()).state).toBe('missing');
  }finally{cleanup(root);}
},30000);
