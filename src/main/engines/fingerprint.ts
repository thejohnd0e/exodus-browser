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
  return args;
}

export function seedFor(profileId: string): number {
  return createHash('sha256').update(profileId).digest().readUInt32BE(0);
}
