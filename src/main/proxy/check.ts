import {isIP} from 'node:net';
import type {ProxyInput} from '../../shared/contracts';
import {openProxyBridge} from './bridge';
import {proxiedFetch,type ProxiedFetch} from './through-proxy';
import {lookupCountryOnline,lookupTimezoneOnline} from './country-online';
import {lookupCountry} from './country';

// Asked through the profile's proxy over HTTPS (DECISIONS #79): the service sees only the proxy's exit
// address, and an on-path party can no longer rewrite the answer.
export const IP_CHECK_SERVICE='https://api.ipify.org?format=json';

type CheckOptions={endpoint?:URL;ca?:string|Buffer};
type LookupOptions={endpoints?:{ip?:URL;country?:string;zone?:string};ca?:string|Buffer;offlineCountry?:(ip:string)=>Promise<string|null>};

async function exitIp(get:ProxiedFetch,endpoint:URL):Promise<string>{
  let ip:unknown;
  try{
    const response=await get(endpoint.href,{headers:{accept:'application/json'},signal:AbortSignal.timeout(10000)});
    if(response.status!==200)throw Error('PROXY_CHECK_FAILED');
    ip=(await response.json() as {ip?:unknown}).ip;
  }catch(error){
    if(error instanceof Error&&error.message==='PROXIED_TIMEOUT')throw Error('PROXY_CHECK_TIMEOUT');
    throw Error('PROXY_CHECK_FAILED');
  }
  // A malformed answer is reported like any other failed check, as before.
  if(typeof ip!=='string'||!isIP(ip))throw Error('PROXY_CHECK_FAILED');
  return ip;
}

/** External IP of a proxy, asked through that proxy over HTTPS. */
export async function checkProxy(input:ProxyInput,options:CheckOptions={}):Promise<{ip:string}>{
  const endpoint=options.endpoint??new URL(IP_CHECK_SERVICE);
  if(endpoint.protocol!=='https:')throw Error('CHECK_SCHEME_UNSUPPORTED');
  const bridge=await openProxyBridge(input);
  try{return {ip:await exitIp(proxiedFetch(bridge.url,{ca:options.ca}),endpoint)};}
  finally{await bridge.close();}
}

/**
 * Exit IP, country and time zone of a proxy through one bridge. Nothing is sent from the host directly:
 * if the country service does not answer, the bundled database decides; if the zone service does not
 * answer, the zone stays unknown and the caller falls back to a single-zone country or asks the user.
 */
export async function lookupExitLocation(input:ProxyInput,options:LookupOptions={}):Promise<{ip:string;country:string|null;zone:string|null}>{
  const endpoint=options.endpoints?.ip??new URL(IP_CHECK_SERVICE);
  if(endpoint.protocol!=='https:')throw Error('CHECK_SCHEME_UNSUPPORTED');
  const bridge=await openProxyBridge(input);
  try{
    const get=proxiedFetch(bridge.url,{ca:options.ca});
    const ip=await exitIp(get,endpoint);
    const [online,zone]=await Promise.all([
      lookupCountryOnline(ip,{fetchImpl:get,baseUrl:options.endpoints?.country}),
      lookupTimezoneOnline(ip,{fetchImpl:get,baseUrl:options.endpoints?.zone}),
    ]);
    return {ip,country:online??await (options.offlineCountry??lookupCountry)(ip),zone};
  }finally{await bridge.close();}
}
