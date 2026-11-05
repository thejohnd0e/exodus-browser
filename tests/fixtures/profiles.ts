import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export const valid={name:'Work profile',note:'',startUrls:['about:blank'],languages:['ru-RU'],proxyId:null};
export const tempRoot=()=>mkdtempSync(join(tmpdir(),'local-profiles-test-'));
export const cleanup=(root:string)=>rmSync(root,{recursive:true,force:true});
// Test-only encryption: real safeStorage is verified separately in Electron smoke.
export function testSecrets(){const key=randomBytes(32);return {
  seal(s:string){const iv=randomBytes(12);const c=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,c.update(s),c.final(),c.getAuthTag()]);},
  open(b:Buffer){const d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(-16));return Buffer.concat([d.update(b.subarray(12,-16)),d.final()]).toString();}
};}
