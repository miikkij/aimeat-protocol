#!/usr/bin/env node
/**
 * @file archive-stale-versions.ts
 * @description One-time, REVERSIBLE cleanup of accumulated workspace-record version bloat. Publishing a
 *   workspace record used to append a new `.version.N` on every publish with no change-guard, so a
 *   contract agent that re-published the same draft each poll cycle piled up dozens of byte-identical
 *   versions per record (concentrated in request queues: mail/research/moodboard/image_requests). The
 *   publish path is now guarded (see mcp/workspaces.ts + routes/organisms.ts), so this stops GROWING;
 *   this script cleans up what already accrued.
 *
 *   It does NOT delete: it flags redundant version rows `archived = 1` (the same reversible soft-archive
 *   the organism archive uses) under a shared `archivedRoot` so the whole batch can be restored with
 *   --unarchive. A version row is redundant when it is byte-identical to the version immediately before
 *   it (by N) — a pure republish that recorded no real change. Every genuine state transition, the
 *   first version, and the highest-numbered version (so publish's next-version scan is unaffected) are
 *   ALWAYS kept. Document/record spaces that version legitimately have no consecutive duplicates, so
 *   nothing there is touched.
 *
 *   Read-only by default. `--from-export=<json>` analyses an exported memory dump with no DB at all.
 *   Detects the storage provider from .env for the live scan / apply.
 * @usage
 *   pnpm versions:stats                              # live dry-run: what WOULD be archived (per namespace)
 *   pnpm versions:stats -- --from-export=dump.json   # analyse an export JSON, no DB touched
 *   pnpm versions:archive                            # apply the archive (asks to confirm)
 *   pnpm versions:archive -- --force                 # apply without the prompt
 *   pnpm versions:stats -- --unarchive               # preview restore; add --apply to restore
 *   pnpm versions:archive -- --unarchive --force     # restore the whole archived batch
 * @version-history
 *   v1.0.0 -- 2026-07-01 -- Initial: reversible consecutive-identical version dedupe (sqlite + mongodb),
 *     plus a DB-free --from-export analyser.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const ARCHIVE_ROOT = 'stale-version-dedupe';
const ARCHIVED_BY = 'archive-stale-versions-script';

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
const apply = argv.includes('--apply');
const unarchive = argv.includes('--unarchive');
const fromExportArg = argv.find(a => a.startsWith('--from-export='));
const fromExport = fromExportArg ? fromExportArg.split('=').slice(1).join('=') : null;

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
function bytesOf(v: unknown): number { return Buffer.byteLength(JSON.stringify(v ?? null), 'utf8'); }

async function confirm(message: string): Promise<boolean> {
  if (force) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>(r => rl.question(message, r));
  rl.close();
  return answer.trim().toLowerCase() === 'y';
}

/** Namespace label for a workspace record key: the objectType namespace segment, else '(other)'. */
function nsOf(key: string): string {
  const m = key.match(/\.shared\.([^.]+)\./) || key.match(/\.w\.[^.]+\.([^.]+)\./) || key.match(/^([^.]+)\./);
  return m ? m[1] : '(other)';
}

type Row = { key: string; ownerGaii?: string; value: unknown };

/** Redundant version rows = byte-identical to the version immediately before them (by N), excluding the
 *  highest-numbered version of each record (kept so a future publish's maxN scan is unaffected). */
function planRedundant(rows: Row[]): Array<Row & { bytes: number }> {
  const groups = new Map<string, Array<{ n: number; row: Row }>>();
  for (const r of rows) {
    const m = r.key.match(/^(.*)\.version\.(\d+)$/);
    if (!m) continue;
    const arr = groups.get(m[1]) ?? [];
    arr.push({ n: parseInt(m[2], 10), row: r });
    groups.set(m[1], arr);
  }
  const out: Array<Row & { bytes: number }> = [];
  for (const arr of groups.values()) {
    arr.sort((a, b) => a.n - b.n);
    const maxN = arr[arr.length - 1].n;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].n === maxN) continue;                                   // always keep the top version
      if (JSON.stringify(arr[i].row.value) === JSON.stringify(arr[i - 1].row.value)) {
        out.push({ ...arr[i].row, bytes: bytesOf(arr[i].row.value) });   // identical to its predecessor
      }
    }
  }
  return out;
}

