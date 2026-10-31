import {useId,useState} from 'react';
import {localeChoices,localeName} from '../shared/locales';
import {localeSchema} from '../shared/validation';
import {useI18n} from './i18n/provider';
export function LanguagePicker({value,onChange,disabled}:{value:string[];onChange:(value:string[])=>void;disabled:boolean}){
 const {t}=useI18n();
 const [open,setOpen]=useState(false);const [query,setQuery]=useState('');const listId=useId();const selected=value[0];
 const choices=localeChoices.filter(l=>(l.code+' '+l.name).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 const custom=localeSchema.safeParse(query.trim());
 function choose(code:string){onChange([code]);setOpen(false);setQuery('');}
  return <section className="settings-panel"><h3>{t('Browser language')}</h3><p className="settings-hint">{t('The language this profile will use for websites.')}</p>
   <div className="language-add"><button type="button" aria-label={t('Choose language')} aria-expanded={open} aria-controls={listId} disabled={disabled} onClick={()=>setOpen(!open)}>{localeName(selected)} <small>{selected}</small> ⌄</button>
    {open&&<div className="language-dropdown" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setOpen(false);}}}><input autoFocus aria-label={t('Search languages')} value={query} onChange={e=>setQuery(e.target.value)} placeholder={t('Language name or BCP47 code')}/><div id={listId} role="listbox" aria-label={t('Available languages')}>{choices.map(l=><button type="button" role="option" aria-selected={selected===l.code} key={l.code} onClick={()=>choose(l.code)}>{l.name} <small>{l.code}</small></button>)}{custom.success&&!choices.some(l=>l.code===custom.data)&&<button type="button" role="option" aria-selected={selected===custom.data} onClick={()=>choose(custom.data)}>{t('Choose by code: {{code}}',{code:custom.data})}</button>}{!choices.length&&!custom.success&&<p className="settings-hint">{t('No matches. You can enter a valid BCP47 code.')}</p>}</div></div>}
   </div><p className="settings-hint">{t('Websites may receive a reduced language list for privacy. The browser interface language depends on Chromium resources.')}</p></section>;
}
