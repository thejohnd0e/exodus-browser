import {it,expect} from 'vitest';
import {timezoneMatchesCountry} from '../../src/shared/country-timezones';

it('never warns in auto mode, which follows the exit IP',()=>{
 expect(timezoneMatchesCountry('TR',{mode:'auto'})).toBe(true);
 expect(timezoneMatchesCountry('US',{mode:'auto'})).toBe(true);
});

it('checks a fixed manual zone against the country',()=>{
 expect(timezoneMatchesCountry('TR',{mode:'manual',value:'Europe/Moscow'})).toBe(false);
 expect(timezoneMatchesCountry('TR',{mode:'manual',value:'Europe/Istanbul'})).toBe(true);
 expect(timezoneMatchesCountry('US',{mode:'manual',value:'America/Chicago'})).toBe(true);
});

it('does not warn for countries missing from the table',()=>{
 expect(timezoneMatchesCountry('ZZ',{mode:'manual',value:'Europe/Moscow'})).toBe(true);
});
