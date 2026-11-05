import type {AppLanguage} from '../shared/settings';
const flagUrls=import.meta.glob('../../resources/flags/*.svg',{eager:true,query:'?url',import:'default'}) as Record<string,string>;
const flags=new Map(Object.entries(flagUrls).map(([path,url])=>[path.slice(path.lastIndexOf('/')+1,path.lastIndexOf('.')).toUpperCase(),url]));

export function CountryFlag({countryCode,language}:{countryCode:string|null;language:AppLanguage}){
 if(!countryCode||! /^[A-Z]{2}$/.test(countryCode))return null;
 const src=flags.get(countryCode);
 if(!src)return null;
 try{
  const countryName=new Intl.DisplayNames([language==='ru'?'ru':'en'],{type:'region'}).of(countryCode);
  if(!countryName||countryName===countryCode)return null;
  return <img className="country-flag" src={src} alt={countryName} title={countryName} loading="lazy"/>;
 }catch{return null;}
}
