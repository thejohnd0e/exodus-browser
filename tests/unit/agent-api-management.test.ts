import { expect, it } from 'vitest';
import { AgentManagement } from '../../src/main/agent-api/management';
import type { AgentIdentity } from '../../src/main/agent-api/credentials';
import type { Profile, SavedProxy } from '../../src/shared/contracts';
import { DEFAULT_FINGERPRINT } from '../../src/shared/fingerprint';

const identity: AgentIdentity = { id: 'client', label: 'Client', profileIds: ['visible'], proxyIds: ['proxy-visible'] };
function fixture() {
  const proxy: SavedProxy = { id: 'proxy-visible', name: 'Proxy', kind: 'http', host: '127.0.0.1', port: 8080, hasPassword: true, profileIds: ['visible', 'hidden'], createdAt: '', updatedAt: '' };
  const profile = (id: string): Profile => ({ id, name: id, note: '', startUrls: ['about:blank'], languages: ['en-US'], proxyId: proxy.id, proxy, fingerprint: DEFAULT_FINGERPRINT, fingerprintSeed: 42, restoreLastSession: false, extensionIds: [], createdAt: '', updatedAt: '' });
  return new AgentManagement({ list: async () => [profile('visible'), profile('hidden')], listProxies: () => [proxy] }, {
    create: async input => ({ ...profile('created'), ...input, fingerprint: input.fingerprint ?? DEFAULT_FINGERPRINT }),
    start: async () => undefined, stop: async () => undefined, states: () => ({}),
    grantProfile: async () => undefined, engineVersion: async () => '156.0.8078.80',
  });
}

it('filters profiles and all proxy profile references by credential grants', async () => {
  const management = fixture();
  const profiles = await management.dispatch(identity, 'GET', '/api/v1/profiles', undefined) as Profile[];
  expect(profiles.map(p => p.id)).toEqual(['visible']);
  expect(profiles[0]!.proxy?.profileIds).toEqual(['visible']);
  const proxies = await management.dispatch(identity, 'GET', '/api/v1/proxies', undefined) as SavedProxy[];
  expect(proxies[0]!.profileIds).toEqual(['visible']);
});

it('does not reveal proxy inventory through authorized profiles without a proxy grant', async () => {
  const management = fixture();
  const profiles = await management.dispatch({ ...identity, proxyIds: [] }, 'GET', '/api/v1/profiles', undefined) as Profile[];
  expect(profiles[0]!.proxy).toBeNull();
  expect(profiles[0]!.proxyId).toBeNull();
  expect(await management.dispatch({ ...identity, proxyIds: [] }, 'GET', '/api/v1/proxies', undefined)).toEqual([]);
});

it('does not distinguish missing and unauthorized profile identifiers', async () => {
  const management = fixture();
  for (const id of ['hidden', 'missing']) await expect(management.dispatch(identity, 'GET', '/api/v1/profiles/' + id, undefined)).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  expect(await management.dispatch(identity, 'GET', '/api/v1/profiles/visible', undefined)).toMatchObject({ id: 'visible' });
});

it('advertises only implemented capabilities and rejects unsupported actions', async () => {
  const management = fixture();
  expect(await management.dispatch(identity, 'GET', '/api/v1/status', undefined)).toMatchObject({ apiVersion: '1', capabilities: ['profiles.read', 'profiles.create', 'profiles.start', 'profiles.stop', 'fingerprints.generate', 'proxies.read', 'tabs.read', 'page.navigate', 'page.snapshot', 'page.click', 'page.fill', 'page.screenshot'] });
  await expect(management.dispatch(identity, 'POST', '/api/v1/profiles', {})).rejects.toMatchObject({ status: 400, code: 'INVALID_INPUT' });
});

it('creates a profile, grants it to the caller and generates a compatible fingerprint', async () => {
  const created: Profile[] = [];
  const grants: Array<[string, string]> = [];
  const management = new AgentManagement({
    list: async () => created, listProxies: () => [],
    create: async input => { const profile = { id: '00000000-0000-4000-8000-0000000000aa', name: input.name, note: '', startUrls: input.startUrls, languages: input.languages, proxyId: null, proxy: null, fingerprint: input.fingerprint!, fingerprintSeed: input.fingerprintSeed ?? 1, restoreLastSession: false, extensionIds: [], createdAt: '', updatedAt: '' }; created.push(profile); return profile; },
    start: async () => {}, stop: async () => {}, states: () => ({}), grantProfile: async (credentialId, profileId) => { grants.push([credentialId, profileId]); }, engineVersion: async () => '156.0.8078.80',
  });
  const result = await management.dispatch(identity, 'POST', '/api/v1/profiles', { name: 'Agent profile' }) as Profile;
  expect(result.name).toBe('Agent profile');
  expect(result.startUrls).toEqual(['about:blank']);
  expect(result.fingerprint.userAgent).toContain('Chrome/156.0.0.0');
  expect(grants).toEqual([['client', result.id]]);
});

