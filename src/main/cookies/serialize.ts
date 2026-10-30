import type {CookieInput} from '../../shared/cookies';
import type {CookieFormat} from './parse';

export function serializeCookies(cookies: CookieInput[], format: CookieFormat): string {
  if (format === 'json') return JSON.stringify(cookies, null, 2) + '\n';
  const lines = ['# Netscape HTTP Cookie File'];
  for (const cookie of cookies) {
    const prefix = cookie.httpOnly ? '#HttpOnly_' : '';
    const includeSubdomains = cookie.domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const secure = cookie.secure ? 'TRUE' : 'FALSE';
    const expiry = cookie.expirationDate ?? 0;
    lines.push(`${prefix}${cookie.domain}\t${includeSubdomains}\t${cookie.path}\t${secure}\t${expiry}\t${cookie.name}\t${cookie.value}`);
  }
  return lines.join('\n') + '\n';
}
