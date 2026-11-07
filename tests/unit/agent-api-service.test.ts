import { expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { AgentApiService } from '../../src/main/agent-api/service';
import { testSecrets } from '../fixtures/profiles';
import { DEFAULT_FINGERPRINT } from '../../src/shared/fingerprint';

const profile = {
  id: '00000000-0000-4000-8000-000000000001', name: 'Visible', note: '', startUrls: ['about:blank'], languages: ['en-US'],
  proxyId: null, proxy: null, fingerprint: DEFAULT_FINGERPRINT, fingerprintSeed: 7, restoreLastSession: false, extensionIds: [], createdAt: '', updatedAt: '',
};

async function service() {
  const root = await mkdtemp(join(tmpdir(), 'agent-api-service-'));
  const instance = await AgentApiService.open({ root, secrets: testSecrets(), profiles: { list: async () => [profile], listProxies: () => [] } });
  return { instance, close: async () => { await instance.disable(); await rm(root, { recursive: true, force: true }); } };
}

function call(origin: string, path: string, token?: string) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = request(origin + path, { headers: token ? { Authorization: 'Bearer ' + token } : {} }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; });
      response.on('end', () => { try { resolve({ status: response.statusCode!, body: body ? JSON.parse(body) : null }); } catch (error) { reject(error); } });
    });
    req.on('error', reject); req.end();
  });
}

it('stays disabled and unauthenticated until the manager enables it', async () => {
  const { instance, close } = await service();
  try {
    expect(instance.status()).toMatchObject({ enabled: false, credentials: [] });
    const credential = await instance.createCredential('OpenCode');
    expect(instance.status().credentials).toEqual([{ id: credential.id, label: 'OpenCode', revoked: false, profileIds: [], proxyIds: [] }]);
    const { origin } = await instance.enable();
    try {
      expect(instance.status()).toMatchObject({ enabled: true, origin });
      expect((await call(origin!, '/api/v1/profiles')).status).toBe(401);
      expect((await call(origin!, '/api/v1/profiles', credential.token)).body.value).toEqual([]);
    } finally { await instance.disable(); }
    expect(instance.status()).toMatchObject({ enabled: false });
  } finally { await close(); }
});

it('reports and revokes individual grants through the manager facade', async () => {
  const { instance, close } = await service();
  try {
    const credential = await instance.createCredential('OpenCode');
    await instance.grant('profile', credential.id, profile.id);
    expect(instance.status().credentials[0]).toMatchObject({ profileIds: [profile.id], proxyIds: [] });
    await instance.revokeGrant('profile', credential.id, profile.id);
    expect(instance.status().credentials[0]).toMatchObject({ profileIds: [], proxyIds: [] });
  } finally { await close(); }
});

