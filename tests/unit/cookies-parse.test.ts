import {it,expect} from 'vitest';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {detectCookieFormat,readCookieFile,parseJsonCookies} from '../../src/main/cookies/parse';
import {tempRoot,cleanup} from '../fixtures/profiles';
const now=1_800_000_000;
it('detects JSON from the first non-whitespace character',()=>{
  expect(detectCookieFormat('  [{"name":"a"}]')).toBe('json');
  expect(detectCookieFormat('{"cookies":[]}')).toBe('json');
  expect(detectCookieFormat('# Netscape HTTP Cookie File')).toBe('netscape');
});
it('reads strict UTF-8, removes the BOM and limits file size',async()=>{
  const root=tempRoot();try{
    const ok=join(root,'ok.json');await writeFile(ok,Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from('[]')]));
    expect(await readCookieFile(ok)).toBe('[]');
    const bad=join(root,'bad.json');await writeFile(bad,Buffer.from([0xff,0xfe,0x00]));
    await expect(readCookieFile(bad)).rejects.toThrow('INVALID_COOKIE_FILE');
    const huge=join(root,'huge.json');await writeFile(huge,Buffer.alloc(5*1024*1024+1));
    await expect(readCookieFile(huge)).rejects.toThrow('COOKIES_TOO_LARGE');
  }finally{cleanup(root);}
});
it('normalizes Dolphin JSON expiration, booleans and defaults',()=>{
  const [a,b,c]=parseJsonCookies(JSON.stringify([
    {domain:'example.com',name:'a',path:'/',value:'1',expires:now+60},
    {domain:'example.com',name:'b',path:'/',value:'2',expirationDate:(now+60)*1000},
    {domain:'example.com',name:'c',path:'/',value:'3'},
  ]),now);
  expect(a.expirationDate).toBe(now+60);expect(b.expirationDate).toBe(now+60);expect(c.expirationDate).toBeNull();
  expect(a.storeId).toBe('0');expect(a.sameSite).toBe('unspecified');expect(a.httpOnly).toBe(false);
});
it('understands string booleans and an object containing cookies',()=>{
  const [a]=parseJsonCookies(JSON.stringify({cookies:[{domain:'example.com',name:'a',path:'/',value:'1',httpOnly:'true',secure:1}]}),now);
  expect(a.httpOnly).toBe(true);expect(a.secure).toBe(true);
});
it('applies Dolphin rules for special names and facebook',()=>{
  const [a,b]=parseJsonCookies(JSON.stringify([
    {domain:'facebook.com',name:'xs',path:'/',value:'1',secure:false},
    {domain:'www.facebook.com',name:'other',path:'/',value:'2'},
  ]),now);
  expect(a).toMatchObject({domain:'.facebook.com',httpOnly:true,secure:true,sameSite:'no_restriction'});
  expect(b.domain).toBe('.www.facebook.com');
});
it('normalizes no_restriction and reserved prefixes to Chromium requirements',()=>{
  const [a,b]=parseJsonCookies(JSON.stringify([
    {domain:'example.com',name:'a',path:'/',value:'1',sameSite:'none',secure:false},
    {domain:'example.com',name:'__Host-x',path:'/other',value:'2'},
  ]),now);
  expect(a.secure).toBe(true);expect(a.sameSite).toBe('no_restriction');
  expect(b).toMatchObject({path:'/',secure:true});
});
it('skips expired cookies and rejects the file for any invalid entry',()=>{
  expect(parseJsonCookies(JSON.stringify([{domain:'example.com',name:'a',path:'/',value:'1',expires:now-1}]),now)).toEqual([]);
  expect(()=>parseJsonCookies(JSON.stringify([{domain:'example.com',name:'a',path:'/',value:'a\tb'}]),now)).toThrow('INVALID_COOKIE_FILE');
  expect(()=>parseJsonCookies('{',now)).toThrow('INVALID_COOKIE_FILE');
  expect(()=>parseJsonCookies(JSON.stringify([{domain:'example.com',name:'a',path:'/',value:'1',storeId:'1'}]),now)).toThrow('COOKIE_STORE_UNSUPPORTED');
});
it('accepts a 401-day expiration without truncating it',()=>{
  const [a]=parseJsonCookies(JSON.stringify([{domain:'example.com',name:'a',path:'/',value:'1',expires:now+401*86400}]),now);
  expect(a.expirationDate).toBe(now+401*86400);
});
