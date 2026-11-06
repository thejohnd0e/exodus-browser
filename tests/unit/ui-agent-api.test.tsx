// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/renderer/App';
import type { ProfileApi } from '../../src/shared/contracts';
import { DEFAULT_FINGERPRINT } from '../../src/shared/fingerprint';

afterEach(cleanup);
const profile = { id: 'd31bb0d8-7bfa-4341-a12a-83a801e8cb4a', name: 'Work', note: '', startUrls: ['about:blank'], languages: ['en-US'], proxyId: null, proxy: null, fingerprint: DEFAULT_FINGERPRINT, fingerprintSeed: 1, restoreLastSession: false, extensionIds: [], createdAt: '', updatedAt: '' };

function api(overrides: Partial<ProfileApi> = {}): ProfileApi {
  const base = {
    list: async () => ({ ok: true, value: [profile] }), states: async () => ({ ok: true, value: {} }), warnings: async () => ({ ok: true, value: {} }),
    engineStatus: async () => ({ ok: true, value: { state: 'ready' } }), listProxies: async () => ({ ok: true, value: [] }), runningProxyVersions: async () => ({ ok: true, value: {} }),
    listExtensions: async () => ({ ok: true, value: [] }), getSettings: async () => ({ ok: true, value: { language: 'en' } }), updateSettings: async (value: never) => ({ ok: true, value }),
    onCloseRequested: () => () => undefined, confirmClose: async () => true,
    onUpdateState: () => () => undefined, getUpdateState: async () => ({ ok: true, value: { state: 'idle' } }),
    agentApiStatus: async () => ({ ok: true, value: { enabled: false, origin: null, credentials: [] } }),
    setAgentApiEnabled: async (enabled: boolean) => ({ ok: true, value: { enabled, origin: enabled ? 'http://127.0.0.1:1234' : null, credentials: [] } }),
    createAgentCredential: async () => ({ ok: true, value: { id: 'd31bb0d8-7bfa-4341-a12a-83a801e8cb4b', token: 'exa_synthetic' } }),
    revokeAgentCredential: async () => ({ ok: true, value: undefined }),
    grantAgentCredential: async () => ({ ok: true, value: undefined }),
    revokeAgentGrant: async () => ({ ok: true, value: undefined }),
  };
  return { ...base, ...overrides } as unknown as ProfileApi;
}

it('enables the local API and shows its loopback address', async () => {
  const setAgentApiEnabled = vi.fn(api().setAgentApiEnabled);
  render(<App api={api({ setAgentApiEnabled })} />);
  await screen.findByText('Work');
  fireEvent.click(screen.getByRole('button', { name: 'Agent API' }));
  await screen.findByRole('heading', { name: 'Agent API' });
  fireEvent.click(screen.getByRole('button', { name: 'Enable API' }));
  await waitFor(() => expect(setAgentApiEnabled).toHaveBeenCalledWith(true));
  await screen.findByText('http://127.0.0.1:1234');
});

