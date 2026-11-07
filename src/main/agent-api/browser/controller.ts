import { lstat } from 'node:fs/promises';
import { isAbsolute, normalize } from 'node:path';
import type { EngineBrowser, EnginePage } from '../../engines/types';

export type BrowserTab = { targetId: string; url: string; title?: string };
export type SnapshotElement = { ref: string; tag: string; role: string | null; name: string; value?: string; disabled?: boolean; type?: string; checked?: boolean; expanded?: boolean };
export type Snapshot = { url: string; title: string; text: string; elements: SnapshotElement[]; truncated: boolean };
export type BrowserError = Error & { code: string };

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_TEXT = 20000;
const MAX_ELEMENTS = 400;

function fail(code: string, message = code): BrowserError { return Object.assign(Error(message), { code }); }

/** Bounded operation: a caller's signal, an internal deadline, and cleanup on either. */
export async function withDeadline<T>(promise: Promise<T>, timeoutMs: number, code: string, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw fail('CANCELLED');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(fail(code)), timeoutMs); }),
      new Promise<never>((_, reject) => { onAbort = () => reject(fail('CANCELLED')); signal?.addEventListener('abort', onAbort, { once: true }); }),
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

// Runs in the page. Same-origin iframes and open shadow roots are traversed; cross-origin frames
// are separate CDP targets and are addressed by their own targetId instead.
const SNAPSHOT_SCRIPT = `(() => {
  const interactive = [
    'a[href]', 'button', 'input', 'select', 'textarea', 'summary',
    '[role=button]', '[role=link]', '[role=textbox]', '[role=checkbox]',
    '[role=radio]', '[role=switch]', '[role=combobox]', '[role=listbox]',
    '[role=option]', '[role=menuitem]', '[role=menuitemcheckbox]',
    '[role=menuitemradio]', '[role=tab]', '[role=slider]', '[role=spinbutton]',
    '[contenteditable=""]', '[contenteditable=true]'
  ].join(',');
  const out = [];
  const visit = (root, prefix) => {
    let nodes = [];
    try { nodes = Array.from(root.querySelectorAll(interactive)); } catch { return; }
    for (const el of nodes) {
      if (out.length >= ${MAX_ELEMENTS}) return;
      const ref = prefix + out.length;
      el.setAttribute('data-exodus-ref', ref);
      const owner = el.ownerDocument || document;
      const labelledBy = (el.getAttribute('aria-labelledby') || '').split(/\\s+/).map(id => { const target = id ? owner.getElementById(id) : null; return target ? (target.innerText || target.textContent || '').trim() : ''; }).filter(Boolean).join(' ');
      const name = (el.getAttribute('aria-label') || labelledBy || el.getAttribute('name') || (el.innerText || '').trim() || el.getAttribute('placeholder') || el.getAttribute('title') || '').slice(0, 200);
      const item = { ref, tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), name, value: 'value' in el ? String(el.value ?? '').slice(0, 200) : undefined, disabled: el.disabled === true };
      if (el.tagName === 'INPUT' && el.type) item.type = el.type;
      if (el.checked === true || el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true') item.checked = true;
      const expanded = el.getAttribute('aria-expanded');
      if (expanded === 'true') item.expanded = true; else if (expanded === 'false') item.expanded = false;
      out.push(item);
    }
    let all = [];
    try { all = Array.from(root.querySelectorAll('*')); } catch { return; }
    for (const el of all) {
      const shadow = el.shadowRoot;
      if (shadow) visit(shadow, prefix + 's');
      if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
        try {
          const doc = el.contentDocument;
          if (doc && doc.body) visit(doc, prefix + 'f');
        } catch { /* cross-origin: separate target */ }
      }
    }
  };
  visit(document, '');
  const text = (document.body ? document.body.innerText : '').replace(/\\u00a0/g, ' ');
  return { url: location.href, title: document.title, text: text.slice(0, ${MAX_TEXT}), truncated: text.length > ${MAX_TEXT}, elements: out };
})()`;

