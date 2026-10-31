import {z} from 'zod';
import {isNewer,parseVersion} from './version';
import {isAllowedHost,MAX_INSTALLER_BYTES} from './hosts';

const INSTALLER_PATTERN=/^ExodusBrowser-Setup-(\d+\.\d+\.\d+)\.exe$/;

const assetSchema=z.object({
  name:z.string().min(1).max(255),
  browser_download_url:z.string().max(2048),
  size:z.number().int().positive().max(MAX_INSTALLER_BYTES),
});

const releaseSchema=z.object({
  tag_name:z.string(),
  draft:z.boolean(),
  prerelease:z.boolean(),
  assets:z.array(assetSchema).max(100),
});

export type LatestRelease=
  |{kind:'up-to-date'}
  |{kind:'available';version:string;installer:{name:string;url:string;size:number};checksumsUrl:string};

export function parseLatestRelease(json:unknown,appVersion:string,isAllowedUrl:(url:string)=>boolean=isAllowedHost):LatestRelease{
  const parsed=releaseSchema.safeParse(json);
  if(!parsed.success)throw Error('UPDATE_INVALID_RELEASE');
  const release=parsed.data;
  if(release.draft||release.prerelease)throw Error('UPDATE_INVALID_RELEASE');
  const tag=/^v(\d+\.\d+\.\d+)$/.exec(release.tag_name);
  if(!tag||!parseVersion(tag[1]))throw Error('UPDATE_INVALID_RELEASE');
  const version=tag[1];
  if(!isNewer(version,appVersion))return {kind:'up-to-date'};
  const installers=release.assets.filter(asset=>INSTALLER_PATTERN.test(asset.name));
  const checksums=release.assets.filter(asset=>asset.name==='SHA256SUMS');
  if(installers.length!==1||checksums.length!==1)throw Error('UPDATE_INVALID_RELEASE');
  const installer=installers[0];
  if(installer.name!==`ExodusBrowser-Setup-${version}.exe`)throw Error('UPDATE_INVALID_RELEASE');
  for(const asset of [installer,checksums[0]]){
    if(!isAllowedUrl(asset.browser_download_url))throw Error('UPDATE_INVALID_RELEASE');
  }
  return {
    kind:'available',
    version,
    installer:{name:installer.name,url:installer.browser_download_url,size:installer.size},
    checksumsUrl:checksums[0].browser_download_url,
  };
}

export function parseSha256Sums(text:string,fileName:string):string{
  for(const line of text.split(/\r?\n/)){
    const match=/^([0-9a-fA-F]{64}) [ *]?(.+)$/.exec(line.trim());
    if(match&&match[2]===fileName)return match[1].toLowerCase();
  }
  throw Error('UPDATE_INVALID_RELEASE');
}
