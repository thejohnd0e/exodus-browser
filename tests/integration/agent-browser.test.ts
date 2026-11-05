import { it, expect } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { startFixtureSite } from '../fixtures/automation/site';
import { launchManagedHarness, type ManagedHarness } from '../fixtures/automation/harness';
import { BrowserController } from '../../src/main/agent-api/browser/controller';
import type { EngineBrowser } from '../../src/main/engines/types';

const base = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
const candidates = existsSync(base) ? readdirSync(base).filter(n => n.startsWith('chromium-')).sort().reverse() : [];
const exe = process.env.LOCAL_PROFILES_TEST_CHROMIUM ?? join(base, candidates[0] ?? 'missing', 'chrome-win64', 'chrome.exe');
const fingerprint = { os: 'windows11' as const, userAgent: null, webRtc: 'disableUdp' as const, canvas: 'real' as const, webgl: 'real' as const, webglInfo: { mode: 'real' as const }, webgpu: 'on' as const, clientRects: 'real' as const, audio: 'real' as const, timezone: { mode: 'auto' as const }, geolocation: { mode: 'block' as const }, hardware: { mode: 'real' as const }, screen: { mode: 'real' as const } };

function controller(map: Map<string, EngineBrowser>) { return new BrowserController(id => map.get(id) ?? null); }

async function harnessFor(profileId: string, url: string) {
  const harness = await launchManagedHarness({ executable: exe, profileId, fingerprint, seed: 42, startUrls: [url] });
  expect(harness.process.browser, 'engine exposes the owned CDP handle').toBeDefined();
  return harness;
}

it('drives two running profiles concurrently through their own CDP sessions', async () => {
  if (!existsSync(exe)) throw Error('BLOCKED: no local Chromium');
  const site = await startFixtureSite();
  const map = new Map<string, EngineBrowser>();
  const harnesses: ManagedHarness[] = [];
  try {
    const a = await harnessFor('browser-a', site.origin + '/form?profile=a');
    const b = await harnessFor('browser-b', site.origin + '/main?profile=b');
    harnesses.push(a, b);
    map.set('a', a.process.browser!);
    map.set('b', b.process.browser!);
    const ctl = controller(map);

    const [tabsA, tabsB] = await Promise.all([ctl.tabs('a'), ctl.tabs('b')]);
    expect(tabsA).toHaveLength(1);
    expect(tabsB).toHaveLength(1);
    expect(tabsA[0]!.url).toContain('profile=a');
    expect(tabsB[0]!.url).toContain('profile=b');
    // A target of one profile is never addressable through another profile.
    await expect(ctl.snapshot('b', tabsA[0]!.targetId)).rejects.toMatchObject({ code: 'TAB_NOT_FOUND' });
    await expect(ctl.navigate('b', tabsA[0]!.targetId, site.origin + '/form')).rejects.toMatchObject({ code: 'TAB_NOT_FOUND' });

    const [snapA, snapB] = await Promise.all([ctl.snapshot('a', tabsA[0]!.targetId), ctl.snapshot('b', tabsB[0]!.targetId)]);
    expect(snapA.url).toContain('profile=a');
    expect(snapB.url).toContain('profile=b');
    expect(snapB.text).not.toContain('Saved');

    const input = snapA.elements.find(element => element.tag === 'input' && element.name === 'message');
    const submit = snapA.elements.find(element => element.tag === 'button' && /submit/i.test(element.name));
    expect(input, 'labeled Message input is visible in the snapshot').toBeDefined();
    expect(submit).toBeDefined();
    await ctl.fill('a', tabsA[0]!.targetId, input!.ref, 'Synthetic agent text');
    await ctl.click('a', tabsA[0]!.targetId, submit!.ref);

    const deadline = Date.now() + 10000;
    let saved = false;
    while (Date.now() < deadline && !saved) {
      const snapshot = await ctl.snapshot('a', tabsA[0]!.targetId);
      saved = snapshot.text.includes('Saved');
      if (!saved) await new Promise(resolve => setTimeout(resolve, 200));
    }
    expect(saved, 'form submission result is visible').toBe(true);

    const png = await ctl.screenshot('a', tabsA[0]!.targetId);
    expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await ctl.navigate('b', tabsB[0]!.targetId, site.origin + '/form?profile=b');
    const moved = await ctl.snapshot('b', tabsB[0]!.targetId);
    expect(moved.url).toContain('profile=b');
    expect(moved.elements.some(element => /submit/i.test(element.name))).toBe(true);

    const { targetId } = await b.client.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
    await expect.poll(async () => (await ctl.tabs('b')).length, { timeout: 10000 }).toBe(2);
    await ctl.closeTab('b', targetId);
    await expect.poll(async () => (await ctl.tabs('b')).length, { timeout: 10000 }).toBe(1);

    await a.process.stop();
    await a.process.exit;
    map.delete('a');
    await expect(ctl.tabs('a')).rejects.toMatchObject({ code: 'PROFILE_NOT_RUNNING' });
    expect((await ctl.tabs('b')).length).toBe(1);

    // Restart: the old target ids must never resolve to the new browser.
    const restarted = await harnessFor('browser-a', site.origin + '/form?profile=a2');
    harnesses.push(restarted);
    map.set('a', restarted.process.browser!);
    const restartedTabs = await ctl.tabs('a');
    expect(restartedTabs).toHaveLength(1);
    expect(restartedTabs[0]!.targetId).not.toBe(tabsA[0]!.targetId);
    await expect(ctl.snapshot('a', tabsA[0]!.targetId)).rejects.toMatchObject({ code: 'TAB_NOT_FOUND' });
  } finally {
    for (const harness of harnesses) await harness.close().catch(() => undefined);
    await site.close();
  }
}, 240000);
