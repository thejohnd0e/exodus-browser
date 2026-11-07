import { describe, it, expect } from 'vitest';
import type { CdpClient, CdpMessage } from '../../src/main/cdp/client';
import { installFingerprint } from '../../src/main/cdp/fingerprint';
import { DEFAULT_FINGERPRINT } from '../../src/shared/fingerprint';

interface Fake {
  client: CdpClient;
  calls: string[];
  params: Record<string, unknown>;
  emit(message: CdpMessage): void;
  rejectOn(method: string): void;
  scriptSources: string[];
}

function fake(pages: Array<{ targetId: string; type: string; url?: string }> = [{ targetId: 't1', type: 'page' }], emptyTargetLists = 0): Fake {
  const calls: string[] = [];const params: Record<string, unknown> = {};const listeners: Array<(m: CdpMessage) => void> = [];const scriptSources:string[]=[];
  let rejectMethod = '';let targetLists = 0;
  const fakeClient = {
    send: async (method: string, p: Record<string, unknown> = {}, sessionId?: string) => {
      if (method === rejectMethod) throw Error('boom');
      calls.push(sessionId ? `${method}:${sessionId}` : method);params[method] = p;
      if(method==='Page.addScriptToEvaluateOnNewDocument')scriptSources.push(String(p.source));
      if (method === 'Target.setAutoAttach' && !sessionId) for (const page of pages) listeners.forEach(l => l({ method: 'Target.attachedToTarget', params: { sessionId: page.targetId.replace('t', 's'), targetInfo: page } }));
      if (method === 'Target.getTargets') { if (targetLists++ < emptyTargetLists) return { targetInfos: [] }; return { targetInfos: pages }; }
      if (method === 'Runtime.evaluate' && String(p.expression ?? '').includes('availHeight')) return { result: { value: { screen: { width: 2560, height: 1440, availWidth: 2560, availHeight: 1400 }, dpr: 1 } } };
      // Like Chromium, browser-level auto-attach also attaches new tabs, and an explicit attach
      // creates a second session that is announced with its own attachedToTarget event.
      if (method === 'Target.createTarget') { const targetInfo = { targetId: 't2', type: 'page', url: 'about:blank' }; listeners.forEach(l => l({ method: 'Target.attachedToTarget', params: { sessionId: 's2', targetInfo } })); return { targetId: 't2' }; }
      if (method === 'Target.attachToTarget') { const sessionId = (p.targetId as string).replace('t', 'x'); listeners.forEach(l => l({ method: 'Target.attachedToTarget', params: { sessionId, targetInfo: { targetId: p.targetId, type: 'page', url: 'about:blank' } } })); return { sessionId }; }
      return {};
    },
    onEvent: (cb: (m: CdpMessage) => void) => listeners.push(cb),
    close: () => {},
  };
  return { client: fakeClient as unknown as CdpClient, calls, params, scriptSources, emit: m => listeners.forEach(l => l(m)), rejectOn: m => { rejectMethod = m; } };
}

const windowsEngine = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
const windowsFull = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.80 Safari/537.36';
const SPOOFED = { ...DEFAULT_FINGERPRINT, canvas: 'noise' as const };
const macUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.80 Safari/537.36';

function withLinkHistory(f: Fake): void {
  const send = f.client.send.bind(f.client);
  f.client.send = async (method: string, params: Record<string, unknown> = {}, sessionId?: string) => {
    if (method === 'Page.getNavigationHistory') { f.calls.push(`${method}:${sessionId}`); return { currentIndex: 0, entries: [{ transitionType: 'link' }] } as never; }
    return send(method, params, sessionId);
  };
}

