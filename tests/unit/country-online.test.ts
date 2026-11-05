import {it,expect,vi} from 'vitest';
import {lookupCountryOnline} from '../../src/main/proxy/country-online';

const reply=(body:unknown,ok:boolean=true)=>vi.fn(async()=>({ok,json:async()=>body} as unknown as Response));

it('returns the country reported for the exit IP',async()=>{
  const fetchImpl=reply({ip:'191.217.211.173',country:'PL'});
  expect(await lookupCountryOnline('191.217.211.173',{fetchImpl:fetchImpl as never})).toBe('PL');
});

it('rejects malformed answers and failures instead of guessing',async()=>{
  expect(await lookupCountryOnline('198.51.100.7',{fetchImpl:reply({country:'pl'}) as never})).toBeNull();
  expect(await lookupCountryOnline('198.51.100.8',{fetchImpl:reply({},false) as never})).toBeNull();
  expect(await lookupCountryOnline('198.51.100.9',{fetchImpl:vi.fn(async()=>{throw Error('offline');}) as never})).toBeNull();
});

it('does not query the service for something that is not an IP address',async()=>{
  const fetchImpl=vi.fn();
  expect(await lookupCountryOnline('example.com',{fetchImpl:fetchImpl as never})).toBeNull();
  expect(fetchImpl).not.toHaveBeenCalled();
});
