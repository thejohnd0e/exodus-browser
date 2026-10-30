import {it,expect} from 'vitest';
import {cookieInputSchema,cookieKey,isExpiredCookie,COOKIE_LIMITS} from '../../src/shared/cookies';
const base={domain:'.example.com',name:'sid',path:'/',value:'v',expirationDate:1893456000,httpOnly:true,secure:true,sameSite:'lax' as const,storeId:'0'};
it('accepts a valid cookie and builds its key',()=>{
  expect(cookieInputSchema.parse(base)).toEqual(base);
  expect(cookieKey(base)).toBe('.example.com\t/\tsid');
});
it('requires secure for no_restriction and reserved prefixes',()=>{
  expect(cookieInputSchema.safeParse({...base,sameSite:'no_restriction',secure:false}).success).toBe(false);
  expect(cookieInputSchema.safeParse({...base,name:'__Secure-x',secure:false}).success).toBe(false);
  expect(cookieInputSchema.safeParse({...base,name:'__Host-x',domain:'example.com',path:'/'}).success).toBe(true);
  expect(cookieInputSchema.safeParse({...base,name:'__Host-x',domain:'.example.com'}).success).toBe(false);
});
it('rejects control characters, unsupported storeId and exceeded bounds',()=>{
  expect(cookieInputSchema.safeParse({...base,value:'a\tb'}).success).toBe(false);
  expect(cookieInputSchema.safeParse({...base,storeId:'1'}).success).toBe(false);
  expect(cookieInputSchema.safeParse({...base,value:'x'.repeat(COOKIE_LIMITS.value+1)}).success).toBe(false);
  expect(cookieInputSchema.safeParse({...base,domain:'exa mple.com'}).success).toBe(false);
});
it('treats only positive past expiration times as expired',()=>{
  const now=1_900_000_000;
  expect(isExpiredCookie({...base,expirationDate:now-1},now)).toBe(true);
  expect(isExpiredCookie({...base,expirationDate:now+1},now)).toBe(false);
  expect(isExpiredCookie({...base,expirationDate:null},now)).toBe(false);
});
it('limits expiration to the year 2100',()=>{
  expect(cookieInputSchema.safeParse({...base,expirationDate:5000000000}).success).toBe(false);
});
