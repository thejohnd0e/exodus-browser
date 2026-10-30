import yauzl from 'yauzl';
import {mkdir,open} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {dirname,join} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
export function validateEntryPath(name:string){
  const p=name.endsWith('/')?name.slice(0,-1):name;
  if(!p||p.includes('\\')||p.includes(':')||/[\x00-\x1f]/.test(p)||p.split('/').some(s=>!s||s==='.'||s==='..'||/[. ]$/.test(s)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(s)))throw Error('UNSAFE_ARCHIVE_PATH');
  return name;
}
export async function extractArchive(source:string,destination:string,limits={entries:100000,bytes:20*1024**3}){
  const zip=await new Promise<yauzl.ZipFile>((resolve,reject)=>yauzl.open(source,{lazyEntries:true,validateEntrySizes:true},(e,z)=>e?reject(e):resolve(z!)));
  let count=0,total=0;const seen=new Set<string>();
  await new Promise<void>((resolve,reject)=>{
    let failed=false;
    const fail=(e:unknown)=>{if(!failed){failed=true;zip.close();reject(e);}};
    zip.on('error',fail);zip.on('end',()=>resolve());
    zip.on('entry',(entry:yauzl.Entry)=>{void(async()=>{
      const name=validateEntryPath(entry.fileName);const key=name.replace(/\/$/,'').toLowerCase();
      if(++count>limits.entries||seen.has(key))throw Error('ARCHIVE_LIMIT_OR_DUPLICATE');seen.add(key);
      const mode=(entry.externalFileAttributes>>>16)&0xf000;
      if(mode!==0&&mode!==0x8000&&mode!==0x4000)throw Error('ARCHIVE_LINK_OR_SPECIAL');
      if(entry.generalPurposeBitFlag&1)throw Error('ARCHIVE_ENCRYPTED');
      const target=join(destination,name);
      if(name.endsWith('/'))await mkdir(target,{recursive:true});
      else{
        if(total+entry.uncompressedSize>limits.bytes)throw Error('ARCHIVE_TOO_LARGE');
        await mkdir(dirname(target),{recursive:true});
        const input=await new Promise<NodeJS.ReadableStream>((res,rej)=>zip.openReadStream(entry,(e,s)=>e?rej(e):res(s!)));
        const meter=new Transform({transform(chunk,_encoding,cb){total+=chunk.length;cb(total>limits.bytes?Error('ARCHIVE_TOO_LARGE'):null,chunk);}});
        await pipeline(input,meter,createWriteStream(target,{flags:'wx'}));
      }
      if(!failed)zip.readEntry();
    })().catch(fail);});
    zip.readEntry();
  });
}
