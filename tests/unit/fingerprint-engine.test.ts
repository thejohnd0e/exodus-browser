import { describe, it, expect } from 'vitest';
import { uaForOs, metadataFor, navigatorPlatformByOs, generateBrandVersionList, reduceUserAgent } from '../../src/shared/user-agent';
import { newFingerprint } from '../../src/shared/fingerprint-presets';
import { fingerprintArgs, seedFor } from '../../src/main/engines/fingerprint';
import { DEFAULT_FINGERPRINT } from '../../src/shared/fingerprint';
import { chromiumArgs } from '../../src/main/engines/chromium';

const engineUa = uaForOs('windows11', '156.0.8078.80');
const manualScreen = { mode: 'manual' as const, width: 1920, height: 1080, dpr: 1 };

describe('fingerprint engine presets', () => {
  it('builds the UA for the engine version rather than a constant', () => {
    expect(uaForOs('windows11', '156.0.8078.80')).toContain('Chrome/156.0.0.0 ');
    expect(uaForOs('windows11', '157.0.1.2')).toContain('Chrome/157.0.0.0 ');
    expect(uaForOs('windows11', '156.0.8078.80')).toContain('Windows NT 10.0; Win64; x64');
    expect(uaForOs('macos', '156.0.8078.80')).toContain('Macintosh; Intel Mac OS X 10_15_7');
    expect(uaForOs('linux', '156.0.8078.80')).toContain('X11; Linux x86_64');
  });

  it('reduces stored full-version user agents the way Chrome does', () => {
    expect(reduceUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.80 Safari/537.36'))
      .toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36');
    expect(reduceUserAgent('Custom/1.0')).toBe('Custom/1.0');
  });

  it('always sends Client Hints for a chosen UA and takes the full version from the engine', () => {
    const win = metadataFor(uaForOs('windows11', '156.0.8078.80'), 'windows11', '156.0.8078.80');
    expect(win).toMatchObject({ platform: 'Windows', platformVersion: '15.0.0', architecture: 'x86', bitness: '64', fullVersion: '156.0.8078.80' });
    expect(win!.fullVersionList).toContainEqual({ brand: 'Chromium', version: '156.0.8078.80' });
    expect(win!.brands).toContainEqual({ brand: 'Google Chrome', version: '156' });
    // A different major than the engine cannot borrow the engine build number.
    expect(metadataFor(uaForOs('windows11', '157.0.0.1'), 'windows11', '156.0.8078.80')!.fullVersion).toBe('157.0.0.0');
    const mac = metadataFor(uaForOs('macos', '156.0.8078.80'), 'macos', '156.0.8078.80');
    expect(mac).toMatchObject({ platform: 'macOS', mobile: false, bitness: '64' });
    expect(JSON.stringify(mac!.brands)).toContain('Chromium');
  });

  it('maps fingerprint OS to standard legacy navigator.platform strings', () => {
    expect(navigatorPlatformByOs['windows11']).toBe('Win32');
    expect(navigatorPlatformByOs['windows10']).toBe('Win32');
    expect(navigatorPlatformByOs['macos']).toBe('MacIntel');
    expect(navigatorPlatformByOs['linux']).toBe('Linux x86_64');
  });

  it('generator produces a consistent set', () => {
    const fp = newFingerprint({ os: 'windows10', chromeVersion: '156.0.8078.80', random: () => 0.5 });
    expect(fp.userAgent).toContain('Windows NT 10.0');
    expect(fp.userAgent).toContain('Chrome/156.0.0.0 ');
    expect(fp.webglInfo.mode).toBe('manual');
    expect(fp.webglInfo.mode === 'manual' ? fp.webglInfo.renderer : '').toContain('ANGLE');
    expect([0.5, 1, 2, 4, 8]).toContain(fp.hardware.mode === 'manual' ? fp.hardware.memoryGb : 0);
    expect(fp.hardware.mode).toBe('manual');
    expect(fp.screen.mode).toBe('manual');
    expect(fp.canvas).toBe('noise');
    expect(fp.webgl).toBe('noise');
    expect(fp.clientRects).toBe('noise');
    expect(fp.timezone.mode).toBe('auto');
    expect(fp.geolocation.mode).toBe('block');
    expect('dpr' in fp.screen).toBe(false);
  });

  it('generator aligns GPU vendor to host when available', () => {
    const nvidiaFp = newFingerprint({ os: 'windows11', chromeVersion: '156.0.0.0', random: () => 0.1, hostGpuVendors: ['NVIDIA'] });
    expect(nvidiaFp.webglInfo.mode === 'manual' ? nvidiaFp.webglInfo.renderer : '').toContain('NVIDIA');

    const amdFp = newFingerprint({ os: 'windows11', chromeVersion: '156.0.0.0', random: () => 0.1, hostGpuVendors: ['AMD'] });
    expect(amdFp.webglInfo.mode === 'manual' ? amdFp.webglInfo.renderer : '').toContain('AMD');

    const intelFp = newFingerprint({ os: 'windows11', chromeVersion: '156.0.0.0', random: () => 0.1, hostGpuVendors: ['Intel'] });
    expect(intelFp.webglInfo.mode === 'manual' ? intelFp.webglInfo.renderer : '').toContain('Intel');

    const fallbackFp = newFingerprint({ os: 'macos', chromeVersion: '156.0.0.0', random: () => 0.1, hostGpuVendors: ['NVIDIA'] });
    expect(['Apple', 'Google Inc. (Intel)']).toContain(fallbackFp.webglInfo.mode === 'manual' ? fallbackFp.webglInfo.vendor : '');
  });

  it('arguments contain only public flags', () => {
    expect(fingerprintArgs({ ...DEFAULT_FINGERPRINT, webRtc: 'disableUdp', screen: manualScreen })).toEqual([
      '--window-size=1920,1080', '--webrtc-ip-handling-policy=disable_non_proxied_udp',
    ]);
    expect(fingerprintArgs({ ...DEFAULT_FINGERPRINT, webRtc: 'real', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/156.0.8078.80 Safari/537.36' })).toEqual(['--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/156.0.0.0 Safari/537.36']);
    expect(fingerprintArgs({ ...DEFAULT_FINGERPRINT, webRtc: 'real' })).toEqual([]);
    expect(fingerprintArgs({ ...DEFAULT_FINGERPRINT, webRtc: 'off' })).toEqual(['--webrtc-ip-handling-policy=disable_non_proxied_udp']);
  });

  it('forces the non-proxied UDP block whenever a proxy is used, even when WebRTC is Real', () => {
    const flag = '--webrtc-ip-handling-policy=disable_non_proxied_udp';
    expect(fingerprintArgs({ ...DEFAULT_FINGERPRINT, webRtc: 'real' }, { proxied: true })).toEqual([flag]);
    expect(fingerprintArgs({ ...DEFAULT_FINGERPRINT, webRtc: 'real' }, { proxied: false })).toEqual([]);
    expect(fingerprintArgs({ ...DEFAULT_FINGERPRINT, webRtc: 'real' })).toEqual([]);
    expect(fingerprintArgs({ ...DEFAULT_FINGERPRINT, webRtc: 'disableUdp' }, { proxied: true })).toEqual([flag]);
    const base = { profileId: 'p', userDataDir: 'd', startUrls: [], languages: ['en-US'], fingerprint: { ...DEFAULT_FINGERPRINT, webRtc: 'real' as const } };
    expect(chromiumArgs({ ...base, proxyUrl: 'http://127.0.0.1:1' })).toContain(flag);
    expect(chromiumArgs(base)).not.toContain(flag);
  });

  it('seed is stable and differs between profiles', () => {
    expect(seedFor('a')).toBe(seedFor('a'));
    expect(seedFor('a')).not.toBe(seedFor('b'));
    expect(Number.isInteger(seedFor('a'))).toBe(true);
  });
});

describe('client hints coherence', () => {
  it('generates standard Chromium GREASE brand and permutation orders', () => {
    // Chrome 120: seed=120, grease="Not_A Brand", version="8", order=[0, 1, 2]
    const v120 = generateBrandVersionList(120, '120', '120.0.6099.109');
    expect(v120.brands[0]).toEqual({ brand: 'Not_A Brand', version: '8' });
    expect(v120.brands[1]).toEqual({ brand: 'Chromium', version: '120' });
    expect(v120.brands[2]).toEqual({ brand: 'Google Chrome', version: '120' });

    // Chrome 124: seed=124, grease="Not-A.Brand", version="99", order=[2, 0, 1]
    const v124 = generateBrandVersionList(124, '124', '124.0.6367.60');
    expect(v124.brands[2]).toEqual({ brand: 'Not-A.Brand', version: '99' });
    expect(v124.brands[0]).toEqual({ brand: 'Chromium', version: '124' });
    expect(v124.brands[1]).toEqual({ brand: 'Google Chrome', version: '124' });

    // Chrome 126: seed=126, grease="Not/A)Brand", version="8", order=[0, 1, 2]
    const v126 = generateBrandVersionList(126, '126', '126.0.6478.126');
    expect(v126.brands[0]).toEqual({ brand: 'Not/A)Brand', version: '8' });
    expect(v126.brands[1]).toEqual({ brand: 'Chromium', version: '126' });
    expect(v126.brands[2]).toEqual({ brand: 'Google Chrome', version: '126' });
  });

  it('GREASE brand in metadataFor matches Chromium algorithm and preserves fullVersionList', () => {
    const metadata = metadataFor(uaForOs('windows11', '157.0.0.1'), 'windows11', '157.0.6000.1')!;
    // 157: seed=157, grease="Not-A.Brand", version="99", order=[0, 2, 1]
    expect(metadata.brands).toContainEqual({ brand: 'Not-A.Brand', version: '99' });
    expect(metadata.fullVersionList).toContainEqual({ brand: 'Not-A.Brand', version: '99' });
    expect(metadata.fullVersionList).toContainEqual({ brand: 'Chromium', version: '157.0.6000.1' });
  });

  it('macOS Client Hints are consistent with Apple Silicon', () => {
    const metadata = metadataFor(uaForOs('macos', '157.0.0.1'), 'macos', '156.0.8078.80')!;
    expect(metadata.architecture).toBe('arm');
  });
});

