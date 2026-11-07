import {isIP} from 'node:net';
import {isTimeZone} from '../../shared/fingerprint';
import type {ProxiedFetch} from './through-proxy';

/**
 * Country and time zone of an exit IP, asked from public HTTPS services. There is no default transport:
 * callers pass the fetch of the profile's proxy (`proxiedFetch`), so the service sees the proxy asking
 * about itself and never the host's address (DECISIONS #79).
 */
const CACHE=new Map<string,string>();
const CACHE_LIMIT=200;
const ZONE_CACHE=new Map<string,string>();
/**
 * Time zone of an exit IP, asked from ipwho.is over HTTPS. The zone comes from the address itself, so a
 * country with several zones (the United States, Russia) resolves without a manual choice. The country
 * lookup above stays authoritative; the caller only accepts this zone when the two agree.
 */
export async function lookupTimezoneOnline(
  ip:string,
  options:{fetchImpl:ProxiedFetch;timeoutMs?:number;baseUrl?:string},
):Promise<string|null>{
  if(isIP(ip)===0)return null;
  const cached=ZONE_CACHE.get(ip);
  if(cached)return cached;
  try{
    const response=await options.fetchImpl(`${options.baseUrl??'https://ipwho.is/'}${encodeURIComponent(ip)}`,{
      signal:AbortSignal.timeout(options.timeoutMs??5000),
      headers:{accept:'application/json'},
    });
    if(!response.ok)throw Error('ZONE_LOOKUP_FAILED');
    const data=await response.json() as {success?:unknown;timezone?:{id?:unknown}};
    if(data.success!==true)return null;
    const zone=typeof data.timezone?.id==='string'&&isTimeZone(data.timezone.id)?data.timezone.id:null;
    if(!zone)return null;
    if(ZONE_CACHE.size>=CACHE_LIMIT)ZONE_CACHE.delete(ZONE_CACHE.keys().next().value as string);
    ZONE_CACHE.set(ip,zone);
    return zone;
  }catch{return null;}
}

/**
 * Country of an exit IP, asked from api.country.is over HTTPS. The bundled DB-IP Country Lite
 * snapshot mislabels some ranges (a Polish address was reported as US, a Cloudflare WARP address
 * as Canada), while two independent services agreed with each other. The offline database stays as
 * a fallback for offline use and service failures.
 *
 * The request travels through the profile's proxy (see above).
 */
export async function lookupCountryOnline(
  ip:string,
  options:{fetchImpl:ProxiedFetch;timeoutMs?:number;baseUrl?:string},
):Promise<string|null>{
  if(isIP(ip)===0)return null;
  const cached=CACHE.get(ip);
  if(cached)return cached;
  try{
    const response=await options.fetchImpl(`${options.baseUrl??'https://api.country.is/'}${encodeURIComponent(ip)}`,{
      signal:AbortSignal.timeout(options.timeoutMs??5000),
      headers:{accept:'application/json'},
    });
    if(!response.ok)throw Error('COUNTRY_LOOKUP_FAILED');
    const data=await response.json() as {country?:unknown};
    const code=typeof data.country==='string'&&/^[A-Z]{2}$/.test(data.country)?data.country:null;
    if(!code)return null;
    if(CACHE.size>=CACHE_LIMIT)CACHE.delete(CACHE.keys().next().value as string);
    CACHE.set(ip,code);
    return code;
  }catch{return null;}
}
