import {readFile,stat} from 'node:fs/promises';
import {COOKIE_LIMITS,MAX_COOKIE_EXPIRY,isExpiredCookie,type CookieInput} from '../../shared/cookies';
import {buildCookie} from './normalize';
import {parseNetscape} from './netscape';

export type CookieFormat = 'json' | 'netscape';

const DAY = 86400;

export function detectCookieFormat(text: string): CookieFormat {
  const first = text.trimStart()[0];
  return first === '[' || first === '{' ? 'json' : 'netscape';
}

export async function readCookieFile(filePath: string): Promise<string> {
  const info = await stat(filePath);
  if (info.size > COOKIE_LIMITS.fileBytes) throw Error('COOKIES_TOO_LARGE');
  const bytes = await readFile(filePath);
  const body = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    throw Error('INVALID_COOKIE_FILE');
  }
}

function normalizeExpiry(value: unknown, now: number): { expiry: number | null; expired: boolean } {
  if (value === undefined || value === null || value === '' || value === 0 || value === '0' || value === -1 || value === '-1')
    return { expiry: null, expired: false };
  const raw = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(raw) || raw <= 0) throw Error('INVALID_COOKIE_FILE');
  for (const candidate of [raw, raw * 1000, raw / 1000]) {
    if (candidate > now && candidate <= MAX_COOKIE_EXPIRY) return { expiry: Math.floor(candidate), expired: false };
  }
  if ([raw, raw * 1000, raw / 1000].some(n => n > 0 && n <= now)) return { expiry: null, expired: true };
  return { expiry: Math.floor(now + 365 * DAY), expired: false };
}

function normalizeJsonCookie(raw: unknown, now: number): { cookie: CookieInput; expired: boolean } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('INVALID_COOKIE_FILE');
  const input = raw as Record<string, unknown>;
  const { expiry, expired } = normalizeExpiry(input.expirationDate ?? input.expires, now);
  const cookie = buildCookie({
    domain: input.domain,
    name: input.name,
    path: input.path,
    value: input.value,
    expirationDate: expiry,
    httpOnly: input.httpOnly,
    secure: input.secure,
    sameSite: input.sameSite,
    storeId: input.storeId,
  });
  return { cookie, expired: expired || isExpiredCookie(cookie, now) };
}

export function parseJsonCookies(text: string, now = Math.floor(Date.now() / 1000)): CookieInput[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw Error('INVALID_COOKIE_FILE');
  }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { cookies?: unknown }).cookies) ? (raw as { cookies: unknown[] }).cookies : null;
  if (!list) throw Error('INVALID_COOKIE_FILE');
  if (list.length > COOKIE_LIMITS.entries) throw Error('COOKIES_TOO_MANY');
  const out: CookieInput[] = [];
  for (const item of list) {
    const { cookie, expired } = normalizeJsonCookie(item, now);
    if (!expired) out.push(cookie);
  }
  return out;
}

export function parseCookies(text: string, now = Math.floor(Date.now() / 1000)): CookieInput[] {
  return detectCookieFormat(text) === 'json' ? parseJsonCookies(text, now) : parseNetscape(text, now);
}
