import { it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import type { CdpMessage } from '../../src/main/cdp/client';
import { startAutomationBridge, type Bridge } from '../fixtures/automation/bridge';

type SendCall = { method: string; params: Record<string, unknown>; sessionId?: string };

type FakeClient = {
  send(method: string, params?: Record<string, unknown>, sessionId?: string, timeoutMs?: number): Promise<unknown>;
  onEvent(listener: (message: CdpMessage) => void): void;
  emit(message: CdpMessage): void;
  calls: SendCall[];
  closeCount: number;
};

function fakeClient(): FakeClient {
  const listeners: Array<(message: CdpMessage) => void> = [];
  const calls: SendCall[] = [];
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let nextId = 1;
  const client: FakeClient = {
    async send(method, params = {}, sessionId) {
      const id = nextId++;
      calls.push({ method, params, sessionId });
      if (method === 'Target.detachFromTarget') return {};
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    onEvent(listener) { listeners.push(listener); },
    emit(message) { for (const listener of [...listeners]) listener(message); },
    calls,
    closeCount: 0,
  };
  // Tests resolve sends through respond(); keep a handle on the fake internals.
  (client as unknown as { respond: (method: string, value: unknown) => void; fail: (method: string, error: Error) => void }).respond = (method, value) => {
    const index = calls.map(c => c.method).lastIndexOf(method);
    expect(index, `no pending ${method} call`).toBeGreaterThanOrEqual(0);
    const id = index + 1;
    const entry = pending.get(id);
    if (entry) { pending.delete(id); entry.resolve(value); }
  };
  return client;
}

const openSocket = (url: string, headers: Record<string, string>) =>
  new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    ws.once('open', () => resolve(ws));
    ws.once('unexpected-response', (_req, res) => reject(Error(`rejected with ${res.statusCode}`)));
    ws.once('error', error => reject(error));
  });

function nextMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    ws.once('message', data => { try { resolve(JSON.parse(String(data))); } catch (error) { reject(error); } });
    ws.once('close', () => reject(Error('closed before message')));
  });
}

const sendCommand = (ws: WebSocket, message: unknown) => ws.send(JSON.stringify(message));

let cleanup: Array<() => void> = [];
afterEach(() => { for (const fn of cleanup) fn(); cleanup = []; });

it('rejects missing and incorrect authorization', async () => {
  const client = fakeClient();
  const bridge = await startAutomationBridge(client as never);
  cleanup.push(() => void bridge.close());
  await expect(openSocket(bridge.endpoint, {})).rejects.toThrow('rejected with 401');
  await expect(openSocket(bridge.endpoint, { Authorization: 'Bearer wrong' })).rejects.toThrow('rejected with 401');
  expect(client.calls.map(c => c.method)).not.toContain('Target.attachToBrowserTarget');
});

it('does not dispatch queued commands after disposal during browser attachment', async () => {
  const client = fakeClient();
  const fake = client as unknown as { respond: (method: string, value: unknown) => void };
  const bridge = await startAutomationBridge(client as never);
  const ws = await openSocket(bridge.endpoint, bridge.headers);
  sendCommand(ws, { id: 1, method: 'Browser.close', params: {} });
  await new Promise<void>(resolve => setTimeout(resolve, 20));
  await bridge.close();
  fake.respond('Target.attachToBrowserTarget', { sessionId: 'browser-a' });
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(client.calls.map(call => call.method)).not.toContain('Browser.close');
});

it('rejects foreign Host and Origin', async () => {
  const client = fakeClient();
  const bridge = await startAutomationBridge(client as never);
  cleanup.push(() => void bridge.close());
  await expect(openSocket(bridge.endpoint, { ...bridge.headers, Origin: 'http://evil.example' })).rejects.toThrow('rejected with 403');
  await expect(openSocket(bridge.endpoint, { ...bridge.headers, Host: 'evil.example' })).rejects.toThrow('rejected with 403');
  expect(client.calls.length).toBe(0);
});

