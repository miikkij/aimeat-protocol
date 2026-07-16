#!/usr/bin/env tsx
/**
 * @file scripts/kill-test-servers.ts
 * @description Pre-flight cleanup for the E2E runner — kill a wedged test server left behind by a
 *   previous run (timed-out, crashed, or Ctrl-C'd before teardown) and remove a stale/corrupt SQLite
 *   test DB so the next run starts clean. Deliberately targets ONLY the E2E test port (default 40251,
 *   matching test/run-e2e-ci.ts) and the test DB file — never the dev server on :40050 or any other
 *   node process, so it is safe to run alongside a live `pnpm dev` or a concurrent session.
 * @structure killOnPort (Windows netstat / Unix lsof) + cleanStaleSqlite; runs both on invoke.
 * @usage Prepended to the `test:e2e:*` package scripts (mirrors how `pnpm dev` prepends kill-port.ts).
 *   Override the port with AIMEAT_TEST_PORT. Best-effort: every failure is swallowed.
 * @version-history
 *   v1.0.0 — 2026-07-16 — Initial: stop leftover E2E servers + stale test DB between runs.
 */
import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { platform } from 'node:os';
import { resolve } from 'node:path';

// The E2E runner (test/run-e2e-ci.ts) auto-starts its server on this port.
const port = process.env.AIMEAT_TEST_PORT ?? '40251';

function killOnPort(p: string): void {
  if (platform() === 'win32') {
    let out: string;
    try {
      out = execSync(`netstat -ano | findstr LISTENING | findstr :${p}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch { return; } // nothing listening — clean
    const pids = new Set<string>();
    for (const line of out.trim().split('\n')) {
      const pid = line.trim().split(/\s+/).pop();
      if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /F /T`, { stdio: ['pipe', 'pipe', 'pipe'] });
        console.log(`  Killed leftover test server PID ${pid} on port ${p}`);
      } catch { /* already gone */ }
    }
  } else {
    let out: string;
    try {
      out = execSync(`lsof -ti :${p}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch { return; }
    for (const pid of new Set(out.trim().split('\n').filter(x => /^\d+$/.test(x)))) {
      try {
        execSync(`kill -9 ${pid}`, { stdio: ['pipe', 'pipe', 'pipe'] });
        console.log(`  Killed leftover test server PID ${pid} on port ${p}`);
      } catch { /* already gone */ }
    }
  }
}

/**
 * Remove the SQLite test DB + its WAL/SHM sidecars. A run killed mid-flight can leave the -wal/-shm
 * files WITHOUT the main .db, which makes the next better-sqlite3 open hang → "server failed to start".
 * The runner's own cleanDatabase() deletes these per suite too; doing it here first guarantees a clean
 * open even after a crash. Only touches the fixed test DB path — never a real database.
 */
function cleanStaleSqlite(): void {
  const dbPath = process.env.AIMEAT_DB_PATH ?? resolve(process.cwd(), 'test/.test-e2e.db');
  if (dbPath === ':memory:') return;
  const base = resolve(process.cwd(), dbPath);
  for (const suffix of ['', '-wal', '-shm']) {
    const f = base + suffix;
    if (existsSync(f)) {
      try { rmSync(f, { force: true }); } catch { /* locked → the runner will retry */ }
    }
  }
}

killOnPort(port);
cleanStaleSqlite();
