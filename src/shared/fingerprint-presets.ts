import type { Fingerprint, FingerprintOs } from './fingerprint';
import { catalogFor, gpuByOs, screensByOs, uaForOs } from './user-agent';

const pick = <T,>(items: readonly T[], random: () => number): T => items[Math.floor(random() * items.length) % items.length];

export function newFingerprint(input: { os: FingerprintOs; chromeVersion: string; random: () => number }): Fingerprint {
  const catalog = catalogFor(input.os);
  const gpu = pick(gpuByOs[catalog], input.random);
  const [width, height] = pick(screensByOs[catalog], input.random);
  return {
    os: input.os,
    userAgent: uaForOs(input.os, input.chromeVersion),
    webRtc: 'disableUdp',
    canvas: 'noise',
    webgl: 'noise',
    webglInfo: { mode: 'manual', vendor: gpu.vendor, renderer: gpu.renderer },
    webgpu: 'on',
    clientRects: 'noise',
    audio: 'real',
    timezone: { mode: 'auto' },
    geolocation: { mode: 'auto' },
    hardware: { mode: 'manual', cores: pick([4, 8, 12, 16], input.random), memoryGb: pick([4, 8], input.random) },
    screen: { mode: 'manual', width, height, dpr: input.os === 'macos' ? 2 : 1 },
  };
}
