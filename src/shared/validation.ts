import { z } from 'zod';
import { fingerprintSchema, DEFAULT_FINGERPRINT } from './fingerprint';
const safeUrl=z.string().max(8192).refine(s=>{
  if(s==='about:blank')return true;
  if(/[\x00-\x20]/.test(s))return false;
  try {const u=new URL(s);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}
},'Only http/https URLs without a username or password are allowed');
const proxyFields={kind:z.enum(['http','https','socks5']),host:z.string().min(1).max(253).regex(/^(?:[a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\])$/),port:z.number().int().min(1).max(65535),username:z.string().max(1024).regex(/^[^\r\n:]*$/).optional(),password:z.string().max(4096).regex(/^[^\r\n]*$/).optional()};
const noSocksAuth=(p:{kind:string;username?:string;password?:string})=>p.kind!=='socks5'||(!p.username&&!p.password);
export const proxySchema=z.object(proxyFields).strict().refine(noSocksAuth,'SOCKS5 authentication is not supported yet');
const name=z.string().trim().min(1).max(120);
export const savedProxySchema=z.object({...proxyFields,name}).strict().refine(noSocksAuth,'SOCKS5 authentication is not supported yet');
const {password:_password,...publicProxyFields}=proxyFields;
export const publicProxySchema=z.object(publicProxyFields).strict().refine(noSocksAuth);
export const publicSavedProxySchema=z.object({...publicProxyFields,name}).strict().refine(noSocksAuth);
export const localeSchema=z.string().min(1).max(64).refine(s=>{try{return Intl.getCanonicalLocales(s).length===1;}catch{return false;}},'Invalid language').transform(s=>Intl.getCanonicalLocales(s)[0]);
export const languagesSchema=z.array(localeSchema).length(1,'Specify exactly one language');
export const historicalLanguagesSchema=z.array(localeSchema).min(1).max(20).refine(l=>new Set(l).size===l.length,'Languages must not repeat');
export function normalizeStoredLanguages(value:unknown):[string]{return [historicalLanguagesSchema.parse(value)[0]];}
const profileFields={name,note:z.string().max(4000),startUrls:z.array(safeUrl).max(20)};
export const profileSchema=z.object({...profileFields,languages:languagesSchema,proxyId:z.uuid().nullable(),fingerprint:fingerprintSchema.default(()=>DEFAULT_FINGERPRINT)}).strict();
export const legacyProfileSchema=z.object({...profileFields,language:localeSchema,proxy:proxySchema.nullable()}).strict();
export const legacyStoredSchema=z.object({...profileFields,id:z.uuid(),language:localeSchema,proxy:z.object({...publicProxyFields,hasPassword:z.boolean()}).strict().nullable(),createdAt:z.string(),updatedAt:z.string()}).strict();
export const parseSavedProxyInput=(value:unknown)=>savedProxySchema.parse(value);
export const parseProfileInput=(value:unknown)=>profileSchema.parse(value);
export const parseProfileId=(value:unknown)=>z.uuid().parse(value);
