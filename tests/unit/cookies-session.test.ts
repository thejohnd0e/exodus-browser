import {it,expect,vi} from 'vitest';
import {cookieArgs,openCookieSession} from '../../src/main/cookies/session';
const cookie={domain:'.example.com',name:'sid',path:'/',value:'v',expirationDate:1893456000,httpOnly:true,secure:true,sameSite:'lax' as const,storeId:'0'};
it('arguments ensure network isolation',()=>{
  const args=cookieArgs('C:\\profiles\\a');
  expect(args).toContain('--headless=new');
  expect(args).toContain('--proxy-server=http://127.0.0.1:9');
  expect(args).toContain('--host-resolver-rules=MAP * ~NOTFOUND');
  expect(args).toContain('--disable-background-networking');
  expect(args).not.toContain('--user-agent');
  expect(args.at(-1)).toBe('about:blank');
});
it('sets cookies in the page session and omits session expiration',async()=>{
  const send=vi.fn(async()=>({sessionId:'s1',targetInfos:[{targetId:'t1',type:'page'}]}));
  const session=await openCookieSession({client:{send:send as never,close:vi.fn()},close:async()=>{}});
  await session.setCookie(cookie);
  const [method,params,sessionId]=(send.mock.calls.at(-1) as unknown[]);
  expect(method).toBe('Network.setCookies');expect(sessionId).toBe('s1');
  expect(params).toEqual({cookies:[{name:'sid',value:'v',domain:'.example.com',path:'/',secure:true,httpOnly:true,sameSite:'Lax',expires:1893456000}]});
  await session.setCookie({...cookie,expirationDate:null,sameSite:'unspecified'});
  const last=(send.mock.calls.at(-1) as unknown[])[1] as {cookies:Array<Record<string,unknown>>};
  expect(last.cookies[0]).not.toHaveProperty('expires');
  expect(last.cookies[0]).not.toHaveProperty('sameSite');
});
it('reads cookies and skips partitioned entries',async()=>{
  const send=vi.fn(async(method:string)=>method==='Storage.getCookies'?{cookies:[
    {name:'a',value:'1',domain:'.example.com',path:'/',secure:true,httpOnly:false,expires:-1,sameSite:'Lax'},
    {name:'b',value:'2',domain:'.example.com',path:'/',secure:true,httpOnly:false,expires:5,partitionKey:{topLevelSite:'https://x'}},
  ]}:{sessionId:'s1',targetInfos:[{targetId:'t1',type:'page'}]});
  const session=await openCookieSession({client:{send:send as never,close:vi.fn()},close:async()=>{}});
  expect(await session.getCookies()).toEqual([{domain:'.example.com',name:'a',path:'/',value:'1',expirationDate:null,httpOnly:false,secure:true,sameSite:'lax',storeId:'0'}]);
});
it('clears all cookies through Storage.clearCookies and counts partitioned cookies in raw readback',async()=>{
 let current=[{name:'a',value:'1'},{name:'b',value:'2',partitionKey:{topLevelSite:'https://example.com'}}];
 const send=vi.fn(async(method:string)=>{
   if(method==='Storage.getCookies')return {cookies:current};
   if(method==='Storage.clearCookies'){current=[];return {};}
   if(method==='Target.getTargets')return {targetInfos:[{targetId:'t1',type:'page'}]};
   return {sessionId:'s1'};
 });
 const session=await openCookieSession({client:{send:send as never,close:vi.fn()},close:async()=>{}});
 await expect(session.clearCookies()).resolves.toBeUndefined();
 expect(send.mock.calls.map(call=>call[0])).toContain('Storage.clearCookies');
 expect(await session.getRawCookieCount()).toBe(0);
});
