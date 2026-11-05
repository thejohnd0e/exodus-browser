import {lstat,mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {appSettingsSchema,DEFAULT_APP_SETTINGS,type AppSettings} from '../../shared/settings';

export class AppSettingsService {
 constructor(private root:string){}
 async getSettings():Promise<AppSettings>{
  const file=join(this.root,'settings.json');
  try{
   const stat=await lstat(file);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>1024**2)return DEFAULT_APP_SETTINGS;
   const parsed=appSettingsSchema.safeParse(JSON.parse(await readFile(file,'utf8')));
   return parsed.success?parsed.data:DEFAULT_APP_SETTINGS;
  }catch(error){
   if((error as NodeJS.ErrnoException).code==='ENOENT')return DEFAULT_APP_SETTINGS;
   if(error instanceof SyntaxError)return DEFAULT_APP_SETTINGS;
   throw error;
  }
 }
 async updateSettings(input:AppSettings):Promise<AppSettings>{
  const settings=appSettingsSchema.parse(input);await mkdir(this.root,{recursive:true});
  const file=join(this.root,'settings.json');const temporary=`${file}.partial-${randomUUID()}`;
  try{await writeFile(temporary,JSON.stringify(settings)+'\n',{flag:'wx'});await rename(temporary,file);}
  finally{await rm(temporary,{force:true});}
  return settings;
 }
}
