// Release signing for the in-app updater (DECISIONS #70).
//
//   node scripts/release-signing.mjs keygen <private-key-file>
//       Creates an Ed25519 key pair. The private key is written to <private-key-file> (refuses to
//       overwrite) and must be kept OUTSIDE the repository and backed up; the public key is printed
//       for src/main/update/signing-key.ts.
//   node scripts/release-signing.mjs sign <SHA256SUMS> <private-key-file>
//       Writes <SHA256SUMS>.sig (base64 of the raw 64-byte signature) next to the checksums.
//   node scripts/release-signing.mjs verify <SHA256SUMS> <public-key-pem-file>
//       Checks an existing signature before publishing.
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {createPrivateKey,createPublicKey,generateKeyPairSync,sign,verify} from 'node:crypto';

const [command,first,second]=process.argv.slice(2);
const fail=message=>{console.error(message);process.exit(1);};

if(command==='keygen'){
  if(!first)fail('usage: keygen <private-key-file>');
  if(existsSync(first))fail(`refusing to overwrite ${first}`);
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  writeFileSync(first,privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600});
  console.log(publicKey.export({type:'spki',format:'pem'}).toString());
}else if(command==='sign'){
  if(!first||!second)fail('usage: sign <SHA256SUMS> <private-key-file>');
  const key=createPrivateKey(readFileSync(second));
  if(key.asymmetricKeyType!=='ed25519')fail('the signing key must be Ed25519');
  const checksums=readFileSync(first);
  const signature=sign(null,checksums,key);
  const publicKey=createPublicKey(key);
  if(!verify(null,checksums,publicKey,signature))fail('self-check of the new signature failed');
  writeFileSync(`${first}.sig`,signature.toString('base64')+'\n');
  console.log(`wrote ${first}.sig`);
}else if(command==='verify'){
  if(!first||!second)fail('usage: verify <SHA256SUMS> <public-key-pem-file>');
  const ok=verify(null,readFileSync(first),createPublicKey(readFileSync(second)),Buffer.from(readFileSync(`${first}.sig`,'utf8').trim(),'base64'));
  if(!ok)fail('signature does NOT match');
  console.log('signature OK');
}else fail('usage: keygen | sign | verify (see the header of this file)');
