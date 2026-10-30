import { z } from 'zod';

export type FingerprintOs = 'windows11' | 'windows10' | 'macos' | 'linux';
export type FingerprintMode = 'off' | 'real' | 'noise';
const text = (max: number) => z.string().max(max).refine((s) => !/[\r\n\0]/.test(s), 'Invalid characters in fingerprint value');
const isTimeZone = (s: string) => { try { new Intl.DateTimeFormat('en-US', { timeZone: s }); return true; } catch { return false; } };
const osMarker: Record<FingerprintOs, string> = { windows11: 'Windows NT 10.0', windows10: 'Windows NT 10.0', macos: 'Macintosh', linux: 'Linux' };

export const fingerprintSchema = z.object({
  os: z.enum(['windows11', 'windows10', 'macos', 'linux']),
  userAgent: z.union([z.null(), text(512)]),
  webRtc: z.enum(['off', 'real', 'disableUdp', 'altered']),
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
    z.object({ mode: z.literal('manual'), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracy: z.number().min(1).max(10000) }).strict(),
  ]),
  hardware: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('real') }).strict(),
    z.object({ mode: z.literal('manual'), cores: z.number().int().min(1).max(64), memoryGb: z.union([z.literal(0.5), z.literal(1), z.literal(2), z.literal(4), z.literal(8)]) }).strict(),
  ]),
  screen: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('real') }).strict(),
    z.object({ mode: z.literal('manual'), width: z.number().int().min(800).max(7680), height: z.number().int().min(600).max(4320), dpr: z.number().min(1).max(3) }).strict(),
  ]),
}).strict().superRefine((value, ctx) => {
  if (typeof value.userAgent === 'string' && !value.userAgent.includes(osMarker[value.os]))
    ctx.addIssue({ code: 'custom', path: ['userAgent'], message: 'User-Agent does not match the selected OS' });
});

export type Fingerprint = z.infer<typeof fingerprintSchema>;
export const DEFAULT_FINGERPRINT: Fingerprint = {
  os: 'windows11', userAgent: null, webRtc: 'real', canvas: 'real', webgl: 'real', webglInfo: { mode: 'real' },
  webgpu: 'on', clientRects: 'real', audio: 'real', timezone: { mode: 'auto' }, geolocation: { mode: 'auto' },
  hardware: { mode: 'real' }, screen: { mode: 'real' },
};
export function normalizeFingerprint(value: unknown): Fingerprint {
  return fingerprintSchema.safeParse(value).success ? fingerprintSchema.parse(value) : DEFAULT_FINGERPRINT;
}
