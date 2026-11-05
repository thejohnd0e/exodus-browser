import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

const STORE_HOSTS=new Set(['chromewebstore.google.com','chrome.google.com']);
const STORE_PREFIXES:Record<string,string>={
  'chromewebstore.google.com':'/detail/',
  'chrome.google.com':'/webstore/detail/',
};
const EXTENSION_ID=/^[a-p]{32}$/;
const MAX_HEADER_BYTES=1024*1024;

export function parseStoreLink(input:string):{id:string}{
  let url:URL;
  try{url=new URL(input.trim());}catch{throw Error('EXTENSION_INVALID_LINK');}
  if(url.protocol!=='https:'||url.username||url.password||!STORE_HOSTS.has(url.hostname))throw Error('EXTENSION_INVALID_LINK');
  const prefix=STORE_PREFIXES[url.hostname];
  if(!url.pathname.startsWith(prefix))throw Error('EXTENSION_INVALID_LINK');
  const segments=url.pathname.slice(prefix.length).split('/').filter(Boolean);
  if(segments.length!==2)throw Error('EXTENSION_INVALID_LINK');
  const id=segments[1];
  if(!EXTENSION_ID.test(id))throw Error('EXTENSION_INVALID_LINK');
  return {id};
}

export function storeDownloadUrl(id:string,engineVersion:string):string{
  const url=new URL('https://clients2.google.com/service/update2/crx');
  url.searchParams.set('response','redirect');
  url.searchParams.set('prodversion',engineVersion);
  url.searchParams.set('acceptformat','crx2,crx3');
  url.searchParams.set('x',`id=${id}&uc`);
  return url.toString();
}

export function readCrxZip(payload:Buffer):Buffer{
  if(payload.length<12||payload.subarray(0,4).toString('latin1')!=='Cr24')throw Error('EXTENSION_INVALID_PACKAGE');
  if(payload.readUInt32LE(4)!==3)throw Error('EXTENSION_INVALID_PACKAGE');
  const headerBytes=payload.readUInt32LE(8);
  if(headerBytes>MAX_HEADER_BYTES||12+headerBytes>=payload.length)throw Error('EXTENSION_INVALID_PACKAGE');
  return payload.subarray(12+headerBytes);
}

export async function resolveExtensionName(name:string,directory:string):Promise<string>{
  const match=/^__MSG_(\w+)__$/.exec(name);
  if(!match)return name;
  let locale='en';
  try{const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8')) as {default_locale?:unknown};if(typeof manifest.default_locale==='string')locale=manifest.default_locale;}catch{/* keep English */}
  try{
    const messages=JSON.parse(await readFile(join(directory,'_locales',locale,'messages.json'),'utf8')) as Record<string,{message?:unknown}>;
    const value=messages[match[1]]?.message;
    return typeof value==='string'&&value.trim()?value:name;
  }catch{return name;}
}
