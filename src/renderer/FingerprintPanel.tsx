import type {Fingerprint} from '../shared/fingerprint';
import {newFingerprint} from '../shared/fingerprint-presets';
import {uaForOs} from '../shared/user-agent';
type Option<T extends string>={value:T;label:string;disabled?:boolean};
function Choices<T extends string>({label,value,options,onChange,disabled,extra=[]}:{label:string;value:T;options:readonly Option<T>[];onChange:(value:T)=>void;disabled:boolean;extra?:readonly {label:string}[]}){
  return <div className="fingerprint-field"><span className="fingerprint-label">{label}</span><div className="fingerprint-choices" role="group" aria-label={label}>{options.map(option=><button type="button" key={option.value} className={option.value===value?'active':''} aria-pressed={option.value===value} disabled={disabled||option.disabled} onClick={()=>onChange(option.value)}>{option.label}</button>)}{extra.map(option=><button type="button" key={option.label} disabled>{option.label}</button>)}</div></div>;
}
const osOptions:readonly Option<Fingerprint['os']>[]=[{value:'windows11',label:'Windows 11'},{value:'windows10',label:'Windows 10'},{value:'macos',label:'macOS'},{value:'linux',label:'Linux'}];
const weakOptions:readonly Option<'off'|'real'|'noise'>[]=[{value:'off',label:'Off'},{value:'real',label:'Real'},{value:'noise',label:'Noise'}];
const webRtcOptions:readonly Option<Fingerprint['webRtc']>[]=[{value:'off',label:'Off'},{value:'real',label:'Real'},{value:'disableUdp',label:'Disable UDP'},{value:'altered',label:'Altered'}];
const realNoiseOptions:readonly Option<'real'|'noise'>[]=[{value:'real',label:'Real'},{value:'noise',label:'Noise'}];
const modeOptions:readonly Option<'real'|'manual'>[]=[{value:'real',label:'Real'},{value:'manual',label:'Manual'}];
const autoManualOptions:readonly Option<'auto'|'manual'>[]=[{value:'auto',label:'Auto'},{value:'manual',label:'Manual'}];
const onOffOptions:readonly Option<'on'|'off'>[]=[{value:'on',label:'On'},{value:'off',label:'Off'}];
const memoryOptions=[0.5,1,2,4,8] as const;
export function FingerprintPanel({value,onChange,disabled,chromeVersion}:{value:Fingerprint;onChange:(next:Fingerprint)=>void;disabled:boolean;chromeVersion:string|null}){
  const set=<K extends keyof Fingerprint>(key:K,next:Fingerprint[K])=>onChange({...value,[key]:next});
  const engineVersion=chromeVersion&&/^\d+(\.\d+)+$/.test(chromeVersion)?chromeVersion:null;
  const geo=value.geolocation.mode==='manual'?value.geolocation:{mode:'manual' as const,latitude:0,longitude:0,accuracy:100};
  const hardware=value.hardware.mode==='manual'?value.hardware:{mode:'manual' as const,cores:8,memoryGb:8 as const};
  const screen=value.screen.mode==='manual'?value.screen:{mode:'manual' as const,width:1920,height:1080,dpr:1};
  return <section className="settings-panel fingerprint-panel" aria-labelledby="fingerprint-title">
    <header className="fingerprint-head"><h3 id="fingerprint-title">Fingerprint</h3><button type="button" className="primary" disabled={disabled||!engineVersion} onClick={()=>onChange(newFingerprint({os:value.os,chromeVersion:engineVersion!,random:Math.random}))}>New fingerprint</button></header>
    <p className="settings-hint">{engineVersion?`New fingerprint sets Chrome/${engineVersion} with matching screen resolution, memory and graphics card.`:'Link an engine to generate a fingerprint for its version.'}</p>
    <Choices label="Operating system" value={value.os} options={osOptions} extra={[{label:'Android · Soon'},{label:'iOS · Soon'}]} onChange={os=>set('os',os)} disabled={disabled}/>
    <label>User-Agent<input value={value.userAgent??''} maxLength={512} disabled={disabled} placeholder={engineVersion?uaForOs(value.os,engineVersion):'System default'} onChange={e=>set('userAgent',e.target.value||null)}/><small className="settings-hint">Leave blank to use the actual engine User-Agent.</small></label>
    <Choices label="WebRTC" value={value.webRtc} options={webRtcOptions} onChange={webRtc=>set('webRtc',webRtc)} disabled={disabled}/>
    <Choices label="Canvas" value={value.canvas} options={weakOptions} onChange={canvas=>set('canvas',canvas)} disabled={disabled}/>
    <Choices label="WebGL" value={value.webgl} options={weakOptions} onChange={webgl=>set('webgl',webgl)} disabled={disabled}/>
    <Choices label="WebGL Info" value={value.webglInfo.mode} options={modeOptions} onChange={mode=>set('webglInfo',mode==='manual'?{mode:'manual',vendor:value.webglInfo.mode==='manual'?value.webglInfo.vendor:'',renderer:value.webglInfo.mode==='manual'?value.webglInfo.renderer:''}:{mode:'real'})} disabled={disabled}/>
    {value.webglInfo.mode==='manual'&&<div className="fingerprint-manual"><label>WebGL vendor<input value={value.webglInfo.vendor} maxLength={256} disabled={disabled} onChange={e=>set('webglInfo',{mode:'manual',vendor:e.target.value,renderer:(value.webglInfo as {renderer:string}).renderer})}/></label><label>WebGL renderer<input value={value.webglInfo.renderer} maxLength={512} disabled={disabled} onChange={e=>set('webglInfo',{mode:'manual',vendor:(value.webglInfo as {vendor:string}).vendor,renderer:e.target.value})}/></label></div>}
    <Choices label="WebGPU" value={value.webgpu} options={onOffOptions} onChange={webgpu=>set('webgpu',webgpu)} disabled={disabled}/>
    <Choices label="ClientRects" value={value.clientRects} options={realNoiseOptions} onChange={clientRects=>set('clientRects',clientRects)} disabled={disabled}/>
    <Choices label="Audio" value={value.audio} options={realNoiseOptions} onChange={audio=>set('audio',audio)} disabled={disabled}/>
    <Choices label="Timezone" value={value.timezone.mode} options={autoManualOptions} onChange={mode=>set('timezone',mode==='manual'?{mode:'manual',value:value.timezone.mode==='manual'?value.timezone.value:''}:{mode:'auto'})} disabled={disabled}/>
    {value.timezone.mode==='manual'&&<label>Time zone<input value={value.timezone.value} maxLength={64} placeholder="Europe/Paris" disabled={disabled} onChange={e=>set('timezone',{mode:'manual',value:e.target.value})}/></label>}
    <Choices label="Geolocation" value={value.geolocation.mode} options={autoManualOptions} onChange={mode=>set('geolocation',mode==='manual'?geo:{mode:'auto'})} disabled={disabled}/>
    {value.geolocation.mode==='manual'&&<div className="fingerprint-manual"><label>Latitude<input type="number" min={-90} max={90} step="any" value={geo.latitude} disabled={disabled} onChange={e=>set('geolocation',{...geo,latitude:Number(e.target.value)})}/></label><label>Longitude<input type="number" min={-180} max={180} step="any" value={geo.longitude} disabled={disabled} onChange={e=>set('geolocation',{...geo,longitude:Number(e.target.value)})}/></label><label>Accuracy, m<input type="number" min={1} max={10000} step="any" value={geo.accuracy} disabled={disabled} onChange={e=>set('geolocation',{...geo,accuracy:Number(e.target.value)})}/></label></div>}
    <Choices label="CPU and memory" value={value.hardware.mode} options={modeOptions} onChange={mode=>set('hardware',mode==='manual'?hardware:{mode:'real'})} disabled={disabled}/>
    {value.hardware.mode==='manual'&&<div className="fingerprint-manual"><label>CPU cores<input type="number" min={1} max={64} step={1} value={hardware.cores} disabled={disabled} onChange={e=>set('hardware',{...hardware,cores:Number(e.target.value)})}/></label><label>Memory, GB<select value={hardware.memoryGb} disabled={disabled} onChange={e=>set('hardware',{...hardware,memoryGb:Number(e.target.value) as typeof hardware.memoryGb})}>{memoryOptions.map(m=><option key={m} value={m}>{m}</option>)}</select></label></div>}
    <Choices label="Screen" value={value.screen.mode} options={modeOptions} onChange={mode=>set('screen',mode==='manual'?screen:{mode:'real'})} disabled={disabled}/>
    {value.screen.mode==='manual'&&<div className="fingerprint-manual"><label>Screen width<input type="number" min={800} max={7680} step={1} value={screen.width} disabled={disabled} onChange={e=>set('screen',{...screen,width:Number(e.target.value)})}/></label><label>Screen height<input type="number" min={600} max={4320} step={1} value={screen.height} disabled={disabled} onChange={e=>set('screen',{...screen,height:Number(e.target.value)})}/></label><label>DPR<input type="number" min={1} max={3} step="any" value={screen.dpr} disabled={disabled} onChange={e=>set('screen',{...screen,dpr:Number(e.target.value)})}/></label></div>}
  </section>;
}
