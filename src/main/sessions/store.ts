import {lstat,mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {existsSync,renameSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {sessionSnapshotSchema,type SessionSnapshot} from '../../shared/session';

const idSchema=z.uuid();
const MAX_FILE_SIZE=1024**2;

export class SessionStore {
  constructor(private root:string){}
  private directory(){return join(this.root,'sessions');}
  private async ensureDirectory(create:boolean){
    const directory=this.directory();
    if(create)await mkdir(directory,{recursive:true});
    try{const stat=await lstat(directory);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('UNSAFE_SESSION_PATH');}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'&&!create)return false;throw error;}
    return true;
  }
  async read(id:string):Promise<SessionSnapshot|null>{
    const safeId=idSchema.parse(id);if(!await this.ensureDirectory(false))return null;
    const file=join(this.directory(),`${safeId}.json`);
    try{
      const stat=await lstat(file);if(stat.isSymbolicLink()||!stat.isFile())throw Error('UNSAFE_SESSION_PATH');
      if(stat.size>MAX_FILE_SIZE)throw Error('SESSION_TOO_LARGE');
      let raw:unknown;try{raw=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error instanceof SyntaxError)return null;throw error;}
      const parsed=sessionSnapshotSchema.safeParse(raw);
      return parsed.success?parsed.data:null;
    }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
  }
  async write(id:string,value:SessionSnapshot):Promise<void>{
    const safeId=idSchema.parse(id);const snapshot=sessionSnapshotSchema.parse(value);
    await this.ensureDirectory(true);
    const file=join(this.directory(),`${safeId}.json`);const temporary=`${file}.partial-${randomUUID()}`;
    try{await writeFile(temporary,JSON.stringify(snapshot),{flag:'wx'});await rename(temporary,file);}
    finally{await rm(temporary,{force:true});}
  }
  async prepare(id:string,value:SessionSnapshot):Promise<{publish:()=>void;rollback:()=>void}>{
    const safeId=idSchema.parse(id);const snapshot=sessionSnapshotSchema.parse(value);await this.ensureDirectory(true);
    const file=join(this.directory(),`${safeId}.json`);if(existsSync(file))throw Error('SESSION_ALREADY_EXISTS');
    const temporary=`${file}.partial-${randomUUID()}`;await writeFile(temporary,JSON.stringify(snapshot),{flag:'wx'});let published=false;
    return {publish:()=>{renameSync(temporary,file);published=true;},rollback:()=>{rmSync(temporary,{force:true});if(published)rmSync(file,{force:true});}};
  }
  async remove(id:string):Promise<void>{
    const safeId=idSchema.parse(id);if(!await this.ensureDirectory(false))return;
    const file=join(this.directory(),`${safeId}.json`);
    try{const stat=await lstat(file);if(stat.isSymbolicLink()||!stat.isFile())throw Error('UNSAFE_SESSION_PATH');await rm(file);}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
}
