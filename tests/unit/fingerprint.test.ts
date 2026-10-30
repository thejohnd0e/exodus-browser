import { describe, it, expect } from 'vitest';
import { DEFAULT_FINGERPRINT, fingerprintSchema, normalizeFingerprint } from '../../src/shared/fingerprint';
import { parseProfileInput } from '../../src/shared/validation';

const base = { name: 'P', note: '', startUrls: ['https://example.com'], languages: ['ru-RU'], proxyId: null };
const hardware = { mode: 'manual' as const, cores: 12, memoryGb: 8 as const };
const screen = { mode: 'manual' as const, width: 1920, height: 1080, dpr: 1 };

describe('fingerprint model', () => {
  it('legacy profiles without a fingerprint receive unmodified defaults', () => {
    expect(normalizeFingerprint(undefined)).toEqual(DEFAULT_FINGERPRINT);
    expect(parseProfileInput({ ...base, fingerprint: undefined })).toMatchObject({ fingerprint: DEFAULT_FINGERPRINT });
    expect(parseProfileInput(base as never)).toMatchObject({ fingerprint: DEFAULT_FINGERPRINT });
  });

  it('defaults do not override anything', () => {
    expect(DEFAULT_FINGERPRINT).toEqual(expect.objectContaining({
      os: 'windows11', userAgent: null, webRtc: 'real', canvas: 'real', webgl: 'real',
      webglInfo: { mode: 'real' }, webgpu: 'on', clientRects: 'real', audio: 'real',
      timezone: { mode: 'auto' }, geolocation: { mode: 'auto' },
      hardware: { mode: 'real' }, screen: { mode: 'real' },
    }));
  });

  it('rejects multiline and oversized UA values', () => {
    expect(fingerprintSchema.safeParse({ ...DEFAULT_FINGERPRINT, userAgent: 'Mozilla/5.0\nEvil' }).success).toBe(false);
    expect(fingerprintSchema.safeParse({ ...DEFAULT_FINGERPRINT, userAgent: 'Mozilla/5.0' + 'x'.repeat(600) }).success).toBe(false);
  });

  it('rejects a UA that does not match the selected OS', () => {
    const macUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
    expect(fingerprintSchema.safeParse({ ...DEFAULT_FINGERPRINT, userAgent: macUa, os: 'windows11' }).success).toBe(false);
    expect(fingerprintSchema.safeParse({ ...DEFAULT_FINGERPRINT, userAgent: macUa, os: 'macos' }).success).toBe(true);
  });

  it('manual WebGL Info requires a vendor and renderer', () => {
    expect(fingerprintSchema.safeParse({ ...DEFAULT_FINGERPRINT, webglInfo: { mode: 'manual' } }).success).toBe(false);
    expect(fingerprintSchema.safeParse({ ...DEFAULT_FINGERPRINT, webglInfo: { mode: 'manual', vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA)' } }).success).toBe(true);
  });

  it('limits cores and memory to realistic browser values', () => {
    expect(fingerprintSchema.safeParse({ ...DEFAULT_FINGERPRINT, hardware: { mode: 'manual', cores: 0, memoryGb: 8 } }).success).toBe(false);
    expect(fingerprintSchema.safeParse({ ...DEFAULT_FINGERPRINT, hardware: { mode: 'manual', cores: 65, memoryGb: 8 } }).success).toBe(false);
    expect(fingerprintSchema.safeParse({ ...DEFAULT_FINGERPRINT, hardware: { mode: 'manual', cores: 12, memoryGb: 32 } }).success).toBe(false);
    expect(fingerprintSchema.safeParse({ ...DEFAULT_FINGERPRINT, hardware }).success).toBe(true);
  });

  it('validates geolocation coordinates and accuracy', () => {
    expect(fingerprintSchema.safeParse({ ...DEFAULT_FINGERPRINT, geolocation: { mode: 'manual', latitude: 91, longitude: 0, accuracy: 10 } }).success).toBe(false);
    expect(fingerprintSchema.safeParse({ ...DEFAULT_FINGERPRINT, geolocation: { mode: 'manual', latitude: 55.75, longitude: 37.61 } }).success).toBe(false);
    expect(fingerprintSchema.safeParse({ ...DEFAULT_FINGERPRINT, geolocation: { mode: 'manual', latitude: 55.75, longitude: 37.61, accuracy: 10 } }).success).toBe(true);
  });

  it('validates the time zone using Intl', () => {
    expect(fingerprintSchema.safeParse({ ...DEFAULT_FINGERPRINT, timezone: { mode: 'manual', value: 'Mars/Olympus' } }).success).toBe(false);
    expect(fingerprintSchema.safeParse({ ...DEFAULT_FINGERPRINT, timezone: { mode: 'manual', value: 'Europe/Moscow' } }).success).toBe(true);
  });

  it('limits screen dimensions to reasonable values', () => {
    expect(fingerprintSchema.safeParse({ ...DEFAULT_FINGERPRINT, screen: { ...screen, width: 100 } }).success).toBe(false);
    expect(fingerprintSchema.safeParse({ ...DEFAULT_FINGERPRINT, screen: { ...screen, dpr: 5 } }).success).toBe(false);
    expect(fingerprintSchema.safeParse({ ...DEFAULT_FINGERPRINT, screen: screen }).success).toBe(true);
  });
});
