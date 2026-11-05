import {cookieInputSchema,type CookieInput} from '../../shared/cookies';

export const SPECIAL_COOKIE_NAMES = new Set(['c_user', 'xs', 'fr', 'datr', 'sb']);

export function normalizeCookieDomain(value: unknown): string {
  const domain = String(value ?? '').trim().toLowerCase();
  if (!domain) throw Error('INVALID_COOKIE_FILE');
  if (/(^|\.)facebook\.com$/.test(domain) && !domain.startsWith('.')) return '.' + domain;
  return domain;
}

export function buildCookie(input: {
  domain: unknown;
  name: unknown;
  path: unknown;
  value: unknown;
  expirationDate: number | null;
  httpOnly: unknown;
  secure: unknown;
  sameSite: unknown;
  storeId: unknown;
}): CookieInput {
  const name = String(input.name ?? '');
  let secure = input.secure === true || input.secure === 1 || input.secure === 'true' || input.secure === '1';
  let path = String(input.path ?? '/');
  let domain = normalizeCookieDomain(input.domain);
  const special = SPECIAL_COOKIE_NAMES.has(name);
  if (special) secure = true;
  if (name.startsWith('__Secure-')) secure = true;
  if (name.startsWith('__Host-')) {
    secure = true;
    path = '/';
    domain = domain.replace(/^\./, '');
  }
  const text = typeof input.sameSite === 'string' ? input.sameSite.toLowerCase() : '';
  const sameSite: CookieInput['sameSite'] = special
    ? 'no_restriction'
    : text === 'none' || text === 'no_restriction'
      ? 'no_restriction'
      : text === 'lax'
        ? 'lax'
        : text === 'strict'
          ? 'strict'
          : 'unspecified';
  const candidate: CookieInput = {
    domain,
    name,
    path,
    value: String(input.value ?? ''),
    expirationDate: input.expirationDate,
    httpOnly: special || input.httpOnly === true || input.httpOnly === 1 || input.httpOnly === 'true' || input.httpOnly === '1',
    secure: secure || sameSite === 'no_restriction',
    sameSite,
    storeId: String(input.storeId ?? '0'),
  };
  const parsed = cookieInputSchema.safeParse(candidate);
  if (!parsed.success) {
    if (candidate.storeId !== '0') throw Error('COOKIE_STORE_UNSUPPORTED');
    throw Error('INVALID_COOKIE_FILE');
  }
  return parsed.data;
}
