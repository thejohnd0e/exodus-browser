import {createContext,useContext,type ReactNode} from 'react';
import type {AppLanguage} from '../../shared/settings';
import {en} from '../../shared/i18n/en';
import {formatMessage} from '../../shared/i18n/format';
import type {TranslationKey,TranslationParams} from './types';

export function translate(language:AppLanguage,key:TranslationKey|string,params:TranslationParams={}):string{
 if(Object.hasOwn(en,key))return formatMessage(language,key as TranslationKey,params);
 return key;
}
type I18nValue={language:AppLanguage;t:(key:TranslationKey|string,params?:TranslationParams)=>string;setLanguage:(language:AppLanguage)=>void};
const I18nContext=createContext<I18nValue|null>(null);
export function I18nProvider({language,onLanguageChange,children}:{language:AppLanguage;onLanguageChange:(language:AppLanguage)=>void;children:ReactNode}){
 const value:I18nValue={language,t:(key,params)=>translate(language,key,params),setLanguage:onLanguageChange};
 return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
export function useI18n():I18nValue{
 const value=useContext(I18nContext);if(!value)throw Error('I18N_PROVIDER_MISSING');return value;
}
