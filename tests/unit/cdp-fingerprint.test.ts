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

function fake(pages: Array<{ targetId: string; type: string }> = [{ targetId: 't1', type: 'page' }], emptyTargetLists = 0): Fake {
  const calls: string[] = [];const params: Record<string, unknown> = {};const listeners: Array<(m: CdpMessage) => void> = [];
  let rejectMethod = '';let targetLists = 0;
  const fakeClient = {
    send: async (method: string, p: Record<string, unknown> = {}, sessionId?: string) => {
      if (method === rejectMethod) throw Error('boom');
      calls.push(sessionId ? `${method}:${sessionId}` : method);params[method] = p;
      if (method === 'Target.setAutoAttach') for (const page of pages) listeners.forEach(l => l({ method: 'Target.attachedToTarget', params: { sessionId: page.targetId.replace('t', 's'), targetInfo: page } }));
      if (method === 'Target.getTargets') { if (targetLists++ < emptyTargetLists) return { targetInfos: [] }; return { targetInfos: pages }; }
      if (method === 'Target.createTarget') return { targetId: 't2' };
      if (method === 'Target.attachToTarget') return { sessionId: (p.targetId as string).replace('t', 's') };
      return {};
    },
    onEvent: (cb: (m: CdpMessage) => void) => listeners.push(cb),
    close: () => {},
  };
  return { client: fakeClient as unknown as CdpClient, calls, params, emit: m => listeners.forEach(l => l(m)), rejectOn: m => { rejectMethod = m; } };
}

const windowsEngine = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.80 Safari/537.36';
const macUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.80 Safari/537.36';

describe('installFingerprint', () => {
  it('sets native parameters and a script for each page', async () => {
    const f = fake();
    await installFingerprint(f.client, {
      fingerprint: {
        ...DEFAULT_FINGERPRINT, userAgent: macUa, canvas: 'noise',
        timezone: { mode: 'manual', value: 'Europe/Moscow' },
        geolocation: { mode: 'manual', latitude: 55.75, longitude: 37.61, accuracy: 30 },
      },
      languages: ['ru-RU'], seed: 1, engineUserAgent: windowsEngine,
    });
    await new Promise(r => setTimeout(r, 20));
    expect(f.calls).toContain('Target.setAutoAttach');
    expect(f.calls).toContain('Page.addScriptToEvaluateOnNewDocument:s1');
    expect(f.calls).toContain('Network.setUserAgentOverride:s1');
    expect(f.calls).toContain('Emulation.setTimezoneOverride:s1');
    expect(f.calls).toContain('Emulation.setGeolocationOverride:s1');
    expect(f.calls).toContain('Browser.grantPermissions');
    expect(f.calls).toContain('Runtime.runIfWaitingForDebugger:s1');
    expect(JSON.stringify(f.params['Network.setUserAgentOverride'])).toContain('userAgentMetadata');
    expect(JSON.stringify(f.params['Page.addScriptToEvaluateOnNewDocument'])).toContain('source');
  });

  it('does not override UA, time or geolocation in auto mode', async () => {
    const f = fake();
    await installFingerprint(f.client, { fingerprint: DEFAULT_FINGERPRINT, languages: ['ru-RU'], seed: 1, engineUserAgent: windowsEngine });
    await new Promise(r => setTimeout(r, 20));
    expect(f.calls).not.toContain('Network.setUserAgentOverride:s1');
    expect(f.calls).not.toContain('Emulation.setTimezoneOverride:s1');
    expect(f.calls).not.toContain('Emulation.setGeolocationOverride:s1');
    expect(f.calls).not.toContain('Browser.grantPermissions');
  });

  it('uses a launch flag for UA without a platform change, not a CDP override', async () => {
    const f = fake();
    await installFingerprint(f.client, {
      fingerprint: { ...DEFAULT_FINGERPRINT, userAgent: windowsEngine },
      languages: ['ru-RU'], seed: 1, engineUserAgent: windowsEngine,
    });
    await new Promise(r => setTimeout(r, 20));
    expect(f.calls).not.toContain('Network.setUserAgentOverride:s1');
  });

  it('failure on a new page closes that page but not the session', async () => {
    const f = fake([]);
    const failures: string[] = [];
    await installFingerprint(f.client, { fingerprint: DEFAULT_FINGERPRINT, languages: ['ru-RU'], seed: 1, onPageFailure: r => failures.push(r) });
    f.rejectOn('Page.addScriptToEvaluateOnNewDocument');
    f.emit({ method: 'Target.attachedToTarget', params: { sessionId: 's9', targetInfo: { targetId: 't9', type: 'page' } } });
    await new Promise(r => setTimeout(r, 20));
    expect(failures).toHaveLength(1);
    expect(f.calls).toContain('Target.closeTarget');
    expect(f.params['Target.closeTarget']).toEqual({ targetId: 't9' });
  });

  it('does not treat a worker as a page and still releases it', async () => {
    const f = fake([]);
    await installFingerprint(f.client, { fingerprint: DEFAULT_FINGERPRINT, languages: ['ru-RU'], seed: 1 });
    f.emit({ method: 'Target.attachedToTarget', params: { sessionId: 's3', targetInfo: { targetId: 't3', type: 'worker' } } });
    await new Promise(r => setTimeout(r, 20));
    expect(f.calls).toContain('Runtime.runIfWaitingForDebugger:s3');
    expect(f.calls).not.toContain('Page.addScriptToEvaluateOnNewDocument:s3');
  });
});

