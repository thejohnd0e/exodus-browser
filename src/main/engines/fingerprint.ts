import { createHash } from 'node:crypto';
import type { Fingerprint } from '../../shared/fingerprint';

export function fingerprintArgs(fingerprint: Fingerprint): string[] {
  const args: string[] = [];
  if (fingerprint.userAgent) args.push('--user-agent=' + fingerprint.userAgent);
  if (fingerprint.screen.mode === 'manual') args.push(`--window-size=${fingerprint.screen.width},${fingerprint.screen.height}`);
  if (fingerprint.webRtc !== 'real') args.push('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
  return args;
}

export function seedFor(profileId: string): number {
  return createHash('sha256').update(profileId).digest().readUInt32BE(0);
}