describe('installFingerprint', () => {
  it('resumes a pause that the page caused with its own debugger statement',async()=>{
    const f=fake();const failures:string[]=[];
    await installFingerprint(f.client,{fingerprint:{...SPOOFED,geolocation:{mode:'manual',latitude:40.7,longitude:-74,accuracy:25}},languages:['en-US'],seed:1,onPageFailure:r=>failures.push(r)});
    await new Promise(r=>setTimeout(r,20));
    f.emit({sessionId:'s1',method:'Debugger.paused',params:{callFrames:[{location:{scriptId:'page-own-script'}}]}});
    await new Promise(r=>setTimeout(r,20));
    expect(f.calls).toContain('Debugger.resume:s1');
    expect(f.calls).not.toContain('Target.closeTarget');
    expect(failures).toEqual([]);
  });

  it('does not close an internal page when its instrumentation fails',async()=>{
    const f=fake();const failures:string[]=[];
    await installFingerprint(f.client,{fingerprint:SPOOFED,languages:['en-US'],seed:1,onPageFailure:r=>failures.push(r)});
    // Let the initial page finish its setup first; only the internal page should meet the failure.
    await new Promise(r=>setTimeout(r,20));
    f.rejectOn('Page.addScriptToEvaluateOnNewDocument');
    f.emit({method:'Target.attachedToTarget',params:{sessionId:'s9',targetInfo:{targetId:'t9',type:'page',url:'chrome://settings/'}}});
    await new Promise(r=>setTimeout(r,20));
    expect(f.calls).not.toContain('Target.closeTarget');
    expect(failures).toEqual([]);
  });

  it('keeps the page open when only the resume call fails',async()=>{
    const f=fake();
    await installFingerprint(f.client,{fingerprint:{...SPOOFED,geolocation:{mode:'manual',latitude:40.7,longitude:-74,accuracy:25}},languages:['en-US'],seed:1});
    await new Promise(r=>setTimeout(r,20));
    const guard=f.scriptSources.find(s=>s.includes('debugger;'))!;
    const url=guard.split('sourceURL=')[1];
    f.emit({sessionId:'s1',method:'Debugger.scriptParsed',params:{scriptId:'guard',url}});
    f.rejectOn('Debugger.resume');
    f.emit({sessionId:'s1',method:'Debugger.paused',params:{callFrames:[{location:{scriptId:'guard'}}]}});
    await new Promise(r=>setTimeout(r,20));
    expect(f.calls).toContain('Emulation.setGeolocationOverride:s1');
    expect(f.calls).not.toContain('Target.closeTarget');
  });

  it('closes the guarded page rather than resuming when geolocation setup fails',async()=>{
    const f=fake();const failures:string[]=[];
    await installFingerprint(f.client,{fingerprint:{...SPOOFED,geolocation:{mode:'manual',latitude:40.7,longitude:-74,accuracy:25}},languages:['en-US'],seed:1,onPageFailure:r=>failures.push(r)});
    await new Promise(r=>setTimeout(r,20));
    const guard=f.scriptSources.find(s=>s.includes('debugger;'))!;
    const url=guard.split('sourceURL=')[1];expect(url).toBeTruthy();
    f.emit({sessionId:'s1',method:'Debugger.scriptParsed',params:{scriptId:'guard',url}});
    f.rejectOn('Emulation.setGeolocationOverride');
    f.emit({sessionId:'s1',method:'Debugger.paused',params:{callFrames:[{location:{scriptId:'guard'}}]}});
    await new Promise(r=>setTimeout(r,20));
    expect(f.calls).toContain('Target.closeTarget');
    expect(f.calls).not.toContain('Debugger.resume:s1');
    expect(failures).toEqual(['FINGERPRINT_UNAVAILABLE']);
  });
  it('sets native parameters and a script for each page', async () => {
    const f = fake();
    await installFingerprint(f.client, {
      fingerprint: {
        ...SPOOFED, os: 'macos', userAgent: macUa, canvas: 'noise',
        timezone: { mode: 'manual', value: 'Europe/Moscow' },
        geolocation: { mode: 'manual', latitude: 55.75, longitude: 37.61, accuracy: 30 },
      },
      languages: ['ru-RU'], seed: 1, engineUserAgent: windowsEngine,
    });
    await new Promise(r => setTimeout(r, 20));
    expect(f.calls).toContain('Target.setAutoAttach');
    expect(f.calls).toContain('Page.addScriptToEvaluateOnNewDocument:s1');
    expect(f.calls).toContain('Network.setUserAgentOverride:s1');
    expect(f.params['Network.setUserAgentOverride']).toMatchObject({ platform: 'MacIntel' });
    expect(f.calls).toContain('Emulation.setTimezoneOverride:s1');
    expect(f.calls).toContain('Emulation.setGeolocationOverride:s1');
    expect(f.calls).toContain('Browser.grantPermissions');
    expect(f.calls).toContain('Runtime.runIfWaitingForDebugger:s1');
    expect(JSON.stringify(f.params['Network.setUserAgentOverride'])).toContain('userAgentMetadata');
    expect(JSON.stringify(f.params['Page.addScriptToEvaluateOnNewDocument'])).toContain('source');
  });

  it('does not override time or geolocation in auto mode', async () => {
    const f = fake();
    await installFingerprint(f.client, { fingerprint: SPOOFED, languages: ['ru-RU'], seed: 1, engineUserAgent: windowsEngine });
    await new Promise(r => setTimeout(r, 20));
    // Client Hints are always overridden with Chrome brands; time and geolocation stay native in auto mode.
    expect(f.calls).toContain('Network.setUserAgentOverride:s1');
    expect(f.calls).not.toContain('Emulation.setTimezoneOverride:s1');
    expect(f.calls).not.toContain('Emulation.setGeolocationOverride:s1');
    expect(f.calls).not.toContain('Browser.grantPermissions');
  });

  it('sends Client Hints with the engine full version for a Windows UA', async () => {
    const f = fake();
    await installFingerprint(f.client, {
      fingerprint: { ...SPOOFED, userAgent: windowsFull },
      languages: ['ru-RU'], seed: 1, engineUserAgent: windowsEngine, engineVersion: '156.0.8078.80',
    });
    await new Promise(r => setTimeout(r, 20));
    expect(f.calls).toContain('Network.setUserAgentOverride:s1');
    expect(f.params['Network.setUserAgentOverride']).toMatchObject({ userAgent: windowsEngine, platform: 'Win32', userAgentMetadata: { platform: 'Windows', fullVersion: '156.0.8078.80', architecture: 'x86', bitness: '64' } });
  });

  it('sends Chrome-branded Client Hints even without a custom User-Agent', async () => {
    // Chrome for Testing is Chromium-branded: its own Sec-CH-UA omits "Google Chrome", which both
    // leaks a non-Chrome browser and makes google.com offer to "download Chrome" (DECISIONS.md #60).
    const f = fake();
    await installFingerprint(f.client, {
      fingerprint: DEFAULT_FINGERPRINT, languages: ['en-US'], seed: 156,
      engineUserAgent: windowsEngine, engineVersion: '156.0.8078.80',
    });
    await new Promise(r => setTimeout(r, 20));
    expect(f.calls).toContain('Network.setUserAgentOverride:s1');
    const override = f.params['Network.setUserAgentOverride'] as { userAgent: string; platform: string; userAgentMetadata: { brands: Array<{ brand: string }>; platform: string; platformVersion: string; fullVersion: string } };
    expect(override.userAgent).toBe(windowsEngine);
    expect(override.platform).toBe('Win32');
    expect(override.userAgentMetadata.platform).toBe('Windows');
    expect(override.userAgentMetadata.platformVersion).toBe('15.0.0');
    expect(override.userAgentMetadata.fullVersion).toBe('156.0.8078.80');
    expect(override.userAgentMetadata.brands.map(b => b.brand)).toEqual(expect.arrayContaining(['Chromium', 'Google Chrome']));
  });

  it('matches the fingerprint OS when no custom User-Agent is set', async () => {
    const f = fake();
    await installFingerprint(f.client, {
      fingerprint: { ...DEFAULT_FINGERPRINT, os: 'macos' }, languages: ['en-US'], seed: 156,
      engineUserAgent: windowsEngine, engineVersion: '156.0.8078.80',
    });
    await new Promise(r => setTimeout(r, 20));
    const override = f.params['Network.setUserAgentOverride'] as { userAgent: string; platform: string; userAgentMetadata: { platform: string; platformVersion: string } };
    expect(override.userAgent).toContain('Macintosh; Intel Mac OS X 10_15_7');
    expect(override.platform).toBe('MacIntel');
    expect(override.userAgentMetadata.platform).toBe('macOS');
    expect(override.userAgentMetadata.platformVersion).toBe('15.0.0');
  });

  it('configures the initial page once although navigation reuses it', async () => {
    const f = fake([{ targetId: 't1', type: 'page' }]);
    const session = await installFingerprint(f.client, { fingerprint: SPOOFED, languages: ['en-US'], seed: 1 });
    await session.navigate(['https://a.example']);
    await new Promise(r => setTimeout(r, 20));
    expect(f.calls.filter(c => c.startsWith('Page.addScriptToEvaluateOnNewDocument:'))).toEqual(['Page.addScriptToEvaluateOnNewDocument:s1']);
    expect(f.calls).toContain('Page.navigate:s1');
  });

  it('configures each extra start tab once', async () => {
    const f = fake([{ targetId: 't1', type: 'page' }]);
    const session = await installFingerprint(f.client, { fingerprint: SPOOFED, languages: ['en-US'], seed: 1 });
    await session.navigate(['https://a.example', 'https://b.example']);
    await new Promise(r => setTimeout(r, 20));
    expect(f.calls.filter(c => c.startsWith('Page.addScriptToEvaluateOnNewDocument:')).sort()).toEqual(['Page.addScriptToEvaluateOnNewDocument:s1', 'Page.addScriptToEvaluateOnNewDocument:s2']);
    expect(f.calls).toContain('Page.navigate:s2');
  });

  it('injects no script when no surface is spoofed', async () => {
    const f = fake([{ targetId: 't1', type: 'page' }]);
    const untouched = { ...DEFAULT_FINGERPRINT, geolocation: { mode: 'auto' as const } };
    const session = await installFingerprint(f.client, { fingerprint: untouched, languages: ['en-US'], seed: 1 });
    await session.navigate(['https://a.example']);
    f.emit({ method: 'Target.attachedToTarget', params: { sessionId: 's4', targetInfo: { targetId: 't4', type: 'iframe', url: 'https://frame.example/' } } });
    f.emit({ method: 'Target.attachedToTarget', params: { sessionId: 's5', targetInfo: { targetId: 't5', type: 'worker' } } });
    await new Promise(r => setTimeout(r, 20));
    expect(f.calls.some(c => c.startsWith('Page.addScriptToEvaluateOnNewDocument') || c.startsWith('Runtime.evaluate'))).toBe(false);
    expect(f.calls).toContain('Runtime.runIfWaitingForDebugger:s4');
    expect(f.calls).toContain('Runtime.runIfWaitingForDebugger:s5');
  });

  it('skips Page.reload on attached page if the transition is form_submit', async () => {
    const f = fake([{ targetId: 't1', type: 'page', url: 'https://example.com/checkout' }]);
    let reloaded = false;
    f.client.send = async (method: string, params: unknown, sessionId?: string) => {
      f.calls.push(sessionId ? `${method}:${sessionId}` : method);
      if (method === 'Page.getNavigationHistory') {
        return { currentIndex: 0, entries: [{ id: 1, url: 'https://example.com/checkout', transitionType: 'form_submit' }] } as any;
      }
      if (method === 'Page.reload') {
        reloaded = true;
      }
      return {} as any;
    };
    await installFingerprint(f.client, { fingerprint: SPOOFED, languages: ['en-US'], seed: 1 });
    f.emit({ method: 'Target.attachedToTarget', params: { sessionId: 's2', targetInfo: { targetId: 't2', type: 'page', url: 'https://example.com/checkout' } } });
    await new Promise(r => setTimeout(r, 30));
    expect(reloaded).toBe(false);
  });

  it('neither reloads nor patches a popup when the profile overrides nothing', async () => {
    const f = fake([]);
    withLinkHistory(f);
    await installFingerprint(f.client, { fingerprint: DEFAULT_FINGERPRINT, languages: ['en-US'], seed: 1 });
    f.emit({ method: 'Target.attachedToTarget', params: { sessionId: 's2', targetInfo: { targetId: 't2', type: 'page', url: 'https://example.com/magic?token=once' } } });
    await new Promise(r => setTimeout(r, 30));
    expect(f.calls).not.toContain('Page.reload:s2');
    expect(f.calls).not.toContain('Runtime.evaluate:s2');
    expect(f.calls).toContain('Runtime.runIfWaitingForDebugger:s2');
  });

  // A tab that arrives with a web address already loading is stopped at once and opened again once
  // the overrides are in place, so its first document never runs with the real fingerprint.
  const expectStoppedAndReopened = (f: Fake, url: string) => {
    expect(f.calls).toContain('Page.stopLoading:s2');
    expect(f.calls.indexOf('Page.stopLoading:s2')).toBeLessThan(f.calls.indexOf('Runtime.runIfWaitingForDebugger:s2'));
    expect(f.calls).toContain('Page.navigate:s2');
    expect(f.params['Page.navigate']).toEqual({ url });
    expect(f.calls).not.toContain('Page.reload:s2');
  };

  it('stops and reopens a tab with a web address when only a user-agent override applies', async () => {
    const f = fake([]);
    withLinkHistory(f);
    await installFingerprint(f.client, { fingerprint: DEFAULT_FINGERPRINT, languages: ['en-US'], seed: 1, engineUserAgent: windowsEngine, engineVersion: '156.0.8078.80' });
    f.emit({ method: 'Target.attachedToTarget', params: { sessionId: 's2', targetInfo: { targetId: 't2', type: 'page', url: 'https://example.com/' } } });
    await new Promise(r => setTimeout(r, 30));
    expectStoppedAndReopened(f, 'https://example.com/');
  });

  it('neither stops nor reopens a tab with a web address when the profile overrides nothing', async () => {
    const f = fake([]);
    withLinkHistory(f);
    await installFingerprint(f.client, { fingerprint: DEFAULT_FINGERPRINT, languages: ['en-US'], seed: 1 });
    f.emit({ method: 'Target.attachedToTarget', params: { sessionId: 's2', targetInfo: { targetId: 't2', type: 'page', url: 'https://example.com/once?token=1' } } });
    await new Promise(r => setTimeout(r, 30));
    expect(f.calls).not.toContain('Page.stopLoading:s2');
    expect(f.calls).not.toContain('Page.navigate:s2');
  });

  it('reloads, without stopping, a tab whose address is not a web address', async () => {
    const f = fake([]);
    withLinkHistory(f);
    await installFingerprint(f.client, { fingerprint: SPOOFED, languages: ['en-US'], seed: 1 });
    f.emit({ method: 'Target.attachedToTarget', params: { sessionId: 's2', targetInfo: { targetId: 't2', type: 'page', url: 'file:///C:/page.html' } } });
    await new Promise(r => setTimeout(r, 30));
    expect(f.calls).not.toContain('Page.stopLoading:s2');
    expect(f.calls).toContain('Page.reload:s2');
  });

  it.each([
    ['timezone', { ...DEFAULT_FINGERPRINT, timezone: { mode: 'manual' as const, value: 'Europe/Berlin' } }],
    ['geolocation', { ...DEFAULT_FINGERPRINT, geolocation: { mode: 'manual' as const, latitude: 1, longitude: 2, accuracy: 10 } }],
    ['screen', { ...DEFAULT_FINGERPRINT, screen: { mode: 'manual' as const, width: 1920, height: 1080 } }],
    ['spoof script', SPOOFED],
  ])('stops and reopens a tab with a web address when a %s override applies', async (_name, fingerprint) => {
    const f = fake([]);
    withLinkHistory(f);
    await installFingerprint(f.client, { fingerprint: fingerprint as never, languages: ['en-US'], seed: 1 });
    f.emit({ method: 'Target.attachedToTarget', params: { sessionId: 's2', targetInfo: { targetId: 't2', type: 'page', url: 'https://example.com/' } } });
    await new Promise(r => setTimeout(r, 30));
    expectStoppedAndReopened(f, 'https://example.com/');
  });

  it('failure on a new page closes that page but not the session', async () => {
    const f = fake([]);
    const failures: string[] = [];
    await installFingerprint(f.client, { fingerprint: SPOOFED, languages: ['ru-RU'], seed: 1, onPageFailure: r => failures.push(r) });
    f.rejectOn('Page.addScriptToEvaluateOnNewDocument');
    f.emit({ method: 'Target.attachedToTarget', params: { sessionId: 's9', targetInfo: { targetId: 't9', type: 'page' } } });
    await new Promise(r => setTimeout(r, 20));
    expect(failures).toHaveLength(1);
    expect(f.calls).toContain('Target.closeTarget');
    expect(f.params['Target.closeTarget']).toEqual({ targetId: 't9' });
  });

  it('does not treat a worker as a page and still releases it', async () => {
    const f = fake([]);
    await installFingerprint(f.client, { fingerprint: SPOOFED, languages: ['ru-RU'], seed: 1 });
    f.emit({ method: 'Target.attachedToTarget', params: { sessionId: 's3', targetInfo: { targetId: 't3', type: 'worker' } } });
    await new Promise(r => setTimeout(r, 20));
    expect(f.calls).toContain('Runtime.runIfWaitingForDebugger:s3');
    expect(f.calls).not.toContain('Page.addScriptToEvaluateOnNewDocument:s3');
  });
  it('evaluates the spoof script once when the same worker is attached twice',async()=>{
    const f=fake([]);await installFingerprint(f.client,{fingerprint:SPOOFED,languages:['en-US'],seed:1});
    f.emit({method:'Target.attachedToTarget',params:{sessionId:'s1',targetInfo:{targetId:'worker-1',type:'worker'}}});
    f.emit({method:'Target.attachedToTarget',params:{sessionId:'s2',targetInfo:{targetId:'worker-1',type:'worker'}}});
    await new Promise(r=>setTimeout(r,20));expect(f.calls.filter(call=>call.startsWith('Runtime.evaluate:'))).toHaveLength(1);
  });

  it('does not reload a popup when navigation history cannot be inspected', async () => {
    const f = fake([]);
    await installFingerprint(f.client, { fingerprint: SPOOFED, languages: ['en-US'], seed: 1 });
    f.rejectOn('Page.getNavigationHistory');
    f.emit({ method: 'Target.attachedToTarget', params: { sessionId: 's2', targetInfo: { targetId: 't2', type: 'page', url: 'file:///C:/checkout.html' } } });
    await new Promise(r => setTimeout(r, 30));
    expect(f.calls).not.toContain('Page.reload:s2');
    // The already-loaded document still gets the spoof script, without risking a POST resubmission.
    expect(f.calls).toContain('Runtime.evaluate:s2');
  });

  it('reopens a stopped tab even when navigation history cannot be inspected, so it is not left empty', async () => {
    const f = fake([]);
    await installFingerprint(f.client, { fingerprint: SPOOFED, languages: ['en-US'], seed: 1 });
    f.rejectOn('Page.getNavigationHistory');
    f.emit({ method: 'Target.attachedToTarget', params: { sessionId: 's2', targetInfo: { targetId: 't2', type: 'page', url: 'https://example.com/page' } } });
    await new Promise(r => setTimeout(r, 30));
    expectStoppedAndReopened(f, 'https://example.com/page');
  });

  it('patches an already loaded document instead of reloading a form submission', async () => {
    const f = fake([]);
    await installFingerprint(f.client, { fingerprint: SPOOFED, languages: ['en-US'], seed: 1 });
    const send = f.client.send.bind(f.client);
    f.client.send = async (method: string, params: Record<string, unknown> = {}, sessionId?: string) => {
      if (method === 'Page.getNavigationHistory') return { currentIndex: 0, entries: [{ transitionType: 'form_submit' }] } as never;
      return send(method, params, sessionId);
    };
    f.emit({ method: 'Target.attachedToTarget', params: { sessionId: 's2', targetInfo: { targetId: 't2', type: 'page', url: 'https://example.com/checkout' } } });
    await new Promise(r => setTimeout(r, 30));
    expect(f.calls).not.toContain('Page.reload:s2');
    expect(f.calls).toContain('Runtime.evaluate:s2');
  });

  it('resumes a worker instead of hanging it when it cannot be closed',async()=>{
    const f=fake([]);const send=f.client.send.bind(f.client);
    f.client.send=async(method:string,params:Record<string,unknown>={},sessionId?:string)=>{
      if(method==='Runtime.evaluate'||method==='Target.closeTarget')throw Error('unsupported');
      return send(method,params,sessionId);
    };
    const outcomes:string[]=[];
    await installFingerprint(f.client,{fingerprint:SPOOFED,languages:['en-US'],seed:1,onPageFailure:(_r,outcome)=>outcomes.push(outcome)});
    f.emit({method:'Target.attachedToTarget',params:{sessionId:'s3',targetInfo:{targetId:'t3',type:'worker'}}});
    await new Promise(r=>setTimeout(r,20));
    expect(f.calls).toContain('Runtime.runIfWaitingForDebugger:s3');
    // The user is told that the worker ran without full protection.
    expect(outcomes).toEqual(['unprotected']);
  });

  describe('strict protection',()=>{
    /** A page t1 (session s1) with an iframe f1 (session sf) that starts a worker w1 (session sw) Chromium refuses to close. */
    async function strictRun(strict:boolean,parent:string|undefined){
      const f=fake([]);const send=f.client.send.bind(f.client);const closed:string[]=[];
      f.client.send=async(method:string,params:Record<string,unknown>={},sessionId?:string)=>{
        if(method==='Runtime.evaluate'&&sessionId==='sw')throw Error('unsupported');
        if(method==='Target.closeTarget'){if(params.targetId==='w1')throw Error('unsupported');closed.push(String(params.targetId));}
        return send(method,params,sessionId);
      };
      const outcomes:string[]=[];
      await installFingerprint(f.client,{fingerprint:SPOOFED,languages:['en-US'],seed:1,strict,onPageFailure:(_r,outcome)=>outcomes.push(outcome)});
      f.emit({method:'Target.attachedToTarget',params:{sessionId:'s1',targetInfo:{targetId:'t1',type:'page',url:'about:blank'}}});
      f.emit({method:'Target.attachedToTarget',sessionId:'s1',params:{sessionId:'sf',targetInfo:{targetId:'f1',type:'iframe'}}});
      await new Promise(r=>setTimeout(r,20));
      f.emit({method:'Target.attachedToTarget',...(parent?{sessionId:parent}:{}),params:{sessionId:'sw',targetInfo:{targetId:'w1',type:'worker'}}});
      await new Promise(r=>setTimeout(r,20));
      return {closed,outcomes,resumed:f.calls.includes('Runtime.runIfWaitingForDebugger:sw')};
    }
    it('closes the page that owns a worker it cannot protect, through nested frames, and never resumes the worker',async()=>{
      expect(await strictRun(true,'sf')).toEqual({closed:['t1'],outcomes:['closed'],resumed:false});
    });
    it('keeps a worker without a page paused',async()=>{
      expect(await strictRun(true,undefined)).toEqual({closed:[],outcomes:['closed'],resumed:false});
    });
    it('is off by default: the worker runs and is reported as unprotected',async()=>{
      expect(await strictRun(false,'sf')).toEqual({closed:[],outcomes:['unprotected'],resumed:true});
    });
  });

  it('forgets cached worker evaluations when the target detaches',async()=>{
    const f=fake([]);await installFingerprint(f.client,{fingerprint:SPOOFED,languages:['en-US'],seed:1});
    f.emit({method:'Target.attachedToTarget',params:{sessionId:'s1',targetInfo:{targetId:'w1',type:'worker'}}});
    await new Promise(r=>setTimeout(r,20));
    f.emit({method:'Target.detachedFromTarget',params:{targetId:'w1',sessionId:'s1'}});
    f.emit({method:'Target.attachedToTarget',params:{sessionId:'s2',targetInfo:{targetId:'w1',type:'worker'}}});
    await new Promise(r=>setTimeout(r,20));
    expect(f.calls.filter(call=>call.startsWith('Runtime.evaluate:'))).toHaveLength(2);
  });

  it('closes a worker if the spoof script cannot be evaluated', async () => {
    const f = fake([]);
    await installFingerprint(f.client, { fingerprint: SPOOFED, languages: ['en-US'], seed: 1 });
    f.rejectOn('Runtime.evaluate');
    f.emit({ method: 'Target.attachedToTarget', params: { sessionId: 's3', targetInfo: { targetId: 't3', type: 'worker' } } });
    await new Promise(r => setTimeout(r, 20));
    expect(f.calls).toContain('Target.closeTarget');
    expect(f.calls).not.toContain('Runtime.runIfWaitingForDebugger:s3');
  });

  it('closes a worker when its timezone override fails', async () => {
    const f = fake([]);
    await installFingerprint(f.client, { fingerprint: {...SPOOFED, timezone:{mode:'manual',value:'Europe/Paris'}}, languages: ['en-US'], seed: 1 });
    f.rejectOn('Emulation.setTimezoneOverride');
    f.emit({ method: 'Target.attachedToTarget', params: { sessionId: 's3', targetInfo: { targetId: 't3', type: 'worker' } } });
    await new Promise(r => setTimeout(r, 20));
    expect(f.calls).toContain('Target.closeTarget');
    expect(f.calls).not.toContain('Runtime.runIfWaitingForDebugger:s3');
  });

  it('closes a worker when evaluation returns JavaScript exception details', async () => {
    const f=fake([]);const send=f.client.send.bind(f.client);
    f.client.send=async(method:string,params:Record<string,unknown>={},sessionId?:string)=>{
      if(method==='Runtime.evaluate')return {exceptionDetails:{text:'script failed'}} as any;
      return send(method,params,sessionId);
    };
    await installFingerprint(f.client,{fingerprint:SPOOFED,languages:['en-US'],seed:1});
    f.emit({method:'Target.attachedToTarget',params:{sessionId:'s3',targetInfo:{targetId:'t3',type:'worker'}}});
    await new Promise(r=>setTimeout(r,20));
    expect(f.calls).toContain('Target.closeTarget');
    expect(f.calls).not.toContain('Runtime.runIfWaitingForDebugger:s3');
  });

  it('applies fingerprint overrides to an attached iframe before resuming it', async () => {
    const f=fake([]);
    await installFingerprint(f.client,{fingerprint:{...SPOOFED,timezone:{mode:'manual',value:'Europe/Paris'}},languages:['en-US'],seed:1});
    f.emit({method:'Target.attachedToTarget',params:{sessionId:'s4',targetInfo:{targetId:'t4',type:'iframe',url:'https://frame.example/'}}});
    await new Promise(r=>setTimeout(r,20));
    expect(f.calls).toContain('Page.addScriptToEvaluateOnNewDocument:s4');
    expect(f.calls).toContain('Emulation.setTimezoneOverride:s4');
    expect(f.calls.indexOf('Page.addScriptToEvaluateOnNewDocument:s4')).toBeLessThan(f.calls.indexOf('Runtime.runIfWaitingForDebugger:s4'));
    expect(f.calls).not.toContain('Page.reload:s4');
  });

  it('closes an iframe if its fingerprint script cannot be installed',async()=>{
    const f=fake([]);await installFingerprint(f.client,{fingerprint:SPOOFED,languages:['en-US'],seed:1});
    f.rejectOn('Page.addScriptToEvaluateOnNewDocument');
    f.emit({method:'Target.attachedToTarget',params:{sessionId:'s4',targetInfo:{targetId:'t4',type:'iframe',url:'https://frame.example/'}}});
    await new Promise(r=>setTimeout(r,20));
    expect(f.calls).toContain('Target.closeTarget');expect(f.calls).not.toContain('Runtime.runIfWaitingForDebugger:s4');
  });

  it('closes a newly attached page if recursive auto-attach fails',async()=>{
    const f=fake([]);await installFingerprint(f.client,{fingerprint:SPOOFED,languages:['en-US'],seed:1});
    f.rejectOn('Target.setAutoAttach');
    f.emit({method:'Target.attachedToTarget',params:{sessionId:'s4',targetInfo:{targetId:'t4',type:'page',url:'about:blank'}}});
    await new Promise(r=>setTimeout(r,20));expect(f.calls).toContain('Target.closeTarget');expect(f.calls).not.toContain('Runtime.runIfWaitingForDebugger:s4');
  });

  it('excludes service workers from page-level auto-attach because the browser attaches them',async()=>{
    const f=fake([]);await installFingerprint(f.client,{fingerprint:SPOOFED,languages:['en-US'],seed:1});
    f.emit({method:'Target.attachedToTarget',params:{sessionId:'s4',targetInfo:{targetId:'t4',type:'page',url:'about:blank'}}});
    await new Promise(r=>setTimeout(r,20));expect(f.params['Target.setAutoAttach']).toMatchObject({filter:[{type:'service_worker',exclude:true},{}]});
  });

  it('fails installation when blocking geolocation permissions fails', async () => {
    const f = fake([]); f.rejectOn('Browser.setPermission');
    await expect(installFingerprint(f.client, { fingerprint: {...SPOOFED,geolocation:{mode:'block'}}, languages:['en-US'],seed:1 })).rejects.toThrow('boom');
  });
});