describe('navigate', () => {
  it('opens the first URL in the existing page and the rest in new tabs', async () => {
    const f = fake([{ targetId: 't1', type: 'page' }]);
    const session = await installFingerprint(f.client, { fingerprint: DEFAULT_FINGERPRINT, languages: ['ru-RU'], seed: 1 });
    f.calls.length = 0;
    await session.navigate(['https://a.example', 'https://b.example']);
    expect(f.calls).toContain('Page.addScriptToEvaluateOnNewDocument:s1');
    expect(f.params['Page.navigate']).toEqual({ url: 'https://b.example' });
    expect(f.calls).toContain('Page.navigate:s1');
    expect(f.params['Target.createTarget']).toEqual({ url: 'about:blank' });
  });

  it('waits for the first page after browser startup', async () => {
    const f = fake(undefined, 2);
    const session = await installFingerprint(f.client, { fingerprint: DEFAULT_FINGERPRINT, languages: ['ru-RU'], seed: 1 });
    f.calls.length = 0;
    await session.navigate(['https://a.example']);
    expect(f.calls).toContain('Page.navigate:s1');
  });

  it('application failure on the first page fails navigation', async () => {
    const f = fake([{ targetId: 't1', type: 'page' }]);
    const session = await installFingerprint(f.client, { fingerprint: DEFAULT_FINGERPRINT, languages: ['ru-RU'], seed: 1 });
    f.rejectOn('Page.addScriptToEvaluateOnNewDocument');
    await expect(session.navigate(['https://a.example'])).rejects.toThrow('boom');
  });
});
describe('service targets',()=>{
 it('leaves internal devtools and chrome pages untouched',async()=>{
   const f=fake([]);
   await installFingerprint(f.client,{fingerprint:DEFAULT_FINGERPRINT,languages:['ru-RU'],seed:1});
   f.emit({method:'Target.attachedToTarget',params:{sessionId:'s7',targetInfo:{targetId:'t7',type:'page',url:'devtools://devtools/bundled/inspector.html'}}});
   f.emit({method:'Target.attachedToTarget',params:{sessionId:'s8',targetInfo:{targetId:'t8',type:'page',url:'chrome://settings/'}}});
   await new Promise(r=>setTimeout(r,20));
   expect(f.calls).not.toContain('Page.enable:s7');
   expect(f.calls).not.toContain('Page.enable:s8');
 });
});
