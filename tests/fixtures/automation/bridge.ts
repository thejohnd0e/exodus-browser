import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import type { CdpClient, CdpMessage } from '../../../src/main/cdp/client';

export type Bridge = {
  /** Loopback WebSocket endpoint without any token in the URL. */
  endpoint: string;
  /** Headers a client must send to authenticate (bearer token). Never printed or logged. */
  headers: Readonly<Record<string, string>>;
  close(): Promise<void>;
};

const MAX_MESSAGE_BYTES = 1024 * 1024;

/** In-memory ring buffer: tracing must not slow the race it is meant to observe. */
function trace(line: string): void {
  if (process.env.BRIDGE_TRACE !== '1') return;
  const store = globalThis as unknown as { __bridgeTrace?: string[] };
  const buffer = store.__bridgeTrace ??= [];
  buffer.push(line);
  if (buffer.length > 2000) buffer.splice(0, buffer.length - 2000);
}

type PendingCommand = { callerId: number; resolve: (value: unknown) => void; reject: (error: Error) => void };

/**
 * Test-only adapter between Playwright's public `chromium.connectOverCDP` and one already
 * launched managed browser. A single bridge owns exactly one event dispatcher on the shared
 * CdpClient for its whole lifetime (CdpClient.onEvent has no unsubscribe); the dispatcher is
 * gated by the active connection so reconnects never add listeners.
 */
export async function startAutomationBridge(client: CdpClient, options: { exit?: Promise<unknown> } = {}): Promise<Bridge> {
  const token = randomBytes(32).toString('base64url');
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  const server: Server = createServer((_req, res) => { res.writeHead(404); res.end(); });
  const wss = new WebSocketServer({ noServer: true });
  let disposed = false;
  let active: ActiveConnection | null = null;
  let expectedHost = '';

  server.on('upgrade', (request, socket, head) => {
    if (disposed) { socket.destroy(); return; }
    const host = request.headers.host;
    const origin = request.headers.origin;
    if (origin !== undefined) { rejectHandshake(socket, 403); return; }
    if (typeof host !== 'string' || (expectedHost && host !== expectedHost)) { rejectHandshake(socket, 403); return; }
    if (request.headers.authorization !== headers.Authorization) { rejectHandshake(socket, 401); return; }
    wss.handleUpgrade(request, socket, head, ws => {
      if (disposed) { ws.close(); return; }
      if (active) { ws.close(4001, 'another automation connection is active'); return; }
      active = new ActiveConnection(ws, client, () => { if (active) active = null; });
    });
  });

  // One dispatcher per bridge, alive for the bridge lifetime; it ignores events when no
  // connection is active, so repeated connect/disconnect cycles do not accumulate listeners.
  client.onEvent(message => { if (!disposed && active) active.handleEvent(message); });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  expectedHost = `127.0.0.1:${port}`;
  const endpoint = `ws://127.0.0.1:${port}`;

  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    disposed = true;
    active?.dispose('bridge disposed');
    for (const client_ of wss.clients) client_.terminate();
    closing ??= new Promise<void>(resolve => server.close(() => resolve()));
    return closing;
  };
  if (options.exit) void options.exit.then(close, close);
  return {
    endpoint,
    headers,
    close,
  };
}

