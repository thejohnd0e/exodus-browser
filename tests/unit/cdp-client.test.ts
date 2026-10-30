import { describe, it, expect } from 'vitest';
import { CdpClient, parseDevtoolsUrl, type CdpSocket } from '../../src/main/cdp/client';

function fakeSocket(sent: unknown[]) {
  return {
    send: (d: string) => sent.push(JSON.parse(d)),
    close() { this.onclose?.(); },
    onmessage: null as ((e: { data: string }) => void) | null,
    onclose: null as (() => void) | null,
    onerror: null as ((e: unknown) => void) | null,
  } as CdpSocket & { send: (d: string) => void };
}

describe('cdp client', () => {
  it('extracts the address from stderr and ignores other output', () => {
    expect(parseDevtoolsUrl('DevTools listening on ws://127.0.0.1:9222/devtools/browser/abc-123')).toBe('ws://127.0.0.1:9222/devtools/browser/abc-123');
    expect(parseDevtoolsUrl('[123:ERROR] something')).toBeNull();
    expect(parseDevtoolsUrl('ws://0.0.0.0:9222/devtools/browser/x')).toBeNull();
  });

  it('matches responses by id and emits events', async () => {
    const sent: unknown[] = [];const fake = fakeSocket(sent);
    const client = await CdpClient.connect('ws://127.0.0.1:1/x', { factory: async () => fake });
    const events: unknown[] = [];client.onEvent(m => events.push(m));
    const call = client.send('Emulation.setTimezoneOverride', { timezoneId: 'Europe/Moscow' });
    const request = sent.at(-1) as { id: number; method: string };
    expect(request.method).toBe('Emulation.setTimezoneOverride');
    fake.onmessage!({ data: JSON.stringify({ id: request.id, result: { ok: 1 } }) });
    await expect(call).resolves.toEqual({ ok: 1 });
    fake.onmessage!({ data: JSON.stringify({ method: 'Target.attachedToTarget', params: { a: 1 } }) });
    expect(events).toHaveLength(1);
    client.close();
  });

  it('rejects timeouts and method errors', async () => {
    const sent: unknown[] = [];const fake = fakeSocket(sent);
    const client = await CdpClient.connect('ws://127.0.0.1:1/x', { factory: async () => fake });
    await expect(client.send('Slow.method', {}, undefined, 20)).rejects.toThrow('CDP_TIMEOUT');
    const call = client.send('Bad.method');
    const request = sent.at(-1) as { id: number };
    fake.onmessage!({ data: JSON.stringify({ id: request.id, error: { code: 1, message: 'nope' } }) });
    await expect(call).rejects.toThrow('nope');
    client.close();
  });

  it('rejects pending calls on close', async () => {
    const fake = fakeSocket([]);
    const client = await CdpClient.connect('ws://127.0.0.1:1/x', { factory: async () => fake });
    const call = client.send('Pending.method', {}, undefined, 1000);
    fake.onclose!();
    await expect(call).rejects.toThrow('CDP_CLOSED');
  });
});
