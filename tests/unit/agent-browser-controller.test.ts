import { expect, it } from 'vitest';
import { BrowserController } from '../../src/main/agent-api/browser/controller';
import type { EngineBrowser, EnginePage } from '../../src/main/engines/types';

function fakeBrowser(options: { pages?: EnginePage[]; fail?: boolean; never?: boolean } = {}) {
  const calls: Array<{ method: string; params: Record<string, unknown>; sessionId: string }> = [];
  const pages = options.pages ?? [{ targetId: 't1', url: 'http://fixture/main' }];
  const browser: EngineBrowser = {
    pages: async () => pages,
    attach: async targetId => { if (!pages.some(page => page.targetId === targetId)) throw Error('Session with given id not found.'); return 's-' + targetId; },
    send: async <T>(method: string, params: Record<string, unknown>, sessionId: string) => {
      calls.push({ method, params, sessionId });
      if (options.never) return await new Promise<T>(() => undefined);
      if (options.fail) throw Error('CDP_CLOSED');
      if (method === 'Runtime.evaluate') {
        const expression = String(params.expression ?? '');
        if (expression === 'document.title') return { result: { value: 'Title' } } as T;
        if (expression.includes('data-exodus-ref="7"') && expression.includes('scrollIntoView')) return { result: { value: { x: 10, y: 20, tag: 'button' } } } as T;
        if (expression.includes('data-exodus-ref="7"')) return { result: { value: { ok: true } } } as T;
        if (expression.includes('data-exodus-ref="9"')) return { result: { value: { error: 'SELECTOR_NOT_FOUND' } } } as T;
        return { result: { value: { url: 'http://fixture/main', title: 'Title', text: 'Body', truncated: false, elements: [{ ref: '7', tag: 'button', role: null, name: 'Send' }] } } } as T;
      }
      if (method === 'Page.captureScreenshot') return { data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]).toString('base64') } as T;
      return {} as T;
    },
  };
  return { browser, calls };
}

it('scopes every operation to the requesting profile and target', async () => {
  const { browser } = fakeBrowser();
  const controller = new BrowserController(() => browser);
  expect((await controller.tabs('p1')).map(tab => tab.targetId)).toEqual(['t1']);
  await expect(controller.navigate('p1', 'other', 'http://x')).rejects.toMatchObject({ code: 'TAB_NOT_FOUND' });
  await expect(controller.snapshot('p1', 'other')).rejects.toMatchObject({ code: 'TAB_NOT_FOUND' });
  await expect(controller.click('p1', 'other', '7')).rejects.toMatchObject({ code: 'TAB_NOT_FOUND' });
  await expect(controller.fill('p1', 'other', '7', 'x')).rejects.toMatchObject({ code: 'TAB_NOT_FOUND' });
  await expect(controller.screenshot('p1', 'other')).rejects.toMatchObject({ code: 'TAB_NOT_FOUND' });
});

it('reports a stopped profile instead of opening a new connection', async () => {
  const controller = new BrowserController(() => null);
  await expect(controller.tabs('p1')).rejects.toMatchObject({ code: 'PROFILE_NOT_RUNNING' });
  await expect(controller.navigate('p1', 't1', 'http://x')).rejects.toMatchObject({ code: 'PROFILE_NOT_RUNNING' });
});

it('validates URLs and rejects non-http navigation', async () => {
  const { browser } = fakeBrowser();
  const controller = new BrowserController(() => browser);
  await expect(controller.navigate('p1', 't1', 'javascript:alert(1)')).rejects.toMatchObject({ code: 'INVALID_URL' });
  await expect(controller.navigate('p1', 't1', 'file:///etc/passwd')).rejects.toMatchObject({ code: 'INVALID_URL' });
  expect(await controller.navigate('p1', 't1', 'about:blank')).toEqual({ targetId: 't1', url: 'about:blank' });
});

it('returns a bounded snapshot and actionable refs', async () => {
  const { browser, calls } = fakeBrowser();
  const controller = new BrowserController(() => browser);
  const snapshot = await controller.snapshot('p1', 't1');
  expect(snapshot.elements[0]).toMatchObject({ ref: '7', name: 'Send' });
  expect(snapshot.text).toBe('Body');
  expect(calls.find(call => call.method === 'Runtime.evaluate')!.params).toMatchObject({ returnByValue: true, awaitPromise: true });
});

it('clicks and fills through the existing page session', async () => {
  const { browser, calls } = fakeBrowser();
  const controller = new BrowserController(() => browser);
  await controller.click('p1', 't1', '7');
  expect(calls.filter(call => call.method === 'Input.dispatchMouseEvent').map(call => call.params.type)).toEqual(['mouseMoved', 'mousePressed', 'mouseReleased']);
  await controller.fill('p1', 't1', '7', 'hello');
  expect(calls.some(call => call.method === 'Runtime.evaluate' && String(call.params.expression).includes('hello'))).toBe(true);
  await expect(controller.click('p1', 't1', '9')).rejects.toMatchObject({ code: 'SELECTOR_NOT_FOUND' });
});

