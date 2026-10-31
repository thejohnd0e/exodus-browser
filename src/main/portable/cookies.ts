import {portableCookieSchema,portableCookiesSchema,type PortableCookie} from '../../shared/portable';
export type PortableCookieClient={send(method:string,params?:Record<string,unknown>,sessionId?:string):Promise<unknown>};

type RawCookie={
 name:unknown;value:unknown;domain:unknown;path:unknown;expires?:unknown;session?:unknown;httpOnly?:unknown;secure?:unknown;sameSite?:unknown;priority?:unknown;sourceScheme?:unknown;sourcePort?:unknown;partitionKey?:unknown;partitionKeyOpaque?:unknown;
};

export async function readPortableCookies(client:PortableCookieClient):Promise<PortableCookie[]>{
 try{
  const response=await client.send('Storage.getCookies',{});
  if(!response||typeof response!=='object'||!Array.isArray((response as {cookies?:unknown}).cookies))throw Error('PORTABLE_COOKIE_READ_FAILED');
  const cookies=(response as {cookies:RawCookie[]}).cookies;
  if(cookies.length>20000)throw Error('PORTABLE_COOKIE_LIMIT');
  const result=cookies.map((cookie)=>{
   if(cookie.partitionKeyOpaque===true)throw Error('PORTABLE_COOKIE_PARTITION_UNSUPPORTED');
   if(cookie.partitionKeyOpaque!==undefined&&typeof cookie.partitionKeyOpaque!=='boolean')throw Error('PORTABLE_COOKIE_PARTITION_UNSUPPORTED');
   const expires=typeof cookie.expires==='number'&&cookie.expires>0?cookie.expires:null;
   const session=typeof cookie.session==='boolean'?cookie.session:expires===null;
   return portableCookieSchema.parse({name:cookie.name,value:cookie.value,domain:cookie.domain,path:cookie.path,expires:session?null:expires,session,httpOnly:cookie.httpOnly,secure:cookie.secure,sameSite:cookie.sameSite??'Unspecified',priority:cookie.priority,sourceScheme:cookie.sourceScheme,sourcePort:cookie.sourcePort,partitionKey:cookie.partitionKey});
  });
  return portableCookiesSchema.parse(result);
 }catch(error){if(error instanceof Error&&['PORTABLE_COOKIE_PARTITION_UNSUPPORTED','PORTABLE_COOKIE_LIMIT'].includes(error.message))throw error;throw Error('PORTABLE_COOKIE_READ_FAILED');}
}

export async function writePortableCookies(client:PortableCookieClient,input:PortableCookie[]):Promise<void>{
 let cookies:PortableCookie[];try{cookies=portableCookiesSchema.parse(input);}catch{throw Error('PORTABLE_COOKIE_INVALID');}
 const params=cookies.map(cookie=>({name:cookie.name,value:cookie.value,domain:cookie.domain,path:cookie.path,httpOnly:cookie.httpOnly,secure:cookie.secure,...(cookie.sameSite==='Unspecified'?{}:{sameSite:cookie.sameSite}),priority:cookie.priority,sourceScheme:cookie.sourceScheme,sourcePort:cookie.sourcePort,...(cookie.expires===null?{}:{expires:cookie.expires}),...(cookie.partitionKey?{partitionKey:cookie.partitionKey}:{})}));
 try{await client.send('Storage.setCookies',{cookies:params});}catch{throw Error('PORTABLE_COOKIE_REJECTED');}
}