// Shared in-page lookup of a snapshot ref across the document, open shadow roots and same-origin frames.
const LOCATE = (ref: string) => `const found = [];
  const visit = root => {
    try { const el = root.querySelector('[data-exodus-ref="${ref}"]'); if (el) found.push(el); } catch {}
    let all = [];
    try { all = Array.from(root.querySelectorAll('*')); } catch { return; }
    for (const el of all) {
      if (el.shadowRoot) visit(el.shadowRoot);
      if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') { try { if (el.contentDocument) visit(el.contentDocument); } catch {} }
    }
  };
  visit(document);`;

const FIND_SCRIPT = (ref: string) => `(() => {
  ${LOCATE(ref)}
  if (!found.length) return { error: 'SELECTOR_NOT_FOUND' };
  const el = found[0];
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return { error: 'ELEMENT_NOT_VISIBLE' };
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, tag: el.tagName.toLowerCase() };
})()`;

const FILL_SCRIPT = (ref: string, text: string) => `(() => {
  ${LOCATE(ref)}
  if (!found.length) return { error: 'SELECTOR_NOT_FOUND' };
  const el = found[0];
  if (el.disabled) return { error: 'ELEMENT_DISABLED' };
  if (el instanceof HTMLInputElement && el.type === 'file') return { error: 'INVALID_INPUT' };
  el.focus();
  const value = ${JSON.stringify(text)};
  if (el instanceof HTMLSelectElement) {
    const wanted = value.trim().toLowerCase();
    const options = Array.from(el.options);
    const option = options.find(opt => opt.value === value) || options.find(opt => opt.text.trim().toLowerCase() === wanted);
    if (!option) return { error: 'OPTION_NOT_FOUND' };
    el.value = option.value;
  } else if (el.isContentEditable) { el.textContent = value; }
  else {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true };
})()`;

// Resolves the <input type="file"> for a ref: the element itself, or one inside / next to a dropzone.
const FILE_INPUT_SCRIPT = (ref: string) => `(() => {
  ${LOCATE(ref)}
  if (!found.length) return null;
  const el = found[0];
  if (el instanceof HTMLInputElement && el.type === 'file') return el;
  return el.querySelector('input[type="file"]') || (el.parentElement && el.parentElement.querySelector('input[type="file"]')) || null;
})()`;

const FOCUS_SCRIPT = (ref: string) => `(() => {
  ${LOCATE(ref)}
  if (!found.length) return { error: 'SELECTOR_NOT_FOUND' };
  found[0].focus();
  return { ok: true };
})()`;

// DOM.setFileInputFiles already notifies Chromium; the explicit events make framework listeners (React, Angular, Closure) pick the file up.
const NOTIFY_FILES = `function () { this.dispatchEvent(new Event('input', { bubbles: true })); this.dispatchEvent(new Event('change', { bubbles: true })); return true; }`;

const MAX_UPLOAD_FILES = 20;
type KeySpec = { key: string; code: string; keyCode: number; text?: string };
const KEYS: Record<string, KeySpec> = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
};
export const PRESS_KEYS = Object.keys(KEYS);

/** One profile-scoped controller over CDP sessions owned by Exodus. No second connection is opened. */
export class BrowserController {
  /** Operations on the same profile+target are serialized so navigate/click/fill/close cannot interleave. */
  private queues = new Map<string, Promise<unknown>>();

  constructor(private browserFor: (profileId: string) => EngineBrowser | null, private timeoutMs = DEFAULT_TIMEOUT_MS) {}

  private serial<T>(profileId: string, targetId: string | undefined, operation: () => Promise<T>): Promise<T> {
    const key = `${profileId}\u0000${targetId ?? '*'}`;
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    const settled = next.catch(() => undefined);
    this.queues.set(key, settled);
    void settled.then(() => { if (this.queues.get(key) === settled) this.queues.delete(key); });
    return next;
  }

