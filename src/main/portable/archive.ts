import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {extractArchive,validateEntryPath} from '../backups/archive';
import {portableCookiesSchema,portableManifestSchema,type PortableCookie,type PortableManifest} from '../../shared/portable';

const MAX_MANIFEST_BYTES=1024*1024;
const MAX_COOKIE_BYTES=5*1024*1024;
const MAX_ENTRIES=100000;
const MAX_EXPANDED_BYTES=20*1024**3;
export type PortableArchiveLimits={entries:number;expandedBytes:number;manifestBytes:number;cookieBytes:number;cookieCount:number};
const defaults:PortableArchiveLimits={entries:MAX_ENTRIES,expandedBytes:MAX_EXPANDED_BYTES,manifestBytes:MAX_MANIFEST_BYTES,cookieBytes:MAX_COOKIE_BYTES,cookieCount:20000};
type Extracted={manifest:PortableManifest;cookies:PortableCookie[];dataDirectory:string};

export function isPortableDataPath(path:string):boolean{
 try{validateEntryPath(path);}catch{return false;}
 const normalized=path.replace(/\\/g,'/').replace(/\/$/,'').toLowerCase();
 if(!normalized.startsWith('data/'))return false;
 const relative=normalized.slice(5);const parts=relative.split('/');const base=parts.at(-1)??'';
 if(relative==='local state'||/^(?:singletonlock|singletoncookie|singletonsock(?:et)?|devtoolsactiveport|lock|chrome_debug\.log(?:\.old)?)$/.test(base)||/^.+\.lock$/.test(base))return false;
 if(/^cookies(?:-(?:journal|wal|shm))?$/.test(base))return false;
 if(parts.some(part=>part==='sessions'||part==='session storage'))return false;
 if(['current session','last session','current tabs','last tabs'].includes(base))return false;
 return true;
}

function layoutEntry(name:string,isDirectory:boolean,seen:Set<string>){
 const canonical=name.replace(/\/$/,'');
 const lower=canonical.toLowerCase();
 if((canonical==='manifest.json'||canonical==='cookies.json')&&!isDirectory){seen.add(lower);return;}
 if(canonical==='data'&&isDirectory){seen.add('data/');return;}
 if(canonical.startsWith('data/')&&isPortableDataPath(name)){seen.add(lower);return;}
 throw Error('PORTABLE_ARCHIVE_LAYOUT');
}

export async function extractPortableArchive(source:string,destination:string,overrides:Partial<PortableArchiveLimits>={}):Promise<Extracted>{
 const limits={...defaults,...overrides};const seen=new Set<string>();
 await extractArchive(source,destination,{entries:limits.entries,bytes:limits.expandedBytes,fileBytes:name=>name==='manifest.json'?limits.manifestBytes:name==='cookies.json'?limits.cookieBytes:undefined,onEntry:(name,isDirectory)=>layoutEntry(name,isDirectory,seen)});
 if(!seen.has('manifest.json')||!seen.has('cookies.json')||!seen.has('data/'))throw Error('PORTABLE_ARCHIVE_LAYOUT');
 const manifestPath=join(destination,'manifest.json');const cookiesPath=join(destination,'cookies.json');
 const [manifestInfo,cookiesInfo]=await Promise.all([stat(manifestPath),stat(cookiesPath)]);
 if(!manifestInfo.isFile()||!cookiesInfo.isFile()||manifestInfo.size>limits.manifestBytes||cookiesInfo.size>limits.cookieBytes)throw Error('PORTABLE_ARCHIVE_SIZE_LIMIT');
 try{
  const [manifestText,cookiesText]=await Promise.all([readFile(manifestPath,'utf8'),readFile(cookiesPath,'utf8')]);
  const manifest=portableManifestSchema.parse(JSON.parse(manifestText));const rawCookies=JSON.parse(cookiesText);
  if(!Array.isArray(rawCookies)||rawCookies.length>limits.cookieCount)throw Error('PORTABLE_COOKIE_LIMIT');
  const cookies=portableCookiesSchema.parse(rawCookies);
  return {manifest,cookies,dataDirectory:join(destination,'data')};
 }catch(error){if(error instanceof Error&&error.message==='PORTABLE_COOKIE_LIMIT')throw error;throw Error('PORTABLE_ARCHIVE_INVALID');}
}
