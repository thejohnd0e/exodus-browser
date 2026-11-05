import { describe, it, expect } from 'vitest';
import { resolveTimezone, type ExitLocation } from '../../src/main/proxy/timezone';
import { DEFAULT_FINGERPRINT, type Fingerprint } from '../../src/shared/fingerprint';

const withTz = (timezone: Fingerprint['timezone']): Fingerprint => ({ ...DEFAULT_FINGERPRINT, timezone });
const location = (country: string | null, zone: string | null = null) => async (): Promise<ExitLocation> => ({ country, zone });

describe('auto time zone resolution', () => {
  it('manual mode is untouched and never calls the lookup', async () => {
    let calls = 0;
    const fp = withTz({ mode: 'manual', value: 'Asia/Tokyo' });
    const result = await resolveTimezone(fp, async () => { calls++; return { country: 'DE', zone: 'Europe/Berlin' }; });
    expect(result).toEqual({ fingerprint: fp });
    expect(calls).toBe(0);
  });

  it('auto without a proxy keeps the host zone', async () => {
    const result = await resolveTimezone(withTz({ mode: 'auto' }));
    expect(result).toEqual({ fingerprint: withTz({ mode: 'auto' }) });
  });

  it('uses the zone of the exit IP, including multi-zone countries', async () => {
    for (const [country, zone] of [['US', 'America/Chicago'], ['RU', 'Asia/Yekaterinburg'], ['DE', 'Europe/Berlin']] as const) {
      const result = await resolveTimezone(withTz({ mode: 'auto' }), location(country, zone));
      expect(result.fingerprint.timezone).toEqual({ mode: 'manual', value: zone });
      expect(result.warning).toBeUndefined();
    }
  });

  it('falls back to the single zone of the country when the IP zone is missing', async () => {
    const result = await resolveTimezone(withTz({ mode: 'auto' }), location('DE'));
    expect(result.fingerprint.timezone).toEqual({ mode: 'manual', value: 'Europe/Berlin' });
    expect(result.warning).toBeUndefined();
  });

  it('rejects a zone that does not belong to the reported country', async () => {
    const result = await resolveTimezone(withTz({ mode: 'auto' }), location('DE', 'Asia/Tokyo'));
    expect(result.fingerprint.timezone).toEqual({ mode: 'manual', value: 'Europe/Berlin' });
    expect(result.warning).toBeUndefined();
    const multi = await resolveTimezone(withTz({ mode: 'auto' }), location('US', 'Europe/Berlin'));
    expect(multi.fingerprint.timezone).toEqual({ mode: 'auto' });
    expect(multi.warning).toEqual({ code: 'TIMEZONE_UNRESOLVED' });
  });

  it('warns when neither the IP zone nor a single country zone is available', async () => {
    for (const lookup of [location(null), location('ZZ'), location('RU'), location(null, 'Not/AZone')]) {
      const result = await resolveTimezone(withTz({ mode: 'auto' }), lookup);
      expect(result.fingerprint.timezone).toEqual({ mode: 'auto' });
      expect(result.warning).toEqual({ code: 'TIMEZONE_UNRESOLVED' });
    }
  });

  it('treats a failed lookup as unresolved', async () => {
    const result = await resolveTimezone(withTz({ mode: 'auto' }), async () => { throw Error('offline'); });
    expect(result.fingerprint.timezone).toEqual({ mode: 'auto' });
    expect(result.warning).toEqual({ code: 'TIMEZONE_UNRESOLVED' });
  });
});
