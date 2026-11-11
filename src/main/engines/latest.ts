import type {EngineStatus} from '../../shared/contracts';
import {engineCompatibility} from './compat';

/**
 * Google's update server (the protocol Chrome itself uses) names the stable version that is rolled out
 * to Windows x64 right now. The request carries only the application id and a channel; no profile data,
 * identifier or installed version is sent. Google's list of released versions was not used: it shows
 * staged rollouts that the update server does not offer yet.
 */
export const UPDATE_SERVER_URL='https://update.googleapis.com/service/update2/json';
const CHROME_APP_ID='{8A69D345-D564-463C-AFF1-A69D9E530F96}';
const REQUEST_BODY=JSON.stringify({request:{'@os':'win','@updater':'chrome',acceptformat:'crx3,puff',app:[{appid:CHROME_APP_ID,ap:'x64-stable',updatecheck:{},version:'0.0.0.0'}],arch:'x64',dedup:'cr',os:{arch:'x86_64',platform:'Windows',version:'10.0'},protocol:'3.1',updaterversion:'150.0.0.0'}});
const TIMEOUT_MS=10000;
const LIMIT_BYTES=64*1024;
const VERSION=/^\d+\.\d+\.\d+\.\d+$/;

/** Numeric comparison of two `a.b.c.d` versions; positive when `a` is newer. */
export function compareVersions(a:string,b:string):number{
  const x=a.split('.').map(Number),y=b.split('.').map(Number);
  for(let i=0;i<Math.max(x.length,y.length);i++){const d=(x[i]??0)-(y[i]??0);if(d!==0)return d;}
  return 0;
}

/** The answer starts with the anti-JSON-hijacking prefix `)]}'` on its own line. */
export function parseLatestStable(text:string):string{
  let json:unknown;
  try{json=JSON.parse(text.replace(/^\)\]\}'\r?\n/,''));}catch{throw Error('ENGINE_LATEST_INVALID');}
  const check=(json as {response?:{app?:Array<{updatecheck?:{status?:unknown;manifest?:{version?:unknown}}}>}}|null)?.response?.app?.[0]?.updatecheck;
  const version=check?.manifest?.version;
  if(check?.status!=='ok'||typeof version!=='string'||!VERSION.test(version))throw Error('ENGINE_LATEST_INVALID');
  return version;
}

type Fetch=(url:string,init:{method:'POST';body:string;headers:Record<string,string>;signal:AbortSignal;redirect:'error'})=>Promise<Response>;

export async function fetchLatestStable(fetchImpl:Fetch=globalThis.fetch as Fetch):Promise<string>{
  let text:string;
  try{
    const response=await fetchImpl(UPDATE_SERVER_URL,{method:'POST',body:REQUEST_BODY,headers:{'content-type':'application/json'},signal:AbortSignal.timeout(TIMEOUT_MS),redirect:'error'});
    if(!response.ok)throw Error('status');
    const bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length>LIMIT_BYTES)throw Error('size');
    text=bytes.toString('utf8');
  }catch{throw Error('ENGINE_LATEST_FAILED');}
  return parseLatestStable(text);
}

/**
 * The newest stable Chrome Google has published, remembered from the last successful check. A check
 * is only made when the user asks for updates (the manual button or the opt-in daily check), and a
 * failure keeps the previous answer.
 */
export class LatestEngineVersion {
  private latest:string|null=null;
  constructor(private readonly fetchImpl?:Fetch){}
  async check():Promise<void>{
    try{this.latest=await fetchLatestStable(this.fetchImpl);}catch{/* keep the previous answer */}
  }
  value():string|null{return this.latest;}
}

/**
 * Adds the newest stable version to the status of a Chrome the application manages, when it is newer
 * than the installed one. `latestCompatibility` says whether this Exodus release was tested with it.
 *
 * Google's offline installer is refreshed less often than the update server, so installing it can leave
 * the engine behind the newest version. `offeredAtInstall` is the newest version that was known when the
 * engine was installed; nothing is offered again until something newer than that appears, so an update
 * does not leave a notice that cannot be cleared (DECISIONS #92).
 */
export function withLatest(status:EngineStatus,latest:string|null,offeredAtInstall:string|null=null):EngineStatus{
  if(!latest||status.state!=='ready'||status.source==='external'||!status.version||!VERSION.test(status.version))return status;
  if(compareVersions(latest,status.version)<=0)return status;
  if(offeredAtInstall&&compareVersions(latest,offeredAtInstall)<=0)return status;
  return {...status,latestVersion:latest,latestCompatibility:engineCompatibility(latest)};
}