function report(redundant: Array<Row & { bytes: number }>, totalVersionRows: number) {
  const byNs = new Map<string, { count: number; bytes: number }>();
  let bytes = 0;
  for (const r of redundant) {
    const s = byNs.get(nsOf(r.key)) ?? { count: 0, bytes: 0 };
    s.count++; s.bytes += r.bytes; byNs.set(nsOf(r.key), s);
    bytes += r.bytes;
  }
  console.log(`  Version rows scanned:      ${totalVersionRows.toLocaleString()}`);
  console.log(`  Redundant (archivable):    ${redundant.length.toLocaleString()}  (${fmtBytes(bytes)})`);
  if (byNs.size) {
    console.log('  By namespace:');
    for (const [ns, s] of [...byNs.entries()].sort((a, b) => b[1].bytes - a[1].bytes)) {
      console.log(`    ${ns.padEnd(22)} ${String(s.count).padStart(5)} rows  ${fmtBytes(s.bytes).padStart(10)}`);
    }
  }
  console.log('');
}

// ─── Export-file analysis (no DB) ────────────────────────────
function runFromExport(path: string) {
  const p = resolve(process.cwd(), path);
  if (!existsSync(p)) { console.error(`  x No export file at ${p}`); process.exit(1); }
  const doc = JSON.parse(readFileSync(p, 'utf8')) as { entries?: Row[] };
  const entries = doc.entries ?? [];
  const versionRows = entries.filter(e => /\.version\.\d+$/.test(e.key));
  console.log(`  Source:         export file (${path}) — read-only, no DB touched`);
  console.log(`  Entries:        ${entries.length.toLocaleString()}`);
  console.log('');
  report(planRedundant(versionRows), versionRows.length);
  console.log('  This is analysis only. Point the script at the live node (drop --from-export) to apply.');
}

// ─── SQLite ──────────────────────────────────────────────────
async function runSqlite() {
  const dbPath = resolve(ROOT, env.AIMEAT_SQLITE_PATH ?? './data/aimeat.db');
  if (!existsSync(dbPath)) { console.log(`  No database file at ${dbPath} — nothing to do.`); return; }
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(dbPath);
  try {
    console.log(`  Storage:        sqlite (${dbPath})`);
    console.log(`  DB file size:   ${fmtBytes(statSync(dbPath).size)}`);
    console.log('');

    if (unarchive) {
      const n = (db.prepare('SELECT COUNT(*) AS c FROM memory WHERE archivedRoot = ?').get(ARCHIVE_ROOT) as { c: number }).c;
      console.log(`  Archived batch "${ARCHIVE_ROOT}": ${n.toLocaleString()} row(s).`);
      if (!apply) { console.log('  Read-only. Add --apply to restore them.'); return; }
      if (!await confirm(`  Restore ${n.toLocaleString()} archived version row(s)? [y/N] `)) { console.log('  Aborted.'); return; }
      const res = db.prepare('UPDATE memory SET archived=0, archivedAt=NULL, archivedBy=NULL, archivedRoot=NULL WHERE archivedRoot = ?').run(ARCHIVE_ROOT);
      console.log(`  Restored ${res.changes.toLocaleString()} row(s).`);
      return;
    }

    const rows = db.prepare("SELECT key, ownerGaii, value FROM memory WHERE key LIKE '%.version.%' AND archived = 0").all() as Array<{ key: string; ownerGaii: string; value: string }>;
    const redundant = planRedundant(rows.map(r => ({ key: r.key, ownerGaii: r.ownerGaii, value: JSON.parse(r.value) })));
    report(redundant, rows.length);

    if (!apply) { console.log('  Read-only. Re-run with --apply (pnpm versions:archive) to soft-archive them.'); return; }
    if (redundant.length === 0) { console.log('  Nothing to archive.'); return; }
    if (!await confirm(`  Soft-archive ${redundant.length.toLocaleString()} redundant version row(s)? Reversible via --unarchive. [y/N] `)) { console.log('  Aborted.'); return; }
    const at = new Date().toISOString();
    const stmt = db.prepare('UPDATE memory SET archived=1, archivedAt=?, archivedBy=?, archivedRoot=? WHERE ownerGaii=? AND key=? AND archived=0');
    const tx = db.transaction((items: Array<Row & { bytes: number }>) => {
      let done = 0;
      for (const r of items) done += stmt.run(at, ARCHIVED_BY, ARCHIVE_ROOT, r.ownerGaii, r.key).changes;
      return done;
    });
    console.log(`  Archived ${tx(redundant).toLocaleString()} row(s) under archivedRoot="${ARCHIVE_ROOT}". Restore with: pnpm versions:archive -- --unarchive --force`);
  } finally {
    db.close();
  }
}

