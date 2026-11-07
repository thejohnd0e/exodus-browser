// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { BrowserController } from '../../src/main/agent-api/browser/controller';
import type { EngineBrowser } from '../../src/main/engines/types';

// jsdom has no layout engine, so innerText is approximated by textContent.
Object.defineProperty(HTMLElement.prototype, 'innerText', { get() { return this.textContent; }, configurable: true });

/** Runs the real in-page scripts against a DOM by evaluating the expressions the controller sends. */
function pageBrowser() {
  const sent: Array<{ method: string; params: Record<string, unknown> }> = [];
  const browser: EngineBrowser = {
    pages: async () => [{ targetId: 't1', url: 'http://fixture/' }],
    attach: async () => 's1',
    send: async <T>(method: string, params: Record<string, unknown>) => {
      sent.push({ method, params });
      if (method === 'Runtime.evaluate') {
        const value = (0, eval)(String(params.expression));
        return (params.returnByValue === false ? { result: value ? { objectId: 'o1' } : { subtype: 'null' } } : { result: { value } }) as T;
      }
      return {} as T;
    },
  };
  return { browser, sent };
}

it('snapshots ARIA listboxes, labelled controls and input state in a real DOM', async () => {
  document.body.innerHTML = `<span id="cat">Category</span><div role="combobox" aria-labelledby="cat" aria-expanded="false"></div>
    <div role="listbox"><div role="option" aria-selected="true">News</div></div>
    <input type="checkbox" checked aria-label="Agree"><input type="file" aria-label="Icon">
    <iframe id="f"></iframe>`;
  (document.getElementById('f') as HTMLIFrameElement).contentDocument!.body.innerHTML = '<button>Inner</button>';
  const { browser } = pageBrowser();
  const snapshot = await new BrowserController(() => browser).snapshot('p', 't1');
  const byName = (name: string) => snapshot.elements.find(element => element.name === name)!;
  expect(byName('Category')).toMatchObject({ role: 'combobox', expanded: false });
  expect(snapshot.elements.some(element => element.role === 'listbox')).toBe(true);
  expect(snapshot.elements.find(element => element.role === 'option')).toMatchObject({ name: 'News', checked: true });
  expect(byName('Agree')).toMatchObject({ type: 'checkbox', checked: true });
  expect(byName('Icon').type).toBe('file');
  expect(snapshot.elements.find(element => element.ref.startsWith('f'))).toMatchObject({ tag: 'button' });
});

it('fills a native select by value or text and reports a missing option', async () => {
  document.body.innerHTML = '<select><option value="en">English</option><option value="ru">Russian</option></select>';
  const { browser } = pageBrowser();
  const controller = new BrowserController(() => browser);
  await controller.snapshot('p', 't1');
  const select = document.querySelector('select')!;
  const ref = select.getAttribute('data-exodus-ref')!;
  await controller.fill('p', 't1', ref, 'Russian');
  expect(select.value).toBe('ru');
  await controller.fill('p', 't1', ref, 'en');
  expect(select.value).toBe('en');
  await expect(controller.fill('p', 't1', ref, 'French')).rejects.toMatchObject({ code: 'OPTION_NOT_FOUND' });
});

it('finds the file input of a dropzone and refuses to fill a file input as text', async () => {
  document.body.innerHTML = '<div><div role="button" id="zone">Drop</div><input type="file" id="real"></div><input type="file" id="direct">';
  const { browser, sent } = pageBrowser();
  const controller = new BrowserController(() => browser);
  await controller.snapshot('p', 't1');
  const zone = document.getElementById('zone')!.getAttribute('data-exodus-ref')!;
  const direct = document.getElementById('direct')!.getAttribute('data-exodus-ref')!;
  await expect(controller.fill('p', 't1', direct, 'x')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  const file = fileURLToPathSafe();
  await controller.upload('p', 't1', zone, [file]);
  await controller.upload('p', 't1', direct, [file]);
  expect(sent.filter(call => call.method === 'DOM.setFileInputFiles')).toHaveLength(2);
});

function fileURLToPathSafe(): string { return process.execPath; }
