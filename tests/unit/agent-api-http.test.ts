import { afterEach, expect, it } from 'vitest';
import { request } from 'node:http';
import { startAgentHttp, type AgentHttp } from '../../src/main/agent-api/http';

const servers: AgentHttp[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.close())); });
async function setup() {
  const calls: string[] = [];
  const server = await startAgentHttp({
    authenticate: token => token === 'synthetic-test-token' ? { id: 'client-a', label: 'Test', profileIds: ['profile-a'], proxyIds: [] } : null,
    dispatch: async (identity, method, path) => { calls.push(identity.id + ':' + method + ':' + path); return { profiles: ['profile-a'] }; },
  });
  servers.push(server);
  return { server, calls };
}
function call(origin: string, options: { method?: string; headers?: Record<string, string>; body?: string; path?: string } = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(origin + (options.path ?? '/api/v1/profiles'), { method: options.method ?? 'GET', headers: options.headers }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode!, body }));
    });
    req.on('error', reject); req.end(options.body);
  });
}

it('binds loopback and authenticates before dispatch', async () => {
  const { server, calls } = await setup();
  expect(server.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect((await call(server.origin)).status).toBe(401);
  expect((await call(server.origin, { headers: { Authorization: 'Bearer wrong' } })).status).toBe(401);
  expect(calls).toEqual([]);
  const response = await call(server.origin, { headers: { Authorization: 'Bearer synthetic-test-token' } });
  expect(response.status).toBe(200);
  expect(calls).toEqual(['client-a:GET:/api/v1/profiles']);
});

it('rejects foreign Host and any browser Origin even with valid credentials', async () => {
  const { server, calls } = await setup();
  const foreignHeaders: Array<Record<string, string>> = [{ Host: 'evil.example' }, { Origin: 'https://evil.example' }];
  for (const headers of foreignHeaders) {
    expect((await call(server.origin, { headers: { Authorization: 'Bearer synthetic-test-token', ...headers } })).status).toBe(403);
  }
  expect(calls).toEqual([]);
});

it('bounds JSON bodies and rejects malformed requests without leaking internals', async () => {
  const { server, calls } = await setup();
  const headers = { Authorization: 'Bearer synthetic-test-token', 'Content-Type': 'application/json' };
  expect((await call(server.origin, { method: 'POST', headers, body: '{broken' })).status).toBe(400);
  expect((await call(server.origin, { method: 'POST', headers, body: 'x'.repeat(65537) })).status).toBe(413);
  expect(calls).toEqual([]);
});

it('accepts a bodyless POST for parameterless actions but still validates JSON when a body is sent', async () => {
  const seen: unknown[] = [];
  const server = await startAgentHttp({
    authenticate: () => ({ id: 'a', label: 'A', profileIds: [], proxyIds: [] }),
    dispatch: async (_identity, _method, _path, body) => { seen.push(body); return { ok: true }; },
  });
  servers.push(server);
  const auth = { Authorization: 'Bearer test' };
  expect((await call(server.origin, { method: 'POST', path: '/api/v1/profiles/x/start', headers: auth })).status).toBe(200);
  expect(seen[0]).toBeUndefined();
  expect((await call(server.origin, { method: 'POST', path: '/api/v1/profiles/x/start', headers: { ...auth, 'Content-Type': 'text/plain' }, body: 'x' })).status).toBe(415);
  expect((await call(server.origin, { method: 'POST', path: '/api/v1/profiles/x/start', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{broken' })).status).toBe(400);
});

it('accepts both an absent body and an empty JSON object on every parameterless action', async () => {
  const paths = [
    '/api/v1/profiles/p/start',
    '/api/v1/profiles/p/stop',
    '/api/v1/profiles/p/tabs/t/snapshot',
    '/api/v1/profiles/p/tabs/t/screenshot',
    '/api/v1/profiles/p/tabs/t/close',
  ];
  const seen: unknown[] = [];
  const server = await startAgentHttp({
    authenticate: () => ({ id: 'a', label: 'A', profileIds: [], proxyIds: [] }),
    dispatch: async (_identity, _method, _path, body) => { seen.push(body); return { ok: true }; },
  });
  servers.push(server);
  const auth = { Authorization: 'Bearer test' };
  for (const path of paths) {
    const bare = await call(server.origin, { method: 'POST', path, headers: auth });
    expect(bare.status, path).toBe(200);
    const empty = await call(server.origin, { method: 'POST', path, headers: { ...auth, 'Content-Type': 'application/json' }, body: '{}' });
    expect(empty.status, path).toBe(200);
  }
  expect(seen).toEqual([undefined, {}, undefined, {}, undefined, {}, undefined, {}, undefined, {}]);
});

it('documents the optional JSON body of parameterless actions', async () => {
  const { server } = await setup();
  const response = await call(server.origin, { headers: { Authorization: 'Bearer synthetic-test-token' }, path: '/api/v1/openapi.json' });
  const document = JSON.parse(response.body).value as { paths: Record<string, { post?: { requestBody?: unknown } }> };
  for (const path of [
    '/api/v1/profiles/{id}/start',
    '/api/v1/profiles/{id}/stop',
    '/api/v1/profiles/{id}/tabs/{targetId}/snapshot',
    '/api/v1/profiles/{id}/tabs/{targetId}/screenshot',
    '/api/v1/profiles/{id}/tabs/{targetId}/close',
  ]) {
    expect(document.paths[path]?.post?.requestBody, path).toMatchObject({
      required: false,
      content: { 'application/json': { schema: { type: 'object' } } },
    });
  }
});

it('rechecks authentication on every request and stops admission on disable', async () => {
  let revoked = false;
  const server = await startAgentHttp({ authenticate: () => revoked ? null : { id: 'a', label: 'A', profileIds: [], proxyIds: [] }, dispatch: async () => ({ ok: true }) });
  servers.push(server);
  const headers = { Authorization: 'Bearer test' };
  expect((await call(server.origin, { headers })).status).toBe(200);
  revoked = true;
  expect((await call(server.origin, { headers })).status).toBe(401);
  await server.close();
  await expect(call(server.origin, { headers })).rejects.toThrow();
});

it('forwards a validated idempotency key and rejects malformed ones', async () => {
  const seen: Array<string | undefined> = [];
  const server = await startAgentHttp({
    authenticate: () => ({ id: 'a', label: 'A', profileIds: [], proxyIds: [] }),
    dispatch: async (_identity, _method, _path, _body, key) => { seen.push(key); return { ok: true }; },
  });
  servers.push(server);
  const base = { Authorization: 'Bearer test', 'Content-Type': 'application/json' };
  const post = (key: string) => call(server.origin, { method: 'POST', headers: { ...base, 'Idempotency-Key': key }, body: '{}' });
  expect((await post('short')).status).toBe(400);
  expect((await post('bad key with spaces')).status).toBe(400);
  expect((await post('op-key_12345')).status).toBe(200);
  expect(seen).toEqual(['op-key_12345']);
});

it('serves an OpenAPI document whose paths match the implemented routes', async () => {
  const { server } = await setup();
  const response = await call(server.origin, { headers: { Authorization: 'Bearer synthetic-test-token' }, path: '/api/v1/openapi.json' });
  expect(response.status).toBe(200);
  const document = JSON.parse(response.body).value;
  expect(document.openapi).toBe('3.1.0');
  expect(Object.keys(document.paths).sort()).toEqual([
    '/api/v1/fingerprints', '/api/v1/openapi.json', '/api/v1/profiles', '/api/v1/profiles/{id}',
    '/api/v1/profiles/{id}/start', '/api/v1/profiles/{id}/stop', '/api/v1/profiles/{id}/tabs',
    '/api/v1/profiles/{id}/tabs/{targetId}/click', '/api/v1/profiles/{id}/tabs/{targetId}/close',
    '/api/v1/profiles/{id}/tabs/{targetId}/fill', '/api/v1/profiles/{id}/tabs/{targetId}/navigate', '/api/v1/profiles/{id}/tabs/{targetId}/press',
    '/api/v1/profiles/{id}/tabs/{targetId}/screenshot', '/api/v1/profiles/{id}/tabs/{targetId}/snapshot', '/api/v1/profiles/{id}/tabs/{targetId}/upload',
    '/api/v1/proxies', '/api/v1/status',
  ]);
  expect(JSON.stringify(document)).not.toContain('automation-session');
});

it('does not return service exception details', async () => {
  const server = await startAgentHttp({ authenticate: () => ({ id: 'a', label: 'A', profileIds: [], proxyIds: [] }), dispatch: async () => { throw Error('password=synthetic-secret'); } });
  servers.push(server);
  const response = await call(server.origin, { headers: { Authorization: 'Bearer test' } });
  expect(response.status).toBe(500);
  expect(response.body).not.toContain('synthetic-secret');
});
