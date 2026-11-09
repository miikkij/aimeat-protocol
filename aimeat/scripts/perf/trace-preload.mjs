/**
 * @file scripts/perf/trace-preload.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Per-request database trace for a measuring node. Preloaded with `--import` into a
 *   sandbox node (scripts/sandbox.ts reads AIMEAT_SANDBOX_PRELOAD), it ties every SQL statement to
 *   the HTTP request whose async context ran it and writes one JSON line per finished request:
 *   method, url, status, wall time, response bytes as sent on the socket (after compression), the
 *   number of statements, the time spent in them, and the statements that ran most often.
 *
 *   WHY. The node has no query timing of its own, and a finding such as "the Data Wallet makes 40
 *   reads per consent" needs the count, not a guess from reading code. Wrapping the two drivers
 *   from outside changes no server code, so what is measured is what ships.
 *
 *   HOW. better-sqlite3 is synchronous: Statement.run/get/all/iterate and Database.exec are timed
 *   in place. pg is asynchronous: Client.prototype.query is timed until its promise settles; Kysely
 *   and pg.Pool both end in Client.query, so each statement is counted once. Request context is an
 *   AsyncLocalStorage entered in an http.Server emit wrapper, the same seam sandbox-idle.mjs uses.
 *   Statements outside any request (schedulers, boot) are summed under `bg` and written every 30 s.
 *
 *   OUTPUT. AIMEAT_PERF_TRACE_FILE (default .perf-trace.jsonl beside the log). Without that variable
 *   or AIMEAT_PERF_TRACE=1 the module does nothing.
 * @structure ALS · normalize() · sqlite wrap · pg wrap · http emit wrapper · bg flush
 * @usage AIMEAT_SANDBOX_PRELOAD=scripts/perf/trace-preload.mjs AIMEAT_PERF_TRACE=1 pnpm sandbox
 * @version-history
 *   v1.0.0 — 2026-11-09 — Initial, for the performance measurement at real account size.
 */
import http from 'node:http';
import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const ON = process.env.AIMEAT_PERF_TRACE === '1' || !!process.env.AIMEAT_PERF_TRACE_FILE;
const OUT = process.env.AIMEAT_PERF_TRACE_FILE || '.perf-trace.jsonl';
const als = new AsyncLocalStorage();
const require = createRequire(import.meta.url);

/** One statement text with its literals folded, so `id = 'a'` and `id = 'b'` count as one shape. */
function normalize(sql) {
  return String(sql).replace(/\s+/g, ' ').replace(/'(?:[^']|'')*'/g, "'?'").replace(/\b\d+\b/g, 'N')
    .replace(/\$\d+/g, '$N').replace(/\((?:\s*(?:\?|\$N)\s*,)+\s*(?:\?|\$N)\s*\)/g, '(…)').slice(0, 220);
}

function freshCounter() { return { q: 0, dbMs: 0, rows: 0, shapes: new Map() }; }
const bg = freshCounter();

function record(sql, ms, rows) {
  const c = als.getStore() ?? bg;
  c.q++; c.dbMs += ms; c.rows += rows;
  const k = normalize(sql);
  const s = c.shapes.get(k) ?? { n: 0, ms: 0, rows: 0 };
  s.n++; s.ms += ms; s.rows += rows; c.shapes.set(k, s);
}

function top(c, n = 8) {
  return [...c.shapes.entries()].sort((a, b) => b[1].ms - a[1].ms || b[1].n - a[1].n).slice(0, n)
    .map(([sql, s]) => ({ n: s.n, ms: +s.ms.toFixed(1), rows: s.rows, sql }));
}

function rowCount(r) {
  if (Array.isArray(r)) return r.length;
  if (r && Array.isArray(r.rows)) return r.rows.length;
  return r ? 1 : 0;
}

if (ON) {
  // ── better-sqlite3 ──
  try {
    const Database = require('better-sqlite3');
    const wrapped = new WeakSet();
    const origPrepare = Database.prototype.prepare;
    Database.prototype.prepare = function (sql, ...rest) {
      const stmt = origPrepare.call(this, sql, ...rest);
      const proto = Object.getPrototypeOf(stmt);
      if (!wrapped.has(proto)) {
        wrapped.add(proto);
        for (const m of ['run', 'get', 'all']) {
          const orig = proto[m];
          proto[m] = function (...args) {
            const t0 = performance.now();
            const r = orig.apply(this, args);
            record(this.source, performance.now() - t0, m === 'run' ? 0 : rowCount(r));
            return r;
          };
        }
        const origIter = proto.iterate;
        proto.iterate = function* (...args) {
          const t0 = performance.now(); let n = 0;
          for (const row of origIter.apply(this, args)) { n++; yield row; }
          record(this.source, performance.now() - t0, n);
        };
      }
      return stmt;
    };
    const origExec = Database.prototype.exec;
    Database.prototype.exec = function (sql) {
      const t0 = performance.now();
      const r = origExec.call(this, sql);
      record(sql, performance.now() - t0, 0);
      return r;
    };
  } catch { /* better-sqlite3 not installed: a PostgreSQL-only run */ }

  // ── pg ──
  try {
    const pg = require('pg');
    const origQuery = pg.Client.prototype.query;
    pg.Client.prototype.query = function (config, values, cb) {
      const sql = typeof config === 'string' ? config : config?.text ?? '';
      const t0 = performance.now();
      const ctx = als.getStore() ?? bg;
      const done = (r) => als.run(ctx, () => record(sql, performance.now() - t0, rowCount(r)));
      const r = origQuery.call(this, config, values, cb);
      if (r && typeof r.then === 'function') r.then(done, () => done(null));
      return r;
    };
  } catch { /* pg not installed */ }

  // ── HTTP request context ──
  const origEmit = http.Server.prototype.emit;
  http.Server.prototype.emit = function (event, req, res, ...rest) {
    if (event !== 'request' || !res) return origEmit.call(this, event, req, res, ...rest);
    const c = freshCounter();
    const t0 = performance.now();
    let bytes = 0;
    const sock = res.socket;
    const before = sock?.bytesWritten ?? 0;
    res.once('finish', () => {
      bytes = (sock?.bytesWritten ?? 0) - before;
      const line = {
        at: new Date().toISOString(), method: req.method, url: req.url, status: res.statusCode,
        ms: +(performance.now() - t0).toFixed(1), bytes, q: c.q, dbMs: +c.dbMs.toFixed(1), rows: c.rows,
        top: top(c),
      };
      try { appendFileSync(OUT, JSON.stringify(line) + '\n'); } catch { /* trace is best effort */ }
    });
    return als.run(c, () => origEmit.call(this, event, req, res, ...rest));
  };

  // ── Work outside any request ──
  setInterval(() => {
    if (!bg.q) return;
    try {
      appendFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), bg: true, q: bg.q, dbMs: +bg.dbMs.toFixed(1), rows: bg.rows, top: top(bg, 12) }) + '\n');
    } catch { /* best effort */ }
    bg.q = 0; bg.dbMs = 0; bg.rows = 0; bg.shapes.clear();
  }, 30_000).unref();
}
