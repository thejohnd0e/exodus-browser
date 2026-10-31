import type {ChangeEvent} from 'react';
import {useI18n} from './i18n/provider';

export function AppSettings({disabled=false}:{disabled?:boolean}){
 const {language,setLanguage,t}=useI18n();
 return <label className="app-language"><span>{t('language.label')}</span><select aria-label={t('language.label')} value={language} disabled={disabled} onChange={(event:ChangeEvent<HTMLSelectElement>)=>setLanguage(event.target.value as 'en'|'ru')}><option value="en">{t('language.en')}</option><option value="ru">{t('language.ru')}</option></select></label>;
}
