import {useEffect,useState,type ReactNode} from 'react';
import {useI18n} from './i18n/provider';
import {BUILD_INFO} from '../shared/build-info';
import type {ProfileApi} from '../shared/contracts';
import type {UpdateState} from '../shared/update';
import {messageForError} from '../shared/i18n/messages';

const BYTES_PER_MEGABYTE=1024*1024;

export function UpdateButton({disabled=false,api=window.profileApi}:{disabled?:boolean;api?:ProfileApi}){
  const {language,t}=useI18n();
  const [state,setState]=useState<UpdateState>({state:'idle'});
  const [message,setMessage]=useState<string|null>(null);

  useEffect(()=>{
    let active=true;
    let pushed=false;
    const unsubscribe=api.onUpdateState(next=>{if(active){pushed=true;setState(next);}});
    void api.getUpdateState().then(result=>{if(active&&!pushed&&result.ok)setState(result.value);});
    return()=>{active=false;unsubscribe();};
  },[api]);

  async function check(){
    setMessage(null);
    const result=await api.checkForUpdate();
    if(result.ok)setState(result.value);
    else setMessage(messageForError(result.error.code,language));
  }

  async function download(){
    setMessage(null);
    const result=await api.downloadUpdate();
    if(result.ok)setState(result.value);
    else setMessage(messageForError(result.error.code,language));
  }

  async function install(){
    setMessage(null);
    const result=await api.installUpdate();
    if(!result.ok)setMessage(messageForError(result.error.code,language));
  }

  const version=`v${BUILD_INFO.version}`;
  const busy=state.state==='checking'||state.state==='downloading';
  let status:string|null=null;
  let action:ReactNode=null;
  switch(state.state){
    case 'checking':
      status=t('Checking for updates…');
      break;
    case 'up-to-date':
      status=t('You have the latest version.');
      break;
    case 'available':
      status=t('Version {{version}} is available ({{size}}).',{version:state.version,size:`${Math.round(state.size/BYTES_PER_MEGABYTE)} MB`});
      action=<button type="button" onClick={()=>void download()}>{t('Download update')}</button>;
      break;
    case 'downloading':
      status=t('Downloading {{percent}}%',{percent:state.total>0?Math.min(100,Math.floor(state.received*100/state.total)):0});
      action=<button type="button" onClick={()=>void api.cancelUpdate()}>{t('Cancel download')}</button>;
      break;
    case 'ready':
      status=t('Stop all browsers before installing the update.');
      action=<button type="button" onClick={()=>void install()}>{t('Install and restart')}</button>;
      break;
    case 'error':
      status=messageForError(state.code,language);
      break;
    default:
      break;
  }

  const panel = status || action || message
    ? <div className="update-panel">
        {status && <p className="update-status" role="status">{status}</p>}
        {action}
        {message && <p className="update-status update-error" role="alert">{message}</p>}
      </div>
    : null;

  return <span className="update-control">
    <button type="button" className="build-version" aria-label={`${t('Check for updates')} (${version})`} disabled={disabled||busy} onClick={()=>void check()}>{version}</button>
    {panel}
  </span>;
}
