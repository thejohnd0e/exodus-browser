import { createHash } from 'node:crypto';
import type { Fingerprint } from '../../shared/fingerprint';
import { reduceUserAgent } from '../../shared/user-agent';

/**
 * The switch name is `--webrtc-ip-handling-policy`; the older
 * `--force-webrtc-ip-handling-policy` form was measured to have no effect on
 * STUN traffic in the tested Chromium build. See docs/verification.md.
 */
export const WEBRTC_IP_HANDLING_SWITCH = '--webrtc-ip-handling-policy';

export function fingerprintArgs(fingerprint: Fingerprint, options: { proxied?: boolean } = {}): string[] {
  const args: string[] = [];
  if (fingerprint.userAgent) args.push('--user-agent=' + reduceUserAgent(fingerprint.userAgent));
  if (fingerprint.screen.mode === 'manual') args.push(`--window-size=${fingerprint.screen.width},${fingerprint.screen.height}`);
  // With a proxy, non-proxied UDP (STUN) would reveal the real IP, so the policy applies even in Real mode.
  if (fingerprint.webRtc !== 'real' || options.proxied) args.push(`${WEBRTC_IP_HANDLING_SWITCH}=disable_non_proxied_udp`);
  // WebGPU Off stops Chrome's WebGPU service, so navigator.gpu stays (as in Chrome on a machine without
  // a usable adapter) but requestAdapter() resolves to null in pages, workers and through the
  // prototype getter. A JavaScript patch could be stepped around (DECISIONS #76). Measured on Chrome
  // 157 and Chromium 149; --disable-blink-features=WebGPU and --disable-features=WebGPU had no effect.
  if (fingerprint.webgpu === 'off') args.push('--disable-features=WebGPUService');
  // WebGL Off is Chrome's own switch: getContext('webgl'/'webgl2') on a canvas element returns null
  // whatever the argument is; a getContext patch was bypassed with new String('webgl') (audit
  // recheck 2026-11-08). OffscreenCanvas still creates a context with this or --disable-3d-apis, so
  // page and worker scripts guard that path (OFFSCREEN_WEBGL_OFF). Measured on Chrome 157.
  if (fingerprint.webgl === 'off') args.push('--disable-webgl');
  return args;
}

export function seedFor(profileId: string): number {
  return createHash('sha256').update(profileId).digest().readUInt32BE(0);
}
