import type {EngineStatus} from '../shared/contracts';
import {useState} from 'react';
import {useI18n} from './i18n/provider';
export function EngineSettings({status,busy,onInstall}:{status:EngineStatus;busy:boolean;onInstall:()=>void}){
  const {t}=useI18n();
  const [helpOpen,setHelpOpen]=useState(false);
  if(status.state==='installing'){
    const progress=status.progress;
    const percent=progress?.stage==='download'&&progress.total?Math.min(100,Math.round((progress.received??0)/progress.total*100)):null;
    const megabytes=progress?.stage==='download'&&progress.received?Math.round(progress.received/1048576):null;
    const label=progress?.stage==='download'
      ? `${t('Downloading Google Chrome')}${percent===null?'':` ${percent}%`}${megabytes===null?'':` · ${megabytes} ${t('MB')}`}`
      : progress?.stage==='verify'?t('Checking the signature'):t('Unpacking Google Chrome');
    return <div className="engine engine-installing"><div className="engine-progress"><strong>{label}</strong><div className="engine-bar" role="progressbar" aria-valuenow={percent??undefined} aria-valuemin={0} aria-valuemax={100}><span className={percent===null?'indeterminate':''} style={{width:percent===null?'100%':`${percent}%`}}/></div><p>{t('This can take a minute. Keep this window open.')}</p></div></div>;
  }
  if(status.state==='ready')return <div className="engine-ready"><strong>{status.source==='branded'?'Google Chrome':'Chromium'} {status.version}</strong><span className="engine-help"><button type="button" aria-label={t('About separate Chromium')} aria-describedby="engine-help-text" onFocus={()=>setHelpOpen(true)} onBlur={()=>setHelpOpen(false)} onMouseEnter={()=>setHelpOpen(true)} onMouseLeave={()=>setHelpOpen(false)} onKeyDown={event=>{if(event.key==='Escape')setHelpOpen(false);}}>i</button><span id="engine-help-text" role="tooltip" className={helpOpen?'visible':''}>{status.source==='external'?t('Uses your selected chrome.exe; file integrity is checked at launch.'):t('Each profile runs in a separate browser process; your personal browser is not used.')}</span></span>{status.compatibility==='older'&&status.source!=='external'&&<>
    <span className="engine-warning">{t('engine.older',{min:String(status.supportedMajors?.min??''),max:String(status.supportedMajors?.max??'')})}</span>
    <button type="button" disabled={busy} onClick={onInstall}>{t('engine.update')}</button>
  </>}
  {status.compatibility==='newer'&&<span className="engine-warning">{t('engine.newer',{min:String(status.supportedMajors?.min??''),max:String(status.supportedMajors?.max??'')})}</span>}
  </div>;
  return <div className="engine"><div><strong>{t('Browser not installed')}</strong><p>{t('Download Google Chrome once. Profiles run on it; your personal browser is not used.')}</p></div><div className="engine-actions"><button className="primary" disabled={busy} onClick={onInstall}>{t('Download Google Chrome')}</button></div></div>;
}
