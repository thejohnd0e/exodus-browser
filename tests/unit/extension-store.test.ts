import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseStoreLink,storeDownloadUrl,readCrxZip,resolveExtensionName} from '../../src/main/extensions/store';

const id='lieogkinebikhdchceieedcigeafdkid';
const crx=(zip:Buffer,header=Buffer.from('header'))=>{
  const prefix=Buffer.alloc(12);prefix.write('Cr24',0,'latin1');prefix.writeUInt32LE(3,4);prefix.writeUInt32LE(header.length,8);
  return Buffer.concat([prefix,header,zip]);
};

it('accepts links from both store hosts and ignores tracking parameters',()=>{
  expect(parseStoreLink(`https://chromewebstore.google.com/detail/eagle-for-chrome/${id}?pli=1`)).toEqual({id});
  expect(parseStoreLink(`https://chrome.google.com/webstore/detail/eagle-for-chrome/${id}#reviews`)).toEqual({id});
});

it('rejects lookalike hosts, credentials, plain HTTP and malformed identifiers',()=>{
  for(const link of [
    `https://chromewebstore.google.com.evil.example/detail/eagle/${id}`,
    `https://user@chromewebstore.google.com/detail/eagle/${id}`,
    `http://chromewebstore.google.com/detail/eagle/${id}`,
    `https://chromewebstore.google.com/detail/eagle/${id.toUpperCase()}`,
    `https://chromewebstore.google.com/detail/eagle/${id.slice(0,31)}`,
    `https://chromewebstore.google.com/detail/eagle/${'q'.repeat(32)}`,
    'https://chromewebstore.google.com/detail/eagle',
    'not a link',
  ]) expect(()=>parseStoreLink(link)).toThrow('EXTENSION_INVALID_LINK');
});

it('builds the official download URL for the running engine version',()=>{
  const url=new URL(storeDownloadUrl(id,'156.0.8078.80'));
  expect(url.protocol).toBe('https:');expect(url.hostname).toBe('clients2.google.com');
  expect(url.searchParams.get('x')).toBe(`id=${id}&uc`);
  expect(url.searchParams.get('prodversion')).toBe('156.0.8078.80');
});

it('strips a CRX3 header and rejects payloads that are not CRX3',()=>{
  const zip=Buffer.from('PK\u0003\u0004zip-body','latin1');
  expect(readCrxZip(crx(zip)).equals(zip)).toBe(true);
  expect(()=>readCrxZip(zip)).toThrow('EXTENSION_INVALID_PACKAGE');
  expect(()=>readCrxZip(Buffer.concat([Buffer.from('Cr24','latin1')]))).toThrow('EXTENSION_INVALID_PACKAGE');
  const wrongVersion=crx(zip);wrongVersion.writeUInt32LE(2,4);
  expect(()=>readCrxZip(wrongVersion)).toThrow('EXTENSION_INVALID_PACKAGE');
  const absurd=crx(zip);absurd.writeUInt32LE(5*1024*1024,8);
  expect(()=>readCrxZip(absurd)).toThrow('EXTENSION_INVALID_PACKAGE');
});

it('resolves a localized manifest name from the package locales',async()=>{
  const root=mkdtempSync(join(tmpdir(),'ext-name-'));
  try{
    mkdirSync(join(root,'_locales','en'),{recursive:true});
    writeFileSync(join(root,'_locales','en','messages.json'),JSON.stringify({appName:{message:'Eagle for Chrome'}}));
    await expect(resolveExtensionName('__MSG_appName__',root)).resolves.toBe('Eagle for Chrome');
    await expect(resolveExtensionName('Plain name',root)).resolves.toBe('Plain name');
    await expect(resolveExtensionName('__MSG_missing__',root)).resolves.toBe('__MSG_missing__');
  }finally{rmSync(root,{recursive:true,force:true});}
});
