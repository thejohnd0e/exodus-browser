import {it,expect} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {recoverBuildVersion,resolveBuildInfo,withBuildVersion} from '../../scripts/build-version.mjs';

it('uses the package version for release builds and the counter otherwise',()=>{
  const counterInfo={version:'0.1.78',buildNumber:78};
  expect(resolveBuildInfo({counterInfo,packageVersion:'1.1.78',release:true})).toEqual({version:'1.1.78',buildNumber:78});
  expect(resolveBuildInfo({counterInfo,packageVersion:'1.1.78',release:false})).toEqual(counterInfo);
});

it('rejects a release version that is not MAJOR.MINOR.PATCH',()=>{
  const counterInfo={version:'0.1.78',buildNumber:78};
  expect(()=>resolveBuildInfo({counterInfo,packageVersion:'1.1',release:true})).toThrow('BUILD_VERSION_INVALID');
  expect(()=>resolveBuildInfo({counterInfo,packageVersion:'v1.1.78',release:true})).toThrow('BUILD_VERSION_INVALID');
});

async function buildRoot(){
  const root=await mkdtemp(join(tmpdir(),'exodus-version-'));
  await writeFile(join(root,'build-version-floor.json'),'{"buildNumber":0}');
  return root;
}

it('increments every reservation and never resets when build output is removed',async()=>{
  const root=await buildRoot();
  try{
    expect(await withBuildVersion({root,run:async()=>{}})).toMatchObject({version:'0.1.1',buildNumber:1});
    await rm(join(root,'dist'),{recursive:true,force:true});
    expect(await withBuildVersion({root,run:async()=>{}})).toMatchObject({version:'0.1.2',buildNumber:2});
  }finally{await rm(root,{recursive:true,force:true});}
});

it('rejects corrupt state rather than silently reusing a version',async()=>{
  const root=await buildRoot();
  try{
    await withBuildVersion({root,run:async()=>{}});
    await writeFile(join(root,'.local','build-version.json'),'{broken');
    await expect(withBuildVersion({root,run:async()=>{}})).rejects.toThrow('BUILD_VERSION_STATE_INVALID');
  }finally{await rm(root,{recursive:true,force:true});}
});

it('consumes the version when a build callback fails',async()=>{
  const root=await buildRoot();
  try{
    await expect(withBuildVersion({root,run:async()=>{throw Error('BUILD_FAILED');}})).rejects.toThrow('BUILD_FAILED');
    expect(await withBuildVersion({root,run:async()=>{}})).toMatchObject({version:'0.1.2',buildNumber:2});
  }finally{await rm(root,{recursive:true,force:true});}
});

it('rejects another build while the first build owns the output lock',async()=>{
  const root=await buildRoot();
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  let acquired!:()=>void;
  const ready=new Promise<void>(resolve=>{acquired=resolve;});
  try{
    const first=withBuildVersion({root,run:async()=>{acquired();await gate;}});
    await ready;
    await expect(withBuildVersion({root,run:async()=>{}})).rejects.toThrow('BUILD_ALREADY_RUNNING');
    release();
    await expect(first).resolves.toMatchObject({version:'0.1.1'});
    await expect(withBuildVersion({root,run:async()=>{}})).resolves.toMatchObject({version:'0.1.2'});
  }finally{release();await rm(root,{recursive:true,force:true});}
});

it('requires explicit recovery when initialized version state disappears',async()=>{
  const root=await buildRoot();
  try{
    await withBuildVersion({root,run:async()=>{}});
    await rm(join(root,'.local','build-version.json'));
    await expect(withBuildVersion({root,run:async()=>{}})).rejects.toThrow('BUILD_VERSION_STATE_MISSING');
  }finally{await rm(root,{recursive:true,force:true});}
});

it('requires confirmation and an idle build lock before reseeding lost state',async()=>{
  const root=await buildRoot();
  try{
    await withBuildVersion({root,run:async()=>{}});
    await rm(join(root,'.local','build-version.json'));
    await expect(recoverBuildVersion({root,buildNumber:10,confirm:async()=>false})).rejects.toThrow('BUILD_VERSION_RECOVERY_CANCELLED');
    await expect(withBuildVersion({root,run:async()=>{}})).rejects.toThrow('BUILD_VERSION_STATE_MISSING');
    await expect(recoverBuildVersion({root,buildNumber:10,confirm:async()=>true})).resolves.toBeUndefined();
    await expect(withBuildVersion({root,run:async()=>{}})).resolves.toMatchObject({version:'0.1.11'});
  }finally{await rm(root,{recursive:true,force:true});}
});