it('honours grants, revocation and restart persistence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-api-service-'));
  try {
    const secrets = testSecrets();
    const first = await AgentApiService.open({ root, secrets, profiles: { list: async () => [profile], listProxies: () => [] } });
    const credential = await first.createCredential('OpenCode');
    await first.grant('profile', credential.id, profile.id);
    const { origin } = await first.enable();
    expect((await call(origin!, '/api/v1/profiles', credential.token)).body.value.map((p: any) => p.id)).toEqual([profile.id]);
    await first.disable();
    const second = await AgentApiService.open({ root, secrets, profiles: { list: async () => [profile], listProxies: () => [] } });
    expect(second.status().credentials.map(c => c.id)).toEqual([credential.id]);
    expect(second.status().enabled).toBe(false);
    await second.grant('profile', credential.id, profile.id);
    await second.revoke(credential.id);
    expect(second.status().credentials[0]!.revoked).toBe(true);
    const third = await AgentApiService.open({ root, secrets, profiles: { list: async () => [profile], listProxies: () => [] } });
    expect(third.status().credentials[0]!.revoked).toBe(true);
    await third.disable();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('restores a previously enabled listener and closes it on shutdown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-api-service-'));
  try {
    const secrets = testSecrets();
    const first = await AgentApiService.open({ root, secrets, profiles: { list: async () => [], listProxies: () => [] } });
    await first.enable();
    const origin = first.status().origin!;
    await first.disable();
    const second = await AgentApiService.open({ root, secrets, profiles: { list: async () => [], listProxies: () => [] } });
    await second.enable();
    expect(second.status().enabled).toBe(true);
    await second.disable();
    await expect(call(origin, '/api/v1/status')).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('keeps the enabled preference across application shutdown', async () => {
  const { instance, close } = await service();
  try {
    await instance.enable();
    await instance.close();
    expect(instance.status().enabled).toBe(false);
    await instance.resume();
    expect(instance.status().enabled).toBe(true);
    await instance.disable();
    await instance.resume();
    expect(instance.status().enabled).toBe(false);
  } finally { await close(); }
});

it('never leaves a listener alive after disable', async () => {
  const { instance } = await service();
  const credential = await instance.createCredential('A');
  const [a, b] = await Promise.all([instance.enable(), instance.enable()]);
  await instance.disable();
  const statuses = await Promise.all([a.origin, b.origin].map(origin => call(origin, '/api/v1/status', credential.token).then(result => result.status, () => 0)));
  expect(statuses).toEqual([0, 0]);
});

it('a disable issued while enable is in flight wins', async () => {
  const { instance } = await service();
  const pending = instance.enable();
  const disabling = instance.disable();
  await Promise.race([pending.catch(() => undefined), new Promise(resolve => setTimeout(resolve, 2000))]);
  await disabling.catch(() => undefined);
  expect(instance.status()).toMatchObject({ enabled: false, origin: null });
});

it('keeps the API disabled on restart when persisting the disable fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-api-service-'));
  try {
    const secrets = testSecrets();
    const first = await AgentApiService.open({ root, secrets, profiles: { list: async () => [profile], listProxies: () => [] } });
    await first.enable();
    const settingsFile = join(root, 'agent-api-settings.json');
    const saved = await readFile(settingsFile);
    await rm(settingsFile); await mkdir(settingsFile);
    await first.disable().catch(() => undefined);
    await rm(settingsFile, { recursive: true, force: true }); await writeFile(settingsFile, saved);
    const next = await AgentApiService.open({ root, secrets, profiles: { list: async () => [profile], listProxies: () => [] } });
    await next.resume();
    expect(next.status().enabled).toBe(false);
    await next.disable().catch(() => undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('opens disabled when the plaintext settings file is corrupt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-api-service-'));
  try {
    await writeFile(join(root, 'agent-api-settings.json'), '{"version":1,"enabled":"yes"}');
    const instance = await AgentApiService.open({ root, secrets: testSecrets(), profiles: { list: async () => [], listProxies: () => [] } });
    expect(instance.status().enabled).toBe(false);
    await instance.resume();
    expect(instance.status().enabled).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('does not break the manager when encrypted credential storage is unreadable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-api-service-'));
  try {
    await writeFile(join(root, 'agent-api-credentials.bin'), 'corrupt');
    const instance = await AgentApiService.open({ root, secrets: testSecrets(), profiles: { list: async () => [], listProxies: () => [] } });
    expect(instance.status()).toMatchObject({ enabled: false, credentials: [] });
    await expect(instance.createCredential('X')).rejects.toThrow('AGENT_API_STORAGE_INVALID');
    await expect(instance.enable()).rejects.toThrow('AGENT_API_STORAGE_INVALID');
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('rejects unknown credential identifiers and authenticates a valid key', async () => {
  const { instance, close } = await service();
  try {
    await expect(instance.revoke('00000000-0000-4000-8000-0000000000ff')).rejects.toThrow('AGENT_CREDENTIAL_NOT_FOUND');
    const credential = await instance.createCredential('Codex');
    const { origin } = await instance.enable();
    expect((await call(origin!, '/api/v1/status', credential.token)).body.ok).toBe(true);
  } finally { await close(); }
});

it('reuses the saved port after a restart and publishes a discovery file only while listening', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-api-service-'));
  try {
    const secrets = testSecrets();
    const open = () => AgentApiService.open({ root, secrets, profiles: { list: async () => [], listProxies: () => [] } });
    const first = await open();
    await first.enable();
    const origin = first.status().origin!;
    expect((await readFile(join(root, 'agent-api-origin.txt'), 'utf8')).trim()).toBe(origin);
    expect(JSON.parse(await readFile(join(root, 'agent-api-settings.json'), 'utf8')).port).toBe(Number(new URL(origin).port));
    await first.close();
    await expect(readFile(join(root, 'agent-api-origin.txt'), 'utf8')).rejects.toThrow();
    const second = await open();
    await second.resume();
    expect(second.status().origin).toBe(origin);
    await second.disable();
    // Disabling keeps the remembered port for the next enable.
    expect(JSON.parse(await readFile(join(root, 'agent-api-settings.json'), 'utf8'))).toMatchObject({ enabled: false, port: Number(new URL(origin).port) });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('falls back to a free port when the saved one is taken', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-api-service-'));
  const { createServer } = await import('node:net');
  const blocker = createServer();
  try {
    await new Promise<void>(resolve => blocker.listen(0, '127.0.0.1', resolve));
    const port = (blocker.address() as { port: number }).port;
    await writeFile(join(root, 'agent-api-settings.json'), JSON.stringify({ version: 1, enabled: false, port }));
    const instance = await AgentApiService.open({ root, secrets: testSecrets(), profiles: { list: async () => [], listProxies: () => [] } });
    const { origin } = await instance.enable();
    expect(Number(new URL(origin).port)).not.toBe(port);
    expect(JSON.parse(await readFile(join(root, 'agent-api-settings.json'), 'utf8')).port).toBe(Number(new URL(origin).port));
    await instance.disable();
  } finally { blocker.close(); await rm(root, { recursive: true, force: true }); }
});
