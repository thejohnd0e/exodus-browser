import { expect, it } from 'vitest';
import { BrowserController } from '../../src/main/agent-api/browser/controller';
import { AgentManagement } from '../../src/main/agent-api/management';
import type { AgentIdentity } from '../../src/main/agent-api/credentials';
import type { EngineBrowser } from '../../src/main/engines/types';
import { DEFAULT_FINGERPRINT } from '../../src/shared/fingerprint';

const profile = { id: '00000000-0000-4000-8000-000000000011', name: 'Shared', note: '', startUrls: ['about:blank'], languages: ['en-US'], proxyId: null, proxy: null, fingerprint: DEFAULT_FINGERPRINT, fingerprintSeed: 1, restoreLastSession: false, extensionIds: [], createdAt: '', updatedAt: '' };
const a: AgentIdentity = { id: 'agent-a', label: 'A', profileIds: [profile.id], proxyIds: [] };
const b: AgentIdentity = { id: 'agent-b', label: 'B', profileIds: [profile.id], proxyIds: [] };

it('serializes overlapping operations from two agents on one shared tab', async () => {
  const order: string[] = [];
  const browser: EngineBrowser = {
    pages: async () => [{ targetId: 't1', url: 'http://fixture/main' }],
    attach: async () => 's1',
    send: async <T>(method: string, params: Record<string, unknown>) => {
      if (method === 'Runtime.evaluate') {
        const expression = String(params.expression ?? '');
        order.push(expression.includes('scrollIntoView') ? 'click-lookup-start' : 'evaluate-start');
        await new Promise(resolve => setTimeout(resolve, 25));
        order.push(expression.includes('scrollIntoView') ? 'click-lookup-end' : 'evaluate-end');
        if (expression.includes('scrollIntoView')) return { result: { value: { x: 1, y: 2 } } } as T;
        return { result: { value: { ok: true } } } as T;
      }
      return {} as T;
    },
  };
  const management = new AgentManagement({ list: async () => [profile], listProxies: () => [] }, undefined, new BrowserController(() => browser));
  const [first, second] = await Promise.all([
    management.dispatch(a, 'POST', `/api/v1/profiles/${profile.id}/tabs/t1/fill`, { ref: '7', text: 'x' }),
    management.dispatch(b, 'POST', `/api/v1/profiles/${profile.id}/tabs/t1/click`, { ref: '7' }),
  ]);
  expect(first).toEqual({ ok: true });
  expect(second).toEqual({ ok: true });
  expect(order).toEqual(['evaluate-start', 'evaluate-end', 'click-lookup-start', 'click-lookup-end']);
});

it('does not let one agent reach another profile without a grant', async () => {
  const other = { ...profile, id: '00000000-0000-4000-8000-000000000012' };
  const browser: EngineBrowser = { pages: async () => [{ targetId: 't-other', url: 'http://other' }], attach: async () => 's', send: async <T>() => ({}) as T };
  const management = new AgentManagement({ list: async () => [profile, other], listProxies: () => [] }, undefined, new BrowserController(() => browser));
  await expect(management.dispatch(a, 'GET', `/api/v1/profiles/${other.id}/tabs`, undefined)).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
});
