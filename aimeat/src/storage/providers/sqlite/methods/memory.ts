/**
 * @file src/storage/providers/sqlite/methods/memory.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/memory.ts (memoryMethods), so a fix
 *   in one provider finds its twin by file name. Bodies moved verbatim from the files named in the version
 *   history; bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure memoryMethods
 * @usage Object.assign(SqliteStorage.prototype, memoryMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — 27 methods (setMemory, listMemoryHistory, createMemoryIfAbsent, …) moved here from
 *     owner.ts; getMemoryByKeys, getMemoryByKeysAnyOwner, bulkSetMemory, deleteMemorySubtree,
 *     deleteMemoryByPrefix, bulkDeleteMemory, listMemoryKeysByPrefix moved here from owner-memory-bulk.ts;
 *     listMemoryMeta, listMemoryForOwners, listMemoryMetaForOwners, listAllMemoryMeta moved here from
 *     owner-memory-scope.ts so the file mirrors postgres-kysely/methods/memory.ts (secaudit 2026-10, M8).
 */
import type { MemoryRecord, ArchiveFilter } from '../../../interface.js';
import type {
  MemoryTextHit, MemoryTextSearchOpts, MemoryVersionRecord, MemoryMetaRow,
} from '../../../repositories/memory.repository.js';
import { resolveGroupId } from '../../../memory-sharing.js';
import type { SqliteStorage } from '../index.js';
import {
  searchTextMemory, countMemory as countMemoryRepo, countMemoryWithOrigins as countMemoryWithOriginsRepo,
  sumMemoryBytes as sumMemoryBytesRepo, sumMemoryBytesForOwners as sumMemoryBytesForOwnersRepo, archivedSql,
  archiveMemoryByKey as archiveMemoryByKeyRepo, unarchiveMemoryByRoot as unarchiveMemoryByRootRepo,
  unarchiveMemoryByKey as unarchiveMemoryByKeyRepo, countArchivedByKeyPrefix as countArchivedByKeyPrefixRepo,
  NOT_DELETED_SQL,
} from '../repos/memory.js';

/** The projected columns, in one place so the three reads below cannot drift apart on what META means. */
const META_COLS = 'key, ownerGaii, visibility, groupId, workspaceRef, allowedOrigins, aiProvenanceId, '
  + 'archived, tags, version, flagCount, byteSize, ttlHours, createdAt, updatedAt';

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
    groupId: (row.groupId as string | null) ?? null,
    workspaceRef: (row.workspaceRef as string | null) ?? null,
    allowedOrigins: row.allowedOrigins ? JSON.parse(row.allowedOrigins as string) as string[] : null,
    aiProvenanceId: (row.aiProvenanceId as string | null) ?? null,
    archived: !!row.archived,
  };
}

