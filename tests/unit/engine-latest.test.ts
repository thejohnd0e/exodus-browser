import {describe,it,expect,vi} from 'vitest';
import {chromiumArgs} from '../../src/main/engines/chromium';
import {DEFAULT_FINGERPRINT} from '../../src/shared/fingerprint';
import {UPDATE_SERVER_URL,compareVersions,fetchLatestStable,parseLatestStable,withLatest,LatestEngineVersion} from '../../src/main/engines/latest';
import type {EngineStatus} from '../../src/shared/contracts';

const launch=(fingerprint=DEFAULT_FINGERPRINT)=>chromiumArgs({profileId:'p',userDataDir:'C:\\p',languages:['en-US'],startUrls:[],fingerprint});

describe('feature switches',()=>{
  it('hides the outdated-build prompt, which an engine without an updater would show',()=>{
    const switches=launch().filter(a=>a.startsWith('--disable-features='));
    expect(switches).toEqual(['--disable-features=OutdatedBuildDetector']);
  });
  it('merges every disabled feature into one switch, because Chrome honours only the last one',()=>{
    const switches=launch({...DEFAULT_FINGERPRINT,webgpu:'off'}).filter(a=>a.startsWith('--disable-features='));
    expect(switches).toHaveLength(1);
    expect(switches[0].slice('--disable-features='.length).split(',').sort()).toEqual(['OutdatedBuildDetector','WebGPUService']);
  });
});

describe('compareVersions',()=>{
  it('compares dotted versions numerically',()=>{
    expect(compareVersions('158.0.8127.18','157.0.8103.79')).toBeGreaterThan(0);
    expect(compareVersions('157.0.8103.79','157.0.8103.39')).toBeGreaterThan(0);
    expect(compareVersions('157.0.8103.9','157.0.8103.10')).toBeLessThan(0);
    expect(compareVersions('157.0.8103.39','157.0.8103.39')).toBe(0);
  });
});

const answer=(version:string,status='ok')=>")]}'\n"+JSON.stringify({response:{app:[{appid:'{8A69D345-D564-463C-AFF1-A69D9E530F96}',updatecheck:{status,manifest:{version}}}]}});

describe('parseLatestStable',()=>{
  it('reads the version from the update server answer, with or without the prefix line',()=>{
    expect(parseLatestStable(answer('157.0.8103.79'))).toBe('157.0.8103.79');
    expect(parseLatestStable(answer('157.0.8103.79').split('\n')[1])).toBe('157.0.8103.79');
  });
  it('rejects anything that is not a plain four-part version of an accepted check',()=>{
    for(const bad of ['','not json','{}',answer('158'),answer('158.0.1.2; rm'),answer('157.0.8103.79','noupdate'),JSON.stringify({response:{app:[]}})])
      expect(()=>parseLatestStable(bad)).toThrow('ENGINE_LATEST_INVALID');
  });
});

describe('fetchLatestStable',()=>{
  it('asks the update server over HTTPS with only the application id and channel',async()=>{
    const fetchImpl=vi.fn(async()=>new Response(answer('157.0.8103.79')));
    expect(await fetchLatestStable(fetchImpl as never)).toBe('157.0.8103.79');
    const [url,init]=fetchImpl.mock.calls[0] as unknown as [string,{method:string;body:string;redirect:string}];
    expect(url).toBe(UPDATE_SERVER_URL);expect(new URL(url).protocol).toBe('https:');
    expect(init.method).toBe('POST');expect(init.redirect).toBe('error');
    const request=JSON.parse(init.body).request;
    expect(request.app).toHaveLength(1);expect(request.app[0]).toMatchObject({appid:'{8A69D345-D564-463C-AFF1-A69D9E530F96}',ap:'x64-stable',version:'0.0.0.0'});
    expect(JSON.stringify(request)).not.toMatch(/user|profile|cohort|machine|device/i);
  });
  it('reports a failed or oversized answer as a failure',async()=>{
    await expect(fetchLatestStable((async()=>new Response('',{status:503})) as never)).rejects.toThrow('ENGINE_LATEST_FAILED');
    await expect(fetchLatestStable((async()=>new Response('x'.repeat(100000))) as never)).rejects.toThrow('ENGINE_LATEST_FAILED');
    await expect(fetchLatestStable((async()=>{throw Error('offline');}) as never)).rejects.toThrow('ENGINE_LATEST_FAILED');
  });
});

describe('withLatest',()=>{
  const ready:EngineStatus={state:'ready',version:'157.0.8103.39',source:'branded',compatibility:'supported',supportedMajors:{min:156,max:158}};
  it('adds a newer version together with its compatibility',()=>{
    expect(withLatest(ready,'157.0.8103.79')).toMatchObject({latestVersion:'157.0.8103.79',latestCompatibility:'supported'});
    expect(withLatest(ready,'159.0.1.1')).toMatchObject({latestVersion:'159.0.1.1',latestCompatibility:'newer'});
  });
  it('adds nothing for the same or an older version, a linked browser, a missing engine or no answer',()=>{
    expect(withLatest(ready,'157.0.8103.39')).toEqual(ready);
    expect(withLatest(ready,'156.0.1.1')).toEqual(ready);
    expect(withLatest(ready,null)).toEqual(ready);
    expect(withLatest(ready,'157.0.8103.79',null)).toMatchObject({latestVersion:'157.0.8103.79'});
    // The offline installer lagged behind the update server when the engine was installed: not offered again until something newer appears.
    expect(withLatest(ready,'157.0.8103.79','157.0.8103.79')).toEqual(ready);
    expect(withLatest(ready,'157.0.8103.80','157.0.8103.79')).toMatchObject({latestVersion:'157.0.8103.80'});
    const linked:EngineStatus={state:'ready',version:'linked Chromium',source:'external'};
    expect(withLatest(linked,'158.0.8127.18')).toEqual(linked);
    expect(withLatest({state:'missing'},'158.0.8127.18')).toEqual({state:'missing'});
  });
});

describe('LatestEngineVersion',()=>{
  it('keeps the last good answer when a later check fails',async()=>{
    let fail=false;
    const watch=new LatestEngineVersion((async()=>{if(fail)throw Error('offline');return new Response(answer('157.0.8103.79'));}) as never);
    expect(watch.value()).toBeNull();
    await watch.check();expect(watch.value()).toBe('157.0.8103.79');
    fail=true;await watch.check();expect(watch.value()).toBe('157.0.8103.79');
  });
});
