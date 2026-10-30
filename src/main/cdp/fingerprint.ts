import type { CdpClient, CdpMessage } from './client';
import type { Fingerprint } from '../../shared/fingerprint';
import { buildSpoofScript } from '../engines/spoof-script';
import { metadataFor } from '../../shared/user-agent';

export interface InstallOptions {
  fingerprint: Fingerprint;
  languages: string[];
  seed: number;
  engineUserAgent?: string;
  onPageFailure?: (reason: string) => void;
}

interface TargetInfo { targetId: string; type: string; url?: string }

function sessionIdOf(params: unknown): { sessionId: string; target: TargetInfo } | null {
  const p = params as { sessionId?: string; sessionInfo?: { sessionId: string }; targetInfo?: TargetInfo } | undefined;
  const sessionId = p?.sessionId ?? p?.sessionInfo?.sessionId;
  const target = p?.targetInfo;
  return sessionId && target ? { sessionId, target } : null;
}

export interface FingerprintSession { navigate(urls: string[]): Promise<void> }

const PAGE_WAIT_MS = 5000;
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
  const script = buildSpoofScript(fingerprint, seed);
  const metadata = fingerprint.userAgent && options.engineUserAgent ? metadataFor(fingerprint.userAgent, fingerprint.os, options.engineUserAgent) : null;

  const applyToPage = async (sessionId: string, targetId: string, critical = false): Promise<void> => {
    try {
      await client.send('Page.enable', {}, sessionId);
      await client.send('Page.addScriptToEvaluateOnNewDocument', { source: script }, sessionId);
      if (fingerprint.userAgent && metadata)
        await client.send('Network.setUserAgentOverride', { userAgent: fingerprint.userAgent, acceptLanguage: languages.join(','), userAgentMetadata: metadata }, sessionId);
      if (fingerprint.timezone.mode === 'manual') await client.send('Emulation.setTimezoneOverride', { timezoneId: fingerprint.timezone.value }, sessionId);
      if (fingerprint.geolocation.mode === 'manual') await client.send('Emulation.setGeolocationOverride', { latitude: fingerprint.geolocation.latitude, longitude: fingerprint.geolocation.longitude, accuracy: fingerprint.geolocation.accuracy }, sessionId);
      await client.send('Runtime.runIfWaitingForDebugger', {}, sessionId);
    } catch (error) {
      if (critical) throw error;
      try { await client.send('Target.closeTarget', { targetId }); } catch { /* target may already be gone */ }
      options.onPageFailure?.(error instanceof Error ? error.message : 'unknown');
    }
  };

  if (fingerprint.geolocation.mode === 'manual') await client.send('Browser.grantPermissions', { permissions: ['geolocation'] });

  client.onEvent(message => {
    if (message.method !== 'Target.attachedToTarget') return;
    const attached = sessionIdOf(message.params);
    if (!attached) return;
    if (attached.target.type === 'page' && !/^(devtools|chrome|chrome-extension|edge):/i.test(attached.target.url ?? '')) {
      void applyToPage(attached.sessionId, attached.target.targetId).then(async () => {
        // A target that arrives with a navigation already in flight (popups, window.open) can run
        // page scripts before overrides apply. Reload it once so the visible document is spoofed.
        const url = attached.target.url ?? '';
        if (url && url !== 'about:blank') await client.send('Page.reload', {}, attached.sessionId).catch(() => undefined);
      });
    }
    else void client.send('Runtime.runIfWaitingForDebugger', {}, attached.sessionId).catch(() => undefined);
  });
  await client.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  return {
    async navigate(urls: string[]): Promise<void> {
      const list = urls.length ? urls : ['about:blank'];
      const page = await waitForPage(client);
      const { sessionId } = await client.send<{ sessionId: string }>('Target.attachToTarget', { targetId: page.targetId, flatten: true });
      await applyToPage(sessionId, page.targetId, true);
      await client.send('Page.navigate', { url: list[0] }, sessionId);
      for (const url of list.slice(1)) {
        const { targetId } = await client.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
        const { sessionId: extra } = await client.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
        await applyToPage(extra, targetId, true);
        await client.send('Page.navigate', { url }, extra);
      }
    },
  };
}
