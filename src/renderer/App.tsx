import {useState,useEffect,useCallback,useRef} from 'react';
import type {CookieFormat,Profile,ProfileApi,ProfileState,EngineStatus,Result,SavedProxy,SavedProxyInput} from '../shared/contracts';
import {ProfileEditor} from './ProfileEditor';
import {ProfileList,profileCheckVersion,type ProxyCheckResult} from './ProfileList';
import {EngineSettings} from './EngineSettings';
import {ProxyLibrary} from './ProxyLibrary';
import {ProxyEditor} from './ProxyEditor';
import wordmark from '../../ico/exodus-wordmark.png';
import {BUILD_INFO} from '../shared/build-info';
import {AppSettings} from './AppSettings';
import {I18nProvider} from './i18n/provider';
import type {AppLanguage} from '../shared/settings';
export function App({api=window.profileApi}:{api?:ProfileApi}){
 const [profiles,setProfiles]=useState<Profile[]>([]);const [proxies,setProxies]=useState<SavedProxy[]>([]);const [states,setStates]=useState<Record<string,ProfileState>>({});const [runningVersions,setRunningVersions]=useState<Record<string,string|null>>({});const [engine,setEngine]=useState<EngineStatus>({state:'missing'});const [query,setQuery]=useState('');const [editor,setEditor]=useState<Profile|null|undefined>();const [proxyEditor,setProxyEditor]=useState<SavedProxy|null|undefined>();const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [view,setView]=useState<'profiles'|'proxies'>('profiles');const [language,setLanguage]=useState<AppLanguage>('en');
 const [proxyResults,setProxyResults]=useState<Record<string,ProxyCheckResult|undefined>>({});const [savedResults,setSavedResults]=useState<Record<string,ProxyCheckResult|undefined>>({});const [cookieResults,setCookieResults]=useState<Record<string,{text:string;version:string}|undefined>>({});const refreshSequence=useRef(0);
  const refresh=useCallback(async()=>{const sequence=++refreshSequence.current;try{const [p,s,e,x,v]=await Promise.all([api.list(),api.states(),api.engineStatus(),api.listProxies(),api.runningProxyVersions()]);if(sequence!==refreshSequence.current)return;if(p.ok)setProfiles(p.value);else setMessage(p.error.message);if(s.ok)setStates(s.value);if(e.ok)setEngine(e.value);if(x.ok)setProxies(x.value);else setMessage(x.error.message);if(v.ok)setRunningVersions(v.value);}catch{if(sequence===refreshSequence.current)setMessage('Cannot connect to the local application.');}},[api]);
   useEffect(()=>{document.title=`Exodus Browser v${BUILD_INFO.version}`;},[]);
   useEffect(()=>{let active=true;void api.getSettings().then(result=>{if(active&&result.ok)setLanguage(result.value.language);}).catch(()=>undefined);return()=>{active=false;};},[api]);
  useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),1000);return()=>clearInterval(timer);},[refresh]);
  async function run<T>(action:()=>Promise<Result<T>>):Promise<T|false>{setBusy(true);setMessage('');try{const result=await action();if(!result.ok){setMessage(result.error.message);return false;}return result.value;}catch{setMessage('Operation failed.');return false;}finally{await refresh();setBusy(false);}}
  function updateLanguage(next:AppLanguage){void run(()=>api.updateSettings({language:next})).then(value=>{if(value)setLanguage(value.language);});}
 const filtered=profiles.filter(p=>(p.name+' '+p.note).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 async function createProxy(input:SavedProxyInput){return run(()=>api.createProxy(input));}
   function cookieAction(id:string,kind:'import'|'export',format?:CookieFormat){
   const p=profiles.find(item=>item.id===id);if(!p)return;const version=p.updatedAt;
   void run(()=>kind==='import'?api.importCookies(id):api.exportCookies(id,format??'json')).then(value=>{
    if(!value)return;
    const text=kind==='import'?`Imported ${value.count} cookies from ${value.fileName}`:`Exported ${value.count} cookies to ${value.fileName}`;
    setCookieResults(prev=>({...prev,[id]:{text,version}}));
   });
   }
   function clearCookies(id:string){
    const p=profiles.find(item=>item.id===id);if(!p)return;const version=p.updatedAt;
    void run(()=>api.clearCookies(id)).then(value=>{if(value)setCookieResults(prev=>({...prev,[id]:{text:'Cookies cleared. Other site data was kept.',version}}));});
   }
   return <I18nProvider language={language} onLanguageChange={updateLanguage}><div className="shell"><aside><div className="brand"><img src={wordmark} alt="Exodus Browser" width={1200} height={300}/><span className="build-version">v{BUILD_INFO.version}</span></div><AppSettings disabled={busy}/><nav><button className={view==='profiles'?'nav-active':''} aria-label="Profiles" disabled={busy} onClick={()=>setView('profiles')}>▦ Browser profiles</button><button className={view==='proxies'?'nav-active':''} aria-label="Proxies" disabled={busy} onClick={()=>setView('proxies')}>⇄ Proxies</button></nav></aside><main>
 {message&&<div className="notice" role="alert"><span>{message}</span><button onClick={()=>setMessage('')} aria-label="Dismiss message">✕</button></div>}
  {view==='profiles'?<><header className="page-header"><div><h1>Browser profiles</h1></div><button className="primary" onClick={()=>setEditor(null)} disabled={busy}>＋ New profile</button></header><section className="stats"><div><strong>{profiles.length}</strong><span>Total profiles</span></div><div><strong>{Object.values(states).filter(s=>s==='running').length}</strong><span>Currently running</span></div></section><EngineSettings status={engine} busy={busy} onInstall={()=>void run(()=>api.installEngine())} onLink={()=>void run(()=>api.linkEngine())}/><div className="toolbar"><input placeholder="Search profiles" aria-label="Search profiles" value={query} onChange={e=>setQuery(e.target.value)}/><button disabled={busy} onClick={()=>void run(()=>api.restore())}>Restore from backup</button></div>
  {filtered.length?<ProfileList profiles={filtered} states={states} proxyResults={proxyResults} runningVersions={runningVersions} cookieResults={cookieResults} engineReady={engine.state==='ready'} busy={busy} onEdit={setEditor} onImportCookies={id=>cookieAction(id,'import')} onExportCookies={(id,format)=>cookieAction(id,'export',format)} onClearCookies={clearCookies} onAction={(action,id)=>{
  if(action==='checkProxy'){const p=profiles.find(p=>p.id===id);if(!p)return;const version=profileCheckVersion(p);setProxyResults(prev=>({...prev,[id]:undefined}));void run(async()=>{const result=await api.checkProxy(id);if(result.ok&&result.value){const {ip}=result.value;setProxyResults(prev=>({...prev,[id]:{ip,version}}));}return result;});return;}
  void run(()=>action==='start'?api.start(id):action==='stop'?api.stop(id):action==='remove'?api.remove(id):api.backup(id));
 }}/>:<section className="empty"><div>▧</div><h2>{query?'No profiles found':'Start with your first profile'}</h2><p>{query?'Try a different name.':'Each profile will have its own cookies, site data and settings.'}</p>{!query&&<button onClick={()=>setEditor(null)}>Create profile</button>}</section>}</>:<ProxyLibrary proxies={proxies} profiles={profiles} busy={busy} results={savedResults} onCreate={()=>setProxyEditor(null)} onEdit={setProxyEditor} onRemove={id=>void run(()=>api.removeProxy(id))} onCheck={p=>{const version=p.updatedAt;setSavedResults(prev=>({...prev,[p.id]:undefined}));void run(async()=>{const result=await api.checkSavedProxy(p.id);if(result.ok){const {ip}=result.value;setSavedResults(prev=>({...prev,[p.id]:{ip,version}}));}return result;});}}/>}
 <footer className="disclaimer">Profile isolation is not anti-detection. A browser proxy is not a VPN; prevention of all DNS/WebRTC/UDP leaks is not guaranteed.</footer></main>
 {editor!==undefined&&<ProfileEditor key={editor?.id??'new'} profile={editor??undefined} proxies={proxies} busy={busy} chromeVersion={engine.version??null} onCancel={()=>setEditor(undefined)} onSaveProxy={createProxy} onSave={async input=>{const result=await run(()=>editor?api.update(editor.id,input):api.create(input));if(result!==false)setEditor(undefined);}}/>}
 {proxyEditor!==undefined&&<ProxyEditor proxy={proxyEditor??undefined} busy={busy} onCancel={()=>setProxyEditor(undefined)} onSave={async input=>(await run(()=>proxyEditor?api.updateProxy(proxyEditor.id,input):api.createProxy(input)))!==false}/>}
  </div></I18nProvider>;
}
