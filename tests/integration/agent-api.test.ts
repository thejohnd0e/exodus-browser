import { it, expect } from 'vitest';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AgentApiService } from '../../src/main/agent-api/service';
import { ProfileService } from '../../src/main/profiles/service';
import { ChromiumAdapter } from '../../src/main/engines/chromium';
import { Supervisor } from '../../src/main/runtime/supervisor';
import { tempRoot, cleanup, testSecrets } from '../fixtures/profiles';

const base = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
const candidates = existsSync(base) ? readdirSync(base).filter(n => n.startsWith('chromium-')).sort().reverse() : [];
const exe = process.env.LOCAL_PROFILES_TEST_CHROMIUM ?? join(base, candidates[0] ?? 'missing', 'chrome-win64', 'chrome.exe');

function call(origin: string, path: string, options: { token?: string; method?: string; body?: unknown; idempotencyKey?: string } = {}) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = request(origin + path, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
        ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
      },
    }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode!, body: body ? JSON.parse(body) : null }));
    });
    req.on('error', reject); req.end(payload);
  });
}

it('creates, authorizes, launches and stops a profile through the local API', async () => {
  if (!existsSync(exe)) throw Error('BLOCKED: no local Chromium');
  const root = tempRoot();
  const secrets = testSecrets();
  const profiles = new ProfileService(root, secrets);
  const supervisor = new Supervisor(profiles, new ChromiumAdapter(exe));
  const service = await AgentApiService.open({
    root, secrets, profiles,
    writer: {
      create: input => profiles.create(input), start: id => supervisor.start(id), stop: id => supervisor.stop(id),
      states: () => supervisor.states(), engineVersion: async () => '156.0.8078.80', browser: id => supervisor.browser(id),
    },
  });
  try {
    const credential = await service.createCredential('Integration test');
    const { origin } = await service.enable();
    try {
      expect((await call(origin, '/api/v1/profiles')).status).toBe(401);
      expect((await call(origin, '/api/v1/profiles', { token: credential.token })).body.value).toEqual([]);

      const fingerprint = await call(origin, '/api/v1/fingerprints', { token: credential.token, method: 'POST', body: { os: 'windows11' } });
      expect(fingerprint.status).toBe(200);
      expect(fingerprint.body.value.os).toBe('windows11');

      const created = await call(origin, '/api/v1/profiles', { token: credential.token, method: 'POST', body: { name: 'Agent profile', fingerprint: fingerprint.body.value }, idempotencyKey: 'retry-key-001' });
      expect(created.status).toBe(200);
      const id = created.body.value.id;
      // A retry with the same idempotency key must not create a second profile.
      const retried = await call(origin, '/api/v1/profiles', { token: credential.token, method: 'POST', body: { name: 'Agent profile', fingerprint: fingerprint.body.value }, idempotencyKey: 'retry-key-001' });
      expect(retried.status).toBe(200);
      expect(retried.body.value.id).toBe(id);
      expect((await call(origin, '/api/v1/profiles', { token: credential.token })).body.value).toHaveLength(1);
      expect((await call(origin, '/api/v1/profiles', { token: credential.token, method: 'POST', body: { name: 'Other' }, idempotencyKey: 'retry-key-001' })).status).toBe(409);
      expect((await call(origin, '/api/v1/profiles', { token: credential.token })).body.value.map((profile: any) => profile.id)).toEqual([id]);

      const started = await call(origin, `/api/v1/profiles/${id}/start`, { token: credential.token, method: 'POST', body: {} });
      expect(started.status).toBe(200);
      expect(supervisor.states()[id]).toBe('running');

      const tabs = await call(origin, `/api/v1/profiles/${id}/tabs`, { token: credential.token });
      expect(tabs.status).toBe(200);
      expect(tabs.body.value[0].url).toBe('about:blank');

      // Revocation applies to the next request of an already running session.
      await service.revoke(credential.id);
      expect((await call(origin, `/api/v1/profiles/${id}/tabs`, { token: credential.token })).status).toBe(401);
      await supervisor.stop(id);
      expect(supervisor.states()[id]).toBe('stopped');

      // A dropped MCP client must not take the API down or leave the manager stranded.
      const second = await service.createCredential('MCP drop');
      await service.grant('profile', second.id, id);
      const mcp = spawn(process.execPath, [join(process.cwd(), 'tools', 'mcp', 'exodus-mcp.mjs')], {
        env: { ...process.env, EXODUS_API_URL: origin, EXODUS_API_TOKEN: second.token }, stdio: ['pipe', 'pipe', 'ignore'],
      });
      const reply = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('MCP_TIMEOUT')), 15000);
        mcp.stdout.setEncoding('utf8');
        mcp.stdout.on('data', chunk => { if (String(chunk).includes('apiVersion')) { clearTimeout(timer); resolve(String(chunk)); } });
        mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'status', arguments: {} } }) + '\n');
      });
      expect(reply).toContain('apiVersion');
      mcp.stdin.end();
      await new Promise<void>(resolve => { mcp.once('exit', () => resolve()); setTimeout(resolve, 5000); });
      expect((await call(origin, '/api/v1/profiles', { token: second.token })).status).toBe(200);
      await service.close();
      await expect(call(origin, '/api/v1/profiles', { token: credential.token })).rejects.toThrow();
      expect(supervisor.states()[id]).toBe('stopped');
    } finally { await service.disable(); }
  } finally {
    await supervisor.shutdown().catch(() => undefined);
    profiles.close();
    cleanup(root);
  }
}, 180000);
