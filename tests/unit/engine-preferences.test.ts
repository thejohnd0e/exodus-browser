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
  expect(prefs.intl).toMatchObject({accept_languages:'en-US,en',selected_languages:'en-US,en'});
 }finally{await rm(dir,{recursive:true,force:true});}
});

it('creates preferences for a fresh profile',async()=>{
 const dir=await root();
 try{
  await prepareProfilePreferences({userDataDir:dir,languages:['de-DE']});
  const prefs=JSON.parse(await readFile(join(dir,'Default','Preferences'),'utf8'));
  expect(prefs.session.restore_on_startup).toBe(1);
  expect(prefs.intl.accept_languages).toBe('de-DE,de');
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

it.runIf(process.platform==='win32')('seeds Local State so Chrome does not probe the Windows password with a failed logon',async()=>{
 const dir=await root();
 try{
  await prepareProfilePreferences({userDataDir:dir,languages:['en-US']});
  expect(JSON.parse(await readFile(join(dir,'Local State'),'utf8')).password_manager).toEqual({os_password_blank:false,os_password_last_changed:'9223372036854775807'});
  // An existing Local State keeps its other settings; Chrome's own date is replaced before every launch.
  await writeFile(join(dir,'Local State'),JSON.stringify({browser:{enabled_labs_experiments:[]},password_manager:{os_password_last_changed:'13400000000000000',other:1}}));
  await prepareProfilePreferences({userDataDir:dir,languages:['en-US']});
  const state=JSON.parse(await readFile(join(dir,'Local State'),'utf8'));
  expect(state.browser).toEqual({enabled_labs_experiments:[]});
  expect(state.password_manager).toEqual({os_password_blank:false,os_password_last_changed:'9223372036854775807',other:1});
  await writeFile(join(dir,'Local State'),'[1]');
  await expect(prepareProfilePreferences({userDataDir:dir,languages:['en-US']})).rejects.toThrow('INVALID_PREFERENCES');
 }finally{await rm(dir,{recursive:true,force:true});}
});
