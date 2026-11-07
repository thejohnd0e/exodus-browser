import {createPublicKey,verify} from 'node:crypto';

const SIGNATURE_BYTES=64;

/**
 * Verifies the detached Ed25519 signature published next to `SHA256SUMS`. The signature file holds
 * the base64 of the raw 64-byte signature. Any malformed input, wrong key or unusable trusted key
 * returns false, so a caller can only ever proceed on an explicit true.
 */
export function verifyChecksumsSignature(checksums:Buffer,signatureText:string,publicKeyPem:string):boolean{
  const compact=signatureText.trim();
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(compact))return false;
  const signature=Buffer.from(compact,'base64');
  if(signature.length!==SIGNATURE_BYTES)return false;
  try{
    const key=createPublicKey(publicKeyPem);
    if(key.asymmetricKeyType!=='ed25519')return false;
    return verify(null,checksums,key,signature);
  }catch{
    return false;
  }
}
