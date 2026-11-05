import {useEffect,useId,useRef,useState} from 'react';
import type {AppLanguage} from '../shared/settings';
import {en} from '../shared/i18n/en';
import {ru} from '../shared/i18n/ru';
import {useI18n} from './i18n/provider';

const languages:readonly {code:AppLanguage;name:string}[]=[{code:'en',name:en['language.en']},{code:'ru',name:ru['language.ru']}];

export function AppSettings({disabled=false}:{disabled?:boolean}){
  const {language,setLanguage,t}=useI18n();
  const [open,setOpen]=useState(false);
  const popupId=useId();
  const wrap=useRef<HTMLDivElement>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
  function close(){setOpen(false);trigger.current?.focus();}
  function choose(code:AppLanguage){if(code!==language)setLanguage(code);close();}
  return <div className="app-language" ref={wrap} onBlur={event=>{if(!wrap.current?.contains(event.relatedTarget as Node|null))setOpen(false);}} onKeyDown={event=>{if(event.key==='Escape'&&open){event.stopPropagation();close();}}}>
    <button ref={trigger} type="button" className="language-trigger" aria-label={t('language.label')} aria-expanded={open} aria-controls={popupId} disabled={disabled} onClick={()=>setOpen(current=>!current)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 7h14M5 17h14"/></svg>
      <span>{language.toUpperCase()}</span><span className="chevron" aria-hidden="true">⌃</span>
    </button>
    {open&&<div id={popupId} className="language-popup">
      {languages.map(item=><button key={item.code} type="button" aria-pressed={item.code===language} onClick={()=>choose(item.code)}><span>{item.name}</span>{item.code===language&&<span aria-hidden="true">✓</span>}</button>)}
    </div>}
  </div>;
}
