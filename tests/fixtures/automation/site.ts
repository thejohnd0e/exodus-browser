import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

export type Probe = {
  label: string;
  ua: string;
  platform: string;
  language: string;
  timezone: string;
  cores: number;
  memoryGb: number | null;
  screenWidth: number | null;
  screenHeight: number | null;
};

export type FixtureSite = {
  origin: string;
  /** A second loopback origin (localhost) serving the same pages, for cross-origin iframes. */
  altOrigin: string;
  observations: Probe[];
  close(): Promise<void>;
};

// The probe reads every fingerprint surface at the earliest executable script: no deferred
// callbacks, no load events, so the first stored report is what the target actually observed.
const PROBE_BODY = `
  const hasScreen = typeof screen !== 'undefined';
  const report = { label: LABEL, ua: navigator.userAgent, platform: navigator.platform,
    language: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    cores: navigator.hardwareConcurrency, memoryGb: (typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null),
    screenWidth: hasScreen ? screen.width : null, screenHeight: hasScreen ? screen.height : null };
  fetch('/report?value=' + encodeURIComponent(JSON.stringify(report)));
`;

function probePage(label: string, extra = ''): string {
  return `<!doctype html><meta charset="utf-8"><script>const LABEL=${JSON.stringify(label)};${PROBE_BODY}</script>${extra}`;
}

const WORKER_SRC = `
  const hasScreen = typeof screen !== 'undefined';
  const report = { label: 'worker', ua: navigator.userAgent, platform: navigator.platform,
    language: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    cores: navigator.hardwareConcurrency, memoryGb: (typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null),
    screenWidth: hasScreen ? screen.width : null, screenHeight: hasScreen ? screen.height : null };
  fetch('/report?value=' + encodeURIComponent(JSON.stringify(report)));
`;

const SHARED_WORKER_SRC = `
  onconnect = event => {
    const port = event.ports[0];
    port.start();
    const report = { label: 'shared-worker', ua: navigator.userAgent, platform: navigator.platform,
      language: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      cores: navigator.hardwareConcurrency, memoryGb: (typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null),
      screenWidth: null, screenHeight: null };
    fetch('/report?value=' + encodeURIComponent(JSON.stringify(report)));
    port.postMessage('reported');
  };
`;

const SERVICE_WORKER_SRC = `
  const report = () => fetch('/report?value=' + encodeURIComponent(JSON.stringify(
    { label: 'service-worker', ua: navigator.userAgent, platform: navigator.platform,
      language: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      cores: navigator.hardwareConcurrency, memoryGb: (typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null),
      screenWidth: null, screenHeight: null })));
  self.addEventListener('install', () => { void report(); self.skipWaiting(); });
  self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
  self.addEventListener('message', event => { void report().then(() => event.source.postMessage('reported')); });
`;

export async function startFixtureSite(): Promise<FixtureSite> {
  const observations: Probe[] = [];
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture.local');
    if (url.pathname === '/report') {
      observations.push(JSON.parse(url.searchParams.get('value')!) as Probe);
      res.end('ok');
      return;
    }
    const port = (server.address() as AddressInfo).port;
    switch (url.pathname) {
      case '/main':
        // Controls used by automation: cross-origin iframe, popup, dedicated worker.
        res.setHeader('Content-Type', 'text/html');
        res.end(probePage('main', `
<body>
<iframe id="frame" src="http://localhost:${port}/frame"></iframe>
<button id="open-popup" onclick="window.open('/popup','_blank')">Open popup</button>
<button id="open-worker" onclick="new Worker('/worker.js')">Open worker</button>
<button id="open-shared-worker" onclick="(w=>{w.port.onmessage=()=>{};w.port.start()})(new SharedWorker('/shared-worker.js'))">Open shared worker</button>
</body>`));
        return;
      case '/popup':
        res.setHeader('Content-Type', 'text/html');
        res.end(probePage('popup'));
        return;
      case '/frame':
        res.setHeader('Content-Type', 'text/html');
        res.end(probePage('frame'));
        return;
      case '/worker.js':
        res.setHeader('Content-Type', 'text/javascript');
        res.end(WORKER_SRC);
        return;
      case '/shared-worker.js':
        res.setHeader('Content-Type', 'text/javascript');
        res.end(SHARED_WORKER_SRC);
        return;
      case '/service-worker.js':
        res.setHeader('Content-Type', 'text/javascript');
        res.end(SERVICE_WORKER_SRC);
        return;
      case '/form':
        res.setHeader('Content-Type', 'text/html');
        res.end(`<!doctype html><meta charset="utf-8"><script>const LABEL='form';${PROBE_BODY}</script><body>
<form onsubmit="event.preventDefault();document.getElementById('result').textContent='Saved'">
<label for="message">Message</label><input id="message" name="message"><button type="submit">Submit</button>
</form><div id="result"></div></body>`);
        return;
      default:
        res.statusCode = 404;
        res.end('not found');
    }
  });
  server.listen(0, '::');
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    altOrigin: `http://localhost:${port}`,
    observations,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
