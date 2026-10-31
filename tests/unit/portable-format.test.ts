import {it,expect,vi} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import yazl from 'yazl';
import {DEFAULT_FINGERPRINT} from '../../src/shared/fingerprint';
import {portableManifestSchema,portableCookiesSchema} from '../../src/shared/portable';
import {extractPortableArchive,isPortableDataPath} from '../../src/main/portable/archive';
import {readPortableCookies,writePortableCookies} from '../../src/main/portable/cookies';

const manifest={format:'exodus-portable',version:1,profile:{name:'Work',note:'',startUrls:['about:blank'],languages:['en-US'],fingerprint:DEFAULT_FINGERPRINT,fingerprintSeed:42,restoreLastSession:false,proxy:null},session:null};
const cookie={name:'sid',value:'secret',domain:'example.com',path:'/',expires:null,session:true,httpOnly:true,secure:true,sameSite:'Lax',priority:'Medium',sourceScheme:'Secure',sourcePort:443};

async function archive(entries:Array<{name:string;data?:string;mode?:number}>,limits?:Record<string,number>){
 const root=await mkdtemp(join(tmpdir(),'portable-archive-'));const source=join(root,'input.zip'),destination=join(root,'out');
 const zip=new yazl.ZipFile();for(const entry of entries){if(entry.name.endsWith('/'))zip.addEmptyDirectory(entry.name.slice(0,-1));else zip.addBuffer(Buffer.from(entry.data??''),entry.name,entry.mode===undefined?{}:{mode:entry.mode});}
 await new Promise<void>((resolve,reject)=>{zip.outputStream.pipe(createWriteStream(source)).on('finish',resolve).on('error',reject);zip.end();});
 try{return {root,destination,source,result:await extractPortableArchive(source,destination,limits)};}catch(error){await rm(root,{recursive:true,force:true});throw error;}
}

it('accepts only the strict portable manifest and cookie fields',()=>{
 expect(portableManifestSchema.parse(manifest)).toEqual(manifest);
 expect(portableCookiesSchema.parse([cookie])).toEqual([cookie]);
 expect(portableManifestSchema.safeParse({...manifest,format:'other'}).success).toBe(false);
 expect(portableManifestSchema.safeParse({...manifest,version:2}).success).toBe(false);
 expect(portableManifestSchema.safeParse({...manifest,uuid:'secret'}).success).toBe(false);
 expect(portableManifestSchema.safeParse({...manifest,profile:{...manifest.profile,proxy:{name:'P',kind:'http',host:'proxy.test',port:80,password:'secret'}}}).success).toBe(false);
 expect(portableCookiesSchema.safeParse([{...cookie,extra:'unvalidated'}]).success).toBe(false);
});

it('extracts the exact portable layout and excludes native browser state',async()=>{
 const result=await archive([{name:'manifest.json',data:JSON.stringify(manifest)},{name:'cookies.json',data:JSON.stringify([cookie])},{name:'data/',data:''},{name:'data/Default/Preferences',data:'{}'}]);
 try{
  expect(result.result.manifest).toEqual(manifest);expect(result.result.cookies).toEqual([cookie]);
  expect(await readFile(join(result.destination,'data/Default/Preferences'),'utf8')).toBe('{}');
 }finally{await rm(result.root,{recursive:true,force:true});}
 expect(isPortableDataPath('data/Default/Preferences')).toBe(true);
 for(const path of ['data/Local State','data/Default/Cookies','data/Default/Cookies-journal','data/Default/Cookies-wal','data/Default/Network/Cookies-shm','data/SingletonLock','data/SingletonCookie','data/SingletonSocket','data/DevToolsActivePort','data/LOCK','data/Default/Preferences.lock','data/Default/chrome_debug.log','data/Default/Current Session','data/Default/Last Tabs','data/Default/Sessions/Session_1','data/Default/Session Storage/000001.log'])expect(isPortableDataPath(path),path).toBe(false);
 expect(isPortableDataPath('data/default/cookies')).toBe(false);
});

