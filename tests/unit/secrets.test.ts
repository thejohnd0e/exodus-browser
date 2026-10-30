import {it,expect} from 'vitest';
import { SecretStore } from '../../src/main/security/secrets';
it('refuses to save secrets when OS encryption is unavailable',()=>{
  const s=new SecretStore({isEncryptionAvailable:()=>false,encryptString:()=>Buffer.from('x'),decryptString:()=>''});
  expect(()=>s.seal('secret')).toThrow();
});
