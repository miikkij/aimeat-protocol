/**
 * @file src/storage/providers/sqlite/methods/owner-memory-scope.ts
 * @description Owner-scope memory reads (SQLite): the value-free ?include=meta projection and the
 *   single-query cross-identity list/meta variants. Split out of owner.ts to keep every method-group
 *   file <=800 lines; bound to SqliteStorage via prototype merge (same as the other method groups).
 * @version-history
 *   v1.1.0 - 2026-08-17 - listAllMemoryMeta (cross-owner META projection) + shared rowToMeta helper.
 *   v1.0.0 - 2026-07-15 - Extracted from owner.ts (max-file-lines) during the owner-scope query perf pass.
 */
import type { MemoryRecord, ArchiveFilter } from '../../../interface.js';
import type { MemoryMetaRow } from '../../../repositories/memory.repository.js';
import type { SqliteStorage } from '../index.js';
import { archivedSql } from '../repos/memory.js';

/** Shared row→meta mapping for the projections below (tags parsed, defaults applied). */
function rowToMeta(row: Record<string, unknown>): MemoryMetaRow {
  return {
    key: row.key as string,
    ownerGaii: row.ownerGaii as string,
    visibility: row.visibility as MemoryMetaRow['visibility'],
    tags: JSON.parse((row.tags as string) ?? '[]') as string[],
    version: row.version as number,
    flagCount: (row.flagCount as number | null) ?? 0,
    byteSize: (row.byteSize as number | null) ?? 0,
    ttlHours: (row.ttlHours as number | null) ?? null,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

export const ownerMemoryScopeMethods = {
  async listMemoryMeta(this: SqliteStorage, ownerGaii: string, opts?: { prefix?: string; visibility?: string; tags?: string[]; maxFlags?: number; archived?: ArchiveFilter }): Promise<MemoryMetaRow[]> {
    // META projection: select metadata + byteSize, NEVER the `value` column (the whole point — a
    // keyspace of thousands of keys lists without loading/serialising any value). ttlHours + createdAt
    // are read only to prune lazily-expired rows, then dropped from the result.
    let sql = 'SELECT key, ownerGaii, visibility, tags, version, flagCount, byteSize, ttlHours, createdAt, updatedAt FROM memory WHERE ownerGaii = ?';
    const params: unknown[] = [ownerGaii];
    if (opts?.prefix) { sql += ' AND key LIKE ?'; params.push(opts.prefix + '%'); }
    if (opts?.visibility) { sql += ' AND visibility = ?'; params.push(opts.visibility); }
    sql += archivedSql(opts?.archived);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    const out: MemoryMetaRow[] = [];
    for (const row of rows) {
      const ttlHours = row.ttlHours as number | null;
      if (ttlHours) {
        const expiresAt = new Date(row.createdAt as string).getTime() + ttlHours * 3_600_000;
        if (Date.now() > expiresAt) {
          this.db.prepare('DELETE FROM memory WHERE ownerGaii = ? AND key = ?').run(ownerGaii, row.key);
          continue;
        }
      }
      const meta = rowToMeta(row);
      if (opts?.tags?.length && !opts.tags.every(t => meta.tags.includes(t))) continue;
      if (opts?.maxFlags !== undefined && meta.flagCount > opts.maxFlags) continue;
      out.push(meta);
    }
    return out;
  },

  async listMemoryForOwners(this: SqliteStorage, ownerGaiis: string[], opts?: { prefix?: string; visibility?: string; tags?: string[]; maxFlags?: number; archived?: ArchiveFilter }): Promise<MemoryRecord[]> {
    if (ownerGaiis.length === 0) return [];
    const ph = ownerGaiis.map(() => '?').join(',');
    let sql = `SELECT * FROM memory WHERE ownerGaii IN (${ph})`;
    const params: unknown[] = [...ownerGaiis];
    if (opts?.prefix) { sql += ' AND key LIKE ?'; params.push(opts.prefix + '%'); }
    if (opts?.visibility) { sql += ' AND visibility = ?'; params.push(opts.visibility); }
    sql += archivedSql(opts?.archived);
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    const results: MemoryRecord[] = [];
    for (const row of rows) {
      const record = this.deserializeMemory(row);
      if (this.isMemoryExpired(record)) { this.db.prepare('DELETE FROM memory WHERE ownerGaii = ? AND key = ?').run(record.ownerGaii, record.key); continue; }
      if (opts?.tags?.length && !opts.tags.every(t => record.tags.includes(t))) continue;
      if (opts?.maxFlags !== undefined && (record.flagCount ?? 0) > opts.maxFlags) continue;
      results.push(record);
    }
    return results;
  },

  async listMemoryMetaForOwners(this: SqliteStorage, ownerGaiis: string[], opts?: { prefix?: string; visibility?: string; tags?: string[]; maxFlags?: number; archived?: ArchiveFilter }): Promise<MemoryMetaRow[]> {
    if (ownerGaiis.length === 0) return [];
    const ph = ownerGaiis.map(() => '?').join(',');
    let sql = `SELECT key, ownerGaii, visibility, tags, version, flagCount, byteSize, ttlHours, createdAt, updatedAt FROM memory WHERE ownerGaii IN (${ph})`;
    const params: unknown[] = [...ownerGaiis];
    if (opts?.prefix) { sql += ' AND key LIKE ?'; params.push(opts.prefix + '%'); }
    if (opts?.visibility) { sql += ' AND visibility = ?'; params.push(opts.visibility); }
    sql += archivedSql(opts?.archived);
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    const out: MemoryMetaRow[] = [];
    for (const row of rows) {
      const ttlHours = row.ttlHours as number | null;
      if (ttlHours && Date.now() > new Date(row.createdAt as string).getTime() + ttlHours * 3_600_000) {
        this.db.prepare('DELETE FROM memory WHERE ownerGaii = ? AND key = ?').run(row.ownerGaii, row.key);
        continue;
      }
      const meta = rowToMeta(row);
      if (opts?.tags?.length && !opts.tags.every(t => meta.tags.includes(t))) continue;
      if (opts?.maxFlags !== undefined && meta.flagCount > opts.maxFlags) continue;
      out.push(meta);
    }
    return out;
  },

  async listAllMemoryMeta(this: SqliteStorage, opts?: { prefix?: string; ownerPrefix?: string; excludeOwnerPrefix?: string; visibility?: string; limit?: number; offset?: number; archived?: ArchiveFilter; excludeVersionRows?: boolean; newestFirst?: boolean }): Promise<{ items: MemoryMetaRow[]; total: number }> {
    // listAllMemory's filters + windowing with the META projection: the value column never leaves
    // the database. Lazily-expired rows are pruned here the same way the other meta reads do.
    let whereClauses = '';
    const params: unknown[] = [];
    if (opts?.ownerPrefix) { whereClauses += ' AND ownerGaii LIKE ?'; params.push(opts.ownerPrefix + '%'); }
    if (opts?.excludeOwnerPrefix) { whereClauses += ' AND ownerGaii NOT LIKE ?'; params.push(opts.excludeOwnerPrefix + '%'); }
    if (opts?.prefix) { whereClauses += ' AND key LIKE ?'; params.push(opts.prefix + '%'); }
    if (opts?.visibility) { whereClauses += ' AND visibility = ?'; params.push(opts.visibility); }
    if (opts?.excludeVersionRows) { whereClauses += " AND key NOT LIKE '%.version.%'"; }
    whereClauses += archivedSql(opts?.archived);
    const whereStr = whereClauses ? ' WHERE ' + whereClauses.slice(5) : '';

    const countRow = this.db.prepare('SELECT COUNT(*) as cnt FROM memory' + whereStr).get(...params) as { cnt: number };
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;
    // Always newest-first, matching this backend's listAllMemory (see that method's note).
    const rows = this.db.prepare(
      'SELECT key, ownerGaii, visibility, tags, version, flagCount, byteSize, ttlHours, createdAt, updatedAt FROM memory'
      + whereStr + ' ORDER BY updatedAt DESC LIMIT ? OFFSET ?'
    ).all(...params, limit, offset) as Record<string, unknown>[];

    const items: MemoryMetaRow[] = [];
    for (const row of rows) {
      const ttlHours = row.ttlHours as number | null;
      if (ttlHours && Date.now() > new Date(row.createdAt as string).getTime() + ttlHours * 3_600_000) {
        this.db.prepare('DELETE FROM memory WHERE ownerGaii = ? AND key = ?').run(row.ownerGaii, row.key);
        continue;
      }
      items.push(rowToMeta(row));
    }
    return { items, total: countRow.cnt };
  },
};
