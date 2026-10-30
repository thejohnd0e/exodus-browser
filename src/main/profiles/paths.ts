import { join } from 'node:path';
import { lstatSync, existsSync } from 'node:fs';
import { parseProfileId } from '../../shared/validation';
export function profilePath(root:string,id:string){
  const parent=join(root,'profiles');const target=join(parent,parseProfileId(id));
  for(const p of [root,parent,target])if(existsSync(p)&&lstatSync(p).isSymbolicLink())throw Error('UNSAFE_PATH');
  return target;
}
