/**
 * Page script for the differential test. It collects a flat map of observable browser properties
 * and posts it to /report. It is served as a classic script wrapped in an async function.
 */
export const DIFFERENTIAL_PROBE = String.raw`
const out = {};
const put = (k, v) => { out[k] = typeof v === 'string' ? v : JSON.stringify(v); };
const safe = (k, f) => { try { const v = f(); put(k, v === undefined ? 'undefined' : v); } catch (e) { put(k, 'throws:' + (e && e.constructor && e.constructor.name)); } };
const N = navigator;
for (const name of Object.getOwnPropertyNames(Navigator.prototype).sort()) {
  const d = Object.getOwnPropertyDescriptor(Navigator.prototype, name);
  put('navigator.shape.' + name, (d.get ? 'getter' : typeof d.value) + ':' + d.enumerable + ':' + d.configurable);
}
for (const name of ['userAgent', 'appVersion', 'platform', 'vendor', 'language', 'languages', 'hardwareConcurrency', 'deviceMemory', 'webdriver', 'cookieEnabled', 'maxTouchPoints', 'pdfViewerEnabled', 'doNotTrack', 'onLine'])
  safe('navigator.' + name, () => N[name]);
safe('navigator.plugins', () => Array.from(N.plugins).map(p => p.name).join('|'));
safe('navigator.mimeTypes', () => Array.from(N.mimeTypes).map(p => p.type).join('|'));
safe('uach.brands', () => N.userAgentData.brands);
safe('uach.mobile', () => N.userAgentData.mobile);
safe('uach.platform', () => N.userAgentData.platform);
for (const name of ['width', 'height', 'availWidth', 'availHeight', 'colorDepth', 'pixelDepth']) safe('screen.' + name, () => screen[name]);
safe('dpr', () => devicePixelRatio);
for (const q of ['(device-width: 1920px)', '(min-resolution: 2dppx)', '(prefers-color-scheme: dark)', '(prefers-reduced-motion: reduce)', '(hover: hover)', '(pointer: fine)', '(color-gamut: srgb)', '(dynamic-range: high)'])
  safe('mq.' + q, () => matchMedia(q).matches);
const ro = Intl.DateTimeFormat().resolvedOptions();
put('intl.locale', ro.locale); put('intl.timeZone', ro.timeZone); put('intl.calendar', ro.calendar); put('intl.numbering', ro.numberingSystem);
safe('date.offset', () => new Date(2026, 0, 15, 12).getTimezoneOffset());
safe('date.string', () => new Date(Date.UTC(2026, 0, 15, 12)).toString());
const wrapped = {
  'Function.prototype.toString': Function.prototype.toString,
  'Navigator.hardwareConcurrency': Object.getOwnPropertyDescriptor(Navigator.prototype, 'hardwareConcurrency').get,
  'Navigator.deviceMemory': Object.getOwnPropertyDescriptor(Navigator.prototype, 'deviceMemory').get,
  'Screen.width': Object.getOwnPropertyDescriptor(Screen.prototype, 'width').get,
  'Screen.availHeight': Object.getOwnPropertyDescriptor(Screen.prototype, 'availHeight').get,
  'HTMLCanvasElement.toDataURL': HTMLCanvasElement.prototype.toDataURL,
  'HTMLCanvasElement.toBlob': HTMLCanvasElement.prototype.toBlob,
  'CanvasRenderingContext2D.getImageData': CanvasRenderingContext2D.prototype.getImageData,
  'WebGLRenderingContext.getParameter': WebGLRenderingContext.prototype.getParameter,
  'WebGLRenderingContext.readPixels': WebGLRenderingContext.prototype.readPixels,
  'Element.getBoundingClientRect': Element.prototype.getBoundingClientRect,
  'Element.getClientRects': Element.prototype.getClientRects,
  'AudioBuffer.getChannelData': AudioBuffer.prototype.getChannelData,
  'window.matchMedia': window.matchMedia,
};
const fts = Function.prototype.toString;
for (const key of Object.keys(wrapped)) {
  const f = wrapped[key];
  safe('fn.' + key + '.source', () => fts.call(f));
  safe('fn.' + key + '.name', () => f.name);
  safe('fn.' + key + '.length', () => f.length);
  safe('fn.' + key + '.hasPrototype', () => 'prototype' in f);
  safe('fn.' + key + '.ownNames', () => Object.getOwnPropertyNames(f).sort().join(','));
  safe('fn.' + key + '.proto', () => Object.getPrototypeOf(f) === Function.prototype);
  safe('fn.' + key + '.construct', () => { try { Reflect.construct(String, [], f); return 'constructed'; } catch (e) { return e.constructor.name + ':' + e.message; } });
}
safe('fn.toString.cycle', () => { const F = Function.prototype.toString, p = Object.getPrototypeOf(F); try { Object.setPrototypeOf(F, Object.create(F)); return 'no-throw'; } catch (e) { return e.constructor.name; } finally { try { Object.setPrototypeOf(F, p); } catch (e) {} } });
safe('fn.call.cycle', () => { const F = Function.prototype.call, p = Object.getPrototypeOf(F); try { Object.setPrototypeOf(F, Object.create(F)); return 'no-throw'; } catch (e) { return e.constructor.name; } finally { try { Object.setPrototypeOf(F, p); } catch (e) {} } });
safe('fn.toString.badThis', () => { try { fts.call({}); return 'no-throw'; } catch (e) { return e.constructor.name + ':' + e.message; } });
const frame = document.createElement('iframe'); frame.style.display = 'none'; document.documentElement.appendChild(frame);
const fresh = new Set(Object.getOwnPropertyNames(frame.contentWindow));
put('window.extra', Object.getOwnPropertyNames(window).filter(n => !fresh.has(n) && !/^(report|out|put|safe|N|wrapped|fts|frame|fresh|ro)$/.test(n)).sort());
safe('canvas.empty', () => { const c = document.createElement('canvas'); c.width = 16; c.height = 16; return c.toDataURL().length; });
safe('webgl.vendor', () => { const gl = document.createElement('canvas').getContext('webgl'); if (!gl) return 'none'; const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_VENDOR_WEBGL) : 'noext'; });
safe('webgl.renderer', () => { const gl = document.createElement('canvas').getContext('webgl'); if (!gl) return 'none'; const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'noext'; });
safe('webgl.maxTexture', () => { const gl = document.createElement('canvas').getContext('webgl'); return gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 'none'; });
const worker = await new Promise(resolve => {
  const w = new Worker(URL.createObjectURL(new Blob(['postMessage({l:navigator.languages,c:navigator.hardwareConcurrency,m:navigator.deviceMemory,p:navigator.platform,u:navigator.userAgent})'], { type: 'text/javascript' })));
  w.onmessage = e => resolve(e.data); w.onerror = () => resolve({ error: true });
});
put('worker', worker);
try {
  const he = await N.userAgentData.getHighEntropyValues(['architecture', 'bitness', 'formFactors', 'fullVersionList', 'model', 'platformVersion', 'uaFullVersion', 'wow64']);
  for (const k of Object.keys(he)) put('uach.he.' + k, he[k]);
} catch (e) { put('uach.he', 'throws'); }
await fetch('/sub', { cache: 'no-store' });
await fetch('/report', { method: 'POST', body: JSON.stringify(out) });
`;
