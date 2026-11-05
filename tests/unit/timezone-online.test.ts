import {it,expect,vi} from 'vitest';
import {lookupTimezoneOnline} from '../../src/main/proxy/country-online';

const reply=(body:unknown,ok:boolean=true)=>vi.fn(async()=>({ok,json:async()=>body} as unknown as Response));

it('returns the IANA zone reported for the exit IP',async()=>{
  const fetchImpl=reply({success:true,country_code:'TR',timezone:{id:'Europe/Istanbul'}});
  expect(await lookupTimezoneOnline('185.255.94.41',{fetchImpl:fetchImpl as never})).toBe('Europe/Istanbul');
});

it('rejects malformed answers and failures instead of guessing',async()=>{
  expect(await lookupTimezoneOnline('198.51.100.7',{fetchImpl:reply({success:true,timezone:{id:'Not/AZone'}}) as never})).toBeNull();
  expect(await lookupTimezoneOnline('198.51.100.8',{fetchImpl:reply({success:false,timezone:{id:'Europe/Berlin'}}) as never})).toBeNull();
  expect(await lookupTimezoneOnline('198.51.100.9',{fetchImpl:reply({},false) as never})).toBeNull();
  expect(await lookupTimezoneOnline('198.51.100.10',{fetchImpl:vi.fn(async()=>{throw Error('offline');}) as never})).toBeNull();
});

it('does not query the service for something that is not an IP address',async()=>{
  const fetchImpl=vi.fn();
  expect(await lookupTimezoneOnline('example.com',{fetchImpl:fetchImpl as never})).toBeNull();
  expect(fetchImpl).not.toHaveBeenCalled();
});
