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
import {I18nProvider,translate} from './i18n/provider';
import type {AppLanguage} from '../shared/settings';
import {messageForError} from '../shared/i18n/messages';
export function App({api=window.profileApi}:{api?:ProfileApi}){
 const [profiles,setProfiles]=useState<Profile[]>([]);const [proxies,setProxies]=useState<SavedProxy[]>([]);const [states,setStates]=useState<Record<string,ProfileState>>({});const [runningVersions,setRunningVersions]=useState<Record<string,string|null>>({});const [engine,setEngine]=useState<EngineStatus>({state:'missing'});const [query,setQuery]=useState('');const [editor,setEditor]=useState<Profile|null|undefined>();const [proxyEditor,setProxyEditor]=useState<SavedProxy|null|undefined>();const [busy,setBusy]=useState(false);const [message,setMessage]=useState<string|null>(null);const [view,setView]=useState<'profiles'|'proxies'>('profiles');const [language,setLanguage]=useState<AppLanguage>('en');
 const [proxyResults,setProxyResults]=useState<Record<string,ProxyCheckResult|undefined>>({});const [savedResults,setSavedResults]=useState<Record<string,ProxyCheckResult|undefined>>({});const [cookieResults,setCookieResults]=useState<Record<string,{kind:'import'|'export'|'clear';count:number;fileName:string;version:string}|undefined>>({});const refreshSequence=useRef(0);
 const t=(key:string,params?:Record<string,string|number>)=>translate(language,key,params);
   const refresh=useCallback(async()=>{const sequence=++refreshSequence.current;try{const [p,s,e,x,v]=await Promise.all([api.list(),api.states(),api.engineStatus(),api.listProxies(),api.runningProxyVersions()]);if(sequence!==refreshSequence.current)return;if(p.ok)setProfiles(p.value);else setMessage(p.error.code);if(s.ok)setStates(s.value);if(e.ok)setEngine(e.value);if(x.ok)setProxies(x.value);else setMessage(x.error.code);if(v.ok)setRunningVersions(v.value);}catch{if(sequence===refreshSequence.current)setMessage('OPERATION_FAILED');}},[api]);
    useEffect(()=>{document.title=`Exodus Browser v${BUILD_INFO.version}`;},[]);
    useEffect(()=>{document.documentElement.lang=language==='ru'?'ru':'en';},[language]);
   useEffect(()=>{let active=true;void api.getSettings().then(result=>{if(active&&result.ok)setLanguage(result.value.language);}).catch(()=>undefined);return()=>{active=false;};},[api]);
  useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),1000);return()=>clearInterval(timer);},[refresh]);
   async function run<T>(action:()=>Promise<Result<T>>):Promise<T|false>{setBusy(true);setMessage(null);try{const result=await action();if(!result.ok){setMessage(result.error.code);return false;}return result.value;}catch{setMessage('OPERATION_FAILED');return false;}finally{await refresh();setBusy(false);}}
   function updateLanguage(next:AppLanguage){setBusy(true);void api.updateSettings({language:next}).then(result=>{if(result.ok)setLanguage(result.value.language);else setMessage(result.error.code);}).catch(()=>setMessage('OPERATION_FAILED')).finally(()=>setBusy(false));}
  const filtered=profiles.filter(p=>(p.name+' '+p.note).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 async function createProxy(input:SavedProxyInput){return run(()=>api.createProxy(input));}
   function cookieAction(id:string,kind:'import'|'export',format?:CookieFormat){
   const p=profiles.find(item=>item.id===id);if(!p)return;const version=p.updatedAt;
   void run(()=>kind==='import'?api.importCookies(id):api.exportCookies(id,format??'json')).then(value=>{
    if(!value)return;
     setCookieResults(prev=>({...prev,[id]:{kind,count:value.count,fileName:value.fileName,version}}));
   });
   }
   function clearCookies(id:string){
    const p=profiles.find(item=>item.id===id);if(!p)return;const version=p.updatedAt;
     void run(()=>api.clearCookies(id)).then(value=>{if(value)setCookieResults(prev=>({...prev,[id]:{kind:'clear',count:0,fileName:'',version}}));});
   }
    return <I18nProvider language={language} onLanguageChange={updateLanguage}><div className="shell"><aside><div className="brand"><img src={wordmark} alt="Exodus Browser" width={1200} height={300}/><span className="build-version">v{BUILD_INFO.version}</span></div><AppSettings disabled={busy}/><nav><button className={view==='profiles'?'nav-active':''} aria-label={t('Profiles')} disabled={busy} onClick={()=>setView('profiles')}>▦ {t('Browser profiles')}</button><button className={view==='proxies'?'nav-active':''} aria-label={t('Proxies')} disabled={busy} onClick={()=>setView('proxies')}>⇄ {t('Proxies')}</button></nav></aside><main>
  {message&&<div className="notice" role="alert"><span>{messageForError(message,language)}</span><button onClick={()=>setMessage(null)} aria-label={t('Dismiss message')}>✕</button></div>}
   {view==='profiles'?<><header className="page-header"><div><h1>{t('Browser profiles')}</h1></div><button className="primary" onClick={()=>setEditor(null)} disabled={busy}>＋ {t('New profile')}</button></header><section className="stats"><div><strong>{profiles.length}</strong><span>{t('Total profiles')}</span></div><div><strong>{Object.values(states).filter(s=>s==='running').length}</strong><span>{t('Currently running')}</span></div></section><EngineSettings status={engine} busy={busy} onInstall={()=>void run(()=>api.installEngine())} onLink={()=>void run(()=>api.linkEngine())}/><div className="toolbar"><input placeholder={t('Search profiles')} aria-label={t('Search profiles')} value={query} onChange={e=>setQuery(e.target.value)}/><button disabled={busy} onClick={()=>void run(()=>api.restore())}>{t('Restore from backup')}</button></div>
  {filtered.length?<ProfileList language={language} profiles={filtered} states={states} proxyResults={proxyResults} runningVersions={runningVersions} cookieResults={cookieResults} engineReady={engine.state==='ready'} busy={busy} onEdit={setEditor} onImportCookies={id=>cookieAction(id,'import')} onExportCookies={(id,format)=>cookieAction(id,'export',format)} onClearCookies={clearCookies} onAction={(action,id)=>{
  if(action==='checkProxy'){const p=profiles.find(p=>p.id===id);if(!p)return;const version=profileCheckVersion(p);setProxyResults(prev=>({...prev,[id]:undefined}));void run(async()=>{const result=await api.checkProxy(id);if(result.ok&&result.value){const {ip}=result.value;setProxyResults(prev=>({...prev,[id]:{ip,version}}));}return result;});return;}
  void run(()=>action==='start'?api.start(id):action==='stop'?api.stop(id):action==='remove'?api.remove(id):api.backup(id));
  }}/>:<section className="empty"><div>▧</div><h2>{t(query?'No profiles found':'Start with your first profile')}</h2><p>{t(query?'Try a different name.':'Each profile will have its own cookies, site data and settings.')}</p>{!query&&<button onClick={()=>setEditor(null)}>{t('Create profile')}</button>}</section>}</>:<ProxyLibrary proxies={proxies} profiles={profiles} busy={busy} results={savedResults} onCreate={()=>setProxyEditor(null)} onEdit={setProxyEditor} onRemove={id=>void run(()=>api.removeProxy(id))} onCheck={p=>{const version=p.updatedAt;setSavedResults(prev=>({...prev,[p.id]:undefined}));void run(async()=>{const result=await api.checkSavedProxy(p.id);if(result.ok){const {ip}=result.value;setSavedResults(prev=>({...prev,[p.id]:{ip,version}}));}return result;});}}/>}
  <footer className="disclaimer">{t('Profile isolation is not anti-detection. A browser proxy is not a VPN; prevention of all DNS/WebRTC/UDP leaks is not guaranteed.')}</footer></main>
 {editor!==undefined&&<ProfileEditor key={editor?.id??'new'} profile={editor??undefined} proxies={proxies} busy={busy} chromeVersion={engine.version??null} onCancel={()=>setEditor(undefined)} onSaveProxy={createProxy} onSave={async input=>{const result=await run(()=>editor?api.update(editor.id,input):api.create(input));if(result!==false)setEditor(undefined);}}/>}
 {proxyEditor!==undefined&&<ProxyEditor proxy={proxyEditor??undefined} busy={busy} onCancel={()=>setProxyEditor(undefined)} onSave={async input=>(await run(()=>proxyEditor?api.updateProxy(proxyEditor.id,input):api.createProxy(input)))!==false}/>}
  </div></I18nProvider>;
}
