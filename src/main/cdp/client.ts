export interface CdpMessage { id?: number; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string }; sessionId?: string }
export interface CdpSocket { send(data: string): void; close(): void; onmessage: ((event: { data: string }) => void) | null; onclose: (() => void) | null; onerror: ((error: unknown) => void) | null }
export type CdpSocketFactory = (url: string) => Promise<CdpSocket>;

export function parseDevtoolsUrl(line: string): string | null {
  const match = /(ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[\w-]+)/.exec(line);
  return match ? match[1] : null;
}

async function defaultSocket(url: string): Promise<CdpSocket> {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('CDP_TIMEOUT')), 15000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(null); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(Error('CDP_CLOSED')); }, { once: true });
  });
  const wrapper: CdpSocket = { send: data => ws.send(data), close: () => ws.close(), onmessage: null, onclose: null, onerror: null };
  ws.addEventListener('message', event => wrapper.onmessage?.(event as { data: string }));
  ws.addEventListener('close', () => wrapper.onclose?.(), { once: true });
  ws.addEventListener('error', () => wrapper.onerror?.(new Error('socket')), { once: true });
  return wrapper;
}

interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }

export class CdpClient {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners: Array<(message: CdpMessage) => void> = [];
  private closed = false;
  private constructor(private socket: CdpSocket) {
    socket.onmessage = event => this.receive(event.data);
    socket.onclose = () => this.failAll(Error('CDP_CLOSED'));
    socket.onerror = () => this.failAll(Error('CDP_CLOSED'));
  }
  static async connect(url: string, options: { factory?: CdpSocketFactory } = {}): Promise<CdpClient> {
    const socket = await (options.factory ?? defaultSocket)(url);
    return new CdpClient(socket);
  }
  send<T = unknown>(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 5000): Promise<T> {
    if (this.closed) return Promise.reject(Error('CDP_CLOSED'));
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) });
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('CDP_TIMEOUT')); }, timeoutMs);
      this.pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value as T); }, reject: error => { clearTimeout(timer); reject(error); }, timer });
      this.socket.send(payload);
    });
  }
  onEvent(listener: (message: CdpMessage) => void): void { this.listeners.push(listener); }
  close(): void { this.closed = true; this.socket.close(); this.failAll(Error('CDP_CLOSED')); }
  private receive(data: string): void {
    let message: CdpMessage;
    try { message = JSON.parse(data) as CdpMessage; } catch { return; }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (pending) { this.pending.delete(message.id); message.error ? pending.reject(Error(message.error.message)) : pending.resolve(message.result); }
      return;
    }
    for (const listener of [...this.listeners]) listener(message);
  }
  private failAll(error: Error): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
}
