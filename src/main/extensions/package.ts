import {lstat,readFile,readdir,mkdir} from 'node:fs/promises';
import {basename,join} from 'node:path';
import {z} from 'zod';
import {extractArchive} from '../backups/archive';
import type {ExtensionSummary} from '../../shared/extension';

const manifestSchema=z.object({
  manifest_version: z.literal(3),
  name: z.string().trim().min(1).max(75),
  version: z.string().trim().min(1).max(32),
});

export function validateManifest(text:string):ExtensionSummary{
  let parsed:unknown;
  try{parsed=JSON.parse(text);}catch{throw Error('EXTENSION_INVALID_MANIFEST');}
  const result=manifestSchema.safeParse(parsed);
  if(!result.success)throw Error('EXTENSION_INVALID_MANIFEST');
  return {name:result.data.name,version:result.data.version};
}

export async function assertNoLinks(directory:string):Promise<void>{
  for(const entry of await readdir(directory,{withFileTypes:true})){
    if(entry.isSymbolicLink())throw Error('EXTENSION_UNSAFE_PACKAGE');
    if(entry.isDirectory())await assertNoLinks(join(directory,entry.name));
  }
}

export async function inspectFolder(directory:string):Promise<ExtensionSummary>{
  const file=join(directory,'manifest.json');
  const info=await lstat(file).catch(()=>null);
  if(!info||!info.isFile())throw Error('EXTENSION_INVALID_MANIFEST');
  return validateManifest(await readFile(file,'utf8'));
}

export async function inspectZip(file:string,staging:string):Promise<ExtensionSummary>{
  await mkdir(staging,{recursive:true});
  const names:string[]=[];
  try{await extractArchive(file,staging,{entries:10000,bytes:200*1024**2,onEntry:name=>names.push(name)});}
  catch{throw Error('EXTENSION_UNSAFE_PACKAGE');}
  const manifests=names.filter(name=>basename(name)==='manifest.json');
  if(manifests.length!==1||manifests[0]!=='manifest.json')throw Error('EXTENSION_UNSAFE_PACKAGE');
  return inspectFolder(staging);
}
