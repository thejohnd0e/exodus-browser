import { describe, it, expect } from 'vitest';
import { zonesForCountry, allZonesForCountry } from '../../src/shared/country-timezones';
import { timeZoneOptions } from '../../src/shared/timezones';

describe('country time zones', () => {
  it('single-zone countries resolve to exactly one zone, including Germany with Busingen', () => {
    expect(zonesForCountry('DE')).toEqual(['Europe/Berlin']);
    expect(zonesForCountry('FR')).toEqual(['Europe/Paris']);
    expect(zonesForCountry('de')).toEqual(['Europe/Berlin']);
  });
  it('multi-zone countries expose distinct offsets only', () => {
    const us = zonesForCountry('US');
    expect(us.length).toBeGreaterThan(4);
    expect(us).toContain('America/New_York');
    expect(us).toContain('America/Los_Angeles');
    expect(zonesForCountry('RU')).toContain('Europe/Moscow');
    expect(zonesForCountry('RU').length).toBeGreaterThan(5);
  });
  it('unknown countries have no zones', () => {
    expect(zonesForCountry('ZZ')).toEqual([]);
    expect(allZonesForCountry('ZZ')).toEqual([]);
  });
  it('every listed zone is accepted by the engine', () => {
    const supported = new Set(timeZoneOptions().map(o => o.id));
    for (const code of ['US', 'RU', 'DE', 'JP', 'BR', 'AU', 'CA', 'CN']) {
      for (const zone of allZonesForCountry(code)) expect(() => new Intl.DateTimeFormat('en-US', { timeZone: zone })).not.toThrow();
      expect(supported.has(zonesForCountry(code)[0])).toBe(true);
    }
  });
});
