/**
 * @file test/coverage-preload.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What makes an E2E sweep measurable: loaded through NODE_OPTIONS into every process
 *   the sweep starts, it decides per process whether that process is part of the measure, and it
 *   gets the node's V8 coverage onto disk on Windows, where a kill is TerminateProcess and nothing
 *   is written on the way down.
 *
 *   Three things, all keyed on NODE_V8_COVERAGE being set (without it this file does nothing):
 *   - A NODE process (argv[1] is src/index.ts: a server, a connector daemon) keeps collecting, and
 *     writes its coverage when it finds `stop-<pid>` in the coverage directory. It writes only the
 *     scripts under AIMEAT_COVERAGE_SRC (1.4 MB instead of 33) and puts each script's source map
 *     in `smc/` once, because the map of a .ts file is the same in every process that loaded it.
 *   - Every OTHER process (the runner, a suite, a fake provider) decides at exit: a suite that
 *     built a node in-process (it loaded src/server.ts; nineteen do, api-full and the federation
 *     suites among them) executed node code and its snapshot is kept, reduced the same way; one
 *     that only drove a node over HTTP imported a few helpers and its snapshot is discarded, because
 *     the measure is what a node executed, not what a test imported. Collection is stopped after
 *     the decision, so Node's own write at exit fails and prints "Failed to get 'result' from
 *     coverage profile response" to stderr; that line is the cost of the choice, and breaks nothing.
 *   - `ChildProcess.prototype.kill` is patched so that SIGTERM and SIGINT first drop the sentinel
 *     and only two seconds later send the real signal. A node that polls the sentinel exits on its
 *     own first, with its coverage written; anything else gets the signal it was going to get.
 *     SIGKILL is passed through untouched, because a suite that asks for a hard kill is testing
 *     a crash.
 *   Plain ESM on purpose: NODE_OPTIONS loads it before tsx is registered.
 * @usage `pnpm test:e2e:coverage --db=sqlite` (scripts/e2e-coverage.ts sets the environment).
 * @version-history
 *   v1.0.0 — 2026-09-07 — Initial.
 */
/* global process, setInterval, setTimeout, clearTimeout */
import v8 from 'node:v8';
import { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMainThread } from 'node:worker_threads';

const dir = process.env.NODE_V8_COVERAGE;
const isNodeProcess = /src[\\/]index\.ts$/.test(process.argv[1] ?? '');
const srcPrefix = process.env.AIMEAT_COVERAGE_SRC ?? '';
const KILL_GRACE_MS = 4000;
const POLL_MS = 200;

function keep(url) {
  return srcPrefix ? url.startsWith(srcPrefix) : true;
}

/**
 * Take a snapshot, reduce it to the node's own sources, and store the source maps once.
 * The counts go to disk first and the maps after: the whole thing has to finish inside the grace a
 * killer allows (the runner sends SIGKILL five seconds after SIGTERM, and that one is not deferred),
 * and a map this process did not manage to write is one the next process writes, because the map of
 * a .ts file is the same in every process that loaded it. Measured on the first flush of a sweep,
 * the one that writes every map: about three seconds; later flushes write a handful.
 */
function flush(keepSnapshot) {
  try { v8.takeCoverage(); } catch { return; }
  const own = readdirSync(dir).filter(f => f.startsWith(`coverage-${process.pid}-`) && f.endsWith('.json'));
  const smcDir = join(dir, 'smc');
  mkdirSync(smcDir, { recursive: true });
  const stored = new Set(readdirSync(smcDir));
  for (const file of own) {
    const path = join(dir, file);
    let raw;
    try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch { continue; }
    if (!keepSnapshot(raw)) {
      try { unlinkSync(path); } catch { /* ignore */ }
      continue;
    }
    const result = (raw.result ?? []).filter(s => keep(s.url));
    writeFileSync(join(dir, `cov-${file.slice('coverage-'.length)}`), JSON.stringify({ result }));
    try { unlinkSync(path); } catch { /* the reduced copy is what counts */ }
    for (const [url, entry] of Object.entries(raw['source-map-cache'] ?? {})) {
      if (!keep(url)) continue;
      const name = `${createHash('sha1').update(url).digest('hex')}.json`;
      if (stored.has(name)) continue;
      const target = join(smcDir, name);
      const tmp = `${target}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ url, entry }));
      try { renameSync(tmp, target); } catch { try { unlinkSync(tmp); } catch { /* already gone */ } }
      stored.add(name);
    }
  }
}

/** A process that built a node of its own in-process (nineteen suites do) executed node code. */
const loadedServer = raw => (raw.result ?? []).some(s => /src[\\/]server\.ts$/.test(s.url));

if (dir && !isMainThread) {
  // tsx's module hooks run on a worker thread of their own, and a worker inherits NODE_OPTIONS and
  // argv[1], so this file runs there too. Left alone it raced the main thread for the sentinel,
  // won it about a third of the time, and then process.exit() ended only the worker: the node kept
  // running, the runner's real signal arrived four seconds later, and the snapshot was lost.
  // Measured on the first full sweep: 109 leftover isolate files, and 300 node snapshots where the
  // lane stops alone should have given 316. A worker isolate owns no measure; it stops collecting.
  try { v8.stopCoverage(); } catch { /* not started */ }
} else if (dir) {
  if (isNodeProcess) {
    const stopFile = join(dir, `stop-${process.pid}`);
    const snapshotMs = Number(process.env.AIMEAT_COVERAGE_SNAPSHOT_MS ?? '0');
    if (snapshotMs > 0) setInterval(() => flush(() => true), snapshotMs).unref();
    setInterval(() => {
      if (!existsSync(stopFile)) return;
      try { unlinkSync(stopFile); } catch { /* ignore */ }
      flush(() => true);
      try { v8.stopCoverage(); } catch { /* ignore */ }
      process.exit(0);
    }, POLL_MS).unref();
  } else {
    // Decided at exit, not at start: a suite that booted a node in-process is part of the measure,
    // a suite that only drove one over HTTP is not, and the difference is whether src/server.ts
    // was ever loaded.
    process.on('exit', () => {
      flush(loadedServer);
      try { v8.stopCoverage(); } catch { /* ignore */ }
    });
  }

  const realKill = ChildProcess.prototype.kill;
  ChildProcess.prototype.kill = function kill(signal) {
    const alive = this.exitCode === null && this.signalCode === null;
    if (!alive || signal === 'SIGKILL' || typeof signal === 'number' || !this.pid) return realKill.call(this, signal);
    try { writeFileSync(join(dir, `stop-${this.pid}`), ''); } catch { return realKill.call(this, signal); }
    const timer = setTimeout(() => {
      try { unlinkSync(join(dir, `stop-${this.pid}`)); } catch { /* the child took it */ }
      if (this.exitCode === null && this.signalCode === null) realKill.call(this, signal);
    }, KILL_GRACE_MS);
    this.once('exit', () => clearTimeout(timer));
    return true;
  };
}
