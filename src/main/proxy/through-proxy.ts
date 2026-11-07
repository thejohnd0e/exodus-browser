import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

/** The subset of fetch the exit lookups use; it only ever travels through a profile's proxy. */
export type ProxiedFetch = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<Response>;

const MAX_BYTES = 64 * 1024;

/**
 * HTTPS GET through the local proxy bridge of a profile (`openProxyBridge`): a CONNECT tunnel, then
 * TLS with the system's normal certificate verification. The service therefore sees only the proxy's
 * exit address, never the host's (DECISIONS #79). `ca` exists for tests that run a local HTTPS server;
 * it adds a trusted certificate and never disables verification.
 */
export function proxiedFetch(bridgeUrl: string, options: { ca?: string | Buffer; timeoutMs?: number } = {}): ProxiedFetch {
  const bridge = new URL(bridgeUrl);
  return (url, init = {}) => new Promise<Response>((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== 'https:') { reject(Error('PROXIED_HTTPS_ONLY')); return; }
    const port = Number(target.port || 443);
    const tlsOptions = { servername: target.hostname, ...(options.ca ? { ca: options.ca } : {}) };
    let settled = false;
    let connect: http.ClientRequest | undefined;
    const finish = (error: Error | null, response?: Response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', onAbort);
      if (error) { connect?.destroy(); reject(error); } else resolve(response!);
    };
    const onAbort = () => finish(Error('PROXIED_ABORTED'));
    const timer = setTimeout(() => finish(Error('PROXIED_TIMEOUT')), options.timeoutMs ?? 10000);
    if (init.signal?.aborted) { finish(Error('PROXIED_ABORTED')); return; }
    init.signal?.addEventListener('abort', onAbort, { once: true });
    connect = http.request({ host: bridge.hostname, port: Number(bridge.port), method: 'CONNECT', path: `${target.hostname}:${port}`, headers: { host: `${target.hostname}:${port}` } });
    connect.on('error', () => finish(Error('PROXIED_CONNECT_FAILED')));
    connect.on('connect', (answer, socket) => {
      if (answer.statusCode !== 200) { socket.destroy(); finish(Error('PROXIED_CONNECT_FAILED')); return; }
      // The request must use the TLS socket inside the tunnel. `createConnection` in the request
      // options is ignored together with `agent: false` and Node then connects to the service
      // directly, from the host's address; an agent whose createConnection returns the tunnelled
      // socket is the documented way and the only one that never falls back to a direct connection.
      const agent = new https.Agent({ keepAlive: false, maxSockets: 1 });
      (agent as unknown as { createConnection: () => tls.TLSSocket }).createConnection = () => tls.connect({ socket, ...tlsOptions });
      const request = https.request({
        host: target.hostname, port, method: 'GET', path: target.pathname + target.search,
        headers: { ...init.headers, host: target.host }, agent, ...tlsOptions,
      }, response => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) { request.destroy(); finish(Error('PROXIED_TOO_LARGE')); } else chunks.push(chunk);
        });
        response.on('end', () => finish(null, new Response(Buffer.concat(chunks), { status: response.statusCode ?? 502 })));
        response.on('error', () => finish(Error('PROXIED_FAILED')));
      });
      request.on('error', () => { socket.destroy(); finish(Error('PROXIED_FAILED')); });
      request.on('close', () => agent.destroy());
      request.end();
    });
    connect.end();
  });
}