function rejectHandshake(socket: import('node:stream').Duplex, code: number): void {
  socket.write(`HTTP/1.1 ${code} ${code === 401 ? 'Unauthorized' : 'Forbidden'}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

class ActiveConnection {
  private browserSessionId: string | null = null;
  private childSessions = new Set<string>();
  private pending = new Map<number, PendingCommand>();
  private closed = false;

  private ready: Promise<void>;

  constructor(private ws: WebSocket, private client: CdpClient, private onGone: () => void) {
    ws.on('message', data => { void this.onMessage(data); });
    ws.on('close', () => this.dispose('connection closed'));
    ws.on('error', () => this.dispose('connection error'));
    this.ready = this.attach();
  }

  private async attach(): Promise<void> {
    try {
      const { sessionId } = await this.client.send<{ sessionId: string }>('Target.attachToBrowserTarget', {});
      if (this.closed) { void this.detach(sessionId); return; }
      this.browserSessionId = sessionId;
    } catch (error) { this.dispose(`browser session failed: ${String(error)}`); }
  }

  private async onMessage(data: unknown): Promise<void> {
    // Commands may arrive before the browser session exists; they wait for attachment, not fail.
    await this.ready;
    const raw = typeof data === 'string' ? data : String(data);
    if (Buffer.byteLength(raw) > MAX_MESSAGE_BYTES) { this.dispose('message too large'); return; }
    let message: { id?: unknown; method?: unknown; params?: unknown; sessionId?: unknown };
    try { message = JSON.parse(raw); } catch { this.dispose('malformed json'); return; }
    if (typeof message.id !== 'number' || typeof message.method !== 'string') { this.dispose('malformed command'); return; }
    const replySession = message.sessionId as string | undefined;
    if (message.params !== undefined && (typeof message.params !== 'object' || message.params === null)) { this.fail(message.id, 'invalid params', replySession); return; }
    if (message.sessionId !== undefined && typeof message.sessionId !== 'string') { this.fail(message.id, 'invalid session id', replySession); return; }
    if (this.pending.has(message.id)) { this.fail(message.id, 'duplicate command id', replySession); return; }
    const session = this.resolveSession(message.sessionId);
    if (typeof session === 'string') { this.fail(message.id, `unknown session: ${session}`, replySession); return; }
    // Root commands are routed through the bridge's own browser session; nested commands keep theirs.
    const pipeSessionId = message.sessionId === undefined ? (this.browserSessionId ?? undefined) : message.sessionId as string;
    const callerId = message.id;
    trace(`cmd ${message.method} session=${String(message.sessionId)} browser=${String(this.browserSessionId)} known=${this.childSessions.has(message.sessionId ?? '')} pending=${this.pending.size}`);
    if (process.env.BRIDGE_DEBUG) console.log('BRIDGE cmd', message.method, 'session', String(message.sessionId), 'browser', String(this.browserSessionId), 'children', this.childSessions.size);
    // Responses must carry the session the command was issued on, so the client can route them.
    const replySessionId = message.sessionId as string | undefined;
    const reply = (payload: { result?: unknown; error?: { code: number; message: string } }) => {
      if (this.closed) return;
      trace(`reply id=${callerId} session=${String(replySessionId)} ${payload.error ? 'error=' + payload.error.message : 'result'}`);
      this.ws.send(JSON.stringify({ id: callerId, sessionId: replySessionId, ...payload }));
    };
    const promise = this.client.send(message.method, (message.params as Record<string, unknown>) ?? {}, pipeSessionId, 30000);
    const entry: PendingCommand = {
      callerId,
      resolve: value => reply({ result: value }),
      reject: error => reply({ error: { code: -32000, message: error.message } }),
    };
    this.pending.set(callerId, entry);
    const debug = process.env.BRIDGE_DEBUG;
    promise.then(value => { if (debug) console.log('bridge ok:', message.method); entry.resolve(value); },
      error => { if (debug) console.log('bridge err:', message.method, error.message); entry.reject(error); })
      .finally(() => { this.pending.delete(callerId); });
  }

  /** Returns undefined when the session is allowed, or the rejected session identifier. */
  private resolveSession(sessionId: unknown): string | null {
    if (sessionId === undefined) {
      // Root commands are routed through the bridge's own browser session.
      return this.browserSessionId ? null : 'bridge browser session';
    }
    if (sessionId === this.browserSessionId || this.childSessions.has(sessionId as string)) return null;
    return sessionId as string;
  }

  handleEvent(message: CdpMessage): void {
    if (this.closed || message.id !== undefined) return;
    trace(`event ${String(message.method)} session=${String(message.sessionId)} known=${this.childSessions.has(message.sessionId ?? '') || message.sessionId === this.browserSessionId}${(() => {
      const params = message.params as { sessionId?: string; targetId?: string; targetInfo?: { targetId?: string; type?: string; url?: string }; context?: { id?: number; name?: string; auxData?: { isDefault?: boolean; frameId?: string } }; frame?: { id?: string } } | undefined;
      if (!params) return '';
      if (message.method === 'Runtime.executionContextCreated') return ` ctx=${String(params.context?.id)} default=${String(params.context?.auxData?.isDefault)} frame=${String(params.context?.auxData?.frameId)} name=${String(params.context?.name)}`;
      if (params.targetInfo) return ` inner=${String(params.sessionId)} target=${params.targetInfo.type}:${params.targetInfo.targetId}:${params.targetInfo.url ?? ''}`;
      if (params.sessionId || params.targetId) return ` inner=${String(params.sessionId)} targetId=${String(params.targetId)}`;
      return '';
    })()}`);
    if (!this.browserSessionId) return;
    if (message.sessionId === this.browserSessionId) {
      this.learnSessions(message);
      const { sessionId, ...rest } = message;
      void sessionId;
      this.ws.send(JSON.stringify(rest));
      return;
    }
    if (message.sessionId && this.childSessions.has(message.sessionId)) {
      // Sessions deeper in the tree (iframes, workers under a page session) stay routable.
      this.learnSessions(message);
      this.ws.send(JSON.stringify(message));
    }
  }

  /** Learns sessions attached by any session this bridge already routes, recursively. */
  private learnSessions(message: CdpMessage): void {
    const params = message.params as { sessionId?: string } | undefined;
    if (message.method === 'Target.attachedToTarget' && typeof params?.sessionId === 'string') this.childSessions.add(params.sessionId);
    if (message.method === 'Target.detachedFromTarget' && typeof params?.sessionId === 'string') this.childSessions.delete(params.sessionId);
  }

  private fail(callerId: number, reason: string, sessionId?: string): void {
    trace(`fail id=${callerId} session=${String(sessionId)} reason=${reason}`);
    if (process.env.BRIDGE_DEBUG) console.log('bridge fail:', callerId, reason);
    if (!this.closed) this.ws.send(JSON.stringify({ id: callerId, sessionId, error: { code: -32000, message: reason } }));
  }

  private async detach(sessionId: string): Promise<void> {
    try { await this.client.send('Target.detachFromTarget', { sessionId }); } catch { /* the session may already be gone */ }
  }

  dispose(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    const browserSessionId = this.browserSessionId;
    this.browserSessionId = null;
    this.childSessions.clear();
    const failure = Error(`BRIDGE_CLOSED: ${reason}`);
    for (const entry of this.pending.values()) entry.reject(failure);
    this.pending.clear();
    this.onGone();
    // Disconnect cleanup only detaches the bridge's own browser session. It never closes the
    // shared pipe, never sends Browser.close, and never touches the underlying browser process.
    if (browserSessionId) void this.detach(browserSessionId);
    if (this.ws.readyState === this.ws.OPEN || this.ws.readyState === this.ws.CONNECTING) this.ws.close(1000, reason);
  }
}
