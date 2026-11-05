import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { IdempotencyStore } from '../../src/main/agent-api/idempotency';
import { testSecrets } from '../fixtures/profiles';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function open(secrets = testSecrets()) { const root = await mkdtemp(join(tmpdir(), 'agent-idempotency-')); roots.push(root); return { root, secrets, store: await IdempotencyStore.open(root, secrets) }; }

it('replays a completed operation for the same credential, path and body', async () => {
  const { store } = await open();
  const first = await store.run('client-a', 'POST', '/api/v1/profiles', 'key-1', { name: 'A' }, async () => ({ id: 'p1' }));
  const second = await store.run('client-a', 'POST', '/api/v1/profiles', 'key-1', { name: 'A' }, async () => { throw Error('must not run'); });
  expect(first).toEqual({ id: 'p1' });
  expect(second).toEqual({ id: 'p1' });
});

it('rejects reuse of a key with a different body', async () => {
  const { store } = await open();
  await store.run('client-a', 'POST', '/api/v1/profiles', 'key-1', { name: 'A' }, async () => ({ id: 'p1' }));
  await expect(store.run('client-a', 'POST', '/api/v1/profiles', 'key-1', { name: 'B' }, async () => ({ id: 'p2' })))
    .rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT' });
});

it('keeps credentials isolated and scopes keys by route', async () => {
  const { store } = await open();
  await store.run('client-a', 'POST', '/api/v1/profiles', 'key-1', {}, async () => ({ id: 'a' }));
  const other = await store.run('client-b', 'POST', '/api/v1/profiles', 'key-1', {}, async () => ({ id: 'b' }));
  const otherRoute = await store.run('client-a', 'POST', '/api/v1/profiles/p1/start', 'key-1', {}, async () => ({ started: true }));
  expect(other).toEqual({ id: 'b' });
  expect(otherRoute).toEqual({ started: true });
});

it('persists completed operations across restarts', async () => {
  const { root, secrets, store } = await open();
  await store.run('client-a', 'POST', '/api/v1/profiles', 'key-1', { name: 'A' }, async () => ({ id: 'p1' }));
  const restarted = await IdempotencyStore.open(root, secrets);
  expect(await restarted.run('client-a', 'POST', '/api/v1/profiles', 'key-1', { name: 'A' }, async () => { throw Error('must not run'); })).toEqual({ id: 'p1' });
  expect((await readFile(join(root, 'agent-api-idempotency.bin'))).toString()).not.toContain('p1');
});

it('does not cache failures and allows a retry', async () => {
  const { store } = await open();
  await expect(store.run('client-a', 'POST', '/api/v1/profiles', 'key-1', {}, async () => { throw Error('boom'); })).rejects.toThrow('boom');
  expect(await store.run('client-a', 'POST', '/api/v1/profiles', 'key-1', {}, async () => ({ id: 'ok' }))).toEqual({ id: 'ok' });
});

it('serializes concurrent requests with the same key', async () => {
  const { store } = await open();
  let executions = 0;
  const operation = async () => { executions++; await new Promise(resolve => setTimeout(resolve, 20)); return { id: 'p1' }; };
  const [a, b] = await Promise.all([
    store.run('client-a', 'POST', '/api/v1/profiles', 'key-1', {}, operation),
    store.run('client-a', 'POST', '/api/v1/profiles', 'key-1', {}, operation),
  ]);
  expect(executions).toBe(1);
  expect(a).toEqual(b);
});

it('starts empty when stored state is unreadable and trims expired entries', async () => {
  const { root, secrets } = await open();
  await writeFile(join(root, 'agent-api-idempotency.bin'), 'corrupt');
  const store = await IdempotencyStore.open(root, secrets);
  const old = Date.now() - 25 * 60 * 60 * 1000;
  await store.run('client-a', 'POST', '/api/v1/profiles', 'old', {}, async () => ({ id: 'old' }), old);
  const fresh = await IdempotencyStore.open(root, secrets);
  expect(await fresh.run('client-a', 'POST', '/api/v1/profiles', 'old', {}, async () => ({ id: 'new' }))).toEqual({ id: 'new' });
});
