import type {Fingerprint} from '../../shared/fingerprint';
import type {SessionSnapshot} from '../../shared/session';
export type EngineLaunch={profileId:string;userDataDir:string;startUrls:string[];languages:string[];proxyUrl?:string;fingerprint:Fingerprint;fingerprintSeed?:number;extensionDirs?:string[];onSessionSnapshot?:(snapshot:SessionSnapshot)=>Promise<void>};
export type EngineProcess={pid:number;executable:string;startedAt:string;exit:Promise<{code:number|null;signal:string|null}>;stop():Promise<void>};
export interface BrowserEngineAdapter {capabilities:{fingerprints:boolean};validate():Promise<void>;launch(input:EngineLaunch):Promise<EngineProcess>}
export type ProxyLease={url:string;close():Promise<void>};
