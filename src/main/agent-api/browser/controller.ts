import type { EngineBrowser, EnginePage } from '../../engines/types';

export type BrowserTab = { targetId: string; url: string; title?: string };
export type SnapshotElement = { ref: string; tag: string; role: string | null; name: string; value?: string; disabled?: boolean };
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
  const interactive = 'a[href],button,input,select,textarea,[role=button],[role=link],[role=textbox],[role=checkbox],[role=tab],[contenteditable=""],[contenteditable=true]';
  const out = [];
  const visit = (root, prefix) => {
    let nodes = [];
    try { nodes = Array.from(root.querySelectorAll(interactive)); } catch { return; }
    for (const el of nodes) {
      if (out.length >= ${MAX_ELEMENTS}) return;
      const ref = prefix + out.length;
      el.setAttribute('data-exodus-ref', ref);
      const name = (el.getAttribute('aria-label') || el.getAttribute('name') || (el.innerText || '').trim() || el.getAttribute('placeholder') || el.getAttribute('title') || '').slice(0, 200);
      out.push({ ref, tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), name, value: 'value' in el ? String(el.value ?? '').slice(0, 200) : undefined, disabled: el.disabled === true });
    }
    const all = [];
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

const FIND_SCRIPT = (ref: string) => `(() => {
  const found = [];
  const visit = root => {
    try { const el = root.querySelector('[data-exodus-ref="${ref}"]'); if (el) found.push(el); } catch {}
    const all = [];
    try { all = Array.from(root.querySelectorAll('*')); } catch { return; }
    for (const el of all) {
      if (el.shadowRoot) visit(el.shadowRoot);
      if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') { try { if (el.contentDocument) visit(el.contentDocument); } catch {} }
    }
  };
  visit(document);
  if (!found.length) return { error: 'SELECTOR_NOT_FOUND' };
  const el = found[0];
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return { error: 'ELEMENT_NOT_VISIBLE' };
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, tag: el.tagName.toLowerCase() };
})()`;

const FILL_SCRIPT = (ref: string, text: string) => `(() => {
  const found = [];
  const visit = root => {
    try { const el = root.querySelector('[data-exodus-ref="${ref}"]'); if (el) found.push(el); } catch {}
    const all = [];
    try { all = Array.from(root.querySelectorAll('*')); } catch { return; }
    for (const el of all) {
      if (el.shadowRoot) visit(el.shadowRoot);
      if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') { try { if (el.contentDocument) visit(el.contentDocument); } catch {} }
    }
  };
  visit(document);
  if (!found.length) return { error: 'SELECTOR_NOT_FOUND' };
  const el = found[0];
  if (el.disabled) return { error: 'ELEMENT_DISABLED' };
  el.focus();
  const value = ${JSON.stringify(text)};
  if (el.isContentEditable) { el.textContent = value; }
  else {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true };
})()`;

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
