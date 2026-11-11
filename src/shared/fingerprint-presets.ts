import type { Fingerprint, FingerprintOs } from './fingerprint';
import { catalogFor, gpuByOs, screensByOs, uaForOs } from './user-agent';

const pick = <T,>(items: readonly T[], random: () => number): T => items[Math.floor(random() * items.length) % items.length];

/** Reduces an adapter name to the tokens that identify the model ("NVIDIA GeForce RTX 3060" -> "rtx 3060"). */
const modelKey=(name:string)=>name.toLowerCase()
  .replace(/\(r\)|\(tm\)/g,' ')
  .replace(/\b(nvidia|geforce|amd|radeon|intel|graphics|corporation|inc\.?)\b/g,' ')
  .replace(/\s+/g,' ')
  .trim();

/** The card part of an ANGLE renderer string, normalised like an adapter name. */
const cardKey=(renderer:string)=>{
  const inner=/ANGLE \([^,]+, ([^,]+)/.exec(renderer)?.[1]??renderer;
  return modelKey(inner.split(/ direct3d| opengl|, d3d/i)[0]);
};

export function newFingerprint(input: { os: FingerprintOs; chromeVersion: string; random: () => number; hostGpuVendors?: readonly string[]; hostGpuModels?: readonly string[]; hostScreen?: { width: number; height: number } }): Fingerprint {
  const catalog = catalogFor(input.os);
  const presets = gpuByOs[catalog];
  const families = input.hostGpuVendors ?? [];
  const models = (input.hostGpuModels ?? []).map(modelKey).filter(Boolean);
  const matching = families.length
    ? presets.filter(g => families.some(family => g.vendor.toLowerCase().includes(family.toLowerCase()) || g.renderer.toLowerCase().includes(family.toLowerCase())))
    : [];
  // Optional opt-in: match the installed card exactly, which sacrifices variety for consistency.
  const exact = models.length ? matching.filter(g => models.includes(cardKey(g.renderer))) : [];
  const gpu = pick(exact.length > 0 ? exact : matching.length > 0 ? matching : presets, input.random);
  // A window can be as large as the host display, so a smaller reported screen would put the page's inner
  // size above its screen size. Only sizes that cover the host display are offered; without one, the real
  // screen stays.
  const host = input.hostScreen;
  const sizes = host ? screensByOs[catalog].filter(([w, h]) => w >= host.width && h >= host.height) : screensByOs[catalog];
  const size = sizes.length ? pick(sizes, input.random) : null;
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
    geolocation: { mode: 'block' },
    hardware: { mode: 'manual', cores: pick(gpu.cores ?? [4, 8, 12, 16], input.random), memoryGb: pick(gpu.memoryGb ?? [4, 8], input.random) },
    screen: size ? { mode: 'manual', width: size[0], height: size[1] } : { mode: 'real' },
  };
}