describe('navigate', () => {
  it('opens the first URL in the existing page and the rest in new tabs', async () => {
    const f = fake([{ targetId: 't1', type: 'page' }]);
    const session = await installFingerprint(f.client, { fingerprint: SPOOFED, languages: ['ru-RU'], seed: 1 });
    // The initial page is set up asynchronously; navigate() itself waits for it.
    await new Promise(r => setTimeout(r, 20));
    expect(f.calls).toContain('Page.addScriptToEvaluateOnNewDocument:s1');
    f.calls.length = 0;
    await session.navigate(['https://a.example', 'https://b.example']);
    expect(f.calls).not.toContain('Page.addScriptToEvaluateOnNewDocument:s1');
    expect(f.calls).toContain('Page.addScriptToEvaluateOnNewDocument:s2');
    expect(f.params['Page.navigate']).toEqual({ url: 'https://b.example' });
    expect(f.calls).toContain('Page.navigate:s1');
    expect(f.params['Target.createTarget']).toEqual({ url: 'about:blank' });
  });

  it('waits for the first page after browser startup', async () => {
    const f = fake(undefined, 2);
    const session = await installFingerprint(f.client, { fingerprint: SPOOFED, languages: ['ru-RU'], seed: 1 });
    f.calls.length = 0;
    await session.navigate(['https://a.example']);
    expect(f.calls).toContain('Page.navigate:s1');
  });

  it('application failure on the first page fails navigation', async () => {
    const f = fake([{ targetId: 't1', type: 'page' }]);
    f.rejectOn('Page.addScriptToEvaluateOnNewDocument');
    const session = await installFingerprint(f.client, { fingerprint: SPOOFED, languages: ['ru-RU'], seed: 1 });
    await expect(session.navigate(['https://a.example'])).rejects.toThrow('boom');
  });
  it('reports readiness only after the first page finished loading', async () => {
    const listeners: Array<(message: CdpMessage) => void> = [];
    let states = ['loading', 'interactive', 'complete'];
    const calls: string[] = [];
    const client = {
      onEvent: (listener: (message: CdpMessage) => void) => listeners.push(listener),
      send: async (method: string, params: Record<string, unknown> = {}, sessionId?: string) => {
        calls.push(sessionId ? `${method}:${sessionId}` : method);
        if (method === 'Target.getTargets') return { targetInfos: [{ targetId: 't1', type: 'page', url: 'http://fixture' }] };
        if (method === 'Target.attachToTarget') { listeners.forEach(listener => listener({ method: 'Target.attachedToTarget', params: { sessionId: 's1', targetInfo: { targetId: 't1', type: 'page', url: 'http://fixture' } } })); return { sessionId: 's1' }; }
        if (method === 'Runtime.evaluate') return { result: { value: states.shift() ?? 'complete' } };
        void params;
        return {};
      },
    } as unknown as CdpClient;
    const session = await installFingerprint(client, { fingerprint: DEFAULT_FINGERPRINT, languages: ['en-US'], seed: 1, readyTimeoutMs: 2000 });
    await session.navigate(['http://fixture']);
    await session.ready();
    expect(calls).toContain('Runtime.evaluate:s1');
  });

  it('fails readiness instead of exposing a page that never finishes loading', async () => {
    const client = {
      onEvent: () => undefined,
      send: async (method: string) => {
        if (method === 'Target.getTargets') return { targetInfos: [{ targetId: 't1', type: 'page', url: 'http://fixture' }] };
        if (method === 'Target.attachToTarget') return { sessionId: 's1' };
        if (method === 'Runtime.evaluate') return { result: { value: 'loading' } };
        return {};
      },
    } as unknown as CdpClient;
    const session = await installFingerprint(client, { fingerprint: DEFAULT_FINGERPRINT, languages: ['en-US'], seed: 1, readyTimeoutMs: 1200 });
    await expect(session.ready()).rejects.toThrow('FINGERPRINT_UNAVAILABLE');
  });

  it('denies permissions when geolocation is set to block', async () => {
    const f = fake();
    await installFingerprint(f.client, {
      fingerprint: { ...SPOOFED, geolocation: { mode: 'block' } },
      languages: ['en-US'], seed: 1,
    });
    expect(f.calls).toContain('Browser.setPermission');
    expect(f.params['Browser.setPermission']).toMatchObject({
      permission: { name: 'geolocation' },
      setting: 'denied',
    });
  });

  it('emulates the screen for manual fingerprints without pinning the viewport', async () => {
    const f = fake();
    await installFingerprint(f.client, {
      fingerprint: { ...SPOOFED, screen: { mode: 'manual', width: 1920, height: 1080 } },
      languages: ['en-US'], seed: 1,
    });
    await new Promise(r => setTimeout(r, 20));
    expect(f.calls).toContain('Emulation.setDeviceMetricsOverride:s1');
    expect(f.params['Emulation.setDeviceMetricsOverride']).toMatchObject({
      width: 0, height: 0, screenWidth: 1920, screenHeight: 1080,
      deviceScaleFactor: 1, mobile: false, dontSetVisibleSize: true,
    });
    const source = String((f.params['Page.addScriptToEvaluateOnNewDocument'] as { source?: string }).source);
    expect(source).toContain('"availWidth":1920');
    expect(source).toContain('"availHeight":1040');
  });

  it('uses the configured device pixel ratio and skips emulation for the real screen', async () => {
    const scaled = fake();
    await installFingerprint(scaled.client, {
      fingerprint: { ...SPOOFED, screen: { mode: 'manual', width: 1512, height: 982, dpr: 2 } },
      languages: ['en-US'], seed: 1,
    });
    await new Promise(r => setTimeout(r, 20));
    expect(scaled.params['Emulation.setDeviceMetricsOverride']).toMatchObject({ screenWidth: 1512, screenHeight: 982, deviceScaleFactor: 2 });
    const plain = fake();
    await installFingerprint(plain.client, { fingerprint: { ...SPOOFED, screen: { mode: 'real' } }, languages: ['en-US'], seed: 1 });
    await new Promise(r => setTimeout(r, 20));
    expect(plain.calls.some(call => call.startsWith('Emulation.setDeviceMetricsOverride'))).toBe(false);
  });
});
describe('service targets',()=>{
 it('protects transitions from chrome pages without modifying devtools pages',async()=>{
   const f=fake([]);
   await installFingerprint(f.client,{fingerprint:SPOOFED,languages:['ru-RU'],seed:1});
   f.emit({method:'Target.attachedToTarget',params:{sessionId:'s7',targetInfo:{targetId:'t7',type:'page',url:'devtools://devtools/bundled/inspector.html'}}});
   f.emit({method:'Target.attachedToTarget',params:{sessionId:'s8',targetInfo:{targetId:'t8',type:'page',url:'chrome://settings/'}}});
   await new Promise(r=>setTimeout(r,20));
   expect(f.calls).not.toContain('Page.enable:s7');
   expect(f.calls).toContain('Page.enable:s8');
   expect(f.calls).not.toContain('Page.reload:s8');
 });
});