// ─── MongoDB ─────────────────────────────────────────────────
async function runMongodb() {
  const dbUrl = env.DATABASE_URL;
  if (!dbUrl) { console.error('  x No DATABASE_URL in .env'); process.exit(1); }
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasourceUrl: dbUrl });
  await prisma.$connect();
  try {
    console.log('  Storage:        mongodb');
    console.log('');

    if (unarchive) {
      const n = await prisma.memory.count({ where: { archivedRoot: ARCHIVE_ROOT } });
      console.log(`  Archived batch "${ARCHIVE_ROOT}": ${n.toLocaleString()} row(s).`);
      if (!apply) { console.log('  Read-only. Add --apply to restore them.'); return; }
      if (!await confirm(`  Restore ${n.toLocaleString()} archived version row(s)? [y/N] `)) { console.log('  Aborted.'); return; }
      const res = await prisma.memory.updateMany({ where: { archivedRoot: ARCHIVE_ROOT }, data: { archived: false, archivedAt: null, archivedBy: null, archivedRoot: null } });
      console.log(`  Restored ${res.count.toLocaleString()} row(s).`);
      return;
    }

    const rows = await prisma.memory.findMany({ where: { key: { contains: '.version.' }, archived: false }, select: { key: true, ownerGaii: true, value: true } });
    const redundant = planRedundant(rows.map(r => ({ key: r.key, ownerGaii: r.ownerGaii, value: r.value })));
    report(redundant, rows.length);

    if (!apply) { console.log('  Read-only. Re-run with --apply (pnpm versions:archive) to soft-archive them.'); return; }
    if (redundant.length === 0) { console.log('  Nothing to archive.'); return; }
    if (!await confirm(`  Soft-archive ${redundant.length.toLocaleString()} redundant version row(s)? Reversible via --unarchive. [y/N] `)) { console.log('  Aborted.'); return; }
    const at = new Date();
    let done = 0;
    for (const r of redundant) {
      await prisma.memory.update({ where: { ownerGaii_key: { ownerGaii: r.ownerGaii!, key: r.key } }, data: { archived: true, archivedAt: at, archivedBy: ARCHIVED_BY, archivedRoot: ARCHIVE_ROOT } });
      done++;
    }
    console.log(`  Archived ${done.toLocaleString()} row(s) under archivedRoot="${ARCHIVE_ROOT}". Restore with: pnpm versions:archive -- --unarchive --force`);
  } finally {
    await prisma.$disconnect();
  }
}

// ─── Main ────────────────────────────────────────────────────
console.log('');
console.log('  AIMEAT Stale-Version Archive (reversible)');
console.log('  ══════════════════════════════════════════');

if (fromExport) {
  runFromExport(fromExport);
} else {
  switch (provider) {
    case 'sqlite': await runSqlite(); break;
    case 'mongodb': await runMongodb(); break;
    default: console.log('  Storage: memory (in-memory) — nothing persisted. Use --from-export=<json> to analyse a dump.'); break;
  }
}
console.log('');
