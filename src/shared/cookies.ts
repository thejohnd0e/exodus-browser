import { z } from 'zod';

export type CookieSameSite = 'unspecified' | 'no_restriction' | 'lax' | 'strict';
export interface CookieInput {
  domain: string;
  name: string;
  path: string;
  value: string;
  /** Unix seconds; null means a session cookie. */
  expirationDate: number | null;
  httpOnly: boolean;
  secure: boolean;
  sameSite: CookieSameSite;
  /** "0" means unpartitioned; other values are not supported. */
  storeId: string;
}

export const COOKIE_LIMITS = {
  fileBytes: 5 * 1024 * 1024,
  entries: 20000,
  domain: 256,
  path: 1024,
  name: 1024,
  value: 8192,
} as const;

/** 2100-01-01T00:00:00Z is the upper bound for cookie expiration. */
export const MAX_COOKIE_EXPIRY = 4102444800;

const noControls = (s: string) => !/[\x00-\x1f\x7f]/.test(s);
const domain = z.string().max(COOKIE_LIMITS.domain).regex(/^\.?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i);
const text = (max: number) => z.string().max(max).refine(noControls, 'Invalid characters in cookie');
const bytes = (s: string) => new TextEncoder().encode(s).length;

export const cookieInputSchema = z.object({
  domain,
  name: text(COOKIE_LIMITS.name).min(1),
  path: text(COOKIE_LIMITS.path).startsWith('/'),
  value: z.string().max(COOKIE_LIMITS.value * 4).refine(noControls, 'Invalid characters in cookie').refine(s => bytes(s) <= COOKIE_LIMITS.value, 'Cookie value is too long'),
  expirationDate: z.union([z.null(), z.number().int().min(1).max(MAX_COOKIE_EXPIRY)]),
  httpOnly: z.boolean(),
  secure: z.boolean(),
  sameSite: z.enum(['unspecified', 'no_restriction', 'lax', 'strict']),
  storeId: z.literal('0'),
}).strict().superRefine((cookie, ctx) => {
  if (cookie.sameSite === 'no_restriction' && !cookie.secure)
    ctx.addIssue({ code: 'custom', path: ['secure'], message: 'SameSite=None requires secure' });
  if (cookie.name.startsWith('__Secure-') && !cookie.secure)
    ctx.addIssue({ code: 'custom', path: ['secure'], message: '__Secure- requires secure' });
  if (cookie.name.startsWith('__Host-') && (!cookie.secure || cookie.path !== '/' || cookie.domain.startsWith('.')))
    ctx.addIssue({ code: 'custom', path: ['name'], message: '__Host- requires secure, path=/ and a host-only domain' });
});

export function cookieKey(cookie: Pick<CookieInput, 'domain' | 'path' | 'name'>): string {
  return `${cookie.domain}\t${cookie.path}\t${cookie.name}`;
}

export function isExpiredCookie(cookie: Pick<CookieInput, 'expirationDate'>, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  return cookie.expirationDate !== null && cookie.expirationDate > 0 && cookie.expirationDate <= nowSeconds;
}
