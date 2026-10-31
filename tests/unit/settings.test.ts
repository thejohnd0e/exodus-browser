import {it,expect} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AppSettingsService} from '../../src/main/settings/service';

it('defaults to English and persists settings across service restarts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'exodus-settings-'));
 try{
  const service=new AppSettingsService(root);await expect(service.getSettings()).resolves.toEqual({language:'en'});
  await expect(service.updateSettings({language:'ru'})).resolves.toEqual({language:'ru'});
  await expect(new AppSettingsService(root).getSettings()).resolves.toEqual({language:'ru'});
  await expect(service.updateSettings({language:'en'})).resolves.toEqual({language:'en'});
  await expect(new AppSettingsService(root).getSettings()).resolves.toEqual({language:'en'});
 }finally{await rm(root,{recursive:true,force:true});}
});

it('rejects invalid or extra fields and safely falls back on malformed stored settings',async()=>{
 const root=await mkdtemp(join(tmpdir(),'exodus-settings-'));
 try{
  const service=new AppSettingsService(root);
  await expect(service.updateSettings({language:'fr'} as never)).rejects.toThrow();
  await expect(service.updateSettings({language:'en',extra:true} as never)).rejects.toThrow();
  await writeFile(join(root,'settings.json'),'{broken');
  await expect(new AppSettingsService(root).getSettings()).resolves.toEqual({language:'en'});
 }finally{await rm(root,{recursive:true,force:true});}
});
