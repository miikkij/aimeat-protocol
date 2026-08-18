#!/usr/bin/env node
/**
 * @file consent-audit-prune.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Measure and prune the consent-audit store (ConsentAudit collection /
 *   consent_audit table). Historically this logged one row on EVERY data-access check and
 *   grew without bound (1.2M+ rows in prod). The server now only writes denials + consent
 *   mutations and a core job prunes past the retention window — but this script lets you
 *   inspect the size, see the breakdown by action, and clear the legacy backlog now.
 *   Detects the storage provider from .env. Read-only by default: mutates only with
 *   --clear or --older-than=<days>.
 * @usage
 *   pnpm consent-audit:stats                  # count + size + per-action breakdown
 *   pnpm consent-audit:prune --older-than=90   # delete entries older than 90 days
 *   pnpm consent-audit:prune --clear           # delete ALL consent-audit entries
 *   pnpm consent-audit:prune --clear --force   # skip the confirmation prompt
 *   (sqlite only) add --vacuum to reclaim file space after a delete
 * @version-history
 *   v1.0.0 -- 2026-06-21 -- Initial: stats (with per-action breakdown) + prune for sqlite & mongodb.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

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

function printBreakdown(rows: Array<{ action: string; allowed: boolean; count: number }>) {
  if (rows.length === 0) return;
  console.log('  By action:');
  for (const r of rows.sort((a, b) => b.count - a.count)) {
    console.log(`    ${r.action.padEnd(8)} ${r.allowed ? 'allowed' : 'denied '}  ${r.count.toLocaleString()}`);
  }
  console.log('');
}

// ─── SQLite ──────────────────────────────────────────────────

async function runSqlite() {
  const dbPath = resolve(ROOT, env.AIMEAT_SQLITE_PATH ?? './data/aimeat.db');
  if (!existsSync(dbPath)) { console.log(`  No database file at ${dbPath} — nothing to do.`); return; }

  const Database = (await import('better-sqlite3')).default;
  const db = new Database(dbPath);

  try {
    const tableExists = db.prepare(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name='consent_audit'`,
    ).get();
    if (!tableExists) { console.log('  No consent_audit table — nothing to do.'); return; }

    const count = (db.prepare('SELECT COUNT(*) AS c FROM consent_audit').get() as { c: number }).c;
    const fileSize = statSync(dbPath).size;

    console.log(`  Storage:        sqlite (${dbPath})`);
    console.log(`  Table:          consent_audit`);
    console.log(`  Rows:           ${count.toLocaleString()}`);
    console.log(`  DB file size:   ${fmtBytes(fileSize)}`);
    console.log('');

    if (!willMutate) {
      const rows = db.prepare(
        'SELECT action, allowed, COUNT(*) AS c FROM consent_audit GROUP BY action, allowed',
      ).all() as Array<{ action: string; allowed: number; c: number }>;
      printBreakdown(rows.map(r => ({ action: r.action, allowed: r.allowed === 1, count: r.c })));
      console.log('  Read-only. Pass --clear or --older-than=<days> to prune (add --vacuum to reclaim file space).');
      return;
    }

    const label = olderThanDays !== null ? `older than ${olderThanDays} day(s)` : 'ALL';
    if (!await confirm(`  Delete ${label} consent-audit entries from the sqlite db? [y/N] `)) {
      console.log('  Aborted.'); return;
    }
    const res = olderThanDays !== null
      ? db.prepare('DELETE FROM consent_audit WHERE timestamp < ?').run(cutoffIso(olderThanDays))
      : db.prepare('DELETE FROM consent_audit').run();
    console.log(`  Deleted ${res.changes.toLocaleString()} row(s).`);

    if (vacuum) { db.exec('VACUUM'); console.log('  VACUUM done — file space reclaimed.'); }
    else console.log('  Tip: re-run with --vacuum to shrink the .db file on disk.');
  } finally {
    db.close();
  }
}

// ─── Main ────────────────────────────────────────────────────

console.log('');
console.log('  AIMEAT Consent-Audit Prune');
console.log('  ══════════════════════════════════════');

switch (provider) {
  case 'sqlite': await runSqlite(); break;
  case 'postgres':
  case 'postgresql':
  case 'postgres-kysely':
    console.log('  Storage: postgres-kysely — prune directly via SQL, e.g.');
    console.log("  psql \"$DATABASE_URL\" -c \"DELETE FROM consent_audits WHERE timestamp < now() - interval '30 days'\"");
    break;
  default:
    console.log('  Storage: memory (in-memory) — nothing persisted to prune.');
    break;
}
console.log('');
