import {describe,expect,it} from 'vitest';
import {parseLatestRelease,parseSha256Sums} from '../../src/main/update/release';

const digest='a'.repeat(64);
const asset=(name:string,size=1000)=>({name,browser_download_url:`https://github.com/thejohnd0e/exodus-browser/releases/download/v1.1.78/${name}`,size});
const release=(overrides:Record<string,unknown>={},assets=[asset('ExodusBrowser-Setup-1.1.78.exe'),asset('SHA256SUMS',80)])=>({tag_name:'v1.1.78',draft:false,prerelease:false,assets,...overrides});

describe('parseLatestRelease',()=>{
  it('offers a strictly newer release with one installer and checksums',()=>{
    const result=parseLatestRelease(release(),'0.1.78');
    expect(result).toEqual({
      kind:'available',
      version:'1.1.78',
      installer:{name:'ExodusBrowser-Setup-1.1.78.exe',url:'https://github.com/thejohnd0e/exodus-browser/releases/download/v1.1.78/ExodusBrowser-Setup-1.1.78.exe',size:1000},
      checksumsUrl:'https://github.com/thejohnd0e/exodus-browser/releases/download/v1.1.78/SHA256SUMS',
    });
  });
  it('reports up-to-date when the release is not newer',()=>{
    expect(parseLatestRelease(release(),'1.1.78')).toEqual({kind:'up-to-date'});
  });
  it('rejects drafts, pre-releases and malformed tags',()=>{
    for(const json of [release({draft:true}),release({prerelease:true}),release({tag_name:'1.1.78'}),release({tag_name:'v1.1'})]){
      expect(()=>parseLatestRelease(json,'0.1.78')).toThrow('UPDATE_INVALID_RELEASE');
    }
  });
  it('requires exactly one installer named for the tag version and one SHA256SUMS',()=>{
    expect(()=>parseLatestRelease(release({},[asset('SHA256SUMS',80)]),'0.1.78')).toThrow('UPDATE_INVALID_RELEASE');
    expect(()=>parseLatestRelease(release({},[asset('ExodusBrowser-Setup-1.1.78.exe'),asset('ExodusBrowser-Setup-1.1.78.exe'),asset('SHA256SUMS',80)]),'0.1.78')).toThrow('UPDATE_INVALID_RELEASE');
    expect(()=>parseLatestRelease(release({},[asset('ExodusBrowser-Setup-1.1.79.exe'),asset('SHA256SUMS',80)]),'0.1.78')).toThrow('UPDATE_INVALID_RELEASE');
    expect(()=>parseLatestRelease(release({},[asset('ExodusBrowser-Setup-1.1.78.exe')]),'0.1.78')).toThrow('UPDATE_INVALID_RELEASE');
  });
  it('rejects asset URLs outside https://github.com and non-integer or oversized sizes',()=>{
    const foreign={...asset('ExodusBrowser-Setup-1.1.78.exe'),browser_download_url:'https://example.com/ExodusBrowser-Setup-1.1.78.exe'};
    expect(()=>parseLatestRelease(release({},[foreign,asset('SHA256SUMS',80)]),'0.1.78')).toThrow('UPDATE_INVALID_RELEASE');
    expect(()=>parseLatestRelease(release({},[asset('ExodusBrowser-Setup-1.1.78.exe',1.5),asset('SHA256SUMS',80)]),'0.1.78')).toThrow('UPDATE_INVALID_RELEASE');
    expect(()=>parseLatestRelease(release({},[asset('ExodusBrowser-Setup-1.1.78.exe',300*1024*1024+1),asset('SHA256SUMS',80)]),'0.1.78')).toThrow('UPDATE_INVALID_RELEASE');
  });
  it('rejects non-object input',()=>{
    expect(()=>parseLatestRelease(null,'0.1.78')).toThrow('UPDATE_INVALID_RELEASE');
  });
});

describe('parseSha256Sums',()=>{
  it('returns the lowercase digest for the named installer',()=>{
    const text=`${digest.toUpperCase()}  ExodusBrowser-Setup-1.1.78.exe\nbbbb${'b'.repeat(60)}  other.bin\n`;
    expect(parseSha256Sums(text,'ExodusBrowser-Setup-1.1.78.exe')).toBe(digest);
  });
  it('rejects a missing entry or a malformed digest',()=>{
    expect(()=>parseSha256Sums(`${digest}  other.bin\n`,'ExodusBrowser-Setup-1.1.78.exe')).toThrow('UPDATE_INVALID_RELEASE');
    expect(()=>parseSha256Sums(`${'z'.repeat(64)}  ExodusBrowser-Setup-1.1.78.exe\n`,'ExodusBrowser-Setup-1.1.78.exe')).toThrow('UPDATE_INVALID_RELEASE');
  });
});