it.each([
 ['wrong layout',[{name:'manifest.json',data:JSON.stringify(manifest)},{name:'cookies.json',data:'[]'},{name:'data/',data:''},{name:'payload/file'}]],
 ['path traversal',[{name:'manifest.json',data:JSON.stringify(manifest)},{name:'cookies.json',data:'[]'},{name:'data/',data:''},{name:'data/../escape'}]],
 ['case-insensitive duplicate',[{name:'manifest.json',data:JSON.stringify(manifest)},{name:'MANIFEST.JSON',data:JSON.stringify(manifest)},{name:'cookies.json',data:'[]'},{name:'data/',data:''}]],
 ['symlink entry',[{name:'manifest.json',data:JSON.stringify(manifest)},{name:'cookies.json',data:'[]'},{name:'data/',data:''},{name:'data/link',data:'target',mode:0o120777}]],
])('rejects %s',async(_label,entries)=>{
 await expect(archive(entries as Array<{name:string;data?:string;mode?:number}>)).rejects.toThrow();
});

it('enforces manifest, cookie, entry-count, and expanded-byte limits before accepting data',async()=>{
 const good=[{name:'manifest.json',data:JSON.stringify(manifest)},{name:'cookies.json',data:JSON.stringify([cookie])},{name:'data/',data:''}];
 await expect(archive(good,{manifestBytes:8})).rejects.toThrow();
 await expect(archive(good,{cookieBytes:8})).rejects.toThrow();
 await expect(archive(good,{entries:1})).rejects.toThrow();
 await expect(archive([...good,{name:'data/file',data:'large'}],{expandedBytes:12})).rejects.toThrow();
 await expect(archive([{name:'manifest.json',data:JSON.stringify(manifest)},{name:'cookies.json',data:JSON.stringify([cookie,cookie])}],{cookieCount:1})).rejects.toThrow();
});

it('roundtrips host-only, domain, session and partitioned cookie fields through explicit CDP mappings',async()=>{
 const raw=[{name:'host',value:'a',domain:'example.com',path:'/',expires:-1,session:true,httpOnly:true,secure:true,sameSite:'Lax',priority:'High',sourceScheme:'Secure',sourcePort:443},{name:'domain',value:'b',domain:'.example.com',path:'/x',expires:1900000000,session:false,httpOnly:false,secure:false,sameSite:'Unspecified',priority:'Low',sourceScheme:'NonSecure',sourcePort:80,partitionKey:{topLevelSite:'https://top.example',hasCrossSiteAncestor:false}}];
 const send=vi.fn(async(method:string,_params:Record<string,unknown>={})=>method==='Storage.getCookies'?{cookies:raw}:{});const client={send};
 const cookies=await readPortableCookies(client);
 expect(cookies.map(item=>[item.domain,item.expires,item.session])).toEqual([['example.com',null,true],['.example.com',1900000000,false]]);
 expect(cookies[1].partitionKey).toEqual(raw[1].partitionKey);
 await writePortableCookies(client,cookies);
 const [method,params]=send.mock.calls.at(-1)!;
 expect(method).toBe('Storage.setCookies');
 expect(params).toMatchObject({cookies:[{domain:'example.com',name:'host'},{domain:'.example.com',name:'domain',partitionKey:raw[1].partitionKey}]});
 expect(Object.hasOwn((params as Record<string,unknown> as {cookies:Array<Record<string,unknown>>}).cookies[0],'expires')).toBe(false);
});

it('rejects opaque partitioned cookie information instead of silently losing it',async()=>{
 const client={send:async()=>({cookies:[{name:'opaque',value:'x',domain:'example.com',path:'/',expires:-1,session:true,httpOnly:false,secure:true,sameSite:'None',priority:'Medium',sourceScheme:'Secure',sourcePort:443,partitionKeyOpaque:true}]})};
 await expect(readPortableCookies(client)).rejects.toThrow('PORTABLE_COOKIE_PARTITION_UNSUPPORTED');
});