// A noopener tab (target="_blank" link or form) gets its own renderer process. Until it is resumed,
// Chromium answers only browser-side commands such as Target.setAutoAttach and
// Runtime.runIfWaitingForDebugger; every page-level command waits for the resume.
function answerOnlyAfterResume(f:Fake,sessionId:string,failMethod?:string):string[]{
  const send=f.client.send.bind(f.client);
  const held:Array<()=>void>=[];let resumed=false;
  // The order in which the installer sent its commands, independent of when they were answered.
  const sent:string[]=[];
  f.client.send=(async(method:string,params:Record<string,unknown>={},target?:string)=>{
    if(target===sessionId)sent.push(method);
    if(target!==sessionId||method.startsWith('Target.'))return send(method,params,target);
    if(method==='Runtime.runIfWaitingForDebugger'){const result=await send(method,params,target);resumed=true;held.splice(0).forEach(release=>release());return result;}
    if(!resumed)await new Promise<void>(release=>held.push(release));
    if(method===failMethod){f.calls.push(`${method}:${target}`);throw Error('boom');}
    return send(method,params,target);
  }) as typeof f.client.send;
  return sent;
}

describe('a tab that answers only after it is resumed',()=>{
  it('sends every override before the resume and keeps the tab open',async()=>{
    const f=fake([]);const failures:string[]=[];
    await installFingerprint(f.client,{fingerprint:{...SPOOFED,timezone:{mode:'manual',value:'Europe/Berlin'}},languages:['en-US'],seed:1,engineUserAgent:windowsEngine,engineVersion:'156.0.8078.80',onPageFailure:r=>failures.push(r),pageAnswerWaitMs:30});
    const calls=answerOnlyAfterResume(f,'s2');
    f.emit({method:'Target.attachedToTarget',params:{sessionId:'s2',targetInfo:{targetId:'t2',type:'page',url:''}}});
    await new Promise(r=>setTimeout(r,200));
    expect(calls.at(-1)).toBe('Runtime.runIfWaitingForDebugger');
    for(const override of ['Page.addScriptToEvaluateOnNewDocument','Network.setUserAgentOverride','Emulation.setTimezoneOverride'])
      expect(calls.indexOf(override),override).toBeGreaterThanOrEqual(0);
    expect(f.calls).not.toContain('Target.closeTarget');
    expect(failures).toEqual([]);
  });

  it('keeps the ordinary path, and its fail-closed guarantee, for a tab that answers at once',async()=>{
    const f=fake([]);const failures:string[]=[];
    await installFingerprint(f.client,{fingerprint:SPOOFED,languages:['en-US'],seed:1,onPageFailure:r=>failures.push(r),pageAnswerWaitMs:30});
    f.rejectOn('Page.addScriptToEvaluateOnNewDocument');
    f.emit({method:'Target.attachedToTarget',params:{sessionId:'s2',targetInfo:{targetId:'t2',type:'page',url:''}}});
    await new Promise(r=>setTimeout(r,100));
    expect(f.calls).not.toContain('Runtime.runIfWaitingForDebugger:s2');
    expect(f.params['Target.closeTarget']).toEqual({targetId:'t2'});
    expect(failures).toHaveLength(1);
  });

  it('closes the tab when an override fails after the resume',async()=>{
    const f=fake([]);const failures:string[]=[];
    await installFingerprint(f.client,{fingerprint:SPOOFED,languages:['en-US'],seed:1,onPageFailure:r=>failures.push(r),pageAnswerWaitMs:30});
    answerOnlyAfterResume(f,'s2','Page.addScriptToEvaluateOnNewDocument');
    f.emit({method:'Target.attachedToTarget',params:{sessionId:'s2',targetInfo:{targetId:'t2',type:'page',url:''}}});
    await new Promise(r=>setTimeout(r,200));
    expect(f.params['Target.closeTarget']).toEqual({targetId:'t2'});
    expect(failures).toHaveLength(1);
  });

  it('emulates a manual screen from the last measured display without asking the paused tab',async()=>{
    const f=fake();
    await installFingerprint(f.client,{fingerprint:{...SPOOFED,screen:{mode:'manual',width:1512,height:982,dpr:2}},languages:['en-US'],seed:1,pageAnswerWaitMs:30});
    await new Promise(r=>setTimeout(r,30));
    expect(f.calls).toContain('Emulation.setDeviceMetricsOverride:s1');
    const calls=answerOnlyAfterResume(f,'s2');
    f.emit({method:'Target.attachedToTarget',params:{sessionId:'s2',targetInfo:{targetId:'t2',type:'page',url:''}}});
    await new Promise(r=>setTimeout(r,200));
    expect(calls).toContain('Emulation.setDeviceMetricsOverride');
    expect(calls).not.toContain('Runtime.evaluate');
    expect(calls.indexOf('Emulation.setDeviceMetricsOverride')).toBeLessThan(calls.indexOf('Runtime.runIfWaitingForDebugger'));
    expect(f.calls).not.toContain('Target.closeTarget');
  });

  it('closes a tab with a manual screen when no display has been measured yet',async()=>{
    const f=fake([]);const failures:string[]=[];
    await installFingerprint(f.client,{fingerprint:{...SPOOFED,screen:{mode:'manual',width:1512,height:982,dpr:2}},languages:['en-US'],seed:1,onPageFailure:r=>failures.push(r),pageAnswerWaitMs:30});
    answerOnlyAfterResume(f,'s2');
    f.emit({method:'Target.attachedToTarget',params:{sessionId:'s2',targetInfo:{targetId:'t2',type:'page',url:''}}});
    await new Promise(r=>setTimeout(r,200));
    expect(f.calls).not.toContain('Runtime.runIfWaitingForDebugger:s2');
    expect(f.params['Target.closeTarget']).toEqual({targetId:'t2'});
    expect(failures).toEqual(['SCREEN_METRICS_UNAVAILABLE']);
  });
});

