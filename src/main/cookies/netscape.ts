import {COOKIE_LIMITS,isExpiredCookie,type CookieInput} from '../../shared/cookies';
import {buildCookie} from './normalize';

export function parseNetscape(text: string, now = Math.floor(Date.now() / 1000)): CookieInput[] {
  const lines = text.split(/\r?\n/);
  const out: CookieInput[] = [];
  let count = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    let httpOnly = false;
    let body = line;
    if (line.startsWith('#HttpOnly_')) {
      httpOnly = true;
      body = line.slice('#HttpOnly_'.length);
    } else if (line.startsWith('#')) continue;
    const fields = body.split('\t');
    if (fields.length !== 7) throw Error('INVALID_COOKIE_FILE');
    const [rawDomain, includeSubdomains, path, secure, rawExpiry, name, value] = fields;
    if (includeSubdomains !== 'TRUE' && includeSubdomains !== 'FALSE') throw Error('INVALID_COOKIE_FILE');
    if (secure !== 'TRUE' && secure !== 'FALSE') throw Error('INVALID_COOKIE_FILE');
    const domain = includeSubdomains === 'TRUE' ? (rawDomain.startsWith('.') ? rawDomain : '.' + rawDomain) : rawDomain.replace(/^\./, '');
    const expiry = Number(rawExpiry);
    if (!Number.isFinite(expiry) || expiry < 0) throw Error('INVALID_COOKIE_FILE');
    const cookie = buildCookie({
      domain,
      name,
      path,
      value,
      expirationDate: expiry === 0 ? null : Math.floor(expiry),
      httpOnly,
      secure: secure === 'TRUE',
      sameSite: 'unspecified',
      storeId: '0',
    });
    if (++count > COOKIE_LIMITS.entries) throw Error('COOKIES_TOO_MANY');
    if (!isExpiredCookie(cookie, now)) out.push(cookie);
  }
  return out;
}
