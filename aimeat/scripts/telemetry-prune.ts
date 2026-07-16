#!/usr/bin/env node
/**
 * @file telemetry-prune.ts
 * @description Measure and prune the raw agent telemetry store (TelemetryEvent collection /
 *   telemetry_events table). Raw telemetry is no longer written by the server (see
 *   services/telemetry-buffer.ts), so any existing rows are legacy backlog that only takes
 *   up space — this script reports the size and lets you clear it or trim by age.
 *   Detects the configured storage provider from .env (sqlite). Read-only by
 *   default: it prints stats and mutates ONLY when given --clear or --older-than.
 * @usage
 *   pnpm telemetry:stats                  # report count + size only (no changes)
 *   pnpm telemetry:prune --older-than=7   # delete events older than 7 days
 *   pnpm telemetry:prune --clear          # delete ALL telemetry events
 *   pnpm telemetry:prune --clear --force  # skip the confirmation prompt
 *   (sqlite only) add --vacuum to reclaim file space after a delete
 * @version-history
 *   v2.0.0 -- 2026-07-16 -- Drop the MongoDB path (backend removed); sqlite only
 *   v1.0.0 -- 2026-06-21 -- Initial: stats + clear/older-than prune for sqlite & mongodb.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ─── Args + .env ─────────────────────────────────────────────

function loadEnv(): Record<string, string> {
  const envPath = resolve(ROOT, '.env');
  const vars: Record<string, string> = {};
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)\s*=\s*"?([^"\n]*)"?/);
      if (m) vars[m[1]] = m[2];
    }
  }
  return vars;
}

const env = { ...loadEnv(), ...process.env };
const provider = env.AIMEAT_STORAGE ?? 'memory';
const argv = process.argv.slice(2);
const force = argv.includes('--force') || argv.includes('-f');
const clear = argv.includes('--clear');
const vacuum = argv.includes('--vacuum');
const olderThanArg = argv.find(a => a.startsWith('--older-than='));
const olderThanDays = olderThanArg ? Number(olderThanArg.split('=')[1]) : null;
const willMutate = clear || olderThanDays !== null;

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function cutoffIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

async function confirm(message: string): Promise<boolean> {
  if (force) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>(r => rl.question(message, r));
  rl.close();
  return answer.trim().toLowerCase() === 'y';
}

// ─── SQLite ──────────────────────────────────────────────────

async function runSqlite() {
  const dbPath = resolve(ROOT, env.AIMEAT_SQLITE_PATH ?? './data/aimeat.db');
  if (!existsSync(dbPath)) { console.log(`  No database file at ${dbPath} — nothing to do.`); return; }

  const Database = (await import('better-sqlite3')).default;
  const db = new Database(dbPath);

  try {
    const exists = db.prepare(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name='telemetry_events'`,
    ).get();
    if (!exists) { console.log('  No telemetry_events table — nothing to do.'); return; }

    const count = (db.prepare('SELECT COUNT(*) AS c FROM telemetry_events').get() as { c: number }).c;
    const fileSize = statSync(dbPath).size;
    // Per-table byte usage (dbstat is available in most better-sqlite3 builds).
    let tableBytes: number | null = null;
    try {
      tableBytes = (db.prepare(
        `SELECT SUM(pgsize) AS b FROM dbstat WHERE name IN ('telemetry_events')
         OR name IN (SELECT name FROM sqlite_master WHERE tbl_name='telemetry_events')`,
      ).get() as { b: number | null }).b;
    } catch { /* dbstat not compiled in — skip */ }

    console.log(`  Storage:        sqlite (${dbPath})`);
    console.log(`  Table:          telemetry_events`);
    console.log(`  Rows:           ${count.toLocaleString()}`);
    if (tableBytes != null) console.log(`  Table size:     ${fmtBytes(tableBytes)} (incl. indexes)`);
    console.log(`  DB file size:   ${fmtBytes(fileSize)}`);
    console.log('');

    if (!willMutate) {
      console.log('  Read-only. Pass --clear or --older-than=<days> to prune (add --vacuum to reclaim file space).');
      return;
    }

    const label = olderThanDays !== null ? `older than ${olderThanDays} day(s)` : 'ALL';
    if (!await confirm(`  Delete ${label} telemetry events from the sqlite db? [y/N] `)) {
      console.log('  Aborted.'); return;
    }

    const res = olderThanDays !== null
      ? db.prepare('DELETE FROM telemetry_events WHERE createdAt < ?').run(cutoffIso(olderThanDays))
      : db.prepare('DELETE FROM telemetry_events').run();
    console.log(`  Deleted ${res.changes.toLocaleString()} row(s).`);

    if (vacuum) { db.exec('VACUUM'); console.log('  VACUUM done — file space reclaimed.'); }
    else console.log('  Tip: re-run with --vacuum to shrink the .db file on disk.');
  } finally {
    db.close();
  }
}

// ─── Main ────────────────────────────────────────────────────

console.log('');
console.log('  AIMEAT Telemetry Prune');
console.log('  ══════════════════════════════════════');

switch (provider) {
  case 'sqlite': await runSqlite(); break;
  case 'postgres':
  case 'postgresql':
  case 'postgres-kysely':
    console.log('  Storage: postgres-kysely — prune directly via SQL, e.g.');
    console.log("  psql \"$DATABASE_URL\" -c \"DELETE FROM telemetry_events WHERE created_at < now() - interval '7 days'\"");
    break;
  default:
    console.log('  Storage: memory (in-memory) — telemetry is never persisted; nothing to prune.');
    break;
}
console.log('');
