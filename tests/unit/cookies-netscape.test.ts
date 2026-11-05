import {it,expect} from 'vitest';
import {parseNetscape} from '../../src/main/cookies/netscape';
import {serializeCookies} from '../../src/main/cookies/serialize';
import {parseCookies} from '../../src/main/cookies/parse';
const now=1_800_000_000;
it('reads Netscape comments, #HttpOnly_ and the include-subdomains field',()=>{
  const text=['# Netscape HTTP Cookie File','#HttpOnly_.example.com\tTRUE\t/\tTRUE\t1893456000\tsid\tv','example.com\tFALSE\t/\tFALSE\t0\thost\th'].join('\n');
  const [a,b]=parseNetscape(text,now);
  expect(a).toMatchObject({domain:'.example.com',httpOnly:true,secure:true,expirationDate:1893456000,sameSite:'unspecified'});
  expect(b).toMatchObject({domain:'example.com',httpOnly:false,secure:false,expirationDate:null});
});
it('rejects malformed lines entirely',()=>{
  expect(()=>parseNetscape('example.com\tTRUE\t/\tFALSE\t1\tname',now)).toThrow('INVALID_COOKIE_FILE');
  expect(()=>parseNetscape('example.com\tTRUE\t/\tFALSE\t0\t\tv',now)).toThrow('INVALID_COOKIE_FILE');
});
it('exports JSON and Netscape that can be read back',()=>{
  const cookies=parseNetscape('.example.com\tTRUE\t/\tTRUE\t1893456000\tsid\tv',now);
  const fromJson=parseCookies(serializeCookies(cookies,'json'),now);
  const fromNetscape=parseCookies(serializeCookies(cookies,'netscape'),now);
  expect(fromJson).toEqual(cookies);expect(fromNetscape).toEqual(cookies);
  expect(serializeCookies(cookies,'netscape')).toContain('.example.com\tTRUE\t/\tTRUE\t1893456000\tsid\tv');
  expect(serializeCookies([{...cookies[0],httpOnly:true}],'netscape')).toContain('#HttpOnly_.example.com');
});
