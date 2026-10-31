import {useState} from 'react';
import type {ExtensionEntry} from '../shared/contracts';
import {ConfirmDialog} from './ConfirmDialog';
import {useI18n} from './i18n/provider';

export function ExtensionLibrary({entries,busy,onAddFolder,onAddZip,onUpdate,onRemove}:{
  entries:ExtensionEntry[];busy:boolean;onAddFolder:()=>void;onAddZip:()=>void;onUpdate:(id:string)=>void;onRemove:(id:string)=>void;
}){
  const {t}=useI18n();
  const [pending,setPending]=useState<ExtensionEntry|null>(null);
  return <><header className="page-header"><div><h1>{t('Extensions')}</h1></div><div className="library-actions"><button disabled={busy} onClick={onAddFolder}>{t('Add folder…')}</button><button disabled={busy} onClick={onAddZip}>{t('Add archive…')}</button></div></header>
    <p className="settings-hint">{t('Extensions are copied into the application. Choose which profiles use each one in profile settings.')}</p>
    {entries.length?<div className="extension-list">{entries.map(entry=><article className="extension-card" key={entry.id}><div className="extension-identity"><strong>{entry.name}</strong><span>v{entry.version}</span></div><div className="actions"><button disabled={busy} onClick={()=>onUpdate(entry.id)}>{t('Update…')}</button><button className="danger" disabled={busy} onClick={()=>setPending(entry)}>{t('Remove')}</button></div></article>)}</div>
      :<section className="empty"><h2>{t('No extensions yet')}</h2><p>{t('Add a folder or archive to reuse the extension in any profile.')}</p></section>}
    {pending&&<ConfirmDialog title={t('Confirm action')} message={t('Remove “{{name}}” from the library? Profiles using it will lose it.',{name:pending.name})} cancelLabel={t('Cancel')} confirmLabel={t('Remove')} danger onCancel={()=>setPending(null)} onConfirm={()=>{const id=pending.id;setPending(null);onRemove(id);}}/>}
  </>;
}
