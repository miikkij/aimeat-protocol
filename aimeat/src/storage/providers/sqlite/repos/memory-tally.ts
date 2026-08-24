/**
 * @file src/storage/providers/sqlite/repos/memory-tally.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite SQL for the memory write tally. Counts are DELTAS: every statement adds rather
 *   than sets, keeps the EARLIEST firstAt and the LATEST lastAt, and creates the row on first
 *   sighting. There is no delete and no prune here, on purpose — see the repository contract.
 * @structure upsertWriteTally · upsertFamilyTally · listWriteTally · listFamilyTally ·
 *   countTalliedKeys · pseudonymiseWriter
 * @usage import * as repo from '../repos/memory-tally.js';
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial creation for TARGET-073 step 8.
 */
import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import type {
  MemoryWriteTallyRow, MemoryFamilyTallyRow,
  MemoryWriteTallyUpsert, MemoryFamilyTallyUpsert,
} from '../../../repositories/memory-tally.repository.js';

/**
 * `min()`/`max()` with two arguments are SQLite's SCALAR forms, not the aggregates. That is what
 * keeps firstAt at the earliest sighting even when touches arrive out of order — which they do,
 * because the buffer flushes on a timer and a late flush can carry an older timestamp than one
 * already stored.
 */
const WRITE_UPSERT = `
  INSERT INTO memory_write_tally (ownerGaii, key, writerPrincipal, writeCount, deleteCount, firstAt, lastAt)
  VALUES (@ownerGaii, @key, @writerPrincipal, @writeCount, @deleteCount, @at, @at)
  ON CONFLICT(ownerGaii, key, writerPrincipal) DO UPDATE SET
    writeCount  = writeCount  + excluded.writeCount,
    deleteCount = deleteCount + excluded.deleteCount,
    firstAt     = min(firstAt, excluded.firstAt),
    lastAt      = max(lastAt,  excluded.lastAt)
`;

const FAMILY_UPSERT = `
  INSERT INTO memory_family_tally (ownerGaii, keyFamily, writerPrincipal, tier, writeCount, deleteCount, firstAt, lastAt)
  VALUES (@ownerGaii, @keyFamily, @writerPrincipal, @tier, @writeCount, @deleteCount, @at, @at)
  ON CONFLICT(ownerGaii, keyFamily, writerPrincipal) DO UPDATE SET
    tier        = excluded.tier,
    writeCount  = writeCount  + excluded.writeCount,
    deleteCount = deleteCount + excluded.deleteCount,
    firstAt     = min(firstAt, excluded.firstAt),
    lastAt      = max(lastAt,  excluded.lastAt)
`;

export function upsertWriteTally(db: Database.Database, rows: MemoryWriteTallyUpsert[]): void {
  if (rows.length === 0) return;
  const stmt = db.prepare(WRITE_UPSERT);
  db.transaction((batch: MemoryWriteTallyUpsert[]) => { for (const r of batch) stmt.run(r); })(rows);
}

export function upsertFamilyTally(db: Database.Database, rows: MemoryFamilyTallyUpsert[]): void {
  if (rows.length === 0) return;
  const stmt = db.prepare(FAMILY_UPSERT);
  db.transaction((batch: MemoryFamilyTallyUpsert[]) => { for (const r of batch) stmt.run(r); })(rows);
}

export function listWriteTally(
  db: Database.Database,
  f: { ownerGaii: string; key?: string; keyPrefix?: string; limit?: number },
): MemoryWriteTallyRow[] {
  const where: string[] = ['ownerGaii = ?'];
  const args: unknown[] = [f.ownerGaii];
  if (f.key) { where.push('key = ?'); args.push(f.key); }
  else if (f.keyPrefix) { where.push('key LIKE ? ESCAPE \'\\\''); args.push(`${escapeLike(f.keyPrefix)}%`); }
  args.push(Math.min(f.limit ?? 500, 5000));
  return db.prepare(
    `SELECT * FROM memory_write_tally WHERE ${where.join(' AND ')} ORDER BY lastAt DESC LIMIT ?`,
  ).all(...args) as MemoryWriteTallyRow[];
}

export function listFamilyTally(
  db: Database.Database,
  f: { ownerGaii: string; family?: string; limit?: number },
): MemoryFamilyTallyRow[] {
  const where: string[] = ['ownerGaii = ?'];
  const args: unknown[] = [f.ownerGaii];
  if (f.family) { where.push('keyFamily = ?'); args.push(f.family); }
  args.push(Math.min(f.limit ?? 500, 5000));
  return db.prepare(
    `SELECT * FROM memory_family_tally WHERE ${where.join(' AND ')} ORDER BY writeCount DESC LIMIT ?`,
  ).all(...args) as MemoryFamilyTallyRow[];
}

export function countTalliedKeys(db: Database.Database, ownerGaii: string, familyPrefix: string): number {
  const row = db.prepare(
    `SELECT count(DISTINCT key) AS n FROM memory_write_tally
     WHERE ownerGaii = ? AND key LIKE ? ESCAPE '\\'`,
  ).get(ownerGaii, `${escapeLike(familyPrefix)}%`) as { n: number } | undefined;
  return row?.n ?? 0;
}

/**
 * Rewrite this owner's name out of the WRITER column, wherever the row belongs to somebody else.
 *
 * A stable hash rather than a constant, so two erased writers stay two hands and do not merge into
 * one. Rows in the erased owner's OWN namespace are not touched here — the account cascade deletes
 * those with the rest of their data.
 */
export function pseudonymiseWriter(db: Database.Database, ownerName: string, nodeId: string): number {
  const marker = `erased:${createHash('sha256').update(`${ownerName}@${nodeId}`).digest('hex').slice(0, 12)}`;
  const mine = `${ownerName}@${nodeId}`;
  const asAgent = `%#${ownerName}@${nodeId}`;
  let n = 0;
  for (const table of ['memory_write_tally', 'memory_family_tally']) {
    const res = db.prepare(
      `UPDATE ${table} SET writerPrincipal = ?
       WHERE ownerGaii <> ? AND (writerPrincipal = ? OR writerPrincipal LIKE ?)`,
    ).run(marker, mine, mine, asAgent);
    n += res.changes;
  }
  return n;
}

/** LIKE has its own wildcards; a key holding `%` or `_` must not become a prefix match for more. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, m => `\\${m}`);
}