it('routes root commands through an isolated browser session', async () => {
  const client = fakeClient();
  const fake = client as unknown as { respond: (method: string, value: unknown) => void };
  const bridge = await startAutomationBridge(client as never);
  cleanup.push(() => void bridge.close());
  const ws = await openSocket(bridge.endpoint, bridge.headers);
  const response = nextMessage(ws);
  await new Promise(r => setTimeout(r, 50));
  expect(client.calls[0]?.method).toBe('Target.attachToBrowserTarget');
  fake.respond('Target.attachToBrowserTarget', { sessionId: 'browser-a' });
  await new Promise(r => setTimeout(r, 20));
  sendCommand(ws, { id: 41, method: 'Target.getTargets', params: {} });
  await new Promise(r => setTimeout(r, 20));
  expect(client.calls[1]).toMatchObject({ method: 'Target.getTargets', sessionId: 'browser-a' });
  fake.respond('Target.getTargets', { targetInfos: [] });
  expect(await response).toEqual({ id: 41, result: { targetInfos: [] } });
  ws.close();
});

it('preserves nested session routing', async () => {
  const client = fakeClient();
  const fake = client as unknown as { respond: (method: string, value: unknown) => void };
  const bridge = await startAutomationBridge(client as never);
  cleanup.push(() => void bridge.close());
  const ws = await openSocket(bridge.endpoint, bridge.headers);
  fake.respond('Target.attachToBrowserTarget', { sessionId: 'browser-a' });
  await new Promise(r => setTimeout(r, 10));
  // Playwright enables auto-attach on the browser session; Chromium reports the child session back.
  client.emit({ method: 'Target.attachedToTarget', sessionId: 'browser-a', params: { sessionId: 'child-1', targetInfo: { targetId: 't1', type: 'page' } } });
  await new Promise(r => setTimeout(r, 20));
  const answer = nextMessage(ws);
  sendCommand(ws, { id: 7, method: 'Runtime.evaluate', params: { expression: '1' }, sessionId: 'child-1' });
  await new Promise(r => setTimeout(r, 20));
  expect(client.calls.at(-1)).toMatchObject({ method: 'Runtime.evaluate', sessionId: 'child-1' });
  fake.respond('Runtime.evaluate', { result: { value: 1 } });
  expect(await answer).toEqual({ id: 7, sessionId: 'child-1', result: { result: { value: 1 } } });
  // Nested events keep their session; root events strip only the outer browser session.
  const nested = nextMessage(ws);
  client.emit({ method: 'Runtime.consoleAPICalled', sessionId: 'child-1', params: { kind: 'log' } });
  expect(await nested).toEqual({ method: 'Runtime.consoleAPICalled', sessionId: 'child-1', params: { kind: 'log' } });
  const root = nextMessage(ws);
  client.emit({ method: 'Target.targetCreated', sessionId: 'browser-a', params: { targetInfo: { targetId: 't2', type: 'page' } } });
  expect(await root).toEqual({ method: 'Target.targetCreated', params: { targetInfo: { targetId: 't2', type: 'page' } } });
  // Unrelated sessions are never forwarded.
  const unrelated = nextMessage(ws);
  client.emit({ method: 'Runtime.consoleAPICalled', sessionId: 'someone-else', params: {} });
  client.emit({ method: 'Foo.event', params: {} });
  await expect(Promise.race([unrelated, new Promise((_, r2) => setTimeout(() => r2(Error('forwarded')), 100))])).rejects.toThrow('forwarded');
  // Detaching invalidates the nested session.
  client.emit({ method: 'Target.detachedFromTarget', sessionId: 'browser-a', params: { sessionId: 'child-1', targetId: 't1' } });
  await new Promise(r => setTimeout(r, 20));
  const stale = nextMessage(ws);
  sendCommand(ws, { id: 8, method: 'Runtime.evaluate', params: {}, sessionId: 'child-1' });
  expect(await stale).toMatchObject({ id: 8, sessionId: 'child-1', error: { message: expect.stringContaining('unknown session') } });
  ws.close();
});