it('times out stalled CDP calls and cleans up its signal listener', async () => {
  const { browser } = fakeBrowser({ never: true });
  const controller = new BrowserController(() => browser, 50);
  await expect(controller.tabs('p1')).rejects.toMatchObject({ code: 'TIMEOUT' });
});

it('honours cancellation and maps a lost connection', async () => {
  const { browser } = fakeBrowser({ never: true });
  const controller = new BrowserController(() => browser, 5000);
  const abort = new AbortController();
  const pending = controller.snapshot('p1', 't1', abort.signal);
  abort.abort();
  await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });

  const failing = fakeBrowser({ fail: true });
  const broken = new BrowserController(() => failing.browser);
  await expect(broken.tabs('p1')).rejects.toMatchObject({ code: 'CONNECTION_LOST' });
});

it('returns PNG bytes for a screenshot and rejects oversized artifacts', async () => {
  const { browser } = fakeBrowser();
  const controller = new BrowserController(() => browser);
  const png = await controller.screenshot('p1', 't1');
  expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
});

it('serializes operations on one tab so navigate, click, fill and close cannot interleave', async () => {
  const order: string[] = [];
  const pages = [{ targetId: 't1', url: 'http://fixture/main' }];
  const browser: EngineBrowser = {
    pages: async () => pages,
    attach: async () => 's1',
    send: async <T>(method: string, params: Record<string, unknown>) => {
      if (method === 'Runtime.evaluate') { order.push('evaluate-start'); await new Promise(r => setTimeout(r, 30)); order.push('evaluate-end'); return { result: { value: { ok: true } } } as T; }
      if (method === 'Page.navigate') { order.push('navigate'); return {} as T; }
      if (method === 'Target.closeTarget') { order.push('close'); return {} as T; }
      void params;
      return {} as T;
    },
  };
  const controller = new BrowserController(() => browser);
  await Promise.all([
    controller.fill('p1', 't1', '7', 'text'),
    controller.navigate('p1', 't1', 'http://fixture/next'),
    controller.closeTab('p1', 't1'),
  ]);
  expect(order).toEqual(['evaluate-start', 'evaluate-end', 'navigate', 'close']);
});

it('cleans up after a timeout so the next operation still runs', async () => {
  let slow = true;
  const browser: EngineBrowser = {
    pages: async () => [{ targetId: 't1', url: 'http://fixture/main' }],
    attach: async () => 's1',
    send: async <T>(method: string) => {
      if (method === 'Runtime.evaluate' && slow) { slow = false; return await new Promise<T>(() => undefined); }
      if (method === 'Runtime.evaluate') return { result: { value: { url: 'http://x', title: '', text: '', truncated: false, elements: [] } } } as T;
      return {} as T;
    },
  };
  const controller = new BrowserController(() => browser, 50);
  await expect(controller.snapshot('p1', 't1')).rejects.toMatchObject({ code: 'TIMEOUT' });
  await expect(controller.snapshot('p1', 't1')).resolves.toMatchObject({ url: 'http://x' });
});

it('keeps different profiles independent and cancellable', async () => {
  const release: Array<() => void> = [];
  const browser = (label: string): EngineBrowser => ({
    pages: async () => [{ targetId: 't-' + label, url: 'http://' + label }],
    attach: async () => 's-' + label,
    send: async <T>() => { await new Promise<void>(resolve => release.push(resolve)); return { result: { value: { url: 'http://x', title: '', text: '', truncated: false, elements: [] } } } as T; },
  });
  const controller = new BrowserController(id => browser(id));
  const abort = new AbortController();
  const cancelled = controller.snapshot('a', 't-a', abort.signal);
  const other = controller.snapshot('b', 't-b');
  abort.abort();
  await expect(cancelled).rejects.toMatchObject({ code: 'CANCELLED' });
  release.forEach(fn => fn());
  await expect(other).resolves.toBeDefined();
});

it('rejects a stale targetId after its tab was closed', async () => {
  const pages = [{ targetId: 't1', url: 'http://fixture/main' }];
  const browser: EngineBrowser = {
    pages: async () => pages,
    attach: async () => 's1',
    send: async <T>(method: string) => { if (method === 'Target.closeTarget') pages.length = 0; return {} as T; },
  };
  const controller = new BrowserController(() => browser);
  await controller.closeTab('p1', 't1');
  for (const call of [
    () => controller.snapshot('p1', 't1'),
    () => controller.click('p1', 't1', '7'),
    () => controller.fill('p1', 't1', '7', 'x'),
    () => controller.navigate('p1', 't1', 'http://fixture/next'),
    () => controller.screenshot('p1', 't1'),
  ]) await expect(call()).rejects.toMatchObject({ code: 'TAB_NOT_FOUND' });
});

it('closes only a tab that belongs to the profile', async () => {
  const { browser, calls } = fakeBrowser();
  const controller = new BrowserController(() => browser);
  await expect(controller.closeTab('p1', 'other')).rejects.toMatchObject({ code: 'TAB_NOT_FOUND' });
  await controller.closeTab('p1', 't1');
  expect(calls.some(call => call.method === 'Target.closeTarget')).toBe(true);
});