// Middle click and Ctrl+click: the tab attaches with an empty address while the browser is
// already loading it. A web document committed before the overrides are confirmed must be reloaded.
describe('a background tab that commits while it is being set up',()=>{
  function commitDuring(f:Fake,sessionId:string,when:'before-overrides'|'after-resume',url='https://example.com/opened'){
    const send=f.client.send.bind(f.client);let emitted=false;
    f.client.send=(async(method:string,params:Record<string,unknown>={},target?:string)=>{
      if(target===sessionId&&!emitted&&((when==='before-overrides'&&method==='Target.setAutoAttach')||(when==='after-resume'&&method==='Runtime.runIfWaitingForDebugger'))){
        emitted=true;
        const result=await send(method,params,target);
        f.emit({sessionId,method:'Page.frameNavigated',params:{frame:{id:'main',url}}});
        return result;
      }
      return send(method,params,target);
    }) as typeof f.client.send;
  }
  it('reloads it when the main frame committed before the overrides were confirmed',async()=>{
    const f=fake([]);withLinkHistory(f);
    await installFingerprint(f.client,{fingerprint:SPOOFED,languages:['en-US'],seed:1});
    commitDuring(f,'s2','before-overrides');
    f.emit({method:'Target.attachedToTarget',params:{sessionId:'s2',targetInfo:{targetId:'t2',type:'page',url:''}}});
    await new Promise(r=>setTimeout(r,50));
    expect(f.calls).toContain('Page.reload:s2');
  });
  it('reloads it when a web document is already in the frame tree at setup',async()=>{
    const f=fake([]);withLinkHistory(f);
    await installFingerprint(f.client,{fingerprint:SPOOFED,languages:['en-US'],seed:1});
    const send=f.client.send.bind(f.client);
    f.client.send=(async(method:string,params:Record<string,unknown>={},target?:string)=>{
      if(method==='Page.getFrameTree'&&target==='s2'){f.calls.push(`${method}:${target}`);return {frameTree:{frame:{id:'main',url:'https://example.com/early'}}} as never;}
      return send(method,params,target);
    }) as typeof f.client.send;
    f.emit({method:'Target.attachedToTarget',params:{sessionId:'s2',targetInfo:{targetId:'t2',type:'page',url:''}}});
    await new Promise(r=>setTimeout(r,50));
    expect(f.calls).toContain('Page.reload:s2');
  });
  it('does not reload a tab whose document commits after it was resumed',async()=>{
    const f=fake([]);withLinkHistory(f);
    await installFingerprint(f.client,{fingerprint:SPOOFED,languages:['en-US'],seed:1});
    commitDuring(f,'s2','after-resume');
    f.emit({method:'Target.attachedToTarget',params:{sessionId:'s2',targetInfo:{targetId:'t2',type:'page',url:''}}});
    await new Promise(r=>setTimeout(r,50));
    expect(f.calls).not.toContain('Page.reload:s2');
  });
  it('ignores a committing subframe and a profile that overrides nothing',async()=>{
    const f=fake([]);withLinkHistory(f);
    await installFingerprint(f.client,{fingerprint:SPOOFED,languages:['en-US'],seed:1});
    const send=f.client.send.bind(f.client);let emitted=false;
    f.client.send=(async(method:string,params:Record<string,unknown>={},target?:string)=>{
      const result=await send(method,params,target);
      if(target==='s2'&&method==='Target.setAutoAttach'&&!emitted){emitted=true;f.emit({sessionId:'s2',method:'Page.frameNavigated',params:{frame:{id:'child',parentId:'main',url:'https://ads.example/'}}});}
      return result;
    }) as typeof f.client.send;
    f.emit({method:'Target.attachedToTarget',params:{sessionId:'s2',targetInfo:{targetId:'t2',type:'page',url:''}}});
    const g=fake([]);withLinkHistory(g);
    await installFingerprint(g.client,{fingerprint:DEFAULT_FINGERPRINT,languages:['en-US'],seed:1});
    commitDuring(g,'s3','before-overrides');
    g.emit({method:'Target.attachedToTarget',params:{sessionId:'s3',targetInfo:{targetId:'t3',type:'page',url:''}}});
    await new Promise(r=>setTimeout(r,50));
    expect(f.calls).not.toContain('Page.reload:s2');
    expect(g.calls).not.toContain('Page.reload:s3');
  });
});

describe('nested workers',()=>{
  it('lets a worker attach its own workers before it runs, and instruments them',async()=>{
    const f=fake([]);
    await installFingerprint(f.client,{fingerprint:{...SPOOFED,hardware:{mode:'manual',cores:4,memoryGb:4}},languages:['en-US'],seed:1});
    f.emit({method:'Target.attachedToTarget',params:{sessionId:'w1',targetInfo:{targetId:'worker-1',type:'worker'}}});
    await new Promise(r=>setTimeout(r,20));
    const worker=f.calls.filter(call=>call.endsWith(':w1'));
    expect(worker).toContain('Target.setAutoAttach:w1');
    expect(worker.indexOf('Target.setAutoAttach:w1')).toBeLessThan(worker.indexOf('Runtime.runIfWaitingForDebugger:w1'));
    // The nested worker is announced on the parent worker's session.
    f.emit({sessionId:'w1',method:'Target.attachedToTarget',params:{sessionId:'w2',targetInfo:{targetId:'worker-2',type:'worker'}}});
    await new Promise(r=>setTimeout(r,20));
    expect(f.calls).toContain('Runtime.evaluate:w2');
    expect(f.calls).toContain('Runtime.runIfWaitingForDebugger:w2');
  });
});