export const memoryMethods = {

  // ══════════════════════════════════════════════════════════
  // ── Memory ──
  // ══════════════════════════════════════════════════════════

  async setMemory(this: SqliteStorage, record: MemoryRecord): Promise<MemoryRecord> {
    // WRITING A KEY THAT IS IN THE BIN BRINGS IT BACK, with the new value. The probe must therefore
    // see deleted rows, which `getMemory` deliberately does not: read through that and a key in the
    // bin looks absent, the write takes the INSERT branch, and it collides with the row that is
    // still there under the same primary key. That surfaced as a 500 on the workspace draft path.
    //
    // The old value is not recoverable after this, and that is the right rule: the bin protects
    // against a DELETE, not against an overwrite, exactly as it never protected against one before.
    const rawRow = this.db.prepare('SELECT * FROM memory WHERE ownerGaii = ? AND key = ?')
      .get(record.ownerGaii, record.key) as Record<string, unknown> | undefined;
    const existing = rawRow ? this.deserializeMemory(rawRow) : null;
    // Trackable is a property of the key: inherit the existing setting if the writer didn't specify, so
    // a generic rewrite never silently turns tracking off. Archiving keeps the PREVIOUS version.
    const trackable = record.trackable ?? existing?.trackable ?? false;
    record.trackable = trackable || undefined;
    // Which group this lands in — shared with the Postgres provider so the rule cannot drift.
    const groupId = resolveGroupId(record, existing);
    record.groupId = groupId ?? undefined;
    const valueStr = JSON.stringify(record.value);
    const byteSize = Buffer.byteLength(valueStr, 'utf8');   // cached for the O(1) total-size quota sum + ?include=meta
    if (existing) {
      if (existing.trackable) {
        // Archive the about-to-be-overwritten version into the separate history table (append-only).
        this.db.prepare(
          `INSERT OR IGNORE INTO memory_history (ownerGaii, key, version, value, actor, event, recordedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          existing.ownerGaii, existing.key, existing.version,
          JSON.stringify(existing.value),
          this.memoryAnnotation(existing.value, '_actor'), this.memoryAnnotation(existing.value, '_event'),
          existing.updatedAt,
        );
      }
      record.version = existing.version + 1;
      this.db.prepare(
        `UPDATE memory SET value = ?, visibility = ?, groupId = ?, workspaceRef = ?, tags = ?, ttlHours = ?, version = ?,
         createdAt = ?, updatedAt = ?, flagCount = ?, allowedOrigins = ?, trackable = ?, byteSize = ?,
         aiProvenanceId = ?, deletedAt = NULL, deletedBy = NULL WHERE ownerGaii = ? AND key = ?`
      ).run(
        valueStr, record.visibility, groupId, record.workspaceRef ?? null,
        JSON.stringify(record.tags), record.ttlHours,
        record.version, record.createdAt, record.updatedAt,
        record.flagCount ?? 0,
        record.allowedOrigins ? JSON.stringify(record.allowedOrigins) : null,
        trackable ? 1 : 0, byteSize,
        // Write-through, deliberately NOT inherited from `existing`: a new value is new content, and
        // keeping the old provenance id would assert something about bytes that no longer exist.
        record.aiProvenanceId ?? null,
        record.ownerGaii, record.key,
      );
    } else {
      this.db.prepare(
        `INSERT INTO memory (ownerGaii, key, value, visibility, groupId, workspaceRef, tags, ttlHours, version, createdAt, updatedAt, flagCount, allowedOrigins, trackable, byteSize, aiProvenanceId)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        record.ownerGaii, record.key,
        valueStr, record.visibility, groupId, record.workspaceRef ?? null,
        JSON.stringify(record.tags), record.ttlHours,
        record.version, record.createdAt, record.updatedAt,
        record.flagCount ?? 0,
        record.allowedOrigins ? JSON.stringify(record.allowedOrigins) : null,
        trackable ? 1 : 0, byteSize,
        record.aiProvenanceId ?? null,
      );
    }
    return record;
  },

  async listMemoryHistory(this: SqliteStorage, ownerGaii: string, key: string, opts?: { limit?: number }): Promise<MemoryVersionRecord[]> {
    const limit = opts?.limit ?? 200;
    const rows = this.db.prepare(
      'SELECT * FROM memory_history WHERE ownerGaii = ? AND key = ? ORDER BY version DESC LIMIT ?'
    ).all(ownerGaii, key, limit) as Record<string, unknown>[];
    return rows.map(r => ({
      ownerGaii: r.ownerGaii as string,
      key: r.key as string,
      version: r.version as number,
      value: JSON.parse(r.value as string),
      actor: (r.actor as string | null) ?? null,
      event: (r.event as string | null) ?? null,
      recordedAt: r.recordedAt as string,
    }));
  },

  async createMemoryIfAbsent(this: SqliteStorage, record: MemoryRecord): Promise<MemoryRecord | null> {
    // The conflict clause makes the create a compare-and-swap against "the key does not exist".
    // changes === 0 means another writer got there first, and the caller re-reads and merges rather
    // than overwriting a subtree it never saw.
    //
    // A ROW IN THE BIN IS ABSENT: it has left every read, so the caller saw nothing there, and a
    // DO NOTHING against it answered null on every retry (the workspace append lost six times in a
    // row on a document whose draft a publish had just binned). The conflict takes such a row over
    // with the new value and a clean tombstone, as setMemory does; a live row still wins.
    const valueStr = JSON.stringify(record.value);
    const result = this.db.prepare(
      `INSERT INTO memory (ownerGaii, key, value, visibility, groupId, workspaceRef, tags, ttlHours, version, createdAt, updatedAt, flagCount, allowedOrigins, trackable, byteSize, aiProvenanceId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ownerGaii, key) DO UPDATE SET
         value = excluded.value, visibility = excluded.visibility, groupId = excluded.groupId,
         workspaceRef = excluded.workspaceRef, tags = excluded.tags, ttlHours = excluded.ttlHours,
         version = excluded.version, createdAt = excluded.createdAt, updatedAt = excluded.updatedAt,
         flagCount = excluded.flagCount, allowedOrigins = excluded.allowedOrigins, trackable = excluded.trackable,
         byteSize = excluded.byteSize, aiProvenanceId = excluded.aiProvenanceId,
         deletedAt = NULL, deletedBy = NULL
       WHERE memory.deletedAt IS NOT NULL`
    ).run(
      record.ownerGaii, record.key,
      valueStr, record.visibility, resolveGroupId(record, null), record.workspaceRef ?? null,
      JSON.stringify(record.tags), record.ttlHours,
      record.version, record.createdAt, record.updatedAt,
      record.flagCount ?? 0,
      record.allowedOrigins ? JSON.stringify(record.allowedOrigins) : null,
      record.trackable ? 1 : 0, Buffer.byteLength(valueStr, 'utf8'),
      record.aiProvenanceId ?? null,
    );
    return result.changes === 0 ? null : record;
  },

  async setMemoryIfVersion(this: SqliteStorage, record: MemoryRecord, expectedVersion: number): Promise<MemoryRecord | null> {
    // Serialize the check with the write and reuse setMemory's history and field semantics.
    // The transaction guard also keeps an unrelated writer out while this call awaits.
    return this.transaction(async () => {
      const existing = await this.getMemory(record.ownerGaii, record.key);
      if (!existing || existing.version !== expectedVersion) return null;
      return this.setMemory(record);
    });
  },

  isMemoryExpired(this: SqliteStorage, record: MemoryRecord): boolean {
    if (!record.ttlHours) return false;
    const createdMs = new Date(record.createdAt).getTime();
    return Date.now() > createdMs + record.ttlHours * 3_600_000;
  },

  async getMemory(this: SqliteStorage, ownerGaii: string, key: string): Promise<MemoryRecord | null> {
    // A DELETED RECORD READS AS GONE, which is the difference between the bin and the archive: an
    // archived row is still resolvable by key on purpose, a deleted one must answer 404 or the
    // delete did nothing a person can see. The row is still there — that is what makes it undoable
    // — and the restore path reads it with its own query naming `deletedAt`.
    const row = this.db.prepare('SELECT * FROM memory WHERE ownerGaii = ? AND key = ? AND deletedAt IS NULL').get(ownerGaii, key) as Record<string, unknown> | undefined;
    if (!row) return null;
    const record = this.deserializeMemory(row);
    if (this.isMemoryExpired(record)) {
      this.db.prepare('DELETE FROM memory WHERE ownerGaii = ? AND key = ?').run(ownerGaii, key);
      return null;
    }
    return record;
  },

  async listMemory(this: SqliteStorage, ownerGaii: string, opts?: { prefix?: string; visibility?: string; tags?: string[]; maxFlags?: number; archived?: ArchiveFilter }): Promise<MemoryRecord[]> {
    let sql = 'SELECT * FROM memory WHERE ownerGaii = ?';
    const params: unknown[] = [ownerGaii];

    if (opts?.prefix) {
      sql += ' AND key LIKE ?';
      params.push(opts.prefix + '%');
    }
    if (opts?.visibility) {
      sql += ' AND visibility = ?';
      params.push(opts.visibility);
    }
    sql += archivedSql(opts?.archived);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    const results: MemoryRecord[] = [];
    for (const row of rows) {
      const record = this.deserializeMemory(row);
      if (this.isMemoryExpired(record)) {
        this.db.prepare('DELETE FROM memory WHERE ownerGaii = ? AND key = ?').run(record.ownerGaii, record.key);
        continue;
      }
      if (opts?.tags?.length) {
        const hasTags = opts.tags.every(t => record.tags.includes(t));
        if (!hasTags) continue;
      }
      if (opts?.maxFlags !== undefined && (record.flagCount ?? 0) > opts.maxFlags) continue;
      results.push(record);
    }
    return results;
  },

  async countMemory(this: SqliteStorage, ownerGaiis: string[], opts?: { prefix?: string; visibility?: string }): Promise<number> {
    return countMemoryRepo(this.db, ownerGaiis, opts);
  },

  async countMemoryWithOrigins(this: SqliteStorage): Promise<number> {
    return countMemoryWithOriginsRepo(this.db);
  },

  async sumMemoryBytes(this: SqliteStorage, ownerGaii: string): Promise<number> {
    return sumMemoryBytesRepo(this.db, ownerGaii);
  },

  async sumMemoryBytesForOwners(this: SqliteStorage, ownerGaiis: string[]): Promise<number> {
    return sumMemoryBytesForOwnersRepo(this.db, ownerGaiis);
  },

  async listAllMemory(this: SqliteStorage, opts?: { prefix?: string; ownerPrefix?: string; excludeOwnerPrefix?: string; visibility?: string; limit?: number; offset?: number; archived?: ArchiveFilter; excludeVersionRows?: boolean; newestFirst?: boolean }): Promise<{ items: MemoryRecord[]; total: number }> {
    let whereClauses = '';
    const params: unknown[] = [];

    if (opts?.ownerPrefix) {
      whereClauses += ' AND ownerGaii LIKE ?';
      params.push(opts.ownerPrefix + '%');
    }
    // Excluded IN SQL, not after the slice: a windowed read whose window is entirely unwanted
    // rows would otherwise come back empty (how the landing ticker emptied itself).
    if (opts?.excludeOwnerPrefix) {
      whereClauses += ' AND ownerGaii NOT LIKE ?';
      params.push(opts.excludeOwnerPrefix + '%');
    }
    if (opts?.prefix) {
      whereClauses += ' AND key LIKE ?';
      params.push(opts.prefix + '%');
    }
    if (opts?.visibility) {
      whereClauses += ' AND visibility = ?';
      params.push(opts.visibility);
    }
    // Workspace `.version.N` history rows are dropped IN SQL so the hot read paths never load
    // (or JSON.parse) the historic full-copy values they always discard. See memory.repository.ts.
    if (opts?.excludeVersionRows) {
      whereClauses += " AND key NOT LIKE '%.version.%'";
    }
    whereClauses += archivedSql(opts?.archived);

    const whereStr = whereClauses ? ' WHERE ' + whereClauses.slice(5) : '';

    const countRow = this.db.prepare('SELECT COUNT(*) as cnt FROM memory' + whereStr).get(...params) as { cnt: number };
    const total = countRow.cnt;

    // ONE ORDER AND ONE DEFAULT, ON BOTH BACKENDS. This used to sort by updatedAt whatever the
    // caller asked, and default `limit` to 50, while Postgres sorted by key and returned everything
    // — so the same call gave a different page depending on which backend answered it, and the
    // contract's own comment told callers to work around that rather than defining it. Review item
    // 5.5, 2026-09-06. Postgres's semantics are the definition because they are what production
    // already does: this moves the LOCAL backend onto production's behaviour and leaves production's
    // untouched, which is the only direction that cannot break a live node.
    const offset = opts?.offset ?? 0;
    const orderSql = opts?.newestFirst ? ' ORDER BY updatedAt DESC' : ' ORDER BY key';
    const rows = (opts?.limit
      ? this.db.prepare('SELECT * FROM memory' + whereStr + orderSql + ' LIMIT ? OFFSET ?').all(...params, opts.limit, offset)
      : this.db.prepare('SELECT * FROM memory' + whereStr + orderSql).all(...params)
    ) as Record<string, unknown>[];

    const items: MemoryRecord[] = [];
    for (const row of rows) {
      const record = this.deserializeMemory(row);
      if (this.isMemoryExpired(record)) {
        this.db.prepare('DELETE FROM memory WHERE ownerGaii = ? AND key = ?').run(record.ownerGaii, record.key);
        continue;
      }
      items.push(record);
    }
    return { items, total };
  },

  /**
   * INTO THE BIN, NOT OUT OF THE DATABASE. Every caller of `deleteMemory` gets the undo for free,
   * which is the point: a delete is a delete wherever it is pressed, and there is exactly one place
   * that decides how long it can be taken back.
   *
   * A key already in the bin answers false rather than being re-stamped: deleting twice must not
   * restart the clock, or a loop that retries could keep a record out of reach forever.
   */
  async deleteMemory(this: SqliteStorage, ownerGaii: string, key: string, deletedBy?: string): Promise<boolean> {
    const result = this.db.prepare(
      'UPDATE memory SET deletedAt = ?, deletedBy = ? WHERE ownerGaii = ? AND key = ? AND deletedAt IS NULL'
    ).run(new Date().toISOString(), deletedBy ?? null, ownerGaii, key);
    return result.changes > 0;
  },

  /** Out of the bin, whole. Returns false when nothing of that key is in it — including when the
   *  sweeper has already been past, which is the honest answer to "can I have it back". */
  async restoreMemory(this: SqliteStorage, ownerGaii: string, key: string): Promise<boolean> {
    const result = this.db.prepare(
      'UPDATE memory SET deletedAt = NULL, deletedBy = NULL WHERE ownerGaii = ? AND key = ? AND deletedAt IS NOT NULL'
    ).run(ownerGaii, key);
    return result.changes > 0;
  },

  /** What is in this owner's bin, newest first. The one read that is allowed to see it. */
  async listDeletedMemory(this: SqliteStorage, ownerGaii: string): Promise<MemoryRecord[]> {
    const rows = this.db.prepare(
      'SELECT * FROM memory WHERE ownerGaii = ? AND deletedAt IS NOT NULL ORDER BY deletedAt DESC'
    ).all(ownerGaii) as Array<Record<string, unknown>>;
    return rows.map(r => this.deserializeMemory(r));
  },

  /** The whole bin, across every owner — the operator's read. Names `deletedAt` itself rather than
   *  going through archivedSql, which hides the bin on every branch and must keep doing so. */
  async listAllDeletedMemory(this: SqliteStorage, opts?: { prefix?: string; ownerPrefix?: string; limit?: number; offset?: number }): Promise<{ items: MemoryRecord[]; total: number }> {
    let where = ' WHERE deletedAt IS NOT NULL';
    const params: unknown[] = [];
    if (opts?.ownerPrefix) { where += ' AND ownerGaii LIKE ?'; params.push(opts.ownerPrefix + '%'); }
    if (opts?.prefix) { where += ' AND key LIKE ?'; params.push(opts.prefix + '%'); }

    const { cnt } = this.db.prepare('SELECT COUNT(*) AS cnt FROM memory' + where).get(...params) as { cnt: number };
    const offset = opts?.offset ?? 0;
    const rows = (opts?.limit
      ? this.db.prepare('SELECT * FROM memory' + where + ' ORDER BY deletedAt DESC LIMIT ? OFFSET ?').all(...params, opts.limit, offset)
      : this.db.prepare('SELECT * FROM memory' + where + ' ORDER BY deletedAt DESC').all(...params)
    ) as Array<Record<string, unknown>>;
    return { items: rows.map(r => this.deserializeMemory(r)), total: cnt };
  },

  /** The sweeper's hand. Everything deleted before `cutoff` goes for good — this is the call that
   *  makes "delete" mean delete, and the only one in the memory path that destroys anything. */
  async purgeDeletedMemory(this: SqliteStorage, cutoffIso: string): Promise<number> {
    const result = this.db.prepare(
      'DELETE FROM memory WHERE deletedAt IS NOT NULL AND deletedAt < ?'
    ).run(cutoffIso);
    return result.changes;
  },

  /** STILL A HARD DELETE, deliberately. This is owner erasure — the cascade behind account deletion
   *  — and a person asking to be forgotten is not asking for a bin with their data in it. */
  async deleteAllMemory(this: SqliteStorage, ownerGaii: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM memory WHERE ownerGaii = ?').run(ownerGaii);
    return result.changes;
  },

  async incrementMemoryFlagCount(this: SqliteStorage, ownerGaii: string, key: string): Promise<void> {
    this.db.prepare(
      'UPDATE memory SET flagCount = COALESCE(flagCount, 0) + 1 WHERE ownerGaii = ? AND key = ?'
    ).run(ownerGaii, key);
  },

  async searchMemory(this: SqliteStorage, ownerGaii: string, query: string, opts?: { visibility?: string; maxFlags?: number; prefix?: string; archived?: ArchiveFilter; limit?: number }): Promise<MemoryRecord[]> {
    const q = query.toLowerCase();
    let sql = 'SELECT * FROM memory WHERE ownerGaii = ?';
    const params: unknown[] = [ownerGaii];

    if (opts?.visibility) {
      sql += ' AND visibility = ?';
      params.push(opts.visibility);
    }

    if (opts?.prefix) {
      sql += ' AND key LIKE ?';
      params.push(opts.prefix + '%');
    }
    sql += archivedSql(opts?.archived);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    const results: MemoryRecord[] = [];
    for (const row of rows) {
      const record = this.deserializeMemory(row);
      if (this.isMemoryExpired(record)) {
        this.db.prepare('DELETE FROM memory WHERE ownerGaii = ? AND key = ?').run(record.ownerGaii, record.key);
        continue;
      }
      if (opts?.maxFlags !== undefined && (record.flagCount ?? 0) > opts.maxFlags) continue;
      const valStr = typeof record.value === 'string' ? record.value : JSON.stringify(record.value);
      if (
        record.key.toLowerCase().includes(q) ||
        valStr.toLowerCase().includes(q) ||
        record.tags.some(t => t.toLowerCase().includes(q))
      ) {
        results.push(record);
        // Optional result cap (additive; callers that omit it keep the full result set). The substring
        // match is applied in JS, so the cap is enforced here — post-filter — not as a SQL LIMIT.
        if (opts?.limit !== undefined && results.length >= opts.limit) break;
      }
    }
    return results;
  },

  async searchText(this: SqliteStorage, query: string, opts?: MemoryTextSearchOpts): Promise<MemoryTextHit[]> {
    return searchTextMemory(this.db, query, opts);
  },

  async archiveMemoryByKey(this: SqliteStorage, keyOrPrefix: string, opts: { archivedRoot: string; archivedBy: string; archivedAt: string; match?: 'exact' | 'prefix' | 'subtree' }): Promise<number> {
    return archiveMemoryByKeyRepo(this.db, keyOrPrefix, opts);
  },

  async unarchiveMemoryByRoot(this: SqliteStorage, archivedRoot: string): Promise<number> {
    return unarchiveMemoryByRootRepo(this.db, archivedRoot);
  },

  async unarchiveMemoryByKey(this: SqliteStorage, keyOrPrefix: string, opts?: { match?: 'exact' | 'prefix' | 'subtree' }): Promise<number> {
    return unarchiveMemoryByKeyRepo(this.db, keyOrPrefix, opts);
  },

  async countArchivedByKeyPrefix(this: SqliteStorage, keyPrefix: string): Promise<{ active: number; archived: number }> {
    return countArchivedByKeyPrefixRepo(this.db, keyPrefix);
  },

  deserializeMemory(this: SqliteStorage, row: Record<string, unknown>): MemoryRecord {
    const record: MemoryRecord = {
      key: row.key as string,
      ownerGaii: row.ownerGaii as string,
      value: JSON.parse(row.value as string),
      visibility: row.visibility as MemoryRecord['visibility'],
      tags: JSON.parse(row.tags as string) as string[],
      ttlHours: row.ttlHours as number | null,
      version: row.version as number,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.flagCount !== null && row.flagCount !== undefined) {
      record.flagCount = row.flagCount as number;
    }
    if (row.allowedOrigins) record.allowedOrigins = JSON.parse(row.allowedOrigins as string);
    if (row.groupId) record.groupId = row.groupId as string;
    if (row.workspaceRef) record.workspaceRef = row.workspaceRef as string;
    if (row.trackable) record.trackable = true;
    if (row.archived) record.archived = true;
    if (row.archivedAt) record.archivedAt = row.archivedAt as string;
    if (row.archivedBy) record.archivedBy = row.archivedBy as string;
    if (row.archivedRoot) record.archivedRoot = row.archivedRoot as string;
    // The bin. Two deserialisers exist in this provider — this one and the private copy in
    // repos/memory.ts that only searchTextMemory uses — so a field added to one is invisible
    // through the other, which is exactly how the bin listing came back with no date on it.
    if (row.deletedAt) { record.deletedAt = row.deletedAt as string; record.deletedBy = (row.deletedBy as string) ?? null; }
    if (row.aiProvenanceId) record.aiProvenanceId = row.aiProvenanceId as string;
    return record;
  },

  /** Read an optional `_actor` / `_event` annotation off a record value (the convention the structure
   *  timeline uses) so archived history rows carry who/why. Best-effort. */
  memoryAnnotation(this: SqliteStorage, value: unknown, field: '_actor' | '_event'): string | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const v = (value as Record<string, unknown>)[field];
      if (typeof v === 'string' && v) return v;
    }
    return null;
  },
  // BULK PRIMITIVE (Phase 1) — many keys under one owner in ONE `key IN (…)` query. Live rows only
  // (TTL-expired rows are pruned lazily, mirroring getMemory/listMemory). Order not guaranteed.
  async getMemoryByKeys(this: SqliteStorage, ownerGaii: string, keys: string[]): Promise<MemoryRecord[]> {
    if (keys.length === 0) return [];
    const placeholders = keys.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT * FROM memory WHERE ownerGaii = ? AND key IN (${placeholders})${NOT_DELETED_SQL}`).all(ownerGaii, ...keys) as Record<string, unknown>[];
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

  // BULK PRIMITIVE (Phase 2) — many keys across ALL owners in ONE `key IN (…)` query (no owner filter).
  // Live rows only (TTL-expired rows pruned lazily, mirroring getMemoryByKeys). Backs the organism
  // discovery list's batched workspace-manifest read (N canReadWs manifest scans → 1). A key forked
  // across owners returns >1 row; the caller dedupes.
  async getMemoryByKeysAnyOwner(this: SqliteStorage, keys: string[]): Promise<MemoryRecord[]> {
    if (keys.length === 0) return [];
    const placeholders = keys.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT * FROM memory WHERE key IN (${placeholders})${NOT_DELETED_SQL}`).all(...keys) as Record<string, unknown>[];
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
  //
  // Inside a caller's storage.transaction() the loop runs bare: SQLite has no nested BEGIN, and the
  // Storage.transaction contract says a nested call joins the open transaction. Opening a second one
  // threw `cannot start a transaction within a transaction`, which reached the caller as a 500 —
  // every batch record publish did this, since publishDraftsBatch wraps the upsert and the delete in
  // one boundary. The caller's rollback covers a throw from here, so the try/catch drops with it.
  async bulkSetMemory(this: SqliteStorage, records: MemoryRecord[]): Promise<MemoryRecord[]> {
    if (records.length === 0) return [];
    const out: MemoryRecord[] = [];
    if (this.insideTransaction) {
      for (const r of records) out.push(await this.setMemory(r));
      return out;
    }
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
  // Same nesting rule as bulkSetMemory above: inside a caller's transaction the deletes run bare and
  // commit with it.
  async bulkDeleteMemory(this: SqliteStorage, refs: { ownerGaii: string; key: string }[]): Promise<number> {
    if (refs.length === 0) return 0;
    const stmt = this.db.prepare('DELETE FROM memory WHERE ownerGaii = ? AND key = ?');
    let removed = 0;
    if (this.insideTransaction) {
      for (const r of refs) removed += stmt.run(r.ownerGaii, r.key).changes;
      return removed;
    }
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
    return this.db.prepare('SELECT ownerGaii, key FROM memory WHERE key LIKE ? AND archived = 0 AND deletedAt IS NULL').all(keyPrefix + '%') as { ownerGaii: string; key: string }[];
  },
  async listMemoryMeta(this: SqliteStorage, ownerGaii: string, opts?: { prefix?: string; visibility?: string; tags?: string[]; maxFlags?: number; archived?: ArchiveFilter }): Promise<MemoryMetaRow[]> {
    // META projection: select metadata + byteSize, NEVER the `value` column (the whole point — a
    // keyspace of thousands of keys lists without loading/serialising any value). ttlHours + createdAt
    // are read only to prune lazily-expired rows, then dropped from the result.
    let sql = `SELECT ${META_COLS} FROM memory WHERE ownerGaii = ?`;
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
    let sql = `SELECT ${META_COLS} FROM memory WHERE ownerGaii IN (${ph})`;
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
    // The same order and the same default as listAllMemory beside it, which is now the same as the
    // Postgres backend's: key unless the caller asked for recency, and no implicit ceiling.
    const offset = opts?.offset ?? 0;
    const orderSql = opts?.newestFirst ? ' ORDER BY updatedAt DESC' : ' ORDER BY key';
    const cols = `SELECT ${META_COLS} FROM memory`;
    const rows = (opts?.limit
      ? this.db.prepare(cols + whereStr + orderSql + ' LIMIT ? OFFSET ?').all(...params, opts.limit, offset)
      : this.db.prepare(cols + whereStr + orderSql).all(...params)
    ) as Record<string, unknown>[];

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
