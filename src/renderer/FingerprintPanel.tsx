import {useState} from 'react';
import type {Fingerprint} from '../shared/fingerprint';
import {newFingerprint} from '../shared/fingerprint-presets';
import {uaForOs} from '../shared/user-agent';
import {useI18n} from './i18n/provider';
import {TimeZoneSelect} from './TimeZoneSelect';
type Option<T extends string>={value:T;label:string;disabled?:boolean};
function Choices<T extends string>({label,value,options,onChange,disabled,extra=[]}:{label:string;value:T;options:readonly Option<T>[];onChange:(value:T)=>void;disabled:boolean;extra?:readonly {label:string}[]}){
  const {t}=useI18n();
  return <div className="fingerprint-field"><span className="fingerprint-label">{t(label)}</span><div className="fingerprint-choices" role="group" aria-label={t(label)}>{options.map(option=><button type="button" key={option.value} className={option.value===value?'active':''} aria-pressed={option.value===value} disabled={disabled||option.disabled} onClick={()=>onChange(option.value)}>{t(option.label)}</button>)}{extra.map(option=><button type="button" key={option.label} disabled>{t(option.label)}</button>)}</div></div>;
}
const osOptions:readonly Option<Fingerprint['os']>[]=[{value:'windows11',label:'Windows 11'},{value:'windows10',label:'Windows 10'},{value:'macos',label:'macOS'},{value:'linux',label:'Linux'}];
const weakOptions:readonly Option<'off'|'real'|'noise'>[]=[{value:'off',label:'Off'},{value:'real',label:'Real'},{value:'noise',label:'Noise'}];
const webRtcOptions:readonly Option<Fingerprint['webRtc']>[]=[{value:'off',label:'Off'},{value:'real',label:'Real'},{value:'disableUdp',label:'Disable UDP'}];
const realNoiseOptions:readonly Option<'real'|'noise'>[]=[{value:'real',label:'Real'},{value:'noise',label:'Noise'}];
const modeOptions:readonly Option<'real'|'manual'>[]=[{value:'real',label:'Real'},{value:'manual',label:'Manual'}];
const autoManualOptions:readonly Option<'auto'|'manual'>[]=[{value:'auto',label:'Auto'},{value:'manual',label:'Manual'}];
const geoOptions:readonly Option<'auto'|'block'|'manual'>[]=[{value:'auto',label:'Auto'},{value:'block',label:'Block'},{value:'manual',label:'Manual'}];
const timezoneModeOptions:readonly Option<'auto'|'manual'>[]=[{value:'auto',label:'Auto (by IP)'},{value:'manual',label:'Manual'}];
const onOffOptions:readonly Option<'on'|'off'>[]=[{value:'on',label:'On'},{value:'off',label:'Off'}];
const memoryOptions=[0.5,1,2,4,8] as const;
export function FingerprintPanel({value,onChange,disabled,chromeVersion,hostGpuVendors,hostGpuModels}:{value:Fingerprint;onChange:(next:Fingerprint)=>void;disabled:boolean;chromeVersion:string|null;hostGpuVendors?:readonly string[];hostGpuModels?:readonly string[]}){
   const {t}=useI18n();
  const [matchHostGpu,setMatchHostGpu]=useState(true);
  // The interface runs on the host display, so its screen is the size a profile window can reach.
  const hostScreen=typeof window!=='undefined'&&window.screen?{width:window.screen.width,height:window.screen.height}:undefined;
  const set=<K extends keyof Fingerprint>(key:K,next:Fingerprint[K])=>onChange({...value,[key]:next});
  const engineVersion=chromeVersion&&/^\d+(\.\d+)+$/.test(chromeVersion)?chromeVersion:null;
  const geo=value.geolocation.mode==='manual'?value.geolocation:{mode:'manual' as const,latitude:0,longitude:0,accuracy:100};
  const hardware=value.hardware.mode==='manual'?value.hardware:{mode:'manual' as const,cores:8,memoryGb:8 as const};
  const screen=value.screen.mode==='manual'?value.screen:{mode:'manual' as const,width:1920,height:1080};
  return <section className="settings-panel fingerprint-panel" aria-labelledby="fingerprint-title">
     <header className="fingerprint-head"><h3 id="fingerprint-title">{t('Fingerprint')}</h3><button type="button" className="primary" disabled={disabled||!engineVersion} onClick={()=>onChange({...newFingerprint({os:value.os,chromeVersion:engineVersion!,random:Math.random,hostGpuVendors,hostGpuModels:matchHostGpu?hostGpuModels:undefined,hostScreen}),...(value.strictProtection?{strictProtection:true}:{})})}>{t('New fingerprint')}</button></header>
     <label className="check fingerprint-host-gpu"><input type="checkbox" checked={matchHostGpu} disabled={disabled} onChange={e=>setMatchHostGpu(e.target.checked)}/>{t('Use the installed graphics card')}</label>
     <p className="settings-hint">{engineVersion?t('New fingerprint sets Chrome/{{version}} with matching screen resolution, memory and graphics card.',{version:engineVersion}):t('Link an engine to generate a fingerprint for its version.')}</p>
    <Choices label="Operating system" value={value.os} options={osOptions} extra={[{label:'Android · Soon'},{label:'iOS · Soon'}]} onChange={os=>set('os',os)} disabled={disabled}/>
    {(value.os==='macos'||value.os==='linux')&&<p className="warning" role="status">{t('Selected OS differs from host OS. Fonts, text rendering and graphics limits still show the host platform.')}</p>}
     <label>User-Agent<input value={value.userAgent??''} maxLength={512} disabled={disabled} placeholder={engineVersion?uaForOs(value.os,engineVersion):t('System default')} onChange={e=>set('userAgent',e.target.value||null)}/><small className="settings-hint">{t('Leave blank to use the actual engine User-Agent.')}</small></label>
    <Choices label="WebRTC" value={value.webRtc} options={webRtcOptions} onChange={webRtc=>set('webRtc',webRtc)} disabled={disabled}/>
    <Choices label="Canvas" value={value.canvas} options={weakOptions} onChange={canvas=>set('canvas',canvas)} disabled={disabled}/>
    <Choices label="WebGL" value={value.webgl} options={weakOptions} onChange={webgl=>set('webgl',webgl)} disabled={disabled}/>
    <Choices label="WebGL Info" value={value.webglInfo.mode} options={modeOptions} onChange={mode=>set('webglInfo',mode==='manual'?{mode:'manual',vendor:value.webglInfo.mode==='manual'?value.webglInfo.vendor:'',renderer:value.webglInfo.mode==='manual'?value.webglInfo.renderer:''}:{mode:'real'})} disabled={disabled}/>
     {value.webglInfo.mode==='manual'&&<div className="fingerprint-manual"><label>{t('WebGL vendor')}<input value={value.webglInfo.vendor} maxLength={256} disabled={disabled} onChange={e=>set('webglInfo',{mode:'manual',vendor:e.target.value,renderer:(value.webglInfo as {renderer:string}).renderer})}/></label><label>{t('WebGL renderer')}<input value={value.webglInfo.renderer} maxLength={512} disabled={disabled} onChange={e=>set('webglInfo',{mode:'manual',vendor:(value.webglInfo as {vendor:string}).vendor,renderer:e.target.value})}/></label></div>}
    <Choices label="WebGPU" value={value.webgpu} options={onOffOptions} onChange={webgpu=>set('webgpu',webgpu)} disabled={disabled}/>
    <Choices label="ClientRects" value={value.clientRects} options={realNoiseOptions} onChange={clientRects=>set('clientRects',clientRects)} disabled={disabled}/>
    <Choices label="Audio" value={value.audio} options={realNoiseOptions} onChange={audio=>set('audio',audio)} disabled={disabled}/>
    <Choices label="Timezone" value={value.timezone.mode} options={timezoneModeOptions} onChange={mode=>set('timezone',mode==='manual'?{mode:'manual',value:value.timezone.mode==='manual'?value.timezone.value:''}:{mode:'auto'})} disabled={disabled}/>
     {value.timezone.mode==='manual'&&<TimeZoneSelect value={value.timezone.value} disabled={disabled} onSelect={zone=>set('timezone',{mode:'manual',value:zone})}/>}
     <p className="settings-hint fingerprint-mode-hint">{t(value.timezone.mode==='auto'?'Auto (by IP): the time zone of the proxy exit IP, including countries with several zones. This computer\'s time zone when the profile has no proxy; if the exit IP cannot be resolved, launch asks before using it.':'Manual: the time zone selected below.')}</p>
    <Choices label="Geolocation" value={value.geolocation.mode} options={geoOptions} onChange={mode=>set('geolocation',mode==='manual'?geo:mode==='block'?{mode:'block'}:{mode:'auto'})} disabled={disabled}/>
     {value.geolocation.mode==='manual'&&<div className="fingerprint-manual"><label>{t('Latitude')}<input type="number" min={-90} max={90} step="any" value={geo.latitude} disabled={disabled} onChange={e=>set('geolocation',{...geo,latitude:Number(e.target.value)})}/></label><label>{t('Longitude')}<input type="number" min={-180} max={180} step="any" value={geo.longitude} disabled={disabled} onChange={e=>set('geolocation',{...geo,longitude:Number(e.target.value)})}/></label><label>{t('Accuracy, m')}<input type="number" min={1} max={10000} step="any" value={geo.accuracy} disabled={disabled} onChange={e=>set('geolocation',{...geo,accuracy:Number(e.target.value)})}/></label></div>}
    <Choices label="CPU and memory" value={value.hardware.mode} options={modeOptions} onChange={mode=>set('hardware',mode==='manual'?hardware:{mode:'real'})} disabled={disabled}/>
     {value.hardware.mode==='manual'&&<div className="fingerprint-manual"><label>{t('CPU cores')}<input type="number" min={1} max={64} step={1} value={hardware.cores} disabled={disabled} onChange={e=>set('hardware',{...hardware,cores:Number(e.target.value)})}/></label><label>{t('Memory, GB')}<select value={hardware.memoryGb} disabled={disabled} onChange={e=>set('hardware',{...hardware,memoryGb:Number(e.target.value) as typeof hardware.memoryGb})}>{memoryOptions.map(m=><option key={m} value={m}>{m}</option>)}</select></label></div>}
    <Choices label="Screen" value={value.screen.mode} options={modeOptions} onChange={mode=>set('screen',mode==='manual'?screen:{mode:'real'})} disabled={disabled}/>
     {value.screen.mode==='manual'&&<div className="fingerprint-manual"><label>{t('Screen width')}<input type="number" min={800} max={7680} step={1} value={screen.width} disabled={disabled} onChange={e=>set('screen',{...screen,width:Number(e.target.value)})}/></label><label>{t('Screen height')}<input type="number" min={600} max={4320} step={1} value={screen.height} disabled={disabled} onChange={e=>set('screen',{...screen,height:Number(e.target.value)})}/></label></div>}
     {value.screen.mode==='manual'&&hostScreen&&(value.screen.width<hostScreen.width||value.screen.height<hostScreen.height)&&<p className="warning" role="status">{t('screen.smaller.warning')}</p>}
     <label className="check fingerprint-strict"><input type="checkbox" checked={value.strictProtection===true} disabled={disabled} onChange={e=>{const {strictProtection:_drop,...rest}=value;onChange(e.target.checked?{...rest,strictProtection:true}:rest);}}/>{t('Strict protection')}</label>
     <p className="settings-hint">{t('protection.strict.hint')}</p>
  </section>;
}