it('starts and stops only granted profiles', async () => {
  const calls: string[] = [];
  const profile = { id: 'visible', name: 'visible', note: '', startUrls: ['about:blank'], languages: ['en-US'], proxyId: null, proxy: null, fingerprint: DEFAULT_FINGERPRINT, fingerprintSeed: 1, restoreLastSession: false, extensionIds: [], createdAt: '', updatedAt: '' };
  const management = new AgentManagement({
    list: async () => [profile], listProxies: () => [],
    create: async () => { throw Error('unused'); }, start: async (id: string) => { calls.push('start:' + id); }, stop: async (id: string) => { calls.push('stop:' + id); },
    states: () => ({ visible: 'running' as const }), grantProfile: async () => {}, engineVersion: async () => null,
  });
  expect(await management.dispatch(identity, 'POST', '/api/v1/profiles/visible/start', {})).toEqual({ id: 'visible', state: 'running' });
  expect(await management.dispatch(identity, 'POST', '/api/v1/profiles/visible/stop', {})).toEqual({ id: 'visible', state: 'running' });
  expect(calls).toEqual(['start:visible', 'stop:visible']);
  await expect(management.dispatch(identity, 'POST', '/api/v1/profiles/hidden/start', {})).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
});

it('maps browser tool failures to stable HTTP errors and rejects ungranted profiles', async () => {
  const calls: string[] = [];
  const browser = {
    tabs: async (profileId: string) => { calls.push('tabs:' + profileId); return [{ targetId: 't1', url: 'http://x' }]; },
    navigate: async () => { throw Object.assign(Error('TIMEOUT'), { code: 'TIMEOUT' }); },
    snapshot: async () => { throw Object.assign(Error('TAB_NOT_FOUND'), { code: 'TAB_NOT_FOUND' }); },
    click: async () => undefined, fill: async () => undefined, closeTab: async () => undefined,
    screenshot: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  } as unknown as import('../../src/main/agent-api/browser/controller').BrowserController;
  const profile = { id: 'visible', name: 'visible', note: '', startUrls: ['about:blank'], languages: ['en-US'], proxyId: null, proxy: null, fingerprint: DEFAULT_FINGERPRINT, fingerprintSeed: 1, restoreLastSession: false, extensionIds: [], createdAt: '', updatedAt: '' };
  const management = new AgentManagement({ list: async () => [profile], listProxies: () => [] }, undefined, browser);
  expect(await management.dispatch(identity, 'GET', '/api/v1/profiles/visible/tabs', undefined)).toEqual([{ targetId: 't1', url: 'http://x' }]);
  await expect(management.dispatch(identity, 'POST', '/api/v1/profiles/visible/tabs/t1/navigate', { url: 'http://x' })).rejects.toMatchObject({ status: 504, code: 'TIMEOUT' });
  await expect(management.dispatch(identity, 'POST', '/api/v1/profiles/visible/tabs/t1/snapshot', {})).rejects.toMatchObject({ status: 404, code: 'TAB_NOT_FOUND' });
  await expect(management.dispatch(identity, 'GET', '/api/v1/profiles/hidden/tabs', undefined)).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  const shot = await management.dispatch(identity, 'POST', '/api/v1/profiles/visible/tabs/t1/screenshot', {}) as { dataBase64: string };
  expect(Buffer.from(shot.dataBase64, 'base64').subarray(1, 4)).toEqual(Buffer.from([0x50, 0x4e, 0x47]));
  expect(calls).toEqual(['tabs:visible']);
});

it('reports a stopped profile as 409 when listing tabs', async () => {
  const browser = {
    tabs: async () => { throw Object.assign(Error('PROFILE_NOT_RUNNING'), { code: 'PROFILE_NOT_RUNNING' }); },
    navigate: async () => undefined, snapshot: async () => undefined, click: async () => undefined,
    fill: async () => undefined, closeTab: async () => undefined, screenshot: async () => Buffer.from([]),
  } as unknown as import('../../src/main/agent-api/browser/controller').BrowserController;
  const profile: Profile = { id: 'visible', name: 'visible', note: '', startUrls: ['about:blank'], languages: ['en-US'], proxyId: null, proxy: null, fingerprint: DEFAULT_FINGERPRINT, fingerprintSeed: 1, restoreLastSession: false, extensionIds: [], createdAt: '', updatedAt: '' };
  const management = new AgentManagement({ list: async () => [profile], listProxies: () => [] }, undefined, browser);
  await expect(management.dispatch(identity, 'GET', '/api/v1/profiles/visible/tabs', undefined)).rejects.toMatchObject({ status: 409, code: 'PROFILE_NOT_RUNNING' });
});

it('generates fingerprints only for a known engine and supported operating systems', async () => {
  const management = fixture();
  const fingerprint = await management.dispatch(identity, 'POST', '/api/v1/fingerprints', { os: 'windows11' }) as any;
  expect(fingerprint.os).toBe('windows11');
  expect(fingerprint.screen.width).toBeGreaterThan(0);
  await expect(management.dispatch(identity, 'POST', '/api/v1/fingerprints', { os: 'beos' })).rejects.toMatchObject({ status: 400, code: 'INVALID_INPUT' });
});
