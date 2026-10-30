import { describe, it, expect } from 'vitest';
import { uaForOs, metadataFor } from '../../src/shared/user-agent';
import { newFingerprint } from '../../src/shared/fingerprint-presets';
import { fingerprintArgs, seedFor } from '../../src/main/engines/fingerprint';
import { DEFAULT_FINGERPRINT } from '../../src/shared/fingerprint';

const engineUa = uaForOs('windows11', '156.0.8078.80');
const manualScreen = { mode: 'manual' as const, width: 1920, height: 1080, dpr: 1 };

describe('fingerprint engine presets', () => {
  it('builds the UA for the engine version rather than a constant', () => {
    expect(uaForOs('windows11', '156.0.8078.80')).toContain('Chrome/156.0.8078.80');
    expect(uaForOs('windows11', '156.0.8078.80')).toContain('Windows NT 10.0; Win64; x64');
    expect(uaForOs('macos', '156.0.8078.80')).toContain('Macintosh; Intel Mac OS X 10_15_7');
    expect(uaForOs('linux', '156.0.8078.80')).toContain('X11; Linux x86_64');
  });

  it('needs Client Hints only when the platform or version changes', () => {
    expect(metadataFor(uaForOs('windows11', '156.0.8078.80'), 'windows11', engineUa)).toBeNull();
    expect(metadataFor(uaForOs('windows11', '157.0.0.1'), 'windows11', engineUa)).not.toBeNull();
    const mac = metadataFor(uaForOs('macos', '156.0.8078.80'), 'macos', engineUa);
    expect(mac).toMatchObject({ platform: 'macOS', mobile: false, bitness: '64' });
    expect(JSON.stringify(mac!.brands)).toContain('Chromium');
  });

  it('generator produces a consistent set', () => {
    const fp = newFingerprint({ os: 'windows10', chromeVersion: '156.0.8078.80', random: () => 0.5 });
    expect(fp.userAgent).toContain('Windows NT 10.0');
    expect(fp.userAgent).toContain('Chrome/156.0.8078.80');
    expect(fp.webglInfo.mode).toBe('manual');
    expect(fp.webglInfo.mode === 'manual' ? fp.webglInfo.renderer : '').toContain('ANGLE');
    expect([0.5, 1, 2, 4, 8]).toContain(fp.hardware.mode === 'manual' ? fp.hardware.memoryGb : 0);
    expect(fp.hardware.mode).toBe('manual');
    expect(fp.screen.mode).toBe('manual');
    expect(fp.canvas).toBe('noise');
    expect(fp.webgl).toBe('noise');
    expect(fp.clientRects).toBe('noise');
    expect(fp.timezone.mode).toBe('auto');
    expect(fp.geolocation.mode).toBe('auto');
  });

  it('arguments contain only public flags', () => {
    expect(fingerprintArgs({ ...DEFAULT_FINGERPRINT, webRtc: 'disableUdp', screen: manualScreen })).toEqual([
      '--window-size=1920,1080', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    ]);
    expect(fingerprintArgs({ ...DEFAULT_FINGERPRINT, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/156.0.8078.80 Safari/537.36' })).toEqual(['--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/156.0.8078.80 Safari/537.36']);
    expect(fingerprintArgs(DEFAULT_FINGERPRINT)).toEqual([]);
    expect(fingerprintArgs({ ...DEFAULT_FINGERPRINT, webRtc: 'altered' })).toEqual(['--force-webrtc-ip-handling-policy=disable_non_proxied_udp']);
  });

  it('seed is stable and differs between profiles', () => {
    expect(seedFor('a')).toBe(seedFor('a'));
    expect(seedFor('a')).not.toBe(seedFor('b'));
    expect(Number.isInteger(seedFor('a'))).toBe(true);
  });
});

describe('client hints coherence', () => {
  it('GREASE brand Not_A Brand does not repeat the Chrome version', () => {
    const metadata = metadataFor(uaForOs('windows11', '157.0.0.1'), 'windows11', engineUa)!;
    expect(metadata.brands).toContainEqual({ brand: 'Not_A Brand', version: '24' });
    expect(metadata.fullVersionList).toContainEqual({ brand: 'Not_A Brand', version: '24' });
  });

  it('updates Client Hints for full version changes, not only major versions', () => {
    expect(metadataFor(uaForOs('windows11', '156.0.1.2'), 'windows11', engineUa)).not.toBeNull();
  });

  it('macOS Client Hints are consistent with Apple Silicon', () => {
    const metadata = metadataFor(uaForOs('macos', '157.0.0.1'), 'macos', engineUa)!;
    expect(metadata.architecture).toBe('arm');
  });
});