it('shows a newly issued key once and hides it after dismissal', async () => {
  const createAgentCredential = vi.fn(api().createAgentCredential);
  render(<App api={api({ createAgentCredential })} />);
  await screen.findByText('Work');
  fireEvent.click(screen.getByRole('button', { name: 'Agent API' }));
  fireEvent.change(await screen.findByLabelText('Integration name'), { target: { value: 'OpenCode' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create key' }));
  await screen.findByText(/exa_synthetic/);
  expect(createAgentCredential).toHaveBeenCalledWith('OpenCode');
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss message' }));
  expect(screen.queryByText(/exa_synthetic/)).toBeNull();
});

const credentialId = 'd31bb0d8-7bfa-4341-a12a-83a801e8cb4c';
const second = { ...profile, id: 'd31bb0d8-7bfa-4341-a12a-83a801e8cb4d', name: 'Personal' };
const proxy = { id: '8c6dbed2-8067-43ec-b5fd-3cb482d965ea', name: 'Shared HTTP', kind: 'http' as const, host: 'proxy.example.com', port: 8080, hasPassword: false, createdAt: '', updatedAt: '', profileIds: [] };

it('starts cards collapsed and exposes their grant counts', async () => {
  render(<App api={api({ agentApiStatus: async () => ({ ok: true, value: { enabled: true, origin: null, credentials: [{ id: credentialId, label: 'OpenCode', revoked: false, profileIds: [profile.id], proxyIds: [] }] } }) })} />);
  await screen.findByText('Work'); fireEvent.click(screen.getByRole('button', { name: 'Agent API' }));
  const card = await screen.findByRole('listitem', { name: 'OpenCode' });
  const expand = within(card).getByRole('button', { name: /OpenCode/ });
  expect(expand.getAttribute('aria-expanded')).toBe('false');
  expect(within(card).queryByRole('region', { name: 'Profiles (1)' })).toBeNull();
  fireEvent.click(expand);
  expect(within(card).getByRole('region', { name: 'Profiles (1)' })).toBeTruthy();
});

it('copies the issued token and reports success', async () => {
  const copyText=vi.fn(async()=>({ok:true as const,value:undefined}));
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});
  render(<App api={api({copyText})} />); await screen.findByText('Work');
  fireEvent.click(screen.getByRole('button',{name:'Agent API'}));
  fireEvent.change(await screen.findByLabelText('Integration name'),{target:{value:'OpenCode'}});
  fireEvent.click(screen.getByRole('button',{name:'Create key'}));
  fireEvent.click(await screen.findByRole('button',{name:'Copy key'}));
  await waitFor(()=>expect(copyText).toHaveBeenCalledWith('exa_synthetic'));
  expect(await screen.findByText('Copied')).toBeTruthy();
});

it('keeps the key available for manual copying when clipboard access fails', async () => {
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});
  render(<App api={api({copyText:async()=>({ok:false as const,error:{code:'OPERATION_FAILED',message:'Could not complete the operation.'}})})} />); await screen.findByText('Work');
  fireEvent.click(screen.getByRole('button',{name:'Agent API'}));
  fireEvent.change(await screen.findByLabelText('Integration name'),{target:{value:'OpenCode'}});
  fireEvent.click(screen.getByRole('button',{name:'Create key'}));
  fireEvent.click(await screen.findByRole('button',{name:'Copy key'}));
  expect(await screen.findByText('Copy failed. Select and copy the key manually.')).toBeTruthy();
  expect(screen.getByText('exa_synthetic')).toBeTruthy();
});

it('shows granted profiles and proxies in separate groups with counts', async () => {
  render(<App api={api({
    listProxies: async () => ({ ok: true, value: [proxy] }),
    agentApiStatus: async () => ({ ok: true, value: { enabled: true, origin: 'http://127.0.0.1:1', credentials: [{ id: credentialId, label: 'OpenCode', revoked: false, profileIds: [profile.id], proxyIds: [proxy.id] }] } }),
  })} />);
  await screen.findByText('Work');
  fireEvent.click(screen.getByRole('button', { name: 'Agent API' }));
  const card = await screen.findByRole('listitem', { name: 'OpenCode' });
  fireEvent.click(within(card).getByRole('button', { name: /OpenCode/ }));
  const profileGroup = within(card).getByRole('region', { name: 'Profiles (1)' });
  const proxyGroup = within(card).getByRole('region', { name: 'Proxies (1)' });
  expect(within(profileGroup).getByText('Work')).toBeTruthy();
  expect(within(proxyGroup).getByText('Shared HTTP')).toBeTruthy();
});

