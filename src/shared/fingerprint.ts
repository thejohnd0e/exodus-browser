import { z } from 'zod';

export type FingerprintOs = 'windows11' | 'windows10' | 'macos' | 'linux';
export type FingerprintMode = 'off' | 'real' | 'noise';
const text = (max: number) => z.string().max(max).refine((s) => !/[\r\n\0]/.test(s), 'Invalid characters in fingerprint value');
export const isTimeZone = (s: string) => { try { new Intl.DateTimeFormat('en-US', { timeZone: s }); return true; } catch { return false; } };
const osMarker: Record<FingerprintOs, string> = { windows11: 'Windows NT 10.0', windows10: 'Windows NT 10.0', macos: 'Macintosh', linux: 'Linux' };

/** WebRTC `altered` was removed: it rewrote only createOffer SDP and was detectable. Old data migrates to Disable UDP. */
function migrateWebRtc(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value) && (value as { webRtc?: unknown }).webRtc === 'altered')
    return { ...(value as Record<string, unknown>), webRtc: 'disableUdp' };
  return value;
}

/** The `proxy` time zone mode was merged into `auto`, which now follows the exit IP. A saved zone was only a
 * workaround for countries with several zones and is dropped: the zone is resolved from the IP at launch. */
function migrateTimeZone(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const fingerprint = value as { timezone?: { mode?: unknown } };
  if (fingerprint.timezone?.mode !== 'proxy' && fingerprint.timezone?.mode !== 'auto') return value;
  return { ...(value as Record<string, unknown>), timezone: { mode: 'auto' } };
}

const fingerprintObject = z.object({
  os: z.enum(['windows11', 'windows10', 'macos', 'linux']),
  userAgent: z.union([z.null(), text(512)]),
  webRtc: z.enum(['off', 'real', 'disableUdp']),
  canvas: z.enum(['off', 'real', 'noise']),
  webgl: z.enum(['off', 'real', 'noise']),
  webglInfo: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('real') }).strict(),
    z.object({ mode: z.literal('manual'), vendor: text(256).min(1), renderer: text(512).min(1) }).strict(),
  ]),
  webgpu: z.enum(['on', 'off']),
  clientRects: z.enum(['real', 'noise']),
  audio: z.enum(['real', 'noise']),
  timezone: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('auto') }).strict(),
    z.object({ mode: z.literal('manual'), value: z.string().min(1).max(64).refine(isTimeZone, 'Invalid time zone') }).strict(),
  ]),
  geolocation: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('auto') }).strict(),
    z.object({ mode: z.literal('block') }).strict(),
    z.object({ mode: z.literal('manual'), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracy: z.number().min(1).max(10000) }).strict(),
  ]),
  hardware: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('real') }).strict(),
    z.object({ mode: z.literal('manual'), cores: z.number().int().min(1).max(64), memoryGb: z.union([z.literal(0.5), z.literal(1), z.literal(2), z.literal(4), z.literal(8)]) }).strict(),
  ]),
  screen: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('real') }).strict(),
    z.object({ mode: z.literal('manual'), width: z.number().int().min(800).max(7680), height: z.number().int().min(600).max(4320), dpr: z.number().min(1).max(3).optional() }).strict(),
  ]),
}).strict().superRefine((value, ctx) => {
  if (typeof value.userAgent === 'string' && !value.userAgent.includes(osMarker[value.os]))
    ctx.addIssue({ code: 'custom', path: ['userAgent'], message: 'User-Agent does not match the selected OS' });
});

export const fingerprintSchema = z.preprocess(value => migrateTimeZone(migrateWebRtc(value)), fingerprintObject);

export type Fingerprint = z.infer<typeof fingerprintObject>;
export const DEFAULT_FINGERPRINT: Fingerprint = {
  os: 'windows11', userAgent: null, webRtc: 'disableUdp', canvas: 'real', webgl: 'real', webglInfo: { mode: 'real' },
  webgpu: 'on', clientRects: 'real', audio: 'real', timezone: { mode: 'auto' }, geolocation: { mode: 'block' },
  hardware: { mode: 'real' }, screen: { mode: 'real' },
};
/** Fail-closed parser used before launching a browser: an unreadable fingerprint must never silently become the default. */
export function strictFingerprint(value: unknown): Fingerprint {
  if (value === undefined) return DEFAULT_FINGERPRINT;
  const parsed = fingerprintSchema.safeParse(value);
  if (!parsed.success) throw Error('FINGERPRINT_INVALID');
  return parsed.data;
}
/** Lenient parser for display only; never use it to decide launch behaviour. */
export function normalizeFingerprint(value: unknown): Fingerprint {
  return fingerprintSchema.safeParse(value).success ? fingerprintSchema.parse(value) : DEFAULT_FINGERPRINT;
}
