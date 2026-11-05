import {it,expect,vi} from 'vitest';
import {join} from 'node:path';
import {createCountryLookup} from '../../src/main/proxy/country';

it('returns validated country codes for public IPv4 and IPv6 addresses',async()=>{
 const reader={get:(ip:string)=>({country:{iso_code:ip.includes(':')?'JP':'US'}})};
 const lookup=createCountryLookup({openReader:async()=>reader});
 await expect(lookup('8.8.8.8')).resolves.toBe('US');
 await expect(lookup('2606:4700:4700::1111')).resolves.toBe('JP');
});

it('reads the pinned DB-IP database for known IPv4 and IPv6 addresses',async()=>{
 const lookup=createCountryLookup({databasePath:join(process.cwd(),'resources','geoip','dbip-country-lite.mmdb')});
 await expect(lookup('8.8.8.8')).resolves.toBe('US');
 await expect(lookup('2606:4700:4700::1111')).resolves.toBe('CA');
});

it('does not look up private, reserved, malformed, or unsupported addresses',async()=>{
 const openReader=vi.fn(async()=>({get:()=>({country:{iso_code:'US'}})}));
 const lookup=createCountryLookup({openReader});
 for(const ip of ['127.0.0.1','10.1.2.3','192.0.2.1','203.0.113.5','::1','fc00::1','2001:db8::1','not-an-ip'])
  await expect(lookup(ip)).resolves.toBeNull();
 expect(openReader).not.toHaveBeenCalled();
});

it('returns null for unknown records and malformed country codes',async()=>{
 const lookup=createCountryLookup({openReader:async()=>({get:(ip:string)=>ip==='8.8.4.4'?null:{country:{iso_code:'USA'}}})});
 await expect(lookup('1.1.1.1')).resolves.toBeNull();
 await expect(lookup('8.8.4.4')).resolves.toBeNull();
});

it('fails closed and retries after missing or malformed database errors',async()=>{
 let calls=0;const lookup=createCountryLookup({openReader:async()=>{calls++;throw Error('MMDB unavailable');}});
 await expect(lookup('8.8.8.8')).resolves.toBeNull();
 await expect(lookup('8.8.4.4')).resolves.toBeNull();
 expect(calls).toBe(2);
});
