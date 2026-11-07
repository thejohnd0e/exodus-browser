import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AgentIdentity } from './credentials';
import { AgentApiError as RequestError } from './errors';
import { OPENAPI } from './openapi';

export type AgentHttp = { origin: string; close(): Promise<void> };
export type AgentHttpOptions = {
  authenticate(token: string): AgentIdentity | null;
  dispatch(identity: AgentIdentity, method: string, path: string, body: unknown, idempotencyKey?: string): Promise<unknown>;
};

async function jsonBody(request: IncomingMessage): Promise<unknown> {
  if (request.method === 'GET') return undefined;
  // Parameterless actions (start, stop, snapshot, screenshot, close) accept no body at all.
  // When a body is present it must still be strict JSON.
  const declared = request.headers['content-length'];
  const chunked = request.headers['transfer-encoding'] !== undefined;
  if (declared === '0' || (declared === undefined && !chunked)) return undefined;
  if (request.headers['content-type'] !== 'application/json') throw new RequestError(415, 'JSON_REQUIRED');
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 65536) throw new RequestError(413, 'REQUEST_TOO_LARGE');
    chunks.push(bytes);
  }
  if (size === 0) return undefined;
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new RequestError(400, 'INVALID_JSON'); }
}

/** Explicitly started by manager controls; creating an authority never opens a listener. */
export async function startAgentHttp(options: AgentHttpOptions, listenOptions: { preferredPort?: number } = {}): Promise<AgentHttp> {
  let enabled = true; let host = ''; let inFlight = 0;
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 10000, headersTimeout: 10000 }, async (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    let admitted = false;
    try {
      if (!enabled) throw new RequestError(503, 'API_DISABLED');
      if (request.headers.host !== host || request.headers.origin !== undefined) throw new RequestError(403, 'REQUEST_FORBIDDEN');
      const authorization = request.headers.authorization;
      if (!authorization?.startsWith('Bearer ')) throw new RequestError(401, 'UNAUTHORIZED');
      const identity = options.authenticate(authorization.slice(7));
      if (!identity) throw new RequestError(401, 'UNAUTHORIZED');
      if (inFlight >= 16) throw new RequestError(429, 'TOO_MANY_REQUESTS');
      inFlight++; admitted = true;
      const path = request.url ?? '';
      if (!path.startsWith('/api/v1/') || path.includes('?') || path.includes('#')) throw new RequestError(404, 'NOT_FOUND');
      if (!['GET', 'POST', 'PUT'].includes(request.method ?? '')) throw new RequestError(405, 'METHOD_NOT_ALLOWED');
      if (path === '/api/v1/openapi.json') {
        if (request.method !== 'GET') throw new RequestError(404, 'NOT_FOUND');
        response.end(JSON.stringify({ ok: true, value: OPENAPI }));
        return;
      }
      const body = await jsonBody(request);
      const idempotencyKey = request.headers['idempotency-key'];
      if (idempotencyKey !== undefined && (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey))) throw new RequestError(400, 'INVALID_IDEMPOTENCY_KEY');
      // Body upload is asynchronous: recheck admission and revocation after it completes.
      if (!enabled) throw new RequestError(503, 'API_DISABLED');
      const currentIdentity = options.authenticate(authorization.slice(7));
      if (!currentIdentity || currentIdentity.id !== identity.id) throw new RequestError(401, 'UNAUTHORIZED');
      const result = await options.dispatch(currentIdentity, request.method!, path, body, idempotencyKey as string | undefined);
      if (!enabled || !options.authenticate(authorization.slice(7))) throw new RequestError(401, 'UNAUTHORIZED');
      response.end(JSON.stringify({ ok: true, value: result }));
    } catch (error) {
      const safe = error instanceof RequestError ? error : new RequestError(500, 'INTERNAL_ERROR');
      response.statusCode = safe.status;
      response.end(JSON.stringify({ ok: false, error: { code: safe.code } }));
    } finally { if (admitted) inFlight--; }
  });
  server.maxConnections = 32;
  const listen = (port: number) => new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  // A remembered port keeps client configurations valid across restarts; when it is taken, any free port will do.
  if (listenOptions.preferredPort) await listen(listenOptions.preferredPort).catch(() => listen(0));
  else await listen(0);
  host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  let closing: Promise<void> | undefined;
  return {
    origin: 'http://' + host,
    close() {
      enabled = false;
      closing ??= new Promise<void>(resolve => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      return closing;
    },
  };
}
