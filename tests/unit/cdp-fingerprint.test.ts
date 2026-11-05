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
}

function fake(pages: Array<{ targetId: string; type: string; url?: string }> = [{ targetId: 't1', type: 'page' }], emptyTargetLists = 0): Fake {
  const calls: string[] = [];const params: Record<string, unknown> = {};const listeners: Array<(m: CdpMessage) => void> = [];
  let rejectMethod = '';let targetLists = 0;
  const fakeClient = {
    send: async (method: string, p: Record<string, unknown> = {}, sessionId?: string) => {
      if (method === rejectMethod) throw Error('boom');
      calls.push(sessionId ? `${method}:${sessionId}` : method);params[method] = p;
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
  return { client: fakeClient as unknown as CdpClient, calls, params, emit: m => listeners.forEach(l => l(m)), rejectOn: m => { rejectMethod = m; } };
}

const windowsEngine = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
const windowsFull = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.80 Safari/537.36';
const SPOOFED = { ...DEFAULT_FINGERPRINT, canvas: 'noise' as const };
const macUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.80 Safari/537.36';

describe('installFingerprint', () => {
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
    f.emit({ method: 'Target.attachedToTarget', params: { sessionId: 's2', targetInfo: { targetId: 't2', type: 'page', url: 'https://example.com/checkout' } } });
    await new Promise(r => setTimeout(r, 30));
    expect(f.calls).not.toContain('Page.reload:s2');
    // The already-loaded document still gets the spoof script, without risking a POST resubmission.
    expect(f.calls).toContain('Runtime.evaluate:s2');
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
    await installFingerprint(f.client,{fingerprint:SPOOFED,languages:['en-US'],seed:1});
    f.emit({method:'Target.attachedToTarget',params:{sessionId:'s3',targetInfo:{targetId:'t3',type:'worker'}}});
    await new Promise(r=>setTimeout(r,20));
    expect(f.calls).toContain('Runtime.runIfWaitingForDebugger:s3');
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
 it('leaves internal devtools and chrome pages untouched',async()=>{
   const f=fake([]);
   await installFingerprint(f.client,{fingerprint:SPOOFED,languages:['ru-RU'],seed:1});
   f.emit({method:'Target.attachedToTarget',params:{sessionId:'s7',targetInfo:{targetId:'t7',type:'page',url:'devtools://devtools/bundled/inspector.html'}}});
   f.emit({method:'Target.attachedToTarget',params:{sessionId:'s8',targetInfo:{targetId:'t8',type:'page',url:'chrome://settings/'}}});
   await new Promise(r=>setTimeout(r,20));
   expect(f.calls).not.toContain('Page.enable:s7');
   expect(f.calls).not.toContain('Page.enable:s8');
 });
});
