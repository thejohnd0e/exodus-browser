import {useState} from 'react';
import {useI18n} from './i18n/provider';

export function StoreLinkDialog({onCancel,onSubmit}:{onCancel:()=>void;onSubmit:(link:string)=>void}){
  const {t}=useI18n();
  const [link,setLink]=useState('');
  return <div className="modal-backdrop"><section className="editor store-link-editor" role="dialog" aria-modal="true" aria-labelledby="store-link-title">
    <header><h2 id="store-link-title">{t('Add from store…')}</h2><button type="button" onClick={onCancel} aria-label={t('Close editor')}>✕</button></header>
    <form onSubmit={event=>{event.preventDefault();const value=link.trim();if(!value)return;onSubmit(value);}}>
      <label>{t('Chrome Web Store link')}<input autoFocus value={link} maxLength={2048} placeholder="https://chromewebstore.google.com/detail/name/extension-id" onChange={event=>setLink(event.target.value)}/></label>
      <p className="settings-hint">{t('The extension is downloaded from Google, copied into the library and applied at the next profile launch.')}</p>
      <footer><button type="button" onClick={onCancel}>{t('Cancel')}</button><button className="primary" disabled={!link.trim()}>{t('Add extension')}</button></footer>
    </form>
  </section></div>;
}