it('shows a separate empty state and zero count for each grant group', async () => {
  render(<App api={api({ agentApiStatus: async () => ({ ok: true, value: { enabled: true, origin: 'http://127.0.0.1:1', credentials: [{ id: credentialId, label: 'OpenCode', revoked: false, profileIds: [], proxyIds: [] }] } }) })} />);
  await screen.findByText('Work');
  fireEvent.click(screen.getByRole('button', { name: 'Agent API' }));
  const card = await screen.findByRole('listitem', { name: 'OpenCode' });
  fireEvent.click(within(card).getByRole('button', { name: /OpenCode/ }));
  expect(within(card).getByRole('region', { name: 'Profiles (0)' }).textContent).toContain('No profiles granted.');
  expect(within(card).getByRole('region', { name: 'Proxies (0)' }).textContent).toContain('No proxies granted.');
});

it('grants several resources in one action and reloads the granted list', async () => {
  let granted = false;
  const grantAgentCredential = vi.fn(async () => { granted = true; return { ok: true as const, value: undefined }; });
  render(<App api={api({
    list: async () => ({ ok: true, value: [profile, second] }),
    grantAgentCredential,
    agentApiStatus: async () => ({ ok: true, value: { enabled: true, origin: 'http://127.0.0.1:1', credentials: [{ id: credentialId, label: 'OpenCode', revoked: false, profileIds: granted ? [profile.id, second.id] : [], proxyIds: [] }] } }),
  })} />);
  await screen.findByText('Work');
  fireEvent.click(screen.getByRole('button', { name: 'Agent API' }));
  const card = await screen.findByRole('listitem', { name: 'OpenCode' });
  fireEvent.click(within(card).getByRole('button', { name: /OpenCode/ }));
  fireEvent.click(within(card).getByRole('button', { name: 'Add access' }));
  fireEvent.click(within(card).getByRole('checkbox', { name: 'Work' }));
  fireEvent.click(within(card).getByRole('checkbox', { name: 'Personal' }));
  fireEvent.click(within(card).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(grantAgentCredential).toHaveBeenCalledTimes(2));
  expect(grantAgentCredential).toHaveBeenCalledWith({ credentialId, kind: 'profile', resourceId: profile.id });
  expect(grantAgentCredential).toHaveBeenCalledWith({ credentialId, kind: 'profile', resourceId: second.id });
  await within(card).findByText('Personal');
});

it('revokes a single grant without revoking the key', async () => {
  let revoked = false;
  const revokeAgentGrant = vi.fn(async () => { revoked = true; return { ok: true as const, value: undefined }; });
  render(<App api={api({
    revokeAgentGrant,
    listProxies: async () => ({ ok: true, value: [proxy] }),
    agentApiStatus: async () => ({ ok: true, value: { enabled: true, origin: 'http://127.0.0.1:1', credentials: [{ id: credentialId, label: 'OpenCode', revoked: false, profileIds: revoked ? [] : [profile.id], proxyIds: [proxy.id] }] } }),
  })} />);
  await screen.findByText('Work');
  fireEvent.click(screen.getByRole('button', { name: 'Agent API' }));
  const card = await screen.findByRole('listitem', { name: 'OpenCode' });
  fireEvent.click(within(card).getByRole('button', { name: /OpenCode/ }));
  const profiles = within(card).getByRole('region', { name: 'Profiles (1)' });
  expect(within(card).getByRole('region', { name: 'Proxies (1)' }).textContent).toContain('Shared HTTP');
  fireEvent.click(within(profiles).getByRole('button', { name: 'Remove access: Work' }));
  await waitFor(() => expect(revokeAgentGrant).toHaveBeenCalledWith({ credentialId, kind: 'profile', resourceId: profile.id }));
  await within(card).findByRole('region', { name: 'Profiles (0)' });
  expect(within(card).getByRole('region', { name: 'Proxies (1)' }).textContent).toContain('Shared HTTP');
  expect(screen.getByRole('button', { name: 'Revoke' })).toBeTruthy();
});

