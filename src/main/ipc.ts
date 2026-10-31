import {z} from 'zod';
import {profileSchema,savedProxySchema} from '../shared/validation';
import type {Result} from '../shared/contracts';
import {appSettingsSchema} from '../shared/settings';
import type {AppLanguage} from '../shared/settings';
import {errorsForLanguage,messageForError} from '../shared/i18n/messages';
const id=z.uuid();
const schemas={list:z.tuple([]),create:z.tuple([profileSchema]),update:z.tuple([id,profileSchema]),remove:z.tuple([id]),start:z.tuple([id]),stop:z.tuple([id]),states:z.tuple([]),engineStatus:z.tuple([]),installEngine:z.tuple([]),linkEngine:z.tuple([]),backup:z.tuple([id]),restore:z.tuple([]),exportProfile:z.tuple([id]),importProfile:z.tuple([]),checkProxy:z.tuple([id]),listProxies:z.tuple([]),createProxy:z.tuple([savedProxySchema]),updateProxy:z.tuple([id,savedProxySchema]),removeProxy:z.tuple([id]),checkSavedProxy:z.tuple([id]),runningProxyVersions:z.tuple([]),importCookies:z.tuple([id]),exportCookies:z.tuple([id,z.enum(['json','netscape'])]),clearCookies:z.tuple([id]),getSettings:z.tuple([]),updateSettings:z.tuple([appSettingsSchema]),listExtensions:z.tuple([]),addExtensionFolder:z.tuple([]),addExtensionZip:z.tuple([]),updateExtension:z.tuple([id]),removeExtension:z.tuple([id]),addExtensionFromStore:z.tuple([z.string().trim().min(1).max(2048)])};
export type Operation=keyof typeof schemas;
export const operations=Object.keys(schemas) as Operation[];
const messages:Record<string,true>=Object.fromEntries(errorsForLanguage('en').map(code=>[code,true]));
export function createDispatcher(api:Partial<Record<Operation,(...args:any[])=>Promise<unknown>>>,trusted:(event:unknown)=>boolean,language:()=>AppLanguage=()=> 'en'){
  return async(event:unknown,method:string,args:unknown[]):Promise<Result<unknown>>=>{
     if(!trusted(event))return {ok:false,error:{code:'FORBIDDEN',message:messageForError('FORBIDDEN',language())}};
     if(!Object.hasOwn(schemas,method))return {ok:false,error:{code:'INVALID_REQUEST',message:messageForError('INVALID_REQUEST',language())}};
    const schema=schemas[method as Operation];const parsed=schema.safeParse(args);
     if(!parsed.success)return {ok:false,error:{code:'INVALID_INPUT',message:messageForError('INVALID_INPUT',language())}};
    try{const fn=api[method as Operation];if(!fn)throw Error('NOT_IMPLEMENTED');return {ok:true,value:await fn(...parsed.data)};}
     catch(e){const raw=e instanceof Error?e.message:'';const code=Object.hasOwn(messages,raw)?raw:'OPERATION_FAILED';return {ok:false,error:{code,message:messageForError(code,language())}};}
  };
}
