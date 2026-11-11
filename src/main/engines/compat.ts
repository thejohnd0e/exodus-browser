/**
 * Chrome major versions this Exodus release was tested with (fingerprint, DevTools automation and
 * profile-data compatibility). A release that is verified against a newer Chrome raises `max`; one
 * that drops support for an old Chrome raises `min` (DECISIONS #72). Engine versions outside the
 * range are reported, never silently replaced.
 */
export const SUPPORTED_CHROME_MAJORS={min:156,max:157} as const;

export type EngineCompatibility='supported'|'older'|'newer'|'unknown';

/** Anything that is not a plain `major.minor.build.patch` version (a linked browser, junk) is unknown. */
export function engineCompatibility(version:string|undefined):EngineCompatibility{
  const match=version?/^([1-9]\d*)\.\d+\.\d+\.\d+$/.exec(version):null;
  if(!match)return 'unknown';
  const major=Number(match[1]);
  if(major<SUPPORTED_CHROME_MAJORS.min)return 'older';
  if(major>SUPPORTED_CHROME_MAJORS.max)return 'newer';
  return 'supported';
}

/**
 * Google's installer always delivers the current stable Chrome, whatever this release was tested with.
 * A working engine is therefore replaced only by a tested version: the download is unpacked and checked
 * first, and an untested one is discarded (DECISIONS #92). The first installation, a linked browser
 * and an engine that is already older than the tested range may take any version.
 */
export function canActivateEngine(current:{state:'missing'|'ready'|'unsupported'|'installing';source?:'downloaded'|'external'|'branded';compatibility?:EngineCompatibility},version:string):boolean{
  if(current.state!=='ready'||current.source==='external'||current.compatibility==='older'||current.compatibility==='unknown')return true;
  return engineCompatibility(version)==='supported';
}

/**
 * Replacing a working engine is allowed only while no profile browser or maintenance operation is
 * running; the first installation (no engine yet) is always allowed. Nothing is closed for the user.
 */
export function assertEngineReplaceable(engineState:'missing'|'ready'|'unsupported'|'installing',activeWork:boolean):void{
  if(engineState==='ready'&&activeWork)throw Error('ENGINE_UPDATE_BUSY');
}
