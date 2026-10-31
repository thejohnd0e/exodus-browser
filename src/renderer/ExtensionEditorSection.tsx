import type {ExtensionEntry} from '../shared/contracts';
import {useI18n} from './i18n/provider';

export function ExtensionEditorSection({value,library,timezoneMode,disabled,onChange}:{
  value:string[];library:ExtensionEntry[];timezoneMode:'auto'|'manual';disabled:boolean;onChange:(next:string[])=>void;
}){
  const {t}=useI18n();
  const enabled=library.filter(entry=>value.includes(entry.id));
  const timezoneWarning=enabled.some(entry=>/timezone/i.test(entry.name));
  return <section className="settings-panel extension-panel"><h3>{t('Extensions')}</h3>
    {library.length?<div className="extension-choices">{library.map(entry=><label className="extension-choice" key={entry.id}><input type="checkbox" aria-label={entry.name} checked={value.includes(entry.id)} disabled={disabled} onChange={event=>onChange(event.target.checked?[...value,entry.id]:value.filter(id=>id!==entry.id))}/><span>{entry.name}<small>v{entry.version}</small></span></label>)}</div>
      :<p className="settings-hint">{t('Add extensions in the Extensions section first.')}</p>}
    {timezoneWarning&&timezoneMode!=='manual'&&<p className="extension-warning" role="status">{t('This extension can also change the time zone. Check the profile time zone setting.')}</p>}
    <p className="settings-hint">{t('Changes apply the next time this profile starts.')}</p>
  </section>;
}
