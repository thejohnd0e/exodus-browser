import { describe, it, expect } from 'vitest';
import { parseProfileInput, parseProfileId,proxySchema } from '../../src/shared/validation';
export const valid = { name: 'Work profile', note: '', startUrls: ['https://example.com'], languages: ['ru-RU'], proxyId: null };
describe('profile validation', () => {
  it('accepts Russian names and blank start page', () => {
    expect(parseProfileInput({...valid, startUrls:['about:blank']}).name).toBe('Work profile');
  });
  it('requires exactly one site language',()=>{
    expect(parseProfileInput({...valid,languages:['de-DE']}).languages).toEqual(['de-DE']);
    expect(()=>parseProfileInput({...valid,languages:[]})).toThrow();
    expect(()=>parseProfileInput({...valid,languages:['de-DE','fr-FR']})).toThrow();
  });
  it.each(['file:///C:/secret','javascript:alert(1)','data:text/html,test','https://u:p@example.com','--load-extension=x'])('rejects unsafe URL %s', url => {
    expect(() => parseProfileInput({...valid,startUrls:[url]})).toThrow();
  });
  it.each([0,65536])('rejects port %i', port => expect(() => proxySchema.parse({kind:'http',host:'localhost',port})).toThrow());
  it.each(['http://localhost','host/path','a@b','host\nname'])('rejects invalid host %s', host => expect(() => proxySchema.parse({kind:'http',host,port:8080})).toThrow());
  it('rejects authenticated SOCKS and unknown fields', () => {
    expect(() => proxySchema.parse({kind:'socks5',host:'localhost',port:1080,username:'u'})).toThrow();
    expect(() => parseProfileInput({...valid,executable:'bad'})).toThrow();
    expect(() => parseProfileId('../outside')).toThrow();
  });
});