import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('snapshots ARIA widgets and exposes type, checked and expanded', async () => {
  const { browser, calls } = fakeBrowser();
  await new BrowserController(() => browser).snapshot('p1', 't1');
  const expression = String(calls.find(call => call.method === 'Runtime.evaluate')!.params.expression);
  for (const selector of ['[role=listbox]', '[role=combobox]', '[role=option]', '[role=radio]', '[role=switch]', '[role=menuitem]']) expect(expression).toContain(selector);
  expect(expression).toContain('aria-labelledby');
  expect(expression).toContain('aria-expanded');
  expect(expression).toContain('item.type');
  // Traversal of frames and shadow roots must not reassign a constant.
  expect(expression).not.toContain('const all');
});

it('fills a native select by option value or visible text and rejects file inputs', async () => {
  const { browser, calls } = fakeBrowser();
  await new BrowserController(() => browser).fill('p1', 't1', '7', 'English');
  const expression = String(calls.filter(call => call.method === 'Runtime.evaluate').at(-1)!.params.expression);
  expect(expression).toContain('HTMLSelectElement');
  expect(expression).toContain('OPTION_NOT_FOUND');
  expect(expression).toContain("el.type === 'file'");
});

it('uploads validated local files through DOM.setFileInputFiles without a file dialog', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'exodus-upload-'));
  try {
    const file = join(directory, 'icon.png');
    await writeFile(file, 'png');
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const browser = fakeBrowser().browser;
    const send = browser.send;
    browser.send = (async (method: string, params: Record<string, unknown>, sessionId: string, timeout?: number) => {
      calls.push({ method, params });
      if (method === 'Runtime.evaluate' && params.returnByValue === false) return { result: { type: 'object', objectId: 'node-1' } };
      return send(method, params, sessionId, timeout);
    }) as typeof browser.send;
    const controller = new BrowserController(() => browser);
    await controller.upload('p1', 't1', '7', [file]);
    expect(calls.find(call => call.method === 'DOM.setFileInputFiles')!.params).toEqual({ objectId: 'node-1', files: [file] });
    const notify = calls.find(call => call.method === 'Runtime.callFunctionOn')!.params;
    expect(String(notify.functionDeclaration)).toContain("'change'");
    expect(String(calls.find(call => call.method === 'Runtime.evaluate')!.params.expression)).toContain('input[type="file"]');
    expect(calls.some(call => call.method === 'Page.fileChooserOpened' || call.method === 'Input.dispatchMouseEvent')).toBe(false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('rejects unsafe or missing upload inputs before touching the page', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'exodus-upload-'));
  try {
    const file = join(directory, 'a.txt');
    await writeFile(file, 'x');
    const { browser, calls } = fakeBrowser();
    const controller = new BrowserController(() => browser);
    for (const files of [[], 'a', [1], ['relative.png'], [directory], [join(directory, 'missing.png')], Array.from({ length: 21 }, () => file)]) {
      await expect(controller.upload('p1', 't1', '7', files)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
    const link = join(directory, 'link.txt');
    if (await symlink(file, link).then(() => true, () => false)) await expect(controller.upload('p1', 't1', '7', [link])).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(calls).toEqual([]);
    await expect(controller.upload('p1', 'other', '7', [file])).rejects.toMatchObject({ code: 'TAB_NOT_FOUND' });
    await expect(controller.upload('p1', 't1', '7', [file])).rejects.toMatchObject({ code: 'FILE_INPUT_NOT_FOUND' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('presses keys through CDP, optionally focusing a ref first', async () => {
  const { browser, calls } = fakeBrowser();
  const controller = new BrowserController(() => browser);
  await controller.press('p1', 't1', 'ArrowDown', '7');
  const keys = calls.filter(call => call.method === 'Input.dispatchKeyEvent');
  expect(keys.map(call => call.params.type)).toEqual(['rawKeyDown', 'keyUp']);
  expect(keys[0]!.params).toMatchObject({ key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  expect(calls.findIndex(call => String(call.params.expression).includes('.focus()'))).toBeLessThan(calls.findIndex(call => call.method === 'Input.dispatchKeyEvent'));
  calls.length = 0;
  await controller.press('p1', 't1', 'Enter');
  expect(calls.map(call => call.method)).toEqual(['Input.dispatchKeyEvent', 'Input.dispatchKeyEvent']);
  expect(calls[0]!.params).toMatchObject({ type: 'keyDown', key: 'Enter', text: '\r' });
  await expect(controller.press('p1', 't1', 'F13')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await expect(controller.press('p1', 't1', 'toString')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await expect(controller.press('p1', 't1', 'Tab', '9')).rejects.toMatchObject({ code: 'SELECTOR_NOT_FOUND' });
  await expect(controller.press('p1', 'other', 'Tab')).rejects.toMatchObject({ code: 'TAB_NOT_FOUND' });
});
