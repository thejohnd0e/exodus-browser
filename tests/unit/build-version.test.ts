import {it,expect} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withBuildVersion} from '../../scripts/build-version.mjs';

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
  try{
    const first=withBuildVersion({root,run:async()=>gate});
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
