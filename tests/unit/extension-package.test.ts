import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,createWriteStream,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {ZipFile} from 'yazl';
import {validateManifest,inspectFolder,inspectZip} from '../../src/main/extensions/package';

const manifest=(overrides:Record<string,unknown>={})=>JSON.stringify({manifest_version:3,name:'Fixture',version:'1.0.0',...overrides});
const tempRoot=()=>mkdtempSync(join(tmpdir(),'ext-package-'));

async function zipOf(file:string,entries:Array<[string,string]>){
  const zip=new ZipFile();for(const [name,text] of entries)zip.addBuffer(Buffer.from(text),name);
  const done=pipeline(zip.outputStream,createWriteStream(file));zip.end();await done;return file;
}

it('accepts a Manifest V3 extension and returns its name and version',()=>{
  expect(validateManifest(manifest())).toEqual({name:'Fixture',version:'1.0.0'});
});

it('rejects Manifest V2 and manifests without a version',()=>{
  expect(()=>validateManifest(manifest({manifest_version:2}))).toThrow('EXTENSION_INVALID_MANIFEST');
  expect(()=>validateManifest(JSON.stringify({manifest_version:3,name:'NoVersion'}))).toThrow('EXTENSION_INVALID_MANIFEST');
  expect(()=>validateManifest('{broken')).toThrow('EXTENSION_INVALID_MANIFEST');
});

it('inspects a folder that contains a valid manifest and rejects a folder without one',async()=>{
  const root=tempRoot();try{
    writeFileSync(join(root,'manifest.json'),manifest());
    await expect(inspectFolder(root)).resolves.toEqual({name:'Fixture',version:'1.0.0'});
    const empty=join(root,'empty');mkdirSync(empty);
    await expect(inspectFolder(empty)).rejects.toThrow('EXTENSION_INVALID_MANIFEST');
  }finally{rmSync(root,{recursive:true,force:true});}
});

it('rejects an archive with an unsafe entry name',async()=>{
  const root=tempRoot();try{
    const file=await zipOf(join(root,'evil.zip'),[['manifest.json',manifest()],['payload.js:stream','x']]);
    await expect(inspectZip(file,join(root,'staging'))).rejects.toThrow('EXTENSION_UNSAFE_PACKAGE');
  }finally{rmSync(root,{recursive:true,force:true});}
});

it('rejects an archive with a nested manifest.json in addition to the root manifest',async()=>{
  const root=tempRoot();try{
    const file=await zipOf(join(root,'nested.zip'),[['manifest.json',manifest()],['inner/manifest.json',manifest({name:'Other'})]]);
    await expect(inspectZip(file,join(root,'staging'))).rejects.toThrow('EXTENSION_UNSAFE_PACKAGE');
  }finally{rmSync(root,{recursive:true,force:true});}
});

it('extracts a valid archive into staging and returns its summary',async()=>{
  const root=tempRoot();try{
    const file=await zipOf(join(root,'valid.zip'),[['manifest.json',manifest()],['background.js','console.log(1)']]);
    const staging=join(root,'staging');
    await expect(inspectZip(file,staging)).resolves.toEqual({name:'Fixture',version:'1.0.0'});
    expect(existsSync(join(staging,'background.js'))).toBe(true);
  }finally{rmSync(root,{recursive:true,force:true});}
});
