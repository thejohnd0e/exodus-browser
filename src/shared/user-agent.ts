import type { Fingerprint, FingerprintOs } from './fingerprint';

export interface UserAgentMetadata {
  brands: { brand: string; version: string }[];
  fullVersionList: { brand: string; version: string }[];
  fullVersion: string;
  platform: string;
  platformVersion: string;
  architecture: string;
  model: string;
  mobile: boolean;
  bitness: string;
  wow64: boolean;
}

const platformByOs: Record<FingerprintOs, string> = { windows11: 'Windows', windows10: 'Windows', macos: 'macOS', linux: 'Linux' };
const platformVersionByOs: Record<FingerprintOs, string> = { windows11: '15.0.0', windows10: '10.0.0', macos: '15.0.0', linux: '6.5.0' };
const osMarker: Record<FingerprintOs, string> = { windows11: 'Windows NT 10.0', windows10: 'Windows NT 10.0', macos: 'Macintosh', linux: 'Linux' };

export function uaForOs(os: FingerprintOs, chromeVersion: string): string {
  const chrome = `Mozilla/5.0 (${{ windows11: 'Windows NT 10.0; Win64; x64', windows10: 'Windows NT 10.0; Win64; x64', macos: 'Macintosh; Intel Mac OS X 10_15_7', linux: 'X11; Linux x86_64' }[os]}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  return chrome;
}

export function osMarkerOf(ua: string): string | null {
  if (ua.includes('Windows NT 10.0')) return 'Windows NT 10.0';
  if (ua.includes('Macintosh')) return 'Macintosh';
  if (ua.includes('Linux x86_64')) return 'Linux';
  return null;
}

export function chromeMajorOf(ua: string): string | null {
  const match = /Chrome\/(\d+)/.exec(ua);
  return match ? match[1] : null;
}

export function fullVersionOf(ua: string): string | null {
  return /Chrome\/([\d.]+)/.exec(ua)?.[1] ?? null;
}

export function metadataFor(ua: string, os: FingerprintOs, engineUserAgent: string): UserAgentMetadata | null {
  if (osMarkerOf(ua) === osMarkerOf(engineUserAgent) && fullVersionOf(ua) === fullVersionOf(engineUserAgent)) return null;
  const major = chromeMajorOf(ua) ?? chromeMajorOf(engineUserAgent) ?? '156';
  const full = /Chrome\/([\d.]+)/.exec(ua)?.[1] ?? major;
  const brand = (brand: string) => ({ brand, version: major });
  const fullBrand = (brand: string) => ({ brand, version: full });
  const grease = { brand: 'Not_A Brand', version: '24' };
  return {
    brands: [brand('Chromium'), brand('Google Chrome'), grease],
    fullVersionList: [fullBrand('Chromium'), fullBrand('Google Chrome'), grease],
    fullVersion: full,
    platform: platformByOs[os],
    platformVersion: platformVersionByOs[os],
    architecture: os === 'macos' ? 'arm' : 'x86',
    model: '',
    mobile: false,
    bitness: '64',
    wow64: false,
  };
}

export interface GpuPreset { vendor: string; renderer: string }

export const gpuByOs: Record<'windows' | 'macos' | 'linux', readonly GpuPreset[]> = {
  windows: [
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  ],
  macos: [
    { vendor: 'Apple', renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)' },
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) Iris(TM) Plus Graphics 655, OpenGL 4.1)' },
  ],
  linux: [
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CML GT2), OpenGL 4.6 (Core Profile) Mesa 23.0.4)' },
    { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT (radeonsi navi22 LLVM 15.0.7), OpenGL 4.6 (Core Profile) Mesa 23.0.4)' },
  ],
};

export const screensByOs: Record<'windows' | 'macos' | 'linux', readonly (readonly [number, number])[]> = {
  windows: [[1920, 1080], [2560, 1440], [1536, 864], [1680, 1050], [1366, 768]],
  macos: [[1512, 982], [1728, 1117], [1440, 900], [1920, 1080]],
  linux: [[1920, 1080], [2560, 1440], [1600, 900], [1366, 768]],
};

export function catalogFor(os: FingerprintOs): 'windows' | 'macos' | 'linux' {
  return os === 'macos' ? 'macos' : os === 'linux' ? 'linux' : 'windows';
}
