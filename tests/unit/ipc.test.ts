import {it,expect} from 'vitest';
import {createDispatcher} from '../../src/main/ipc';
import {valid} from '../fixtures/profiles';
import {messageForError} from '../../src/shared/i18n/messages';
it('rejects untrusted frames and malformed arguments before invoking privileged operations',async()=>{
 let called=0;const dispatch=createDispatcher({start:async()=>{called++;}},(e)=>e==='trusted');
 expect((await dispatch('untrusted','start',['d31bb0d8-7bfa-4341-a12a-83a801e8cb4a'])).ok).toBe(false);
 expect((await dispatch('trusted','start',['../outside'])).ok).toBe(false);
 expect((await dispatch('trusted','start',['d31bb0d8-7bfa-4341-a12a-83a801e8cb4a','extra'])).ok).toBe(false);
 expect(called).toBe(0);
 expect((await dispatch('trusted','start',['d31bb0d8-7bfa-4341-a12a-83a801e8cb4a'])).ok).toBe(true);expect(called).toBe(1);
});
it('validates extension operation arguments before touching the library',async()=>{
  let calls=0;const dispatch=createDispatcher({listExtensions:async()=>{calls++;return [];},addExtensionFolder:async()=>{calls++;return null;},removeExtension:async()=>{calls++;}},(e)=>e==='trusted');
  expect((await dispatch('trusted','listExtensions',[])).ok).toBe(true);
  expect((await dispatch('trusted','addExtensionFolder',[])).ok).toBe(true);
  expect((await dispatch('trusted','removeExtension',['not-a-uuid'])).ok).toBe(false);
  expect((await dispatch('trusted','updateExtension',['../outside'])).ok).toBe(false);
  expect((await dispatch('trusted','removeExtension',['d31bb0d8-7bfa-4341-a12a-83a801e8cb4a','extra'])).ok).toBe(false);
  expect(calls).toBe(2);
});

it('localizes trusted-frame, operation and input validation failures',async()=>{
 let language:'en'|'ru'='en';const dispatch=createDispatcher({},()=>true,()=>language);
 expect(await dispatch({},'unknown',[])).toMatchObject({ok:false,error:{code:'INVALID_REQUEST',message:'Unknown operation.'}});
 language='ru';
 expect(await dispatch({},'unknown',[])).toMatchObject({ok:false,error:{code:'INVALID_REQUEST',message:messageForError('INVALID_REQUEST','ru')}});
 expect(await dispatch({},'start',['bad-id'])).toMatchObject({ok:false,error:{code:'INVALID_INPUT',message:messageForError('INVALID_INPUT','ru')}});
 const untrusted=createDispatcher({},()=>false,()=> 'ru');
 expect(await untrusted({},'start',['d31bb0d8-7bfa-4341-a12a-83a801e8cb4a'])).toMatchObject({ok:false,error:{code:'FORBIDDEN',message:messageForError('FORBIDDEN','ru')}});
});
it('does not echo unknown exceptions, paths or secrets to the renderer',async()=>{
 const dispatch=createDispatcher({create:async()=>{throw Error('password=secret C:/private');}},()=>true);
 const result=await dispatch({},'create',[valid]);expect(result.ok).toBe(false);expect(JSON.stringify(result)).not.toContain('secret');expect(JSON.stringify(result)).not.toContain('private');
});
it('validates saved proxy operations and rejects writes from untrusted frames',async()=>{
 let saved=0;const dispatch=createDispatcher({createProxy:async()=>{saved++;return {id:'test'};}},event=>event==='trusted');
 const input={name:'P',kind:'http',host:'localhost',port:80};
 expect((await dispatch('untrusted','createProxy',[input])).ok).toBe(false);
 expect((await dispatch('trusted','createProxy',[{...input,port:0}])).ok).toBe(false);
 expect((await dispatch('trusted','createProxy',[input])).ok).toBe(true);expect(saved).toBe(1);
});
it('explains fingerprint launch failures and invalid fingerprint input',async()=>{
 const dispatch=createDispatcher({start:async()=>{throw Error('FINGERPRINT_UNAVAILABLE');}},()=>true);
 const failed=await dispatch({},'start',['d31bb0d8-7bfa-4341-a12a-83a801e8cb4a']);
 expect(failed).toMatchObject({ok:false,error:{code:'FINGERPRINT_UNAVAILABLE'}});
 if(!failed.ok)expect(failed.error.message).toContain('Could not apply the profile fingerprint');
 const malformed=await dispatch({},'create',[{...valid,fingerprint:{os:'linux'}}]);
 expect(malformed).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});
 if(!malformed.ok)expect(malformed.error.message).toContain('fingerprint');
});

