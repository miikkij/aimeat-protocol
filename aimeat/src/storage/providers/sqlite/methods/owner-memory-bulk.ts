/**
 * @file src/storage/providers/sqlite/methods/owner-memory-bulk.ts
 * @description SQLite memory BULK primitives (data-access redesign) — batched key read, bulk upsert (one
 *   transaction), and the delete family (subtree / prefix-wipe / explicit-ref). Split out of ./owner.ts
 *   to keep that file ≤800 lines (max-file-lines); method bodies are verbatim, bound to SqliteStorage via
 *   the same prototype merge. Each is workload-shaped so the higher layers compose them without SQL.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Extracted from owner.ts (Phase 1/2 bulk primitives).
 */
import type { MemoryRecord } from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

export const ownerMemoryBulkMethods = {
  // BULK PRIMITIVE (Phase 1) — many keys under one owner in ONE `key IN (…)` query. Live rows only
  // (TTL-expired rows are pruned lazily, mirroring getMemory/listMemory). Order not guaranteed.
  async getMemoryByKeys(this: SqliteStorage, ownerGaii: string, keys: string[]): Promise<MemoryRecord[]> {
    if (keys.length === 0) return [];
    const placeholders = keys.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT * FROM memory WHERE ownerGaii = ? AND key IN (${placeholders})`).all(ownerGaii, ...keys) as Record<string, unknown>[];
    const out: MemoryRecord[] = [];
    for (const row of rows) {
      const record = this.deserializeMemory(row);
      if (this.isMemoryExpired(record)) {
        this.db.prepare('DELETE FROM memory WHERE ownerGaii = ? AND key = ?').run(record.ownerGaii, record.key);
        continue;
      }
      out.push(record);
    }
    return out;
  },

  // BULK PRIMITIVE (Phase 1) — upsert many rows in ONE transaction. Reuses setMemory verbatim (version
  // bump + trackable-history + byteSize stay identical); a manual BEGIN/COMMIT wraps the loop into a
  // single commit. better-sqlite3 runs every statement synchronously, so the awaited setMemory calls
  // execute inside the open transaction with nothing else touching the connection between them.
  async bulkSetMemory(this: SqliteStorage, records: MemoryRecord[]): Promise<MemoryRecord[]> {
    if (records.length === 0) return [];
    const out: MemoryRecord[] = [];
    this.db.exec('BEGIN');
    try {
      for (const r of records) out.push(await this.setMemory(r));
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return out;
  },

  // BULK PRIMITIVE (Phase 1) — delete a record's whole family in ONE statement: the base key itself plus
  // its `base.*` children (.draft/.latest/.version.N), WITHOUT matching a sibling `baseX` (mirrors the
  // 'subtree' match archiveMemoryByKey uses). Replaces the per-key gated deletes a record teardown ran.
  async deleteMemorySubtree(this: SqliteStorage, ownerGaii: string, baseKey: string): Promise<number> {
    const result = this.db.prepare(
      'DELETE FROM memory WHERE ownerGaii = ? AND (key = ? OR key LIKE ?)'
    ).run(ownerGaii, baseKey, baseKey + '.%');
    return result.changes;
  },

  // BULK PRIMITIVE (Phase 2) — delete EVERY row under a key prefix, all owners, active AND archived, in
  // ONE statement (the AFTER DELETE trigger keeps both FTS tables in sync per row). Backs the workspace/
  // organism wipe, replacing its per-key deleteMemory loop over thousands of rows.
  async deleteMemoryByPrefix(this: SqliteStorage, keyPrefix: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM memory WHERE key LIKE ?').run(keyPrefix + '%');
    return result.changes;
  },

  // BULK PRIMITIVE (Phase 2) — delete many explicit (ownerGaii, key) rows in ONE transaction (a manual
  // BEGIN/COMMIT round a prepared per-key delete — better-sqlite3 runs it synchronously). Backs the
  // batched record-family delete (rows collected across records, possibly spanning owner identities).
  async bulkDeleteMemory(this: SqliteStorage, refs: { ownerGaii: string; key: string }[]): Promise<number> {
    if (refs.length === 0) return 0;
    const stmt = this.db.prepare('DELETE FROM memory WHERE ownerGaii = ? AND key = ?');
    let removed = 0;
    this.db.exec('BEGIN');
    try {
      for (const r of refs) removed += stmt.run(r.ownerGaii, r.key).changes;
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return removed;
  },

  // BULK PRIMITIVE (Phase 2) — value-free (ownerGaii, key) enumeration under a prefix (SELECT projects
  // only the two columns, never the value). ACTIVE rows only (archived = 0), matching object_delete's
  // scan — an archived record is not deletable. Backs the batched record delete's addressing scan.
  async listMemoryKeysByPrefix(this: SqliteStorage, keyPrefix: string): Promise<{ ownerGaii: string; key: string }[]> {
    return this.db.prepare('SELECT ownerGaii, key FROM memory WHERE key LIKE ? AND archived = 0').all(keyPrefix + '%') as { ownerGaii: string; key: string }[];
  },
};
