/**
 * @file src/storage/providers/sqlite/schema-memory-totals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The SQLite twin of PostgreSQL migration 0125_memory_totals.sql: each principal's memory
 *   as the write ceilings count it, kept by triggers on `memory` in the statement that changes a row
 *   (codebase analysis 2026-11-03, item C3; what is counted: src/storage/memory-totals.ts).
 *
 *   `keys` is countMemory([owner], { excludePrefixes: MEMORY_COUNT_EXCLUDED_PREFIXES }); `bytes` is this
 *   provider's sumMemoryBytes, which sums `byteSize` over EVERY row of the owner (archived and binned
 *   included, unlike PostgreSQL's), so the totals keep that answer.
 *
 *   One row per owner, updated in place: SQLite has one writer at a time, so the shared row costs no
 *   waiting and no deadlock, and a row that reaches zero is removed by the same trigger.
 *
 *   RUN ON EVERY START, after initializeSchema. When the three triggers are all there it does nothing.
 *   When any is missing, which is a first start or a rebuild of the memory table (dropping a table drops
 *   its triggers), it creates them and counts the totals again from the rows, in one transaction.
 * @structure applyMemoryTotals(db)
 * @usage applyMemoryTotals(db);   // SqliteStorage constructor, after initializeSchema
 * @version-history
 *   2026-11-04 — Initial (codebase analysis 2026-11-03, item C3).
 */
import type Database from 'better-sqlite3';
import { MEMORY_COUNT_EXCLUDED_PREFIXES } from '../../memory-totals.js';
import { globPrefix } from '../../key-prefix.js';

const TRIGGERS = ['memory_totals_ai', 'memory_totals_ad', 'memory_totals_au'] as const;

/** A SQL string literal. The prefixes are the node's own constants; the quote is doubled all the same. */
const literal = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/** One row's share of `keys`, for the row named `r` (new or old). */
function keyShare(r: 'new' | 'old'): string {
  const outside = MEMORY_COUNT_EXCLUDED_PREFIXES.map(p => ` AND ${r}.key NOT GLOB ${literal(globPrefix(p))}`).join('');
  return `(CASE WHEN ${r}.deletedAt IS NULL AND ${r}.archived = 0${outside} THEN 1 ELSE 0 END)`;
}

/** Add a share to an owner's row, then drop the row when it reached zero. */
function add(owner: string, keys: string, bytes: string): string {
  return `INSERT INTO memory_totals (ownerGaii, keys, bytes) VALUES (${owner}, ${keys}, ${bytes})
      ON CONFLICT(ownerGaii) DO UPDATE SET keys = keys + excluded.keys, bytes = bytes + excluded.bytes;
    DELETE FROM memory_totals WHERE ownerGaii = ${owner} AND keys = 0 AND bytes = 0;`;
}

export function applyMemoryTotals(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS memory_totals (ownerGaii TEXT PRIMARY KEY, keys INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0)');
  const present = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN (${TRIGGERS.map(() => '?').join(',')})`)
    .all(...TRIGGERS) as Array<{ name: string }>;
  if (present.length === TRIGGERS.length) return;
  const rowKeyShare = keyShare('new').replace(/\bnew\./g, '');
  db.transaction(() => {
    db.exec(`
      DROP TRIGGER IF EXISTS memory_totals_ai;
      DROP TRIGGER IF EXISTS memory_totals_ad;
      DROP TRIGGER IF EXISTS memory_totals_au;
      CREATE TRIGGER memory_totals_ai AFTER INSERT ON memory BEGIN
        ${add('new.ownerGaii', keyShare('new'), 'new.byteSize')}
      END;
      CREATE TRIGGER memory_totals_ad AFTER DELETE ON memory BEGIN
        ${add('old.ownerGaii', `-${keyShare('old')}`, '-old.byteSize')}
      END;
      CREATE TRIGGER memory_totals_au AFTER UPDATE OF ownerGaii, key, archived, deletedAt, byteSize ON memory BEGIN
        ${add('old.ownerGaii', `-${keyShare('old')}`, '-old.byteSize')}
        ${add('new.ownerGaii', keyShare('new'), 'new.byteSize')}
      END;
      DELETE FROM memory_totals;
      INSERT INTO memory_totals (ownerGaii, keys, bytes)
        SELECT ownerGaii, SUM(${rowKeyShare}), SUM(byteSize) FROM memory GROUP BY ownerGaii
        HAVING SUM(${rowKeyShare}) <> 0 OR SUM(byteSize) <> 0;
    `);
  })();
}
