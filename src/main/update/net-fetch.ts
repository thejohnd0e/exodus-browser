type NetRequest = {
  on(event: 'redirect', listener: (status: number, method: string, redirectUrl: string, headers: Record<string, string[]>) => void): void;
  on(event: 'response', listener: (response: NetResponse) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  abort(): void;
  end(): void;
};

type NetResponse = {
  statusCode: number;
  headers: Record<string, string[]>;
  on(event: 'data', listener: (chunk: Buffer) => void): void;
  on(event: 'end', listener: () => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
};

type NetLike = {
  request(options: {url: string; method?: string; redirect?: 'follow' | 'error' | 'manual'}): NetRequest;
};

/**
 * Electron's net.fetch rejects a request with "Redirect was cancelled" when `redirect: 'manual'`
 * is used, so redirects cannot be inspected there. net.request reports them as an event instead;
 * this adapter turns such an event into an ordinary 302 response, so the caller keeps control over
 * which hosts may be followed.
 */
export function createNetFetch(net: NetLike) {
  return function netFetch(url: string, init: {signal?: AbortSignal; redirect?: 'follow' | 'manual'; headers?: Record<string, string>} = {}): Promise<Response> {
    return new Promise<Response>((resolve, reject) => {
      if (init.signal?.aborted) {
        reject(new Error('UPDATE_CANCELLED'));
        return;
      }
      const request = net.request({url, method: 'GET', redirect: 'manual'});
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        init.signal?.removeEventListener('abort', onAbort);
        action();
      };
      const onAbort = () => {
        finish(() => {
          request.abort();
          reject(new Error('UPDATE_CANCELLED'));
        });
      };
      init.signal?.addEventListener('abort', onAbort, {once: true});
      for (const [name, value] of Object.entries(init.headers ?? {})) {
        try { (request as unknown as {setHeader(n: string, v: string): void}).setHeader(name, value); } catch { /* unsupported header is ignored */ }
      }
      request.on('redirect', (status, _method, redirectUrl) => {
        finish(() => {
          request.abort();
          resolve(new Response(null, {status, headers: {location: redirectUrl}}));
        });
      });
      request.on('response', (response) => {
        const headers = new Headers();
        for (const [name, values] of Object.entries(response.headers)) {
          for (const value of values) headers.append(name, value);
        }
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            response.on('data', chunk => controller.enqueue(new Uint8Array(chunk)));
            response.on('end', () => controller.close());
            response.on('error', error => controller.error(error));
          },
        });
        finish(() => resolve(new Response(stream, {status: response.statusCode, headers})));
      });
      request.on('error', error => finish(() => reject(error)));
      request.end();
    });
  };
}
