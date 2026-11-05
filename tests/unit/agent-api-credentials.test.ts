import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CredentialAuthority } from '../../src/main/agent-api/credentials';
import { testSecrets } from '../fixtures/profiles';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function root() { const value = await mkdtemp(join(tmpdir(), 'agent-credentials-')); roots.push(value); return value; }

it('provisions separate identities without granting access to existing resources', async () => {
  const authority = await CredentialAuthority.open(await root(), testSecrets());
  const a = await authority.create('OpenCode');
  const b = await authority.create('Claude Code');
  expect(a.token).not.toBe(b.token);
  expect(a.id).not.toBe(b.id);
  expect(authority.authenticate(a.token)).toEqual({ id: a.id, label: 'OpenCode', profileIds: [], proxyIds: [] });
  expect(authority.authenticate('Bearer ' + a.token)).toBeNull();
  expect(authority.authenticate('bad')).toBeNull();
});

it('persists encrypted grants and revocation across restarts', async () => {
  const directory = await root(); const secrets = testSecrets();
  const authority = await CredentialAuthority.open(directory, secrets);
  const a = await authority.create('OpenCode'); const b = await authority.create('Other');
  const profileId = '00000000-0000-4000-8000-000000000001';
  await authority.grant(a.id, 'profile', profileId);
  expect(authority.authenticate(b.token)?.profileIds).toEqual([]);
  const bytes = await readFile(join(directory, 'agent-api-credentials.bin'));
  expect(bytes.toString()).not.toContain(a.token);
  expect(bytes.toString()).not.toContain('OpenCode');
  const reloaded = await CredentialAuthority.open(directory, secrets);
  expect(reloaded.authenticate(a.token)?.profileIds).toEqual([profileId]);
  await reloaded.revoke(a.id);
  expect(reloaded.authenticate(a.token)).toBeNull();
  const restarted = await CredentialAuthority.open(directory, secrets);
  expect(restarted.authenticate(a.token)).toBeNull();
  expect(restarted.authenticate(b.token)?.id).toBe(b.id);
});

it('does not publish credentials when encrypted persistence fails', async () => {
  const authority = await CredentialAuthority.open(await root(), { seal() { throw Error('OS_ENCRYPTION_UNAVAILABLE'); }, open() { throw Error('unavailable'); } });
  await expect(authority.create('OpenCode')).rejects.toThrow('OS_ENCRYPTION_UNAVAILABLE');
  expect(authority.list()).toEqual([]);
});

it('fails closed on unreadable existing credential storage', async () => {
  const directory = await root();
  await writeFile(join(directory, 'agent-api-credentials.bin'), 'corrupt');
  await expect(CredentialAuthority.open(directory, testSecrets())).rejects.toThrow();
});

it('serializes simultaneous provisioning without losing identities', async () => {
  const directory = await root(); const secrets = testSecrets();
  const authority = await CredentialAuthority.open(directory, secrets);
  const credentials = await Promise.all(Array.from({ length: 5 }, (_, i) => authority.create(`Client ${i}`)));
  const restarted = await CredentialAuthority.open(directory, secrets);
  expect(restarted.list()).toHaveLength(5);
  for (const credential of credentials) expect(restarted.authenticate(credential.token)?.id).toBe(credential.id);
});

it('rejects encrypted storage exceeding the restart limit without replacing prior grants', async () => {
  const directory = await root(); const base = testSecrets(); let oversized = false;
  const secrets = { open: base.open, seal: (value: string) => oversized ? Buffer.alloc(4 * 1024 * 1024 + 1) : base.seal(value) };
  const authority = await CredentialAuthority.open(directory, secrets);
  const credential = await authority.create('OpenCode');
  const before = await readFile(join(directory, 'agent-api-credentials.bin'));
  oversized = true;
  await expect(authority.grant(credential.id, 'profile', '00000000-0000-4000-8000-000000000001')).rejects.toThrow('AGENT_API_STORAGE_TOO_LARGE');
  expect(authority.authenticate(credential.token)?.profileIds).toEqual([]);
  expect(await readFile(join(directory, 'agent-api-credentials.bin'))).toEqual(before);
  const restarted = await CredentialAuthority.open(directory, base);
  expect(restarted.authenticate(credential.token)?.profileIds).toEqual([]);
});

it('lists grants with each credential and revokes a single grant', async () => {
  const directory = await root(); const secrets = testSecrets();
  const authority = await CredentialAuthority.open(directory, secrets);
  const credential = await authority.create('OpenCode');
  const profileA = '00000000-0000-4000-8000-000000000001';
  const profileB = '00000000-0000-4000-8000-000000000002';
  const proxy = '00000000-0000-4000-8000-000000000003';
  await authority.grant(credential.id, 'profile', profileA);
  await authority.grant(credential.id, 'profile', profileB);
  await authority.grant(credential.id, 'proxy', proxy);
  expect(authority.list()).toEqual([{ id: credential.id, label: 'OpenCode', revoked: false, profileIds: [profileA, profileB], proxyIds: [proxy] }]);
  await authority.revokeGrant(credential.id, 'profile', profileA);
  expect(authority.list()[0]).toMatchObject({ profileIds: [profileB], proxyIds: [proxy] });
  await authority.revokeGrant(credential.id, 'profile', profileA);
  const restarted = await CredentialAuthority.open(directory, secrets);
  expect(restarted.list()[0]).toMatchObject({ profileIds: [profileB], proxyIds: [proxy] });
  await expect(restarted.revokeGrant('00000000-0000-4000-8000-0000000000ff', 'profile', profileB)).rejects.toThrow('AGENT_CREDENTIAL_NOT_FOUND');
});

it('does not duplicate a grant issued twice', async () => {
  const authority = await CredentialAuthority.open(await root(), testSecrets());
  const credential = await authority.create('OpenCode');
  const profileId = '00000000-0000-4000-8000-000000000001';
  await authority.grant(credential.id, 'profile', profileId);
  await authority.grant(credential.id, 'profile', profileId);
  expect(authority.list()[0]?.profileIds).toEqual([profileId]);
});