it('labels a grant whose resource no longer exists', async () => {
  render(<App api={api({ agentApiStatus: async () => ({ ok: true, value: { enabled: true, origin: 'http://127.0.0.1:1', credentials: [{ id: credentialId, label: 'OpenCode', revoked: false, profileIds: ['00000000-0000-4000-8000-0000000000aa'], proxyIds: [] }] } }) })} />);
  await screen.findByText('Work');
  fireEvent.click(screen.getByRole('button', { name: 'Agent API' }));
  const card = await screen.findByRole('listitem', { name: 'OpenCode' });
  fireEvent.click(within(card).getByRole('button', { name: /OpenCode/ }));
  expect(within(card).getByRole('region', { name: 'Profiles (1)' }).textContent).toContain('Unknown resource');
});

it('keeps the shown grants when granting fails', async () => {
  const grantAgentCredential = vi.fn(async () => ({ ok: false as const, error: { code: 'OPERATION_FAILED', message: 'failed' } }));
  render(<App api={api({
    list: async () => ({ ok: true, value: [profile, second] }),
    grantAgentCredential,
    agentApiStatus: async () => ({ ok: true, value: { enabled: true, origin: 'http://127.0.0.1:1', credentials: [{ id: credentialId, label: 'OpenCode', revoked: false, profileIds: [], proxyIds: [] }] } }),
  })} />);
  await screen.findByText('Work');
  fireEvent.click(screen.getByRole('button', { name: 'Agent API' }));
  const card = await screen.findByRole('listitem', { name: 'OpenCode' });
  fireEvent.click(within(card).getByRole('button', { name: /OpenCode/ }));
  fireEvent.click(within(card).getByRole('button', { name: 'Add access' }));
  fireEvent.click(within(card).getByRole('checkbox', { name: 'Work' }));
  fireEvent.click(within(card).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(grantAgentCredential).toHaveBeenCalled());
  expect(within(card).getByRole('region', { name: 'Profiles (0)' }).textContent).toContain('No profiles granted.');
  expect(screen.getByRole('alert').textContent).toContain('Operation failed');
});

it('keeps the shown grants when revoking fails', async () => {
  const agentApiStatus = vi.fn(async () => ({ ok: true as const, value: { enabled: true, origin: 'http://127.0.0.1:1', credentials: [{ id: credentialId, label: 'OpenCode', revoked: false, profileIds: [profile.id], proxyIds: [] }] } }));
  const revokeAgentGrant = vi.fn(async () => ({ ok: false as const, error: { code: 'OPERATION_FAILED', message: 'failed' } }));
  render(<App api={api({ revokeAgentGrant, agentApiStatus })} />);
  await screen.findByText('Work');
  fireEvent.click(screen.getByRole('button', { name: 'Agent API' }));
  const card = await screen.findByRole('listitem', { name: 'OpenCode' });
  fireEvent.click(within(card).getByRole('button', { name: /OpenCode/ }));
  await waitFor(() => expect(agentApiStatus).toHaveBeenCalledTimes(1));
  fireEvent.click(within(card).getByRole('button', { name: 'Remove access: Work' }));
  await waitFor(() => expect(revokeAgentGrant).toHaveBeenCalled());
  expect(screen.getByRole('alert').textContent).toContain('Operation failed');
  expect(within(card).getByText('Work')).toBeTruthy();
  expect(agentApiStatus).toHaveBeenCalledTimes(1);
});

it('revokes an active credential', async () => {  const revokeAgentCredential = vi.fn(api().revokeAgentCredential);
  render(<App api={api({ revokeAgentCredential, agentApiStatus: async () => ({ ok: true, value: { enabled: true, origin: 'http://127.0.0.1:1', credentials: [{ id: 'd31bb0d8-7bfa-4341-a12a-83a801e8cb4c', label: 'Claude Code', revoked: false, profileIds: [], proxyIds: [] }] } }) })} />);
  await screen.findByText('Work');
  fireEvent.click(screen.getByRole('button', { name: 'Agent API' }));
  await screen.findAllByText('Claude Code');
  fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
  await waitFor(() => expect(revokeAgentCredential).toHaveBeenCalledWith('d31bb0d8-7bfa-4341-a12a-83a801e8cb4c'));
});