  private require(profileId: string): EngineBrowser {
    const browser = this.browserFor(profileId);
    if (!browser) throw fail('PROFILE_NOT_RUNNING');
    return browser;
  }

  private async send<T>(browser: EngineBrowser, method: string, params: Record<string, unknown>, sessionId: string, signal?: AbortSignal, timeoutMs = this.timeoutMs): Promise<T> {
    try { return await withDeadline(browser.send<T>(method, params, sessionId, timeoutMs), timeoutMs + 1000, 'TIMEOUT', signal); }
    catch (error) {
      const code = (error as BrowserError).code;
      if (code) throw error;
      const message = error instanceof Error ? error.message : '';
      if (/CDP_CLOSED|Target closed|Session with given id not found/i.test(message)) throw fail('CONNECTION_LOST', message);
      throw fail('BROWSER_ERROR', message);
    }
  }

  private async evaluate<T>(browser: EngineBrowser, sessionId: string, expression: string, signal?: AbortSignal): Promise<T> {
    const result = await this.send<{ result?: { value?: T }; exceptionDetails?: { text?: string } }>(browser, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId, signal);
    if (result.exceptionDetails) throw fail('EVALUATION_FAILED', result.exceptionDetails.text ?? 'EVALUATION_FAILED');
    return result.result?.value as T;
  }

  private async pages(browser: EngineBrowser): Promise<EnginePage[]> { return browser.pages(); }

  private async session(browser: EngineBrowser, targetId: string): Promise<string> { return browser.attach(targetId); }

  async tabs(profileId: string, signal?: AbortSignal): Promise<BrowserTab[]> { return this.serial(profileId, undefined, () => this.run_tabs(profileId, signal)); }
  async navigate(profileId: string, targetId: string, url: string, signal?: AbortSignal): Promise<{ targetId: string; url: string }> { return this.serial(profileId, targetId, () => this.run_navigate(profileId, targetId, url, signal)); }
  async closeTab(profileId: string, targetId: string, signal?: AbortSignal): Promise<void> { return this.serial(profileId, targetId, () => this.run_closeTab(profileId, targetId, signal)); }
  async snapshot(profileId: string, targetId: string, signal?: AbortSignal): Promise<Snapshot> { return this.serial(profileId, targetId, () => this.run_snapshot(profileId, targetId, signal)); }
  async click(profileId: string, targetId: string, ref: string, signal?: AbortSignal): Promise<void> { return this.serial(profileId, targetId, () => this.run_click(profileId, targetId, ref, signal)); }
  async fill(profileId: string, targetId: string, ref: string, text: string, signal?: AbortSignal): Promise<void> { return this.serial(profileId, targetId, () => this.run_fill(profileId, targetId, ref, text, signal)); }
  async upload(profileId: string, targetId: string, ref: string, files: unknown, signal?: AbortSignal): Promise<void> { return this.serial(profileId, targetId, () => this.run_upload(profileId, targetId, ref, files, signal)); }
  async press(profileId: string, targetId: string, key: string, ref?: string, signal?: AbortSignal): Promise<void> { return this.serial(profileId, targetId, () => this.run_press(profileId, targetId, key, ref, signal)); }
  async screenshot(profileId: string, targetId: string, signal?: AbortSignal): Promise<Buffer> { return this.serial(profileId, targetId, () => this.run_screenshot(profileId, targetId, signal)); }

