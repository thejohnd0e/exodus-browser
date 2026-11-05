import {it,expect} from 'vitest';
import {existsSync,readdirSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {launchCookieBrowser,openCookieSession} from '../../src/main/cookies/session';
import {writePortableCookies,readPortableCookies} from '../../src/main/portable/cookies';

const base=join(process.env.LOCALAPPDATA??'','ms-playwright');
const candidates=existsSync(base)?readdirSync(base).filter(n=>n.startsWith('chromium-')).sort().reverse():[];
const executable=process.env.LOCAL_PROFILES_TEST_CHROMIUM??join(base,candidates[0]??'missing','chrome-win64','chrome.exe');

it('roundtrips session, persistent, httpOnly, secure, SameSite, host-only, domain and partitioned cookies in Chromium',async()=>{
 if(!existsSync(executable))throw Error('BLOCKED: no local Chromium');
 const sourceDir=await mkdtemp(join(tmpdir(),'portable-cookie-source-'));const targetDir=await mkdtemp(join(tmpdir(),'portable-cookie-target-'));
 const launched=[] as Array<Awaited<ReturnType<typeof launchCookieBrowser>>>;
 try{
  const sourceBrowser=await launchCookieBrowser({executable,userDataDir:sourceDir});launched.push(sourceBrowser);
  const sourceSession=await openCookieSession(sourceBrowser);
  const now=Math.floor(Date.now()/1000);
  const source=[
   {name:'host_session',value:'session-value',domain:'example.com',path:'/',expires:null,session:true,httpOnly:true,secure:true,sameSite:'Strict' as const,priority:'High' as const,sourceScheme:'Secure' as const,sourcePort:443},
   {name:'domain_persistent',value:'persistent-value',domain:'.example.com',path:'/app',expires:now+86400,session:false,httpOnly:false,secure:true,sameSite:'Lax' as const,priority:'Medium' as const,sourceScheme:'Secure' as const,sourcePort:443,partitionKey:{topLevelSite:'https://top.example',hasCrossSiteAncestor:false}},
  ];
  await writePortableCookies(sourceSession.client,source);
  const cookies=await readPortableCookies(sourceSession.client);
  await sourceBrowser.close();launched.splice(launched.indexOf(sourceBrowser),1);
  const targetBrowser=await launchCookieBrowser({executable,userDataDir:targetDir});launched.push(targetBrowser);
  const targetSession=await openCookieSession(targetBrowser);
  await writePortableCookies(targetSession.client,cookies);
  const readback=await readPortableCookies(targetSession.client);
  expect(readback).toHaveLength(2);
  const actual=readback.map(cookie=>({name:cookie.name,value:cookie.value,domain:cookie.domain,path:cookie.path,session:cookie.session,httpOnly:cookie.httpOnly,secure:cookie.secure,sameSite:cookie.sameSite,priority:cookie.priority,sourceScheme:cookie.sourceScheme,sourcePort:cookie.sourcePort,...(cookie.partitionKey?{partitionKey:cookie.partitionKey}:{})})).sort((a,b)=>a.name.localeCompare(b.name));
  const expected=source.map(({expires,...cookie})=>cookie).sort((a,b)=>a.name.localeCompare(b.name));
  expect(actual).toEqual(expected);
  const persistent=readback.find(cookie=>cookie.name==='domain_persistent')!;
  expect(persistent.expires).toBeGreaterThan(now+86390);
  expect(persistent.expires).toBeLessThanOrEqual(now+86400);
 }finally{await Promise.allSettled(launched.map(browser=>browser.close()));await Promise.all([rm(sourceDir,{recursive:true,force:true}),rm(targetDir,{recursive:true,force:true})]);}
},120000);
