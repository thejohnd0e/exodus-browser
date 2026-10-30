import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
export type ProcessRecord={pid:number;executable:string;createdAt:string;commandLine:string};
export async function probeProfileProcesses():Promise<ProcessRecord[]>{
  if(process.platform!=='win32')throw Error('PROCESS_INSPECTION_UNAVAILABLE');
  const command=`$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | ForEach-Object { @{pid=$_.ProcessId; executable=$_.ExecutablePath; createdAt=[string]$_.CreationDate; commandLine=$_.CommandLine} }) | ConvertTo-Json -Compress`;
  const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:15000,maxBuffer:4*1024**2});
  const data=JSON.parse(stdout.trim()||'[]');const rows=Array.isArray(data)?data:[data];
  if(rows.some(r=>typeof r.commandLine!=='string'))throw Error('PROCESS_INSPECTION_INCOMPLETE');
  return rows;
}
