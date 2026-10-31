import {it,expect} from 'vitest';
import {join} from 'node:path';
import {createCountryLookup} from '../../src/main/proxy/country';

it('loads country data from the built runtime resource directory',async()=>{
 const databasePath=join(process.cwd(),'dist','resources','geoip','dbip-country-lite.mmdb');
 const lookup=createCountryLookup({databasePath});
 await expect(lookup('8.8.8.8')).resolves.toBe('US');
 await expect(lookup('2606:4700:4700::1111')).resolves.toBe('CA');
});
