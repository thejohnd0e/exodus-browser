import { describe, it, expect } from 'vitest';
import { buildSpoofScript, buildWorkerSpoofScript, deriveScreenAvailability, spoofConfig, webgpuInfoFor } from '../../src/main/engines/spoof-script';
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
    const script = buildSpoofScript({ ...DEFAULT_FINGERPRINT, hardware }, 1);
    expect(script).not.toContain('getImageData');
    expect(script).not.toContain('toDataURL');
    expect(script).not.toContain('RTCPeerConnection');
    expect(script).not.toContain('getClientRects');
  });

  it('a profile without spoofed surfaces injects nothing, not even the toString mask', () => {
    const untouched = { ...DEFAULT_FINGERPRINT, geolocation: { mode: 'auto' as const } };
    expect(buildSpoofScript(untouched, 1)).toBe('');
    expect(buildWorkerSpoofScript(untouched, 1)).toBe('');
  });

  it('frames share one mask registry through a per-script handshake', () => {
    const a = buildSpoofScript({ ...DEFAULT_FINGERPRINT, canvas: 'noise' }, 1);
    const b = buildSpoofScript({ ...DEFAULT_FINGERPRINT, canvas: 'noise' }, 1);
    expect(a).toContain('parent');
    expect(a).not.toContain('__NONCE__');
    expect(a).not.toBe(b);
  });

  it('maps WebGL presets to the WebGPU adapter vendor and architecture Chromium reports', () => {
    expect(webgpuInfoFor('Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toEqual({ vendor: 'nvidia', architecture: 'ampere' });
    expect(webgpuInfoFor('Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toEqual({ vendor: 'nvidia', architecture: 'lovelace' });
    expect(webgpuInfoFor('Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)')).toEqual({ vendor: 'nvidia', architecture: 'turing' });
    expect(webgpuInfoFor('Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toEqual({ vendor: 'amd', architecture: 'rdna-2' });
    expect(webgpuInfoFor('Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toEqual({ vendor: 'amd', architecture: 'gcn-4' });
    expect(webgpuInfoFor('Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)')).toEqual({ vendor: 'intel', architecture: 'gen-12lp' });
    expect(webgpuInfoFor('Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toEqual({ vendor: 'intel', architecture: 'gen-9' });
    expect(webgpuInfoFor('Some Vendor', 'Unknown Renderer')).toEqual({ vendor: '', architecture: '' });
  });

  it('a manual WebGL identity also aligns the WebGPU adapter info in pages and workers', () => {
    const fp = { ...DEFAULT_FINGERPRINT, webglInfo: { mode: 'manual' as const, vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' } };
    expect(buildSpoofScript(fp, 1)).toContain('GPUAdapterInfo');
    expect(buildWorkerSpoofScript(fp, 1)).toContain('GPUAdapterInfo');
    expect(buildSpoofScript({ ...fp, webgpu: 'off' }, 1)).not.toContain('GPUAdapterInfo');
  });

  it('manual screen mode patches screen and outer window dimensions', () => {
    const script = buildSpoofScript({ ...DEFAULT_FINGERPRINT, screen }, 1);
    expect(script).toContain('availWidth');
    expect(script).toContain('outerWidth');
    expect(script).toContain('1512');
  });

  it('takes the available screen area from the display model instead of a fixed taskbar', () => {
    const script = buildSpoofScript({ ...DEFAULT_FINGERPRINT, screen }, 1, { width: 1512, height: 942 });
    expect(script).toContain('"availWidth":1512');
    expect(script).toContain('"availHeight":942');
    expect(script).not.toContain('h-40');
  });

  it('derives the available area from the real work-area inset', () => {
    expect(deriveScreenAvailability({ width: 1920, height: 1080 }, { width: 2560, height: 1440, availWidth: 2560, availHeight: 1400 }))
      .toEqual({ width: 1920, height: 1040 });
    expect(deriveScreenAvailability({ width: 1920, height: 1080 }, { width: 2560, height: 1440, availWidth: 2560, availHeight: 1440 }))
      .toEqual({ width: 1920, height: 1080 });
    expect(deriveScreenAvailability({ width: 800, height: 600 }, { width: 1024, height: 768, availWidth: 1024, availHeight: 0 }))
      .toEqual({ width: 800, height: 1 });
  });

  it('webrtc off removes the constructor and legacy webkit aliases', () => {
    const script = buildSpoofScript({ ...DEFAULT_FINGERPRINT, webRtc: 'off' }, 1);
    expect(script).toContain('RTCPeerConnection');
    expect(script).toContain('webkitRTCPeerConnection');
  });

  it('configuration contains no profile secrets', () => {
    const script = buildSpoofScript({ ...DEFAULT_FINGERPRINT, canvas: 'noise', hardware }, 3);
    expect(script).not.toContain('password');
    expect(script).not.toContain('proxy');
  });

  it('script with all sections enabled has valid syntax', () => {
    const script = buildSpoofScript({
      ...DEFAULT_FINGERPRINT, canvas: 'noise', webgl: 'noise', clientRects: 'noise', audio: 'noise', webgpu: 'off', webRtc: 'off',
      hardware, screen,
    }, 3);
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain('getBoundingClientRect');
  });

  it('worker spoof script applies hardware and platform for worker scopes', () => {
    const script = buildWorkerSpoofScript({ ...DEFAULT_FINGERPRINT, os: 'macos', hardware }, 3);
    expect(script).toContain('WorkerNavigator');
    expect(script).toContain('MacIntel');
    expect(script).toContain('"cores":12');
    expect(() => new Function(script)).not.toThrow();
  });

  it('stealth: does not leak Dolphin or Exodus global variables (__LP_FP__)', () => {
    const pageScript = buildSpoofScript({ ...DEFAULT_FINGERPRINT, canvas: 'noise', hardware }, 1);
    const workerScript = buildWorkerSpoofScript({ ...DEFAULT_FINGERPRINT, os: 'macos', hardware }, 1);
    expect(pageScript).not.toContain('__LP_FP__');
    expect(workerScript).not.toContain('__LP_FP__');
  });

  it('stealth: patches Function.prototype.toString using a WeakMap mask', () => {
    const script = buildSpoofScript({ ...DEFAULT_FINGERPRINT, canvas: 'noise' }, 1);
    expect(script).toContain('WeakMap');
    expect(script).toContain('Function.prototype.toString');
  });

  it('stealth: defines hardware and screen on prototypes, not instances', () => {
    const script = buildSpoofScript({ ...DEFAULT_FINGERPRINT, hardware, screen }, 1);
    expect(script).toContain('Navigator.prototype');
    expect(script).toContain('Screen.prototype');
    expect(script).not.toContain("def(navigator,'hardwareConcurrency'");
    expect(script).not.toContain("def(screen,'width'");
  });

  it('stealth: audio noise hooks AudioBuffer channel data methods', () => {
    const script = buildSpoofScript({ ...DEFAULT_FINGERPRINT, audio: 'noise' }, 1);
    expect(script).toContain('AudioBuffer.prototype');
    expect(script).toContain('getChannelData');
  });

  it('stealth: clientRects noise covers Range.prototype and noises the rects the browser returned, in place', () => {
    const script = buildSpoofScript({ ...DEFAULT_FINGERPRINT, clientRects: 'noise' }, 1);
    expect(script).toContain('Range.prototype');
    expect(script).toContain('noiseRectList');
    // A Proxy over DOMRectList leaked the real values through descriptors (client-rects.test.ts).
    expect(script).not.toContain('new Proxy(list');
  });

  it('stealth: geolocation block mode leaves page APIs untouched (browser-level permission)', () => {
    const script = buildSpoofScript({ ...DEFAULT_FINGERPRINT, geolocation: { mode: 'block' } }, 1);
    expect(script).toBe('');
  });
});

describe('out-of-process frame screen',()=>{
  const manual={...DEFAULT_FINGERPRINT,screen:{mode:'manual' as const,width:1512,height:982,dpr:2}};
  it('is configured only for an out-of-process frame with a manual screen',()=>{
    expect(spoofConfig(manual,1,undefined,true).frameScreen).toEqual({dpr:2});
    expect(spoofConfig(manual,1).frameScreen).toBeNull();
    expect(spoofConfig(DEFAULT_FINGERPRINT,1,undefined,true).frameScreen).toBeNull();
    expect(spoofConfig({...manual,screen:{mode:'manual' as const,width:1512,height:982}},1,undefined,true).frameScreen).toEqual({dpr:null});
  });
  it('adds the matchMedia rewrite to the frame script and never to the top page script',()=>{
    expect(buildSpoofScript(manual,1,undefined,{outOfProcessFrame:true})).toContain("keep(window,'matchMedia'");
    expect(buildSpoofScript(manual,1)).not.toContain("keep(window,'matchMedia'");
  });
});
