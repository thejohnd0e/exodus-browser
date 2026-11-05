export const MAX_INSTALLER_BYTES=300*1024*1024;

export function isAllowedHost(url:string):boolean{
  let parsed:URL;
  try{parsed=new URL(url);}catch{return false;}
  if(parsed.protocol!=='https:')return false;
  return parsed.hostname==='github.com'||parsed.hostname.endsWith('.githubusercontent.com');
}
