export type Version = {major:number;minor:number;patch:number};

const MAX_PART=999999;

export function parseVersion(text:string):Version|null{
  const match=/^(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if(!match)return null;
  const [major,minor,patch]=match.slice(1).map(Number);
  if(major>MAX_PART||minor>MAX_PART||patch>MAX_PART)return null;
  return {major,minor,patch};
}

export function isNewer(candidate:string,current:string):boolean{
  const next=parseVersion(candidate);
  const now=parseVersion(current);
  if(!next||!now)return false;
  if(next.major!==now.major)return next.major>now.major;
  if(next.minor!==now.minor)return next.minor>now.minor;
  return next.patch>now.patch;
}
