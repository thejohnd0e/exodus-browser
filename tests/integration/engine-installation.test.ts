import {it,expect} from 'vitest';
import {writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {EngineInstaller} from '../../src/main/engines/installation';
import {tempRoot,cleanup} from '../fixtures/profiles';
it('does not mark a corrupt or interrupted engine download ready',async()=>{
  const root=tempRoot();
  try{
    const installer=new EngineInstaller(root,async(_url,file)=>{await writeFile(file,'corrupt');});
    const release={version:'156.0.8078.80',url:'https://storage.googleapis.com/chrome-for-testing-public/156.0.8078.80/win64/chrome-win64.zip',sha256:'a'.repeat(64)};
    await expect(installer.install(release)).rejects.toThrow();
    expect((await installer.status()).state).toBe('missing');
    const broken=new EngineInstaller(root,async()=>{throw Error('offline');});
    await expect(broken.install(release)).rejects.toThrow();
    expect((await broken.status()).state).toBe('missing');
  }finally{cleanup(root);}
});
