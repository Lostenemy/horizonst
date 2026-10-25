import type { Server, ServerResponse } from 'node:http';

const within = async <T>(work: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('lifecycle_deadline')), Math.max(1, ms));
    })]);
  } finally { if (timer) clearTimeout(timer); }
};

export class ServiceLifecycle {
  stopping = false;
  private stops = new Map<string, () => void>();
  private work = new Set<Promise<unknown>>();
  private shutdownPromise?: Promise<number>;
  private removeSignals?: () => void;
  private responses = new Set<ServerResponse>();
  private streams = new WeakSet<ServerResponse>();

  track<T>(operation: Promise<T>): Promise<T> {
    this.work.add(operation);
    void operation.then(() => this.work.delete(operation), () => this.work.delete(operation));
    return operation;
  }

  register(name: string, stop: () => void): void {
    if (this.stopping) { stop(); return; }
    if (this.stops.has(name)) throw new Error('duplicate_lifecycle_registration');
    this.stops.set(name, stop);
  }

  periodic(name: string, ms: number, task: () => Promise<unknown>, immediate = false): void {
    if (this.stopping || this.stops.has(name)) return;
    let running = false;
    const run = () => {
      if (this.stopping || running) return;
      running = true;
      void this.track(Promise.resolve().then(task)).catch(() => {
        console.error('Background task failed; no automatic write replay', { task: name });
      }).finally(() => { running = false; });
    };
    const timer = setInterval(run, ms);
    timer.unref();
    this.register(name, () => clearInterval(timer));
    if (immediate) run();
  }

  shutdown(server: Server, stopTransport: () => Promise<void>, closeDatabase: () => Promise<void>,
    budgetMs = 24_000): Promise<number> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.stopping = true;
    this.shutdownPromise = (async () => {
      const deadline = Date.now() + budgetMs;
      let failed = false;
      for (const stop of this.stops.values()) {
        try { stop(); } catch { failed = true; }
      }
      this.stops.clear();
      for (const response of this.responses) {
        if (this.streams.has(response) || String(response.getHeader('Content-Type') || '').startsWith('text/event-stream')) response.end();
      }
      const httpClosed = new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
      });
      const transport = Promise.resolve().then(stopTransport);
      // HTTP includes long-lived SSE; accepted database work is drained independently below.
      try { await within(Promise.all([httpClosed, transport]), Math.min(8_000, budgetMs / 3)); }
      catch { server.closeAllConnections(); failed = true; }
      try {
        while (this.work.size) await within(Promise.allSettled([...this.work]), deadline - Date.now() - Math.min(4_000, budgetMs / 6));
      } catch { failed = true; }
      try { await within(Promise.resolve().then(closeDatabase), deadline - Date.now()); }
      catch { failed = true; }
      return failed ? 1 : 0;
    })();
    return this.shutdownPromise;
  }

  install(server: Server, stopTransport: () => Promise<void>, closeDatabase: () => Promise<void>): () => void {
    if (this.removeSignals) return this.removeSignals;
    const observe = (_request: unknown, response: ServerResponse) => {
      if (response.writableFinished) return;
      this.responses.add(response);
      // writeHead(headers) may bypass Node's getHeader cache. Observe, but never change, these headers.
      const writeHead = response.writeHead;
      const streams = this.streams;
      response.writeHead = function (this: ServerResponse, ...args: any[]) {
        const headers = typeof args[1] === 'string' ? args[2] : args[1];
        const entries: Array<[string, unknown]> = Array.isArray(headers)
          ? headers.reduce((all: Array<[string, unknown]>, key: string, i: number) => {
            if (i % 2 === 0) all.push([key, headers[i + 1]]); return all;
          }, []) : Object.entries(headers || {});
        if (entries.some(([key, value]) => key.toLowerCase() === 'content-type' && String(value).startsWith('text/event-stream'))) streams.add(response);
        return writeHead.apply(this, args as any);
      } as typeof response.writeHead;
      const remove = () => this.responses.delete(response);
      response.once('finish', remove); response.once('close', remove);
    };
    server.prependListener('request', observe);
    let received = false;
    const stop = () => {
      if (received) return;
      received = true;
      // Ref'ed watchdog with 5 s margin; real container timing still requires a responsive event loop.
      const watchdog = setTimeout(() => {
        console.error('Shutdown deadline exceeded; unfinished durable work remains recoverable');
        process.exit(1);
      }, 25_000);
      void this.shutdown(server, stopTransport, closeDatabase).then(code => {
        clearTimeout(watchdog);
        process.exit(code);
      }, () => { clearTimeout(watchdog); process.exit(1); });
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
    this.removeSignals = () => {
      process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
      server.removeListener('request', observe);
      this.removeSignals = undefined;
    };
    return this.removeSignals;
  }
}

export const lifecycle = new ServiceLifecycle();

export function attachDatabaseLifecycle(pool: any) {
  const clients = new Set<any>();
  const onError = () => console.warn('PostgreSQL connection lost; next acquisition may reconnect; writes are not replayed');
  pool.on('error', onError);
  pool.on('connect', (client: any) => {
    clients.add(client);
    client.on('error', onError);
  });
  pool.on('remove', (client: any) => { clients.delete(client); });
  let closing = false;
  let probe: Promise<boolean> | undefined;
  let end: Promise<void> | undefined;
  return {
    ready(): Promise<boolean> {
      if (closing || lifecycle.stopping) return Promise.resolve(false);
      if (probe) return probe;
      probe = (async () => {
        let client: any;
        let expired = false;
        let released = false;
        const release = (destroy: boolean) => {
          if (client && !released) { released = true; client.release(destroy || undefined); }
        };
        const acquired = Promise.resolve().then(() => pool.connect()).then(value => {
          client = value;
          if (expired) { release(true); throw new Error('late_health_connection'); }
          return client;
        });
        const query = acquired.then(value => value.query({ text: 'SELECT 1', query_timeout: 1_000 }));
        try { await within(query, 2_000); release(false); return true; }
        catch { expired = true; release(true); return false; }
      })().finally(() => { probe = undefined; });
      return probe;
    },
    close(): Promise<void> {
      if (end) return end;
      closing = true;
      end = within(Promise.resolve().then(() => pool.end()), 2_000).catch(error => {
        for (const client of clients) {
          try { void Promise.resolve(client.end()).catch(() => undefined); } catch { /* connection already gone */ }
        }
        throw error;
      });
      return end;
    }
  };
}