it('keeps command ids independent', async () => {
  const client = fakeClient();
  const fake = client as unknown as { respond: (method: string, value: unknown) => void };
  const bridge = await startAutomationBridge(client as never);
  cleanup.push(() => void bridge.close());
  const ws = await openSocket(bridge.endpoint, bridge.headers);
  fake.respond('Target.attachToBrowserTarget', { sessionId: 'browser-a' });
  await new Promise(r => setTimeout(r, 20));
  const answer = nextMessage(ws);
  // Caller id 1: the pipe id chosen by the client is 2 (attachToBrowserTarget took 1). The response must still carry id 1.
  sendCommand(ws, { id: 1, method: 'Browser.getVersion', params: {} });
  await new Promise(r => setTimeout(r, 20));
  const attach = client.calls[0]!;
  expect(attach.method).toBe('Target.attachToBrowserTarget');
  fake.respond('Browser.getVersion', { product: 'Chrome/156' });
  expect(await answer).toEqual({ id: 1, result: { product: 'Chrome/156' } });
  // Duplicate outstanding caller ids are rejected instead of silently crossing responses.
  const duplicateError = nextMessage(ws);
  sendCommand(ws, { id: 9, method: 'Target.getTargets', params: {} });
  await new Promise(r => setTimeout(r, 10));
  sendCommand(ws, { id: 9, method: 'Browser.getVersion', params: {} });
  expect(await duplicateError).toMatchObject({ id: 9, error: { message: expect.stringMatching(/duplicate/i) } });
  // The original command is unaffected and still completes with the caller's id.
  const original = nextMessage(ws);
  fake.respond('Target.getTargets', { targetInfos: [] });
  expect(await original).toEqual({ id: 9, result: { targetInfos: [] } });
  ws.close();
});

it('disconnect does not close the pipe', async () => {
  const client = fakeClient();
  const fake = client as unknown as { respond: (method: string, value: unknown) => void };
  const bridge = await startAutomationBridge(client as never);
  cleanup.push(() => void bridge.close());
  const ws = await openSocket(bridge.endpoint, bridge.headers);
  fake.respond('Target.attachToBrowserTarget', { sessionId: 'browser-a' });
  ws.close();
  await new Promise(r => setTimeout(r, 100));
  const methods = client.calls.map(c => c.method);
  expect(methods).not.toContain('Browser.close');
  expect(client.closeCount).toBe(0);
  expect(methods).toContain('Target.detachFromTarget');
});

it('disposal rejects pending work and ignores late events', async () => {
  const client = fakeClient();
  const fake = client as unknown as { respond: (method: string, value: unknown) => void };
  const bridge = await startAutomationBridge(client as never);
  const ws = await openSocket(bridge.endpoint, bridge.headers);
  fake.respond('Target.attachToBrowserTarget', { sessionId: 'browser-a' });
  await new Promise(r => setTimeout(r, 20));
  const answer = nextMessage(ws);
  sendCommand(ws, { id: 5, method: 'Target.getTargets', params: {} });
  await new Promise(r => setTimeout(r, 20));
  const closed = new Promise(resolve => ws.once('close', resolve));
  await bridge.close();
  await closed;
  await expect(answer).rejects.toThrow('closed');
  // Late events from the pipe are ignored and nothing is forwarded to the dead socket.
  client.emit({ method: 'Target.targetCreated', sessionId: 'browser-a', params: {} });
  // After disposal the endpoint accepts no connections.
  await expect(openSocket(bridge.endpoint, bridge.headers)).rejects.toThrow();
  expect(client.calls.map(c => c.method)).not.toContain('Browser.close');
  expect(client.closeCount).toBe(0);
});

it('closes automation admission when the owning process exits', async () => {
  let exitProcess: () => void = () => {};
  const exit = new Promise<void>(resolve => { exitProcess = resolve; });
  const client = fakeClient();
  const bridge = await startAutomationBridge(client as never, { exit });
  cleanup.push(() => void bridge.close());
  const ws = await openSocket(bridge.endpoint, bridge.headers);
  const closed = new Promise<void>(resolve => ws.once('close', () => resolve()));
  exitProcess();
  await closed;
  await expect(openSocket(bridge.endpoint, bridge.headers)).rejects.toThrow();
  expect(client.calls.map(call => call.method)).not.toContain('Browser.close');
});
