import type {AppLanguage} from '../settings';
import {en} from './en';
import {ru} from './ru';
export function formatMessage(language:AppLanguage,key:keyof typeof en,params:Record<string,string|number>={}):string{
 let value=((language==='ru'&&Object.hasOwn(ru,key)?ru:en)[key] as string|undefined)??en[key];
 value=value.replace(/\{(\w+), plural, ([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g,(_full,name:string,choices:string)=>{
  const count=Number(params[name]??0);const category=new Intl.PluralRules(language).select(count);
  const forms=Object.fromEntries([...choices.matchAll(/(\w+)\s*\{([^{}]*)\}/g)].map(match=>[match[1],match[2]]));
  return (forms[category]??forms.other??'').replaceAll('#',new Intl.NumberFormat(language).format(count));
 });
 return value.replace(/\{\{?(\w+)\}?\}/g,(_match,name:string)=>{const param=params[name];return typeof param==='number'?new Intl.NumberFormat(language).format(param):String(param??`{{${name}}}`);});
}
