import { expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMcpHandler } from '../../tools/mcp/exodus-mcp.mjs';

const script = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'tools', 'mcp', 'exodus-mcp.mjs');

it('answers initialize when spawned as a client launches the stdio bridge', async () => {
  const output = await new Promise<string>((resolve, reject) => {
    const child = execFile(process.execPath, [script], {
      env: { ...process.env, EXODUS_API_URL: 'http://127.0.0.1:1', EXODUS_API_TOKEN: 'exa_' + 'a'.repeat(43) },
    }, (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin!.end('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
  });
  expect(output).toContain('"serverInfo"');
  expect(output).toContain('exodus-agent');
  expect(output).not.toContain('exa_');
});

function handler(fetchImpl: any) {
  return createMcpHandler({ url: 'http://127.0.0.1:9', token: 'synthetic-token', fetchImpl });
}

it('answers initialize without revealing the token', async () => {
  const response = await handler(vi.fn()).handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) as any;
  expect(response.result.serverInfo.name).toBe('exodus-agent');
  expect(response.result.capabilities.tools).toEqual({});
  expect(JSON.stringify(response)).not.toContain('synthetic-token');
});

it('ignores notifications and lists bounded profile tools', async () => {
  const mcp = handler(vi.fn());
  expect(await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
  const response = await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) as any;
  const names = response.result.tools.map((tool: any) => tool.name);
  expect(names).toEqual(['status', 'profiles_list', 'profiles_get', 'profile_create', 'profile_start', 'profile_stop', 'proxies_list', 'fingerprint_generate', 'tabs', 'navigate', 'snapshot', 'click', 'fill', 'upload', 'press', 'screenshot', 'close']);
  expect(names).not.toContain('evaluate');
  expect(names).not.toContain('delete_profile');
  expect(JSON.stringify(response.result.tools)).not.toContain('synthetic-token');
});

it('forwards tool calls to the authenticated HTTP API', async () => {
  const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, value: [{ id: 'p1' }] }) }));
  const response = await handler(fetchImpl).handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'profiles_list', arguments: {} } }) as any;
  expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:9/api/v1/profiles', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer synthetic-token' }) }));
  expect(JSON.parse(response.result.content[0].text)).toEqual([{ id: 'p1' }]);
});

it('maps API failures to tool errors without leaking the token', async () => {
  const fetchImpl = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ ok: false, error: { code: 'UNAUTHORIZED' } }) }));
  const response = await handler(fetchImpl).handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'status', arguments: {} } }) as any;
  expect(response.result.isError).toBe(true);
  expect(response.result.content[0].text).toContain('UNAUTHORIZED');
  expect(JSON.stringify(response)).not.toContain('synthetic-token');
});

it('rejects unknown tools and malformed calls', async () => {
  const mcp = handler(vi.fn());
  const unknown = await mcp.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'evaluate', arguments: { code: '1' } } }) as any;
  expect(unknown.error.code).toBe(-32602);
  const missing = await mcp.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'profiles_get', arguments: {} } }) as any;
  expect(missing.result.isError).toBe(true);
});
it('builds the URL from arguments for every parameterized tool', async () => {
  const seen: string[] = [];
  const fetchImpl = vi.fn(async (url: string) => { seen.push(url); return { ok: true, status: 200, json: async () => ({ ok: true, value: {} }) }; });
  const mcp = handler(fetchImpl);
  await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'profiles_get', arguments: { id: 'abc' } } });
  await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'profile_start', arguments: { id: 'abc' } } });
  await mcp.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'profile_stop', arguments: { id: 'abc' } } });
  await mcp.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'tabs', arguments: { id: 'abc' } } });
  await mcp.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'navigate', arguments: { id: 'abc', targetId: 't1', url: 'http://x' } } });
  await mcp.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'snapshot', arguments: { id: 'abc', targetId: 't1' } } });
  await mcp.handle({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'click', arguments: { id: 'abc', targetId: 't1', ref: '0' } } });
  await mcp.handle({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'fill', arguments: { id: 'abc', targetId: 't1', ref: '0', text: 'x' } } });
  await mcp.handle({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'screenshot', arguments: { id: 'abc', targetId: 't1' } } });
  await mcp.handle({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'close', arguments: { id: 'abc', targetId: 't1' } } });
  expect(seen).toEqual([
    'http://127.0.0.1:9/api/v1/profiles/abc',
    'http://127.0.0.1:9/api/v1/profiles/abc/start',
    'http://127.0.0.1:9/api/v1/profiles/abc/stop',
    'http://127.0.0.1:9/api/v1/profiles/abc/tabs',
    'http://127.0.0.1:9/api/v1/profiles/abc/tabs/t1/navigate',
    'http://127.0.0.1:9/api/v1/profiles/abc/tabs/t1/snapshot',
    'http://127.0.0.1:9/api/v1/profiles/abc/tabs/t1/click',
    'http://127.0.0.1:9/api/v1/profiles/abc/tabs/t1/fill',
    'http://127.0.0.1:9/api/v1/profiles/abc/tabs/t1/screenshot',
    'http://127.0.0.1:9/api/v1/profiles/abc/tabs/t1/close',
  ]);
});

import { defaultOriginFile, resolveValue } from '../../tools/mcp/exodus-mcp.mjs';

it('resolves {file:...} values and leaves literals alone', () => {
  const read = vi.fn(() => ' file-token\r\n');
  expect(resolveValue('{file:C:/keys/token.txt}', read)).toBe('file-token');
  expect(read).toHaveBeenCalledWith('C:/keys/token.txt');
  expect(resolveValue('literal-token', read)).toBe('literal-token');
  expect(resolveValue(undefined, read)).toBeUndefined();
  expect(defaultOriginFile({ APPDATA: 'C:\\Users\\x\\AppData\\Roaming' })).toMatch(/Local Profiles[\\/]agent-api-origin\.txt$/);
  expect(defaultOriginFile({ EXODUS_API_ORIGIN_FILE: 'D:/o.txt', APPDATA: 'C:\\a' })).toBe('D:/o.txt');
});

it('re-reads the published origin once when the connection fails', async () => {
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (url: string) => {
    urls.push(url);
    if (url.startsWith('http://127.0.0.1:9/')) throw new TypeError('fetch failed');
    return { ok: true, status: 200, json: async () => ({ ok: true, value: [] }) };
  });
  const mcp = createMcpHandler({ url: 'http://127.0.0.1:9', token: 'synthetic-token', fetchImpl, originFile: 'origin.txt', readText: () => 'http://127.0.0.1:4242\n' });
  const call = (id: number) => mcp.handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'profiles_list', arguments: {} } }) as Promise<any>;
  expect(JSON.parse((await call(1)).result.content[0].text)).toEqual([]);
  await call(2);
  expect(urls).toEqual(['http://127.0.0.1:9/api/v1/profiles', 'http://127.0.0.1:4242/api/v1/profiles', 'http://127.0.0.1:4242/api/v1/profiles']);
});

it('never follows a non-loopback origin from the discovery file', async () => {
  const fetchImpl = vi.fn(async () => { throw new TypeError('fetch failed'); });
  const mcp = createMcpHandler({ url: 'http://127.0.0.1:9', token: 'synthetic-token', fetchImpl, originFile: 'origin.txt', readText: () => 'http://evil.example:80' });
  const response = await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'status', arguments: {} } }) as any;
  expect(response.result.isError).toBe(true);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
