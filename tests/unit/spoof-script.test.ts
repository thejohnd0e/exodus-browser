import { describe, it, expect } from 'vitest';
import { buildSpoofScript } from '../../src/main/engines/spoof-script';
import { DEFAULT_FINGERPRINT } from '../../src/shared/fingerprint';

const hardware = { mode: 'manual' as const, cores: 12, memoryGb: 8 as const };
const screen = { mode: 'manual' as const, width: 1512, height: 982, dpr: 2 };

describe('spoof script', () => {
  it('creates a safe script literal with the requested values', () => {
    const script = buildSpoofScript({
      ...DEFAULT_FINGERPRINT, canvas: 'noise', webgpu: 'off',
      webglInfo: { mode: 'manual', vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, RTX)' }, hardware,
    }, 7);
    expect(script.startsWith('(()=>{')).toBe(true);
    expect(script).toContain('ANGLE (NVIDIA, RTX)');
    expect(script).toContain('"cores":12');
    expect(script).toContain('"seed":7');
    expect(() => new Function(script)).not.toThrow();
  });

  it('quotes and slashes in values do not break the literal', () => {
    const script = buildSpoofScript({
      ...DEFAULT_FINGERPRINT, webglInfo: { mode: 'manual', vendor: 'a"b', renderer: "c'd\\e" },
    }, 1);
    expect(() => new Function(script)).not.toThrow();
  });

  it('real mode does not patch canvas, webgl or webrtc', () => {
    const script = buildSpoofScript(DEFAULT_FINGERPRINT, 1);
    expect(script).not.toContain('getImageData');
    expect(script).not.toContain('toDataURL');
    expect(script).not.toContain('RTCPeerConnection');
    expect(script).not.toContain('getClientRects');
  });

  it('manual screen mode patches screen and outer window dimensions', () => {
    const script = buildSpoofScript({ ...DEFAULT_FINGERPRINT, screen }, 1);
    expect(script).toContain('availWidth');
    expect(script).toContain('outerWidth');
    expect(script).toContain('1512');
  });

  it('webrtc off and altered handle RTCPeerConnection', () => {
    expect(buildSpoofScript({ ...DEFAULT_FINGERPRINT, webRtc: 'off' }, 1)).toContain('RTCPeerConnection');
    expect(buildSpoofScript({ ...DEFAULT_FINGERPRINT, webRtc: 'altered' }, 1)).toContain('RTCPeerConnection');
  });

  it('configuration contains no profile secrets', () => {
    const script = buildSpoofScript({ ...DEFAULT_FINGERPRINT, canvas: 'noise', hardware }, 3);
    expect(script).not.toContain('password');
    expect(script).not.toContain('proxy');
  });

  it('script with all sections enabled has valid syntax', () => {
    const script = buildSpoofScript({
      ...DEFAULT_FINGERPRINT, canvas: 'noise', webgl: 'noise', clientRects: 'noise', audio: 'noise', webgpu: 'off', webRtc: 'altered',
      hardware, screen,
    }, 3);
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain('getBoundingClientRect');
  });
});
