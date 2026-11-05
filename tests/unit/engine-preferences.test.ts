import {it,expect} from 'vitest';
import {mkdir,readFile,writeFile,rm,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareProfilePreferences} from '../../src/main/engines/chromium';

async function root(){return mkdtemp(join(tmpdir(),'prefs-'));}

it('disables Chromium session restore so saved tabs are not duplicated',async()=>{
 const dir=await root();
 try{
  await mkdir(join(dir,'Default'),{recursive:true});
  await writeFile(join(dir,'Default','Preferences'),JSON.stringify({session:{restore_on_startup:5,startup_urls:['https://old.example/'],keep:true},profile:{name:'Work'},other:1}));
  await prepareProfilePreferences({userDataDir:dir,languages:['en-US']});
  const prefs=JSON.parse(await readFile(join(dir,'Default','Preferences'),'utf8'));
  expect(prefs.session).toMatchObject({restore_on_startup:1,startup_urls:[],keep:true});
  expect(prefs.profile).toMatchObject({name:'Work',exit_type:'Normal',exited_cleanly:true});
  expect(prefs.other).toBe(1);
  expect(prefs.intl).toMatchObject({accept_languages:'en-US',selected_languages:'en-US'});
 }finally{await rm(dir,{recursive:true,force:true});}
});

it('creates preferences for a fresh profile',async()=>{
 const dir=await root();
 try{
  await prepareProfilePreferences({userDataDir:dir,languages:['de-DE']});
  const prefs=JSON.parse(await readFile(join(dir,'Default','Preferences'),'utf8'));
  expect(prefs.session.restore_on_startup).toBe(1);
  expect(prefs.intl.accept_languages).toBe('de-DE');
 }finally{await rm(dir,{recursive:true,force:true});}
});

it('rejects a preferences file that is not an object',async()=>{
 const dir=await root();
 try{
  await mkdir(join(dir,'Default'),{recursive:true});
  await writeFile(join(dir,'Default','Preferences'),JSON.stringify([1,2,3]));
  await expect(prepareProfilePreferences({userDataDir:dir,languages:['en-US']})).rejects.toThrow('INVALID_PREFERENCES');
 }finally{await rm(dir,{recursive:true,force:true});}
});
