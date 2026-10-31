import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {recoverBuildVersion} from './build-version.mjs';

const buildNumber=Number(process.argv[2]);
if(!Number.isSafeInteger(buildNumber)||buildNumber<0){
  console.error('Usage: node scripts/recover-build-version.mjs <last-used-build-number>');
  process.exit(2);
}
const terminal=createInterface({input:stdin,output:stdout});
try{
  const answer=await terminal.question(`Confirm no build is running and reseed to ${buildNumber}? Type YES: `);
  await recoverBuildVersion({root:process.cwd(),buildNumber,confirm:async()=>answer==='YES'});
  console.log(`Build counter reseeded to ${buildNumber}. The next build will use 0.1.${buildNumber+1}.`);
}catch(error){
  console.error(error instanceof Error?error.message:'Build counter recovery failed.');
  process.exitCode=1;
}finally{terminal.close();}