it('validates cookie operations and explains their errors',async()=>{
  let calls=0;const dispatch=createDispatcher({importCookies:async()=>{calls++;return {count:1,fileName:'a.json'};},exportCookies:async()=>{calls++;return {count:1,fileName:'a.txt'};}},()=>true);
  const id='d31bb0d8-7bfa-4341-a12a-83a801e8cb4a';
  expect((await dispatch({},'importCookies',[id])).ok).toBe(true);
  expect((await dispatch({},'exportCookies',[id,'netscape'])).ok).toBe(true);
  expect((await dispatch({},'exportCookies',[id,'xml'])).ok).toBe(false);
  expect((await dispatch({},'importCookies',['../x'])).ok).toBe(false);
  expect(calls).toBe(2);
  for(const [code,text] of [['INVALID_COOKIE_FILE','corrupted'],['COOKIES_NOT_PERSISTED','not fully'],['COOKIE_REJECTED_BY_BROWSER','rejected'],['COOKIE_STORE_UNSUPPORTED','not supported'],['COOKIES_SESSION_FAILED','Could not open'],['ENGINE_NOT_READY','engine']] as const){
    const failing=createDispatcher({importCookies:async()=>{throw Error(code);}},()=>true);
    const result=await failing({},'importCookies',[id]);
    expect(result.ok).toBe(false);if(!result.ok){expect(result.error.code).toBe(code);expect(result.error.message).toContain(text);}
  }
});
it('validates cookie clearing and returns only allowlisted failure messages',async()=>{
 const id='d31bb0d8-7bfa-4341-a12a-83a801e8cb4a';let calls=0;
 const dispatch=createDispatcher({clearCookies:async()=>{calls++;return {cleared:true};}},()=>true);
 expect(await dispatch({},'clearCookies',[id])).toMatchObject({ok:true,value:{cleared:true}});
 expect((await dispatch({},'clearCookies',['../bad'])).ok).toBe(false);expect(calls).toBe(1);
 const failure=createDispatcher({clearCookies:async()=>{throw Error('COOKIE_CLEAR_FAILED');}},()=>true);
 expect(await failure({},'clearCookies',[id])).toMatchObject({ok:false,error:{code:'COOKIE_CLEAR_FAILED',message:'Could not clear cookies in Chromium.'}});
 const unsafe=createDispatcher({clearCookies:async()=>{throw Error('COOKIE_SESSION_CLOSE_FAILED path C:/private secret');}},()=>true);
 const result=await unsafe({},'clearCookies',[id]);expect(JSON.stringify(result)).not.toContain('secret');expect(JSON.stringify(result)).not.toContain('private');
});
it('validates persisted application settings through the trusted IPC boundary',async()=>{
 let language='en';const dispatch=createDispatcher({getSettings:async()=>({language}),updateSettings:async(input:{language:'en'|'ru'})=>{language=input.language;return {language};}},()=>true);
 expect(await dispatch({},'getSettings',[])).toMatchObject({ok:true,value:{language:'en'}});
 expect(await dispatch({},'updateSettings',[{language:'ru'}])).toMatchObject({ok:true,value:{language:'ru'}});
 expect((await dispatch({},'updateSettings',[{language:'fr'}])).ok).toBe(false);
 expect((await dispatch({},'updateSettings',[{language:'en',unexpected:true}])).ok).toBe(false);
 expect(language).toBe('ru');
});
