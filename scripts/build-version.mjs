import {open,readFile,mkdir,rename,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

async function writeAtomic(path,text){
  const temporary=`${path}.partial-${randomUUID()}`;
  try{await writeFile(temporary,text,{flag:'wx'});await rename(temporary,path);}
  finally{await rm(temporary,{force:true});}
}

export async function withBuildVersion({root,run}){
  const local=join(root,'.local');await mkdir(local,{recursive:true});
  const lockPath=join(local,'build.lock');let lock;
  try{lock=await open(lockPath,'wx');}
  catch(error){if(error?.code==='EEXIST')throw Error('BUILD_ALREADY_RUNNING');throw error;}
  try{
    const statePath=join(local,'build-version.json');
    const markerPath=join(root,'.build-version.initialized');
    const floorPath=join(root,'build-version-floor.json');
    let state;
    try{state=JSON.parse(await readFile(statePath,'utf8'));}
    catch(error){
      if(error?.code!=='ENOENT')throw Error('BUILD_VERSION_STATE_INVALID');
      try{await readFile(markerPath);throw Error('BUILD_VERSION_STATE_MISSING');}
      catch(markerError){if(markerError.message==='BUILD_VERSION_STATE_MISSING')throw markerError;if(markerError?.code!=='ENOENT')throw markerError;}
      let floor;
      try{floor=JSON.parse(await readFile(floorPath,'utf8'));}catch{throw Error('BUILD_VERSION_FLOOR_INVALID');}
      if(!floor||!Number.isSafeInteger(floor.buildNumber)||floor.buildNumber<0)throw Error('BUILD_VERSION_FLOOR_INVALID');
      state={buildNumber:floor.buildNumber};
    }
    if(!state||!Number.isSafeInteger(state.buildNumber)||state.buildNumber<0)throw Error('BUILD_VERSION_STATE_INVALID');
    const next=state.buildNumber+1;
    if(!Number.isSafeInteger(next))throw Error('BUILD_VERSION_STATE_INVALID');
    await writeAtomic(statePath,JSON.stringify({buildNumber:next})+'\n');
    try{const marker=await open(markerPath,'wx');await marker.close();}
    catch(error){if(error?.code!=='EEXIST')throw error;}
    const info={version:`0.1.${next}`,buildNumber:next};
    await run(info);
    return info;
  }finally{
    await lock.close();
    await rm(lockPath,{force:true});
  }
}

export async function recoverBuildVersion({root,buildNumber,confirm}){
  if(!Number.isSafeInteger(buildNumber)||buildNumber<0)throw Error('BUILD_VERSION_SEED_INVALID');
  const local=join(root,'.local');await mkdir(local,{recursive:true});
  const lockPath=join(local,'build.lock');let lock;
  try{lock=await open(lockPath,'wx');}
  catch(error){if(error?.code==='EEXIST')throw Error('BUILD_ALREADY_RUNNING');throw error;}
  try{
    if(!await confirm())throw Error('BUILD_VERSION_RECOVERY_CANCELLED');
    const floor=JSON.parse(await readFile(join(root,'build-version-floor.json'),'utf8'));
    if(!floor||!Number.isSafeInteger(floor.buildNumber)||buildNumber<floor.buildNumber)throw Error('BUILD_VERSION_SEED_INVALID');
    const statePath=join(local,'build-version.json');
    try{
      const state=JSON.parse(await readFile(statePath,'utf8'));
      if(!Number.isSafeInteger(state.buildNumber)||buildNumber<state.buildNumber)throw Error('BUILD_VERSION_SEED_INVALID');
    }catch(error){if(error.message==='BUILD_VERSION_SEED_INVALID')throw error;if(error?.code!=='ENOENT'){/* Confirmed recovery of corrupt state. */}}
    await writeAtomic(statePath,JSON.stringify({buildNumber})+'\n');
    const markerPath=join(root,'.build-version.initialized');
    try{await writeFile(markerPath,'initialized\n',{flag:'wx'});}catch(error){if(error?.code!=='EEXIST')throw error;}
  }finally{await lock.close();await rm(lockPath,{force:true});}
}