  private async run_tabs(profileId: string, signal?: AbortSignal): Promise<BrowserTab[]> {
    const browser = this.require(profileId);
    const pages = await withDeadline(this.pages(browser), this.timeoutMs, 'TIMEOUT', signal);
    const tabs: BrowserTab[] = [];
    for (const page of pages) {
      try {
        const sessionId = await this.session(browser, page.targetId);
        const title = await this.evaluate<string>(browser, sessionId, 'document.title', signal);
        tabs.push({ targetId: page.targetId, url: page.url ?? '', title });
      } catch (error) {
        const code = (error as BrowserError).code;
        if (code && ['CANCELLED', 'TIMEOUT', 'CONNECTION_LOST', 'PROFILE_NOT_RUNNING'].includes(code)) throw error;
        tabs.push({ targetId: page.targetId, url: page.url ?? '' });
      }
    }
    return tabs;
  }

  private async run_navigate(profileId: string, targetId: string, url: string, signal?: AbortSignal): Promise<{ targetId: string; url: string }> {
    const browser = this.require(profileId);
    if (!/^https?:\/\//i.test(url) && url !== 'about:blank') throw fail('INVALID_URL');
    const pages = await this.pages(browser);
    if (!pages.some(page => page.targetId === targetId)) throw fail('TAB_NOT_FOUND');
    const sessionId = await this.session(browser, targetId);
    const result = await this.send<{ errorText?: string; frameId?: string }>(browser, 'Page.navigate', { url }, sessionId, signal);
    if (result.errorText) throw fail('NAVIGATION_FAILED', result.errorText);
    return { targetId, url };
  }

  private async run_closeTab(profileId: string, targetId: string, signal?: AbortSignal): Promise<void> {
    const browser = this.require(profileId);
    const pages = await this.pages(browser);
    if (!pages.some(page => page.targetId === targetId)) throw fail('TAB_NOT_FOUND');
    await this.send(browser, 'Target.closeTarget', { targetId }, await this.session(browser, targetId), signal);
  }

  private async run_snapshot(profileId: string, targetId: string, signal?: AbortSignal): Promise<Snapshot> {
    const browser = this.require(profileId);
    const pages = await this.pages(browser);
    if (!pages.some(page => page.targetId === targetId)) throw fail('TAB_NOT_FOUND');
    const sessionId = await this.session(browser, targetId);
    const snapshot = await this.evaluate<Snapshot>(browser, sessionId, SNAPSHOT_SCRIPT, signal);
    snapshot.elements = (snapshot.elements ?? []).slice(0, MAX_ELEMENTS);
    snapshot.text = (snapshot.text ?? '').slice(0, MAX_TEXT);
    return snapshot;
  }

  private async run_click(profileId: string, targetId: string, ref: string, signal?: AbortSignal): Promise<void> {
    const browser = this.require(profileId);
    const pages = await this.pages(browser);
    if (!pages.some(page => page.targetId === targetId)) throw fail('TAB_NOT_FOUND');
    const sessionId = await this.session(browser, targetId);
    const position = await this.evaluate<{ x: number; y: number; error?: string }>(browser, sessionId, FIND_SCRIPT(ref.replace(/[^a-zA-Z0-9]/g, '')), signal);
    if (position.error) throw fail(position.error);
    await this.send(browser, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: position.x, y: position.y }, sessionId, signal);
    await this.send(browser, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: position.x, y: position.y, button: 'left', clickCount: 1 }, sessionId, signal);
    await this.send(browser, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: position.x, y: position.y, button: 'left', clickCount: 1 }, sessionId, signal);
  }

  private async run_fill(profileId: string, targetId: string, ref: string, text: string, signal?: AbortSignal): Promise<void> {
    if (typeof text !== 'string' || text.length > 10000) throw fail('INVALID_INPUT');
    const browser = this.require(profileId);
    const pages = await this.pages(browser);
    if (!pages.some(page => page.targetId === targetId)) throw fail('TAB_NOT_FOUND');
    const sessionId = await this.session(browser, targetId);
    const result = await this.evaluate<{ ok?: boolean; error?: string }>(browser, sessionId, FILL_SCRIPT(ref.replace(/[^a-zA-Z0-9]/g, ''), text), signal);
    if (result.error) throw fail(result.error);
  }

  /** Local files are validated in the main process, then attached through CDP; no OS file dialog is opened. */
  private async run_upload(profileId: string, targetId: string, ref: string, files: unknown, signal?: AbortSignal): Promise<void> {
    if (!Array.isArray(files) || files.length < 1 || files.length > MAX_UPLOAD_FILES) throw fail('INVALID_INPUT');
    const resolved: string[] = [];
    for (const file of files) {
      if (typeof file !== 'string' || !file || file.includes('\u0000') || !isAbsolute(file)) throw fail('INVALID_INPUT');
      const info = await lstat(file).catch(() => null);
      if (!info || !info.isFile() || info.isSymbolicLink()) throw fail('INVALID_INPUT');
      resolved.push(normalize(file));
    }
    const browser = this.require(profileId);
    const pages = await this.pages(browser);
    if (!pages.some(page => page.targetId === targetId)) throw fail('TAB_NOT_FOUND');
    const sessionId = await this.session(browser, targetId);
    const located = await this.send<{ result?: { objectId?: string; subtype?: string }; exceptionDetails?: { text?: string } }>(browser, 'Runtime.evaluate', { expression: FILE_INPUT_SCRIPT(ref.replace(/[^a-zA-Z0-9]/g, '')), returnByValue: false }, sessionId, signal);
    if (located.exceptionDetails) throw fail('EVALUATION_FAILED', located.exceptionDetails.text ?? 'EVALUATION_FAILED');
    const objectId = located.result?.objectId;
    if (!objectId || located.result?.subtype === 'null') throw fail('FILE_INPUT_NOT_FOUND');
    await this.send(browser, 'DOM.setFileInputFiles', { objectId, files: resolved }, sessionId, signal);
    await this.send(browser, 'Runtime.callFunctionOn', { objectId, functionDeclaration: NOTIFY_FILES, returnByValue: true }, sessionId, signal);
  }

  private async run_press(profileId: string, targetId: string, key: string, ref: string | undefined, signal?: AbortSignal): Promise<void> {
    const spec = typeof key === 'string' && Object.hasOwn(KEYS, key) ? KEYS[key]! : null;
    if (!spec) throw fail('INVALID_INPUT');
    const browser = this.require(profileId);
    const pages = await this.pages(browser);
    if (!pages.some(page => page.targetId === targetId)) throw fail('TAB_NOT_FOUND');
    const sessionId = await this.session(browser, targetId);
    if (ref !== undefined) {
      const focused = await this.evaluate<{ ok?: boolean; error?: string }>(browser, sessionId, FOCUS_SCRIPT(ref.replace(/[^a-zA-Z0-9]/g, '')), signal);
      if (focused.error) throw fail(focused.error);
    }
    const base = { key: spec.key, code: spec.code, windowsVirtualKeyCode: spec.keyCode, nativeVirtualKeyCode: spec.keyCode };
    await this.send(browser, 'Input.dispatchKeyEvent', { type: spec.text ? 'keyDown' : 'rawKeyDown', ...base, ...(spec.text ? { text: spec.text } : {}) }, sessionId, signal);
    await this.send(browser, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base }, sessionId, signal);
  }

  private async run_screenshot(profileId: string, targetId: string, signal?: AbortSignal): Promise<Buffer> {
    const browser = this.require(profileId);
    const pages = await this.pages(browser);
    if (!pages.some(page => page.targetId === targetId)) throw fail('TAB_NOT_FOUND');
    const sessionId = await this.session(browser, targetId);
    const result = await this.send<{ data: string }>(browser, 'Page.captureScreenshot', { format: 'png' }, sessionId, signal);
    const png = Buffer.from(result.data, 'base64');
    if (png.length < 8 || png[0] !== 0x89 || png[1] !== 0x50) throw fail('SCREENSHOT_FAILED');
    if (png.length > 5 * 1024 * 1024) throw fail('ARTIFACT_TOO_LARGE');
    return png;
  }
}
