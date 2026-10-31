import {basename} from 'node:path';
import type {PortableProfileService} from './service';
import type {AppLanguage} from '../../shared/settings';
import {nativeMessage} from '../../shared/i18n/messages';

type OpenResult={canceled:boolean;filePaths:string[]};type SaveResult={canceled:boolean;filePath?:string};
export function createPortableOperations({portable,showOpen,showSave,showExportConfirm,language='en'}:{
 portable:Pick<PortableProfileService,'exportFile'|'importFile'>;
 showOpen:(options:{title:string;properties:string[];filters:Array<{name:string;extensions:string[]}>})=>Promise<OpenResult>;
 showSave:(options:{defaultPath:string;filters:Array<{name:string;extensions:string[]}>})=>Promise<SaveResult>;
 showExportConfirm:()=>Promise<boolean>;
 language?:AppLanguage|(()=>AppLanguage);
}){
 const currentLanguage=()=>typeof language==='function'?language():language;
 return {
  async exportProfile(id:string):Promise<{fileName:string}|null>{
   if(!await showExportConfirm())return null;
   const result=await showSave({defaultPath:'profile-portable.zip',filters:[{name:nativeMessage('portable.filter',currentLanguage()),extensions:['zip']}]});
   if(result.canceled||!result.filePath)return null;
   await portable.exportFile(id,result.filePath);return {fileName:basename(result.filePath)};
  },
  async importProfile(){
   const result=await showOpen({title:nativeMessage('portable.import.title',currentLanguage()),properties:['openFile'],filters:[{name:nativeMessage('portable.filter',currentLanguage()),extensions:['zip']}]});
   if(result.canceled||!result.filePaths[0])return null;
   return portable.importFile(result.filePaths[0]);
  },
 };
}
