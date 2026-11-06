import { randomUUID } from 'node:crypto';
import type { CdpClient, CdpMessage } from './client';
import type { Fingerprint } from '../../shared/fingerprint';
import { buildSpoofScript, buildWorkerSpoofScript, deriveScreenAvailability, type ScreenAvailability } from '../engines/spoof-script';
import { metadataFor, navigatorPlatformByOs, reduceUserAgent, uaForOs } from '../../shared/user-agent';

export interface InstallOptions {
  fingerprint: Fingerprint;
  languages: string[];
  seed: number;
  engineUserAgent?: string;
  engineVersion?: string;
  onPageFailure?: (reason: string) => void;
  /** Test-only override for the readiness deadline. */
  readyTimeoutMs?: number;
}

interface TargetInfo { targetId: string; type: string; url?: string }

function sessionIdOf(params: unknown): { sessionId: string; target: TargetInfo } | null {
  const p = params as { sessionId?: string; sessionInfo?: { sessionId: string }; targetInfo?: TargetInfo } | undefined;
  const sessionId = p?.sessionId ?? p?.sessionInfo?.sessionId;
  const target = p?.targetInfo;
  return sessionId && target ? { sessionId, target } : null;
}

export interface FingerprintSession {
  navigate(urls: string[]): Promise<void>;
  /** Resolves after the first page finished loading with the spoof script installed. */
  ready(): Promise<void>;
  /** Page targets currently known to the browser, in discovery order. */
  pages(): Promise<TargetInfo[]>;
  /** Reuses this installer's page session when it exists, otherwise creates one. */
  attach(targetId: string): Promise<string>;
}

