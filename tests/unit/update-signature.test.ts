import {describe,expect,it} from 'vitest';
import {generateKeyPairSync,sign} from 'node:crypto';
import {verifyChecksumsSignature} from '../../src/main/update/signature';

const pair=()=>generateKeyPairSync('ed25519');
const pem=(key:ReturnType<typeof pair>['publicKey'])=>key.export({type:'spki',format:'pem'}).toString();
const sigOf=(data:Buffer,key:ReturnType<typeof pair>['privateKey'])=>sign(null,data,key).toString('base64');
const sums=Buffer.from(`${'a'.repeat(64)}  ExodusBrowser-Setup-1.4.0.exe\n`);

describe('verifyChecksumsSignature',()=>{
  it('accepts a signature made by the matching private key',()=>{
    const {publicKey,privateKey}=pair();
    expect(verifyChecksumsSignature(sums,sigOf(sums,privateKey)+'\n',pem(publicKey))).toBe(true);
  });
  it('rejects changed checksums',()=>{
    const {publicKey,privateKey}=pair();
    const tampered=Buffer.from(sums.toString().replace('a'.repeat(64),'b'.repeat(64)));
    expect(verifyChecksumsSignature(tampered,sigOf(sums,privateKey),pem(publicKey))).toBe(false);
  });
  it('rejects a signature from a different key',()=>{
    const other=pair();const trusted=pair();
    expect(verifyChecksumsSignature(sums,sigOf(sums,other.privateKey),pem(trusted.publicKey))).toBe(false);
  });
  it.each(['','not base64 !!!','AAAA',Buffer.alloc(63).toString('base64'),Buffer.alloc(65).toString('base64')])('rejects a malformed signature %j',bad=>{
    expect(verifyChecksumsSignature(sums,bad,pem(pair().publicKey))).toBe(false);
  });
  it('rejects instead of throwing when the trusted key is unusable',()=>{
    const {privateKey}=pair();
    expect(verifyChecksumsSignature(sums,sigOf(sums,privateKey),'not a key')).toBe(false);
  });
});
