import {z} from 'zod';
import {fingerprintSchema} from './fingerprint';
import {languagesSchema} from './validation';
import {sessionSnapshotSchema} from './session';
import {MAX_COOKIE_EXPIRY} from './cookies';

const safeStartUrl=z.string().min(1).max(8192).refine(value=>{
 if(value==='about:blank')return true;
 if(/[\x00-\x20]/.test(value))return false;
 try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}
},'Unsupported startup URL');

const portableProxySchema=z.object({name:z.string().trim().min(1).max(120),kind:z.enum(['http','https','socks5']),host:z.string().min(1).max(253),port:z.number().int().min(1).max(65535),username:z.string().max(1024).optional(),hasPassword:z.boolean()}).strict().refine(proxy=>proxy.kind!=='socks5'||!proxy.username,'SOCKS5 authentication is not supported yet');
export const portableProfileSchema=z.object({
 name:z.string().trim().min(1).max(120),note:z.string().max(4000),startUrls:z.array(safeStartUrl).max(20),languages:languagesSchema,
 fingerprint:fingerprintSchema,fingerprintSeed:z.number().int().min(0).max(0xffffffff),restoreLastSession:z.boolean(),proxy:portableProxySchema.nullable(),
}).strict();
export const portableManifestSchema=z.object({format:z.literal('exodus-portable'),version:z.literal(1),profile:portableProfileSchema,session:sessionSnapshotSchema.nullable()}).strict();
export type PortableManifest=z.infer<typeof portableManifestSchema>;
export type PortableProfile=z.infer<typeof portableProfileSchema>;

const topLevelSite=z.string().min(1).max(2048).refine(value=>{
 try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}
},'Invalid cookie partition site');
const cookieText=(maximum:number)=>z.string().max(maximum).refine(value=>!/[\x00-\x1f\x7f]/.test(value),'Invalid cookie text');
export const portableCookieSchema=z.object({
 name:cookieText(1024).min(1),value:cookieText(32768),domain:cookieText(256).regex(/^\.?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i),path:cookieText(1024).startsWith('/'),
 expires:z.number().finite().min(1).max(MAX_COOKIE_EXPIRY).nullable(),session:z.boolean(),httpOnly:z.boolean(),secure:z.boolean(),sameSite:z.enum(['Unspecified','None','Lax','Strict']),
 priority:z.enum(['Low','Medium','High']).optional(),sourceScheme:z.enum(['Unset','NonSecure','Secure']).optional(),sourcePort:z.number().int().min(-1).max(65535).optional(),
 partitionKey:z.object({topLevelSite,hasCrossSiteAncestor:z.boolean().optional()}).strict().optional(),
}).strict().superRefine((cookie,ctx)=>{
 if(cookie.session!==(cookie.expires===null))ctx.addIssue({code:'custom',path:['session'],message:'Session and expiration fields disagree'});
 if(cookie.sameSite==='None'&&!cookie.secure)ctx.addIssue({code:'custom',path:['secure'],message:'SameSite=None requires secure'});
});
export const portableCookiesSchema=z.array(portableCookieSchema).max(20000);
export type PortableCookie=z.infer<typeof portableCookieSchema>;