const PAGE_WAIT_MS = 5000;
const READY_WAIT_MS = 15000;
async function waitForPage(client: CdpClient): Promise<TargetInfo> {
  const deadline = Date.now() + PAGE_WAIT_MS;
  for (;;) {
    const { targetInfos } = await client.send<{ targetInfos: TargetInfo[] }>('Target.getTargets', {});
    const page = targetInfos.find(t => t.type === 'page');
    if (page) return page;
    if (Date.now() >= deadline) throw Error('FINGERPRINT_UNAVAILABLE');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

export async function installFingerprint(client: CdpClient, options: InstallOptions): Promise<FingerprintSession> {
  const { fingerprint, languages, seed } = options;
  const workerScript = buildWorkerSpoofScript(fingerprint, seed);
  // The emulated screen keeps the host display's work-area inset, so it is computed per page
  // from the real widget before the override is applied.
  let screenAvailability: ScreenAvailability | undefined;
  const pageScript = (): string => buildSpoofScript(fingerprint, seed, screenAvailability);
  // Chrome for Testing is Chromium-branded: its own Sec-CH-UA omits "Google Chrome", which both
  // leaks a non-Chrome browser and makes google.com offer to "download Chrome". Always send
  // Chrome-branded Client Hints; without a custom UA keep the fingerprint OS so the UA string,
  // platform and hints describe the same platform. See DECISIONS.md #60.
  const effectiveUa = fingerprint.userAgent
    ? reduceUserAgent(fingerprint.userAgent)
    : options.engineUserAgent
      ? (options.engineVersion ? uaForOs(fingerprint.os, options.engineVersion) : reduceUserAgent(options.engineUserAgent))
      : '';
  const metadata = effectiveUa ? metadataFor(fingerprint.userAgent ?? effectiveUa, fingerprint.os, options.engineVersion ?? options.engineUserAgent) : null;
  const pageSessions = new Map<string, { sessionId: string; ready: Promise<void> }>();
  const geoGuardUrl = `exodus-geo-guard://${randomUUID()}`;
  // Only the newest guard script of a session can pause a live document; keeping one id
  // per session bounds memory for long-lived tabs.
  const geoGuardScripts = new Map<string, string>();
  // Internal pages are instrumented so a later web document is covered, but a tab the user
  // opened for chrome://settings must never be closed because instrumentation failed there.
  const internalTargets = new Set<string>();
  // Other consumers may attach their own browser sessions on this pipe. Only follow
  // attachment trees rooted in this installer's page/worker sessions.
  const ownedSessions = new Map<string, { targetId: string; parent?: string }>();
  const revokeSession = (sessionId: string): void => {
    const owned = ownedSessions.get(sessionId);
    if (!owned) return;
    ownedSessions.delete(sessionId);
    geoGuardScripts.delete(sessionId);
    for (const [child, info] of ownedSessions) if (info.parent === sessionId) revokeSession(child);
    if (pageSessions.get(owned.targetId)?.sessionId === sessionId) pageSessions.delete(owned.targetId);
    workerEvaluations.delete(owned.targetId);
  };

  const readRealScreen = async (sessionId: string): Promise<{ screen: { width: number; height: number; availWidth: number; availHeight: number }; dpr: number } | null> => {
    try {
      const { result } = await client.send<{ result: { value?: { screen?: { width: number; height: number; availWidth: number; availHeight: number }; dpr?: number } } }>(
        'Runtime.evaluate',
        { expression: '({screen:{width:screen.width,height:screen.height,availWidth:screen.availWidth,availHeight:screen.availHeight},dpr:devicePixelRatio})', returnByValue: true },
        sessionId,
      );
      const value = result?.value;
      if (!value?.screen || typeof value.screen.width !== 'number' || typeof value.screen.availWidth !== 'number') return null;
      return { screen: value.screen, dpr: typeof value.dpr === 'number' ? value.dpr : 1 };
    } catch { return null; }
  };

  /**
   * A script-only screen override leaves CSS media queries on the real display, so the profile
   * reports one size in JS and another in @media. Emulation.setDeviceMetricsOverride moves the
   * screen (and device pixel ratio) inside Chromium itself, which media queries honour; a page
   * size of zero keeps the real window layout so resizing still works. See DECISIONS.md #63.
   */
  const applyScreenEmulation = async (sessionId: string): Promise<void> => {
    const screen = fingerprint.screen;
    if (screen.mode !== 'manual') return;
    const real = await readRealScreen(sessionId);
    if (!real) throw Error('SCREEN_METRICS_UNAVAILABLE');
    screenAvailability = deriveScreenAvailability(screen, real.screen);
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 0, height: 0,
      screenWidth: screen.width, screenHeight: screen.height,
      deviceScaleFactor: screen.dpr ?? real.dpr,
      mobile: false,
      dontSetVisibleSize: true,
    }, sessionId);
  };

  const runApplyToPage = async (sessionId: string, targetId: string, topLevel: boolean): Promise<void> => {
    await client.send('Page.enable', {}, sessionId);
    if (topLevel && fingerprint.geolocation.mode === 'manual') {
      await client.send('Debugger.enable', {}, sessionId);
      await client.send('Page.addScriptToEvaluateOnNewDocument', { source: `if(location.protocol !== 'chrome:') debugger;\n//# sourceURL=${geoGuardUrl}` }, sessionId);
    }
    await client.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true,filter:[{type:'service_worker',exclude:true},{}] }, sessionId);
    if (topLevel && fingerprint.screen.mode === 'manual') await applyScreenEmulation(sessionId);
    const script = pageScript();
    if (script) await client.send('Page.addScriptToEvaluateOnNewDocument', { source: `if(location.protocol !== 'chrome:'){${script}\n}` }, sessionId);
    if (effectiveUa && metadata)
      await client.send('Network.setUserAgentOverride', { userAgent: effectiveUa, acceptLanguage: languages.join(','), platform: navigatorPlatformByOs[fingerprint.os], userAgentMetadata: metadata }, sessionId);
    if (fingerprint.timezone.mode === 'manual') await client.send('Emulation.setTimezoneOverride', { timezoneId: fingerprint.timezone.value }, sessionId);
    if (fingerprint.geolocation.mode === 'manual') await client.send('Emulation.setGeolocationOverride', { latitude: fingerprint.geolocation.latitude, longitude: fingerprint.geolocation.longitude, accuracy: fingerprint.geolocation.accuracy }, sessionId);
    await client.send('Runtime.runIfWaitingForDebugger', {}, sessionId);
  };

  const applyToPage = async (sessionId: string, targetId: string, topLevel = false, critical = false): Promise<void> => {
    let existing = pageSessions.get(targetId);
    if (!existing) {
      const ready = runApplyToPage(sessionId, targetId, topLevel);
      existing = { sessionId, ready };
      pageSessions.set(targetId, existing);
    }
    try {
      await existing.ready;
    } catch (error) {
      if (critical) throw error;
      // A detached session no longer authorizes this asynchronous installation to
      // close a target that may already have a replacement session. It must still
      // never leave the target paused.
      if (!ownedSessions.has(existing.sessionId)) { await client.send('Runtime.runIfWaitingForDebugger', {}, existing.sessionId).catch(() => undefined); return; }
      // An internal page belongs to the user, not to the fingerprint: release it instead of
      // closing the tab they opened.
      if (internalTargets.has(targetId)) { await client.send('Runtime.runIfWaitingForDebugger', {}, existing.sessionId).catch(() => undefined); return; }
      try { await client.send('Target.closeTarget', { targetId }); } catch { /* target may already be gone */ }
      options.onPageFailure?.(error instanceof Error ? error.message : 'unknown');
    }
  };

  const workerEvaluations=new Map<string,Promise<void>>();
  const applyToWorker = async (sessionId: string, targetId: string): Promise<void> => {
    try {
      if (fingerprint.timezone.mode === 'manual')
        await client.send('Emulation.setTimezoneOverride', { timezoneId: fingerprint.timezone.value }, sessionId);
      if (effectiveUa && metadata)
        await client.send('Network.setUserAgentOverride', { userAgent: effectiveUa, acceptLanguage: languages.join(','), platform: navigatorPlatformByOs[fingerprint.os], userAgentMetadata: metadata }, sessionId);
      if (workerScript) {
        let evaluation=workerEvaluations.get(targetId);
        if(!evaluation){evaluation=client.send<{exceptionDetails?:unknown}>('Runtime.evaluate',{expression:workerScript},sessionId).then(result=>{if(result.exceptionDetails)throw Error('FINGERPRINT_UNAVAILABLE');});workerEvaluations.set(targetId,evaluation);}
        await evaluation;
      }
      await client.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => undefined);
    } catch (error) {
      if (!ownedSessions.has(sessionId)) { await client.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => undefined); return; }
      // A paused target must never be left paused: Chromium refuses to close dedicated workers,
      // so a failed override falls back to resuming the target (fail-open) instead of hanging the page.
      try { await client.send('Target.closeTarget', { targetId }); }
      catch { await client.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => undefined); }
      options.onPageFailure?.(error instanceof Error ? error.message : 'unknown');
    }
  };

  if (fingerprint.geolocation.mode === 'manual') await client.send('Browser.grantPermissions', { permissions: ['geolocation'] });
  if (fingerprint.geolocation.mode === 'block') await client.send('Browser.setPermission', { permission: { name: 'geolocation' }, setting: 'denied' });

  client.onEvent(message => {
    if (message.sessionId && !ownedSessions.has(message.sessionId)) return;
    if (message.method === 'Debugger.scriptParsed' && message.sessionId) {
      const parsed = message.params as { url?: string; scriptId?: string } | undefined;
      if (parsed?.url === geoGuardUrl && parsed.scriptId) geoGuardScripts.set(message.sessionId, parsed.scriptId);
      return;
    }
    if (message.method === 'Debugger.paused' && message.sessionId) {
      const paused = message.params as { callFrames?: Array<{ location?: { scriptId?: string } }> } | undefined;
      const scriptId = paused?.callFrames?.[0]?.location?.scriptId;
      const sessionId = message.sessionId;
      const geo = fingerprint.geolocation;
      // A page's own `debugger;` statement or any other pause is not ours to hold: enabling the
      // Debugger domain must stay transparent, exactly as when no debugger is attached.
      if (geo.mode !== 'manual' || scriptId === undefined || geoGuardScripts.get(sessionId) !== scriptId) {
        void client.send('Debugger.resume', {}, sessionId).catch(() => undefined);
        return;
      }
      const targetId = ownedSessions.get(sessionId)?.targetId;
      void (async () => {
        try {
          await client.send('Emulation.setGeolocationOverride', { latitude: geo.latitude, longitude: geo.longitude, accuracy: geo.accuracy }, sessionId);
        } catch {
          if (targetId && ownedSessions.get(sessionId)?.targetId === targetId) await client.send('Target.closeTarget', { targetId }).catch(() => undefined);
          options.onPageFailure?.('FINGERPRINT_UNAVAILABLE');
          return;
        }
        if (ownedSessions.get(sessionId)?.targetId === targetId) await client.send('Debugger.resume', {}, sessionId).catch(() => undefined);
      })();
      return;
    }
    if(message.method==='Target.targetDestroyed'){const targetId=(message.params as {targetId?:string}|undefined)?.targetId;if(targetId){for(const [sessionId,info] of ownedSessions)if(info.targetId===targetId)revokeSession(sessionId);workerEvaluations.delete(targetId);pageSessions.delete(targetId);}return;}
    if(message.method==='Target.detachedFromTarget'){
      const detached=message.params as {targetId?:string;sessionId?:string}|undefined;
      if(detached?.sessionId)revokeSession(detached.sessionId);
      return;
    }
    if (message.method !== 'Target.attachedToTarget') return;
    const attached = sessionIdOf(message.params);
    if (!attached) return;
    const installable = ['page','iframe','worker','shared_worker','service_worker'].includes(attached.target.type);
    if (installable) ownedSessions.set(attached.sessionId,{targetId:attached.target.targetId,parent:message.sessionId});    if (attached.target.type === 'page' && !/^(devtools|chrome-extension|edge):/i.test(attached.target.url ?? '')) {
      if (/^chrome:/i.test(attached.target.url ?? '')) internalTargets.add(attached.target.targetId);
      void applyToPage(attached.sessionId, attached.target.targetId, true).then(async () => {
        // A target that arrives with a navigation already in flight (popups, window.open) can run
        // page scripts before overrides apply. Reload it once so the visible document is spoofed.
        const url = attached.target.url ?? '';
        if (url && url !== 'about:blank' && !/^chrome:/i.test(url)) {
          let reload = true;
          try {
            const history = await client.send<{ currentIndex: number; entries: Array<{ transitionType?: string }> }>('Page.getNavigationHistory', {}, attached.sessionId);
            const current = history.entries[history.currentIndex];
            if (current?.transitionType === 'form_submit') reload = false;
          } catch { reload = false; }
          if (reload) await client.send('Page.reload', {}, attached.sessionId).catch(() => undefined);
          // Reloading is unsafe for POST results and may be unavailable, but the document that is
          // already loaded was created before the injected script existed. Patch it in place so a
          // tab opened by hand is not left with the real hardware fingerprint.
          else { const patch = pageScript(); if (patch) await client.send('Runtime.evaluate', { expression: patch }, attached.sessionId).catch(() => undefined); }
        }
      });
    } else if (attached.target.type === 'iframe') {
      void applyToPage(attached.sessionId, attached.target.targetId);
    } else if (['worker', 'shared_worker', 'service_worker'].includes(attached.target.type)) {
      void applyToWorker(attached.sessionId, attached.target.targetId);
    } else void client.send('Runtime.runIfWaitingForDebugger', {}, attached.sessionId).catch(() => undefined);
  });
  await client.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });

  const ensurePageSession = async (targetId: string): Promise<string> => {
    const existing = pageSessions.get(targetId);
    if (existing) {
      await existing.ready;
      return existing.sessionId;
    }
    const { sessionId } = await client.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
    await applyToPage(sessionId, targetId, true, true);
    return pageSessions.get(targetId)?.sessionId ?? sessionId;
  };

  return {
    async pages(): Promise<TargetInfo[]> {
      const { targetInfos } = await client.send<{ targetInfos: TargetInfo[] }>('Target.getTargets', {});
      return targetInfos.filter(target => target.type === 'page');
    },
    attach: ensurePageSession,
    async navigate(urls: string[]): Promise<void> {
      const list = urls.length ? urls : ['about:blank'];
      const page = await waitForPage(client);
      const sessionId = await ensurePageSession(page.targetId);
      await client.send('Page.navigate', { url: list[0] }, sessionId);
      for (const url of list.slice(1)) {
        const { targetId } = await client.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
        const extra = await ensurePageSession(targetId);
        await client.send('Page.navigate', { url }, extra);
      }
    },
    /**
     * Automation must not touch a target before its first document runs with the spoof script.
     * Polling the main session's readyState is the same condition a page script sees, and it
     * fails closed instead of exposing real values.
     */
    async ready(): Promise<void> {
      const deadline = Date.now() + (options.readyTimeoutMs ?? READY_WAIT_MS);
      let sessionId: string | undefined;
      for (;;) {
        const { targetInfos } = await client.send<{ targetInfos: TargetInfo[] }>('Target.getTargets', {});
        const page = targetInfos.find(t => t.type === 'page');
        if (page) sessionId = await ensurePageSession(page.targetId);
        if (sessionId) {
          try {
            const state = await client.send<{ result: { value?: string } }>('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }, sessionId);
            if (state.result?.value === 'complete') return;
          } catch { /* navigation in flight: retry until the deadline */ }
        }
        if (Date.now() >= deadline) throw Error('FINGERPRINT_UNAVAILABLE');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    },
  };
}
