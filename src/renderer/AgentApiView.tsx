import {useEffect,useState} from 'react';
import type {Profile,ProfileApi,Result,SavedProxy} from '../shared/contracts';
import type {AgentApiStatus} from '../shared/agent-api';
import {useI18n} from './i18n/provider';

const empty:AgentApiStatus={enabled:false,origin:null,credentials:[]};
type Kind='profile'|'proxy';
type Resource={kind:Kind;id:string;name:string};
type Credential=AgentApiStatus['credentials'][number];

export function AgentApiView({api,profiles,proxies,busy,onResult}:{api:ProfileApi;profiles:Profile[];proxies:SavedProxy[];busy:boolean;onResult:(result:Result<unknown>)=>void}){
  const {t}=useI18n();
  const [status,setStatus]=useState<AgentApiStatus>(empty);
  const [label,setLabel]=useState('');
  const [issued,setIssued]=useState<{id:string;token:string}|null>(null);
  const [copyStatus,setCopyStatus]=useState<'idle'|'copied'|'error'>('idle');
  const [expanded,setExpanded]=useState<Record<string,boolean>>({});
  const [open,setOpen]=useState<string|null>(null);
  const [selected,setSelected]=useState<Record<string,boolean>>({});

  async function load(){const result=await api.agentApiStatus();if(result.ok)setStatus(result.value);else onResult(result);}
  useEffect(()=>{void load();},[api]);

  async function toggle(enabled:boolean){const result=await api.setAgentApiEnabled(enabled);if(result.ok)setStatus(result.value);else onResult(result);}
  async function create(){if(!label.trim())return;const result=await api.createAgentCredential(label.trim());onResult(result);if(result.ok){setIssued(result.value);setCopyStatus('idle');setLabel('');await load();}}
  async function copyKey(){try{if(!issued||!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');await navigator.clipboard.writeText(issued.token);setCopyStatus('copied');}catch{setCopyStatus('error');}}
  async function revoke(id:string){const result=await api.revokeAgentCredential(id);onResult(result);if(result.ok)await load();}
  async function apply(credentialId:string){
    const picks=resources.filter(resource=>selected[resource.kind+':'+resource.id]);
    if(!picks.length)return;
    for(const pick of picks){
      const result=await api.grantAgentCredential({credentialId,kind:pick.kind,resourceId:pick.id});
      if(!result.ok){onResult(result);return;}
    }
    setSelected({});setOpen(null);await load();
  }
  async function removeGrant(credentialId:string,kind:Kind,resourceId:string){
    const result=await api.revokeAgentGrant({credentialId,kind,resourceId});
    onResult(result);
    if(result.ok)await load();
  }

  const active=status.credentials.filter(credential=>!credential.revoked);
  const resources:Resource[]=[
    ...profiles.map(profile=>({kind:'profile' as const,id:profile.id,name:profile.name})),
    ...proxies.map(proxy=>({kind:'proxy' as const,id:proxy.id,name:proxy.name})),
  ];
  const nameOf=(kind:Kind,id:string)=>resources.find(resource=>resource.kind===kind&&resource.id===id)?.name??t('Unknown resource');
  const availableFor=(credential:Credential)=>resources.filter(resource=>!(resource.kind==='profile'?credential.profileIds:credential.proxyIds).includes(resource.id));
  const selectionKey=(resource:Resource)=>resource.kind+':'+resource.id;
  const picked=resources.filter(resource=>selected[selectionKey(resource)]);

  function togglePicker(credentialId:string){
    setOpen(open===credentialId?null:credentialId);
    setSelected({});
  }

  return <>
    <header className="page-header"><div><h1>{t('Agent API')}</h1></div></header>
    <section className="summary-row">
      <div className="summary-counts">
        <span><strong>{status.enabled?t('API enabled'):t('API disabled')}</strong></span>
        {status.origin&&<span><strong>{status.origin}</strong></span>}
      </div>
      <button className={status.enabled?'agent-api-enabled':'agent-api-disabled'} disabled={busy} onClick={()=>void toggle(!status.enabled)}>{status.enabled?t('Disable API'):t('Enable API')}</button>
    </section>
    <p className="hint">{t('The API listens only on this computer. Each integration uses its own key and sees only the profiles and proxies you grant.')}</p>
    <section className="agent-credentials">
      <h2>{t('Integrations')}</h2>
      <div className="toolbar">
        <input aria-label={t('Integration name')} placeholder={t('Integration name')} value={label} maxLength={100} disabled={busy} onChange={event=>setLabel(event.target.value)}/>
        <button disabled={busy||!label.trim()} onClick={()=>void create()}>{t('Create key')}</button>
      </div>
      {issued&&<div className="notice agent-key-notice"><div><p>{t('Copy this key now. It is shown only once.')}</p><button type="button" className="agent-key" aria-label={t('Copy key')} onClick={()=>void copyKey()}><code>{issued.token}</code><span>{t('Click to copy')}</span></button><p role="status">{copyStatus==='copied'?t('Copied'):copyStatus==='error'?t('Copy failed. Select and copy the key manually.'):''}</p></div><button aria-label={t('Dismiss message')} onClick={()=>setIssued(null)}>✕</button></div>}
      {active.length===0?<p className="hint">{t('No integrations yet.')}</p>:<ul className="agent-list">
        {active.map(credential=>{
          const available=availableFor(credential);
          return <li key={credential.id} className="agent-card" aria-label={credential.label}>
            <div className="agent-card-head"><button type="button" className="agent-card-toggle" aria-expanded={!!expanded[credential.id]} aria-controls={'agent-details-'+credential.id} onClick={()=>setExpanded(previous=>({...previous,[credential.id]:!previous[credential.id]}))}><strong>{credential.label}</strong><span>{t('Profiles ({{count}})',{count:credential.profileIds.length})} · {t('Proxies ({{count}})',{count:credential.proxyIds.length})}</span><span aria-hidden="true">{expanded[credential.id]?'▴':'▾'}</span></button><button disabled={busy} onClick={()=>void revoke(credential.id)}>{t('Revoke')}</button></div>
            <div id={'agent-details-'+credential.id} hidden={!expanded[credential.id]}>
            <p className="hint">{t('Access')}</p>
            <div className="agent-grant-groups">
              <section className="agent-grant-group" aria-labelledby={'agent-profiles-'+credential.id}>
                <h4 id={'agent-profiles-'+credential.id}>{t('Profiles ({{count}})',{count:credential.profileIds.length})}</h4>
                {credential.profileIds.length===0?<p className="hint">{t('No profiles granted.')}</p>:<ul className="agent-chips">
                  {credential.profileIds.map(id=>{
                    const name=nameOf('profile',id);
                    return <li key={id}><span>{name}</span><button aria-label={t('Remove access: {{name}}',{name})} disabled={busy} onClick={()=>void removeGrant(credential.id,'profile',id)}>✕</button></li>;
                  })}
                </ul>}
              </section>
              <section className="agent-grant-group" aria-labelledby={'agent-proxies-'+credential.id}>
                <h4 id={'agent-proxies-'+credential.id}>{t('Proxies ({{count}})',{count:credential.proxyIds.length})}</h4>
                {credential.proxyIds.length===0?<p className="hint">{t('No proxies granted.')}</p>:<ul className="agent-chips">
                  {credential.proxyIds.map(id=>{
                    const name=nameOf('proxy',id);
                    return <li key={id}><span>{name}</span><button aria-label={t('Remove access: {{name}}',{name})} disabled={busy} onClick={()=>void removeGrant(credential.id,'proxy',id)}>✕</button></li>;
                  })}
                </ul>}
              </section>
            </div>
            {available.length===0?resources.length>0&&<p className="hint">{t('Every available resource is already granted.')}</p>:<div className="agent-grant">
              <button disabled={busy} onClick={()=>togglePicker(credential.id)}>{t('Add access')}</button>
              {open===credential.id&&<div className="agent-picker">
                {(['profile','proxy'] as const).map(kind=>{
                  const entries=available.filter(resource=>resource.kind===kind);
                  if(!entries.length)return null;
                  return <fieldset key={kind}><legend>{kind==='profile'?t('Profiles'):t('Proxies')}</legend>
                    {entries.map(resource=><label key={selectionKey(resource)}><input type="checkbox" checked={!!selected[selectionKey(resource)]} disabled={busy} onChange={()=>setSelected(previous=>({...previous,[selectionKey(resource)]:!previous[selectionKey(resource)]}))}/>{resource.name}</label>)}
                  </fieldset>;
                })}
                <button disabled={busy||!picked.length} onClick={()=>void apply(credential.id)}>{t('Apply')}</button>
              </div>}
            </div>}
            </div>
          </li>;
        })}
      </ul>}
    </section>
  </>;
}
