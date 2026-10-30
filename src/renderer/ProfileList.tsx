import {useState} from 'react';
import type {CookieFormat,Profile,ProfileState} from '../shared/contracts';
const labels:Record<ProfileState,string>={stopped:'Stopped',starting:'Starting',running:'Running',stopping:'Stopping',error:'Launch error',blocked:'Blocked'};
const osLabels:Record<Profile['fingerprint']['os'],string>={windows11:'Windows 11',windows10:'Windows 10',macos:'macOS',linux:'Linux'};
const modeLabels:Record<string,string>={off:'Off',real:'Real',noise:'Noise',disableUdp:'Disable UDP',altered:'Altered',on:'On'};
export const fingerprintSummary=(p:Profile)=>{
 const platform=p.fingerprint.userAgent===null?'system default':osLabels[p.fingerprint.os];
 const timezone=p.fingerprint.timezone.mode==='auto'?'Auto':p.fingerprint.timezone.value;
 return {platform:`${platform} · Canvas: ${modeLabels[p.fingerprint.canvas]} · WebGL: ${modeLabels[p.fingerprint.webgl]}`,timezone:`Time zone: ${timezone}`};
};
export type ProxyCheckResult={ip:string;version:string};
export const profileCheckVersion=(p:Profile)=>`${p.updatedAt}:${p.proxy?.id??''}:${p.proxy?.updatedAt??''}`;
function CookieExport({disabled,onPick}:{disabled:boolean;onPick:(format:CookieFormat)=>void}){
  const [open,setOpen]=useState(false);
  return <div className="cookie-export"><button type="button" disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>Export cookies…</button>{open&&<div className="cookie-menu" role="menu"><button type="button" role="menuitem" onClick={()=>{setOpen(false);onPick('json');}}>JSON (Dolphin)</button><button type="button" role="menuitem" onClick={()=>{setOpen(false);onPick('netscape');}}>Netscape cookies.txt</button></div>}</div>;
}
export function ProfileList({profiles,states,proxyResults,runningVersions,cookieResults,engineReady,busy,onAction,onEdit,onImportCookies,onExportCookies}:{profiles:Profile[];states:Record<string,ProfileState>;proxyResults:Record<string,ProxyCheckResult|undefined>;runningVersions:Record<string,string|null>;cookieResults:Record<string,{text:string;version:string}|undefined>;engineReady:boolean;busy:boolean;onAction:(action:'start'|'stop'|'remove'|'backup'|'checkProxy',id:string)=>void;onEdit:(p:Profile)=>void;onImportCookies:(id:string)=>void;onExportCookies:(id:string,format:CookieFormat)=>void}){
 return <div className="profiles">{profiles.map(p=>{
  const state=states[p.id]??'stopped';const locked=!['stopped','error'].includes(state);
  const result=proxyResults[p.id];const summary=fingerprintSummary(p);
  return <article className="profile" key={p.id}>
   <div className="profile-top"><span className="avatar">{p.name.charAt(0).toUpperCase()}</span><div className="profile-title"><h3>{p.name}</h3><span>{p.proxy?`${p.proxy.name} · ${p.proxy.kind.toUpperCase()} · ${p.proxy.host}:${p.proxy.port}`:'Direct connection'}</span></div><span className={'status '+state}>{labels[state]}</span></div>
   {p.note&&<p className="note">{p.note}</p>}
    <div className="metadata"><span>{p.languages[0]}</span><span>{p.startUrls.length} start pages</span><span>Separate storage</span></div>
    <div className="fingerprint-summary"><span>{summary.platform}</span><span>{summary.timezone}</span><button disabled={busy||locked} onClick={()=>onEdit(p)}>Fingerprint: edit</button></div>
    {p.fingerprint.webRtc==='off'&&<p className="warning">WebRTC is disabled: some media sites and services that check the API may not work.</p>}
   <div className="actions"><button className="primary" disabled={busy||locked||!engineReady} onClick={()=>onAction('start',p.id)}>Launch</button><button disabled={busy||state!=='running'} onClick={()=>onAction('stop',p.id)}>Stop</button><button disabled={busy||locked} onClick={()=>onEdit(p)}>Edit</button><button disabled={busy||locked} onClick={()=>onAction('backup',p.id)}>Backup</button><button disabled={busy||locked} onClick={()=>onImportCookies(p.id)}>Import cookies…</button><CookieExport disabled={busy||locked} onPick={format=>onExportCookies(p.id,format)}/><button disabled={busy||!p.proxy} aria-describedby={p.proxy?'proxy-disclosure-'+p.id:undefined} onClick={()=>onAction('checkProxy',p.id)}>Check IP</button><button className="danger" disabled={busy||locked} onClick={()=>onAction('remove',p.id)}>Delete</button></div>
   {cookieResults[p.id]?.version===p.updatedAt&&<p className="cookie-result" role="status">{cookieResults[p.id]!.text}</p>}
   {p.proxy&&<div className="proxy-check">
    <p className="proxy-disclosure" id={'proxy-disclosure-'+p.id}>api.ipify.org will see the proxy IP. The HTTP response may be spoofed.</p>
    {result?.version===profileCheckVersion(p)&&<p className="proxy-result" role="status">External IP: {result.ip}</p>}
    {Object.hasOwn(runningVersions,p.id)&&runningVersions[p.id]!==`${p.proxy.id}:${p.proxy.updatedAt}`&&<p className="warning">Checking the saved proxy. The running browser uses its previous settings until restarted.</p>}
   </div>}
   {state==='blocked'&&<p className="warning">Close the remaining browser manually and restart the manager.</p>}
  </article>;
 })}</div>;
}
