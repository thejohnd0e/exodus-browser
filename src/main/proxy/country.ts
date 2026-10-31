import {join} from 'node:path';
import {open,type CountryResponse} from 'maxmind';
import * as ipaddr from 'ipaddr.js';

type CountryReader={get(ip:string):{country?:{iso_code?:string}|null}|null};
type CountryLookupOptions={openReader?:()=>Promise<CountryReader>;databasePath?:string};
const databasePath=join(__dirname,'resources','geoip','dbip-country-lite.mmdb');

export function createCountryLookup(options:CountryLookupOptions={}){
 let readerPromise:Promise<CountryReader>|undefined;
 const openReader=options.openReader??(()=>open<CountryResponse>(options.databasePath??databasePath,{cache:{max:256}}));
 return async function lookupCountry(ip:string):Promise<string|null>{
  try{
   const address=ipaddr.parse(ip);
   if(address.range()!=='unicast')return null;
   readerPromise??=openReader();
   const record=await (await readerPromise).get(address.toString());
   const code=record?.country?.iso_code;
   return typeof code==='string'&&/^[A-Z]{2}$/.test(code)?code:null;
  }catch{
   readerPromise=undefined;
   return null;
  }
 };
}

export const lookupCountry=createCountryLookup();
