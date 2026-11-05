import { expect, it } from 'vitest';
import type { CdpClient, CdpMessage } from '../../src/main/cdp/client';
import { installFingerprint } from '../../src/main/cdp/fingerprint';
import { DEFAULT_FINGERPRINT } from '../../src/shared/fingerprint';

it('ignores automation-owned attachments even when their page session has detached', async () => {
  const listeners: Array<(message: CdpMessage) => void> = [];
  const calls: Array<{ method: string; sessionId?: string; params: Record<string, unknown> }> = [];
  const client = {
    onEvent(listener: (message: CdpMessage) => void) { listeners.push(listener); },
    async send(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
      calls.push({ method, sessionId, params });
      if (sessionId === 'foreign-page') throw Error('Session with given id not found.');
      return {};
    },
  };
  await installFingerprint(client as unknown as CdpClient, { fingerprint: DEFAULT_FINGERPRINT, languages: ['en-US'], seed: 42 });
  for (const listener of listeners) listener({ method: 'Target.attachedToTarget', sessionId: 'automation-browser', params: { sessionId: 'foreign-page', targetInfo: { targetId: 'live-page', type: 'page', url: 'about:blank' } } });
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(calls.some(call => call.method === 'Target.closeTarget' && call.params.targetId === 'live-page')).toBe(false);
  expect(calls.some(call => call.sessionId === 'foreign-page')).toBe(false);
});

it.each(['worker', 'shared_worker', 'service_worker'])('revokes stale %s installation before a replacement resumes', async type => {
  const listeners: Array<(message: CdpMessage) => void> = [];
  const calls: Array<{ method: string; sessionId?: string }> = [];
  let rejectOld: (error: Error) => void = () => {};
  const client = {
    onEvent(listener: (message: CdpMessage) => void) { listeners.push(listener); },
    async send(method: string, _params: Record<string, unknown> = {}, sessionId?: string) {
      calls.push({ method, sessionId });
      if (method === 'Runtime.evaluate' && sessionId === 'old') return await new Promise((_, reject) => { rejectOld = reject; });
      return {};
    },
  };
  await installFingerprint(client as unknown as CdpClient, { fingerprint: { ...DEFAULT_FINGERPRINT, hardware: { mode: 'manual', cores: 12, memoryGb: 8 } }, languages: ['en-US'], seed: 42 });
  const emit = (message: CdpMessage) => listeners.forEach(listener => listener(message));
  emit({ method: 'Target.attachedToTarget', params: { sessionId: 'old', targetInfo: { targetId: 'worker-target', type } } });
  await new Promise<void>(resolve => setImmediate(resolve));
  emit({ method: 'Target.detachedFromTarget', params: { sessionId: 'old' } });
  emit({ method: 'Target.attachedToTarget', params: { sessionId: 'new', targetInfo: { targetId: 'worker-target', type } } });
  rejectOld(Error('Session with given id not found.'));
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(calls).toContainEqual({ method: 'Runtime.evaluate', sessionId: 'new' });
  expect(calls).toContainEqual({ method: 'Runtime.runIfWaitingForDebugger', sessionId: 'new' });
  expect(calls.some(call => call.method === 'Target.closeTarget')).toBe(false);
});

it.each(['parent detach', 'target destruction'])('revokes pending child installation after %s', async action => {
  const listeners: Array<(message: CdpMessage) => void> = [];
  const calls: string[] = [];
  let rejectChild: (error: Error) => void = () => {};
  const client = {
    onEvent(listener: (message: CdpMessage) => void) { listeners.push(listener); },
    async send(method: string, _params: Record<string, unknown> = {}, sessionId?: string) {
      calls.push(method);
      if (method === 'Page.enable' && sessionId === 'child') return await new Promise((_, reject) => { rejectChild = reject; });
      return {};
    },
  };
  await installFingerprint(client as unknown as CdpClient, { fingerprint: DEFAULT_FINGERPRINT, languages: ['en-US'], seed: 42 });
  const emit = (message: CdpMessage) => listeners.forEach(listener => listener(message));
  emit({ method: 'Target.attachedToTarget', params: { sessionId: 'parent', targetInfo: { targetId: 'page', type: 'page', url: 'about:blank' } } });
  emit({ method: 'Target.attachedToTarget', sessionId: 'parent', params: { sessionId: 'child', targetInfo: { targetId: 'frame', type: 'iframe', url: 'about:blank' } } });
  await new Promise<void>(resolve => setImmediate(resolve));
  if (action === 'parent detach') emit({ method: 'Target.detachedFromTarget', params: { sessionId: 'parent' } });
  else emit({ method: 'Target.targetDestroyed', params: { targetId: 'frame' } });
  rejectChild(Error('Session with given id not found.'));
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(calls).not.toContain('Target.closeTarget');
});

it('does not close a target after the installer session detached during installation', async () => {
  const listeners: Array<(message: CdpMessage) => void> = [];
  const calls: string[] = [];
  let rejectEnable: (error: Error) => void = () => {};
  const client = {
    onEvent(listener: (message: CdpMessage) => void) { listeners.push(listener); },
    async send(method: string, _params: Record<string, unknown> = {}, sessionId?: string) {
      calls.push(method);
      if (method === 'Page.enable' && sessionId === 'installer-page') return await new Promise((_, reject) => { rejectEnable = reject; });
      return {};
    },
  };
  await installFingerprint(client as unknown as CdpClient, { fingerprint: DEFAULT_FINGERPRINT, languages: ['en-US'], seed: 42 });
  const emit = (message: CdpMessage) => listeners.forEach(listener => listener(message));
  emit({ method: 'Target.attachedToTarget', params: { sessionId: 'installer-page', targetInfo: { targetId: 'live-page', type: 'page', url: 'about:blank' } } });
  emit({ method: 'Target.detachedFromTarget', params: { sessionId: 'installer-page' } });
  rejectEnable(Error('Session with given id not found.'));
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(calls).not.toContain('Target.closeTarget');
});
