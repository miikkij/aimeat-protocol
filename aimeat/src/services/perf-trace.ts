/**
 * @file src/services/perf-trace.ts
 * @description Opt-in per-request storage profiler. Gated by config.perfTrace (env AIMEAT_PERF_TRACE,
 *   read through loadConfig() like every other flag — NOT a bespoke process.env read here). When on,
 *   the Storage instance is wrapped in a Proxy that times and counts every top-level method call,
 *   accumulating the totals into an AsyncLocalStorage context established per request. A request opts in
 *   with `?trace=1` or the `x-aimeat-trace: 1` header; the summary (query count, DB ms, wall ms, hottest
 *   methods) is returned in the `X-Aimeat-Perf` response header and logged. This is how we SEE what one
 *   operation actually costs — how many DB round-trips, where the time goes, which routes fan out N+1 —
 *   instead of guessing. Off → storage returned untouched and the middleware is a no-op (zero overhead).
 * @structure
 *   - instrumentStorage(storage, enabled) — wrap Storage so calls record into the active trace (no-op if off)
 *   - perfTraceMiddleware(enabled) — factory → per-request ALS middleware that emits the summary
 *   - traceOperation(fn) / formatTrace(store) / getActiveTrace() — programmatic profiling helpers
 * @usage
 *   storage = instrumentStorage(storage, config.perfTrace);   // in config-init (has config)
 *   app.use(perfTraceMiddleware(config.perfTrace));            // outermost middleware
 *   curl -D - 'http://localhost:40050/v1/memory?trace=1' -H 'authorization: Bearer …'  # see X-Aimeat-Perf
 * @version-history
 *   v1.0.0 — 2026-07-14 — Initial per-request storage profiler (perf audit follow-up).
 *   v1.1.0 — 2026-07-14 — Config-driven: gate on config.perfTrace passed in, instead of reading
 *     process.env directly (which could be read before .env was applied). Same mechanism as every
 *     other AIMEAT_* flag.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

export interface MethodStat { count: number; ms: number; }

export interface TraceStore {
  httpMethod: string;
  path: string;
  calls: Map<string, MethodStat>;
  totalCalls: number;
  totalDbMs: number;
  startNs: bigint;
}

const als = new AsyncLocalStorage<TraceStore>();

/** The active request's accumulator, or undefined outside a traced request. */
export function getActiveTrace(): TraceStore | undefined { return als.getStore(); }

// Storage members that never touch the DB — excluded so the "queries" count stays meaningful.
const NON_DB = new Set<string>(['ensureReady', 'ready']);

/**
 * Wrap a Storage instance so every top-level method call is timed and counted into the active
 * request's trace (if one is running). Returns the storage UNCHANGED when `enabled` is false — no
 * Proxy, no overhead, in production. `this` inside a wrapped method stays bound to the REAL storage,
 * so a method's own internal helper/DB calls are not double-counted; the number reported is the count
 * of Storage calls the route itself made (which is exactly the N+1 signal we want).
 */
export function instrumentStorage(storage: Storage, enabled: boolean): Storage {
  if (!enabled) return storage;
  return new Proxy(storage, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig !== 'function' || typeof prop !== 'string' || NON_DB.has(prop)) return orig;
      return function tracedStorageCall(...args: unknown[]): unknown {
        const store = als.getStore();
        if (!store) return (orig as (...a: unknown[]) => unknown).apply(target, args);
        const t0 = process.hrtime.bigint();
        const record = (): void => {
          const ms = Number(process.hrtime.bigint() - t0) / 1e6;
          const s = store.calls.get(prop) ?? { count: 0, ms: 0 };
          s.count++; s.ms += ms;
          store.calls.set(prop, s);
          store.totalCalls++; store.totalDbMs += ms;
        };
        let result: unknown;
        try {
          result = (orig as (...a: unknown[]) => unknown).apply(target, args);
        } catch (err) {
          record();
          throw err;
        }
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          return (result as Promise<unknown>).then(
            (v) => { record(); return v; },
            (err) => { record(); throw err; },
          );
        }
        record();
        return result;
      };
    },
  }) as Storage;
}

/**
 * Run `fn` inside a fresh trace context and return its result plus the accumulated trace. For
 * programmatic profiling (CLI/tests/benchmarks) without an HTTP request. Requires the storage to have
 * been wrapped by {@link instrumentStorage} with enabled=true — otherwise the store comes back empty.
 */
export async function traceOperation<T>(fn: () => Promise<T>): Promise<{ result: T; store: TraceStore }> {
  const store: TraceStore = {
    httpMethod: 'FN', path: '-', calls: new Map(), totalCalls: 0, totalDbMs: 0, startNs: process.hrtime.bigint(),
  };
  const result = await als.run(store, fn);
  return { result, store };
}

/** The compact one-line summary of a finished trace (query count, DB ms, wall ms, hottest methods). */
export function formatTrace(store: TraceStore): string { return summarize(store); }

/** Build the compact one-line summary from a finished trace. */
function summarize(store: TraceStore): string {
  const wallMs = Number(process.hrtime.bigint() - store.startNs) / 1e6;
  const top = [...store.calls.entries()]
    .sort((a, b) => b[1].ms - a[1].ms)
    .slice(0, 8)
    .map(([m, s]) => `${m}:${s.count}/${s.ms.toFixed(0)}ms`)
    .join(' ');
  return `q=${store.totalCalls} dbms=${store.totalDbMs.toFixed(0)} wall=${wallMs.toFixed(0)} | ${top}`;
}

/**
 * Build the outermost middleware. When `enabled` and the request opts in (`?trace=1` or
 * `x-aimeat-trace: 1`), it runs the rest of the pipeline inside an ALS context so storage calls
 * accumulate, then writes the summary to the `X-Aimeat-Perf` header (before the body flushes) and logs
 * it. Returns a pass-through no-op middleware when disabled. Opt-in keeps ordinary traffic untouched.
 */
export function perfTraceMiddleware(enabled: boolean): RequestHandler {
  if (!enabled) return (_req: Request, _res: Response, next: NextFunction): void => next();
  return (req: Request, res: Response, next: NextFunction): void => {
    const optedIn = req.query?.trace === '1' || req.headers['x-aimeat-trace'] === '1';
    if (!optedIn) { next(); return; }

    const store: TraceStore = {
      httpMethod: req.method,
      path: req.path,
      calls: new Map(),
      totalCalls: 0,
      totalDbMs: 0,
      startNs: process.hrtime.bigint(),
    };

    // Set the header by patching res.writeHead — the single point where headers are finalised, run
    // just before they flush. Setting it in res.end is too late: compression (mounted after us) flushes
    // headers before our end wrapper runs, so res.headersSent is already true and setHeader is a no-op.
    // The trace store is complete by writeHead (the handler awaited its storage calls before responding).
    const origWriteHead = res.writeHead.bind(res) as (...a: unknown[]) => Response;
    let headerSet = false;
    (res as unknown as { writeHead: (...a: unknown[]) => Response }).writeHead = function patchedWriteHead(...args: unknown[]): Response {
      if (!headerSet) {
        headerSet = true;
        if (!res.headersSent) {
          try { res.setHeader('X-Aimeat-Perf', summarize(store)); } catch { /* headers already locked */ }
        }
      }
      return origWriteHead(...args);
    };
    // Log independently of the header (survives header stripping by a reverse proxy). `finish` always
    // fires once the response is fully sent. Plain string — the logger does NOT do printf %s.
    res.on('finish', () => logger.info(`[perf] ${req.method} ${req.originalUrl} — ${summarize(store)}`));

    als.run(store, () => next());
  };
}
