import {it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdir,writeFile,readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {canActivateEngine,engineCompatibility,assertEngineReplaceable,SUPPORTED_CHROME_MAJORS} from '../../src/main/engines/compat';
import {EngineInstaller} from '../../src/main/engines/installation';
import {installBrandedEngine,removeOtherBrandedVersions} from '../../src/main/engines/branded';
import {tempRoot,cleanup} from '../fixtures/profiles';

const {min,max}=SUPPORTED_CHROME_MAJORS;

it('classifies an engine version against the range this release was tested with',()=>{
  expect(engineCompatibility(`${min}.0.1.2`)).toBe('supported');
  expect(engineCompatibility(`${max}.0.9.9`)).toBe('supported');
  expect(engineCompatibility(`${min-1}.0.1.2`)).toBe('older');
  expect(engineCompatibility(`${max+1}.0.1.2`)).toBe('newer');
});

it.each([undefined,'','linked Chromium','157','abc.1.2.3','0157.0.0.0','157.0.0'])('treats %j as unknown rather than guessing',version=>{
  expect(engineCompatibility(version as string|undefined)).toBe('unknown');
});

async function installedEngine(root:string,version:string){
  const dir=join(root,'branded',version,'Chrome-bin');await mkdir(dir,{recursive:true});
  const executable=join(dir,'chrome.exe');await writeFile(executable,'MZ fake chrome '+version);
  const sha256=createHash('sha256').update(await readFile(executable)).digest('hex');
  await writeFile(join(root,'branded.json'),JSON.stringify({version,executable,sha256}));
  return executable;
}

it('reports compatibility and the supported range in the engine status',async()=>{
  const root=tempRoot();
  try{
    const installer=new EngineInstaller(root,async()=>undefined);
    await installedEngine(root,`${min-1}.0.1.1`);
    expect(await installer.status()).toMatchObject({state:'ready',source:'branded',version:`${min-1}.0.1.1`,compatibility:'older',supportedMajors:{min,max}});
    await installedEngine(root,`${max}.0.1.1`);
    expect(await installer.status()).toMatchObject({compatibility:'supported'});
  }finally{cleanup(root);}
});

it('keeps the working engine when the replacement is not trusted',async()=>{
  const root=tempRoot();
  try{
    const executable=await installedEngine(root,`${min-1}.0.1.1`);
    const before=await readFile(join(root,'branded.json'),'utf8');
    const run=async(_exe:string,args:string[])=>{
      const out=args.find(a=>a.startsWith('-o'))!.slice(2);const archive=args[1];
      if(archive.endsWith('.msi'))await writeFile(join(out,'Binary.GoogleChromeInstaller'),'x');
      else if(archive.endsWith('Binary.GoogleChromeInstaller'))await writeFile(join(out,'updater.7z'),'x');
      else if(archive.endsWith('updater.7z'))await writeFile(join(out,`${max}.0.0.1_chrome_installer.exe`),'x');
      else if(archive.endsWith('_chrome_installer.exe'))await writeFile(join(out,'chrome.7z'),'x');
      else{await mkdir(join(out,'Chrome-bin'),{recursive:true});await writeFile(join(out,'Chrome-bin','chrome.exe'),'MZ new');}
    };
    const download=async(_url:string,destination:string)=>{await writeFile(destination,Buffer.alloc(60*1024**2));};
    await expect(installBrandedEngine(root,{download,sevenZip:'7za',run,verify:vi.fn(async()=>({trusted:false,version:null}))})).rejects.toThrow('ENGINE_UNTRUSTED');
    expect(await readFile(join(root,'branded.json'),'utf8')).toBe(before);
    expect((await readdir(join(root,'branded')))).toEqual([`${min-1}.0.1.1`]);
    expect(await readFile(executable,'utf8')).toContain('fake chrome');
  }finally{cleanup(root);}
});

it('removes only the superseded engine versions after an update is active',async()=>{
  const root=tempRoot();
  try{
    await installedEngine(root,'156.0.1.1');await installedEngine(root,'157.0.2.2');
    await mkdir(join(root,'branded','not-a-version'),{recursive:true});
    await removeOtherBrandedVersions(root,'157.0.2.2');
    expect((await readdir(join(root,'branded'))).sort()).toEqual(['157.0.2.2','not-a-version']);
    // Nothing to remove, or a missing directory, is not an error.
    await removeOtherBrandedVersions(root,'157.0.2.2');
    await expect(removeOtherBrandedVersions(join(root,'nowhere'),'1.2.3.4')).resolves.toBeUndefined();
  }finally{cleanup(root);}
});

it('refuses to replace a working engine while profiles or maintenance are active, but never blocks the first install',()=>{
  expect(()=>assertEngineReplaceable('ready',true)).toThrow('ENGINE_UPDATE_BUSY');
  expect(()=>assertEngineReplaceable('ready',false)).not.toThrow();
  expect(()=>assertEngineReplaceable('missing',true)).not.toThrow();
  expect(()=>assertEngineReplaceable('unsupported',true)).not.toThrow();
});

it('replaces a working engine only with a tested version',()=>{
  const supported={state:'ready' as const,source:'branded' as const,compatibility:'supported' as const};
  expect(canActivateEngine(supported,`${max}.0.1.1`)).toBe(true);
  expect(canActivateEngine(supported,`${max+1}.0.1.1`)).toBe(false);
  expect(canActivateEngine({...supported,compatibility:'newer'},`${max+2}.0.1.1`)).toBe(false);
  // Nothing installed, a linked browser, or an engine already below the tested range: any version is better than none.
  expect(canActivateEngine({state:'missing'},`${max+1}.0.1.1`)).toBe(true);
  expect(canActivateEngine({state:'ready',source:'external'},`${max+1}.0.1.1`)).toBe(true);
  expect(canActivateEngine({...supported,compatibility:'older'},`${max+1}.0.1.1`)).toBe(true);
});

it('remembers the newest version known when the engine was installed',async()=>{
  const root=tempRoot();
  try{
    const exe=join(root,'branded','157.0.8103.51','Chrome-bin','chrome.exe');
    await mkdir(join(root,'branded','157.0.8103.51','Chrome-bin'),{recursive:true});await writeFile(exe,'fake chrome');
    const sha256=createHash('sha256').update('fake chrome').digest('hex');
    const installer=new EngineInstaller(root,async()=>{});
    await writeFile(join(root,'branded.json'),JSON.stringify({version:'157.0.8103.51',executable:exe,sha256}));
    expect(await installer.offeredAtInstall()).toBeNull();
    await writeFile(join(root,'branded.json'),JSON.stringify({version:'157.0.8103.51',executable:exe,sha256,latestSeen:'157.0.8103.79'}));
    expect(await installer.offeredAtInstall()).toBe('157.0.8103.79');
    expect((await installer.status()).version).toBe('157.0.8103.51');
  }finally{cleanup(root);}
});
