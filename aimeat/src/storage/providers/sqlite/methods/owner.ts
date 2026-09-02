/**
 * @file src/storage/providers/sqlite/methods/owner.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Owner and Memory storage methods. Extracted from sqlite/index.ts to satisfy max-file-lines; bodies verbatim, bound to SqliteStorage via prototype merge.
 * @version-history
 *   v1.6.0 — 2026-09-02 — The Agents group moved out to methods/agents.ts by pure extraction when
 *     this file reached the 800-line limit; nothing else changed.
 *   v1.1.0 — 2026-08-23 — Owner lifecycle columns (disabledAt/disabledBy/managedBy, BR-04) carried
 *     through deserializeOwner and updateOwner. This file is the copy the prototype actually uses;
 *     repos/owner.ts got the same change.
 *   v1.5.0 — 2026-08-13 — …and `registeredBy`. It is carried through updateAgent rather than
 *     omitted from the SET list: the write-once rule lives where the value is set (createAgent
 *     alone), so both providers behave the same way.
 *   v1.4.0 — 2026-08-13 — createAgent/updateAgent/deserializeAgent carry `consoleUrl`, matching the
 *     Postgres provider (migration 0034).
 *   v1.3.0 — 2026-08-11 — The memory writes persist `groupId` (shared rule in storage/memory-sharing.ts).
 *     This backend had never written the column on any path, so every `visibility:'group'` record on a
 *     SQLite node was unreadable by every member of the group it named, permanently and silently — the
 *     write answering 201 with the group's own name in the response.
 *   v1.0.0 — 2026-07-13 — Extracted from providers/sqlite/index.ts (max-file-lines)
 *   v1.1.0 — 2026-07-14 — Perf: add listMemoryMeta (metadata + byteSize projection, no value column)
 *     backing ?include=meta.
 *   v1.2.0 — 2026-07-25 — listAllMemory gains excludeOwnerPrefix (filters in SQL, so a windowed read
 *     is not emptied by rows it was going to drop); newestFirst is accepted for Postgres parity and
 *     is already this backend's ordering.
 */
import type {
  OwnerRecord, MemoryRecord, ArchiveFilter
} from '../../../interface.js';
import type { MemoryTextHit, MemoryTextSearchOpts, MemoryVersionRecord } from '../../../repositories/memory.repository.js';
import { resolveGroupId } from '../../../memory-sharing.js';
import { pseudonymiseWriter } from '../repos/memory-tally.js';
import type { SqliteStorage } from '../index.js';
import { searchTextMemory, countMemory as countMemoryRepo, sumMemoryBytes as sumMemoryBytesRepo, sumMemoryBytesForOwners as sumMemoryBytesForOwnersRepo, archivedSql, archiveMemoryByKey as archiveMemoryByKeyRepo, unarchiveMemoryByRoot as unarchiveMemoryByRootRepo, unarchiveMemoryByKey as unarchiveMemoryByKeyRepo, countArchivedByKeyPrefix as countArchivedByKeyPrefixRepo } from '../repos/memory.js';

export const ownerMethods = {
  // ══════════════════════════════════════════════════════════
  // ── Owners ──
  // ══════════════════════════════════════════════════════════

  async createOwner(this: SqliteStorage, owner: OwnerRecord): Promise<OwnerRecord> {
    try {
      this.db.prepare(
        `INSERT INTO owners (name, displayName, publicKey, roles, createdAt)
         VALUES (?, ?, ?, ?, ?)`
      ).run(
        owner.name,
        owner.displayName ?? null,
        owner.publicKey,
        JSON.stringify(owner.roles),
        owner.createdAt,
      );
      return owner;
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) throw new Error('NAME_TAKEN', { cause: err });
      throw err;
    }
  },

  async getOwner(this: SqliteStorage, name: string): Promise<OwnerRecord | null> {
    const row = this.db.prepare('SELECT * FROM owners WHERE name = ?').get(name) as Record<string, unknown> | undefined;
    return row ? this.deserializeOwner(row) : null;
  },

  async listOwners(this: SqliteStorage): Promise<OwnerRecord[]> {
    const rows = this.db.prepare('SELECT * FROM owners').all() as Record<string, unknown>[];
    return rows.map(r => this.deserializeOwner(r));
  },

  async updateOwner(this: SqliteStorage, name: string, updates: Partial<OwnerRecord>): Promise<OwnerRecord | null> {
    const existing = await this.getOwner(name);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE owners SET displayName = ?, publicKey = ?, roles = ?, createdAt = ?,
         disabledAt = ?, disabledBy = ?, managedBy = ? WHERE name = ?`
    ).run(
      updated.displayName ?? null,
      updated.publicKey,
      JSON.stringify(updated.roles),
      updated.createdAt,
      updated.disabledAt ?? null,
      updated.disabledBy ?? null,
      updated.managedBy ?? null,
      name,
    );
    return updated;
  },

  async deleteOwner(this: SqliteStorage, name: string): Promise<boolean> {
    const txn = this.db.transaction(() => {
      // 1. Get all agents belonging to this owner
      const agentRows = this.db.prepare('SELECT gaii FROM agents WHERE owner = ?').all(name) as { gaii: string }[];
      const agentGaiis = agentRows.map(r => r.gaii);

      // 2. Cascade delete all agent-related data for each agent
      for (const gaii of agentGaiis) {
        this.cascadeDeleteAgentData(gaii);
      }

      // 3. Delete all agents for this owner
      this.db.prepare('DELETE FROM agents WHERE owner = ?').run(name);

      // 3b. Data owned by the GHII itself, not by an agent. cascadeDeleteAgentData above runs per
      // AGENT gaii, so everything written under the person's own identity — which is most of what a
      // person has, because owner sessions and app grants both resolve to the GHII — survived the
      // delete. Found by test/unit/storage-conformance.test.ts on the day it was written: Postgres
      // clears these and SQLite did not, the mirror image of the audit's H-30 in the other provider.
      const ghiiRows = this.db.prepare('SELECT ghii FROM ghiis WHERE ownerName = ?').all(name) as { ghii: string }[];
      for (const row of ghiiRows) {
        this.cascadeDeleteAgentData(row.ghii);
      }

      // What this person WROTE into somebody else's namespace is that other owner's record of who
      // touched their data, so it is pseudonymised rather than deleted — removing it would silently
      // turn their "four hands" into three. The node id comes from a GHII, so this runs while one is
      // still readable.
      const tallyNodeId = ghiiRows[0]?.ghii.split('@')[1] ?? '';
      if (tallyNodeId) pseudonymiseWriter(this.db, name, tallyNodeId);

      // 4. Delete GHII records for this owner
      this.db.prepare('DELETE FROM ghiis WHERE ownerName = ?').run(name);

      // 5. Delete personal nodes and their mailbox items & push subscriptions
      const nodeRows = this.db.prepare('SELECT nodeId FROM personal_nodes WHERE ownerName = ?').all(name) as { nodeId: string }[];
      for (const node of nodeRows) {
        this.db.prepare('DELETE FROM mailbox_items WHERE personalNodeId = ?').run(node.nodeId);
        this.db.prepare('DELETE FROM personal_push_subscriptions WHERE personalNodeId = ?').run(node.nodeId);
        this.db.prepare('DELETE FROM notification_preferences WHERE personalNodeId = ?').run(node.nodeId);
      }
      this.db.prepare('DELETE FROM personal_nodes WHERE ownerName = ?').run(name);

      // 6. Delete push subscriptions for this owner
      this.db.prepare('DELETE FROM push_subscriptions WHERE ownerName = ?').run(name);
      this.db.prepare('DELETE FROM personal_push_subscriptions WHERE ownerName = ?').run(name);

      // 7. Delete listings for this owner
      this.db.prepare('DELETE FROM listings WHERE ownerName = ?').run(name);

      // 8. Delete purchases for this owner (as buyer or seller)
      this.db.prepare('DELETE FROM purchases WHERE buyerOwner = ? OR sellerOwner = ?').run(name, name);

      // 9. Delete chat instances for this owner
      this.db.prepare('DELETE FROM chat_instances WHERE ownerName = ?').run(name);

      // 10. Delete email verifications for this owner
      this.db.prepare('DELETE FROM email_verifications WHERE ownerName = ?').run(name);

      // 11. Delete the owner record itself
      const result = this.db.prepare('DELETE FROM owners WHERE name = ?').run(name);
      return result.changes > 0;
    });
    return txn();
  },


  deserializeOwner(this: SqliteStorage, row: Record<string, unknown>): OwnerRecord {
    return {
      name: row.name as string,
      displayName: (row.displayName as string) ?? undefined,
      publicKey: row.publicKey as string,
      roles: JSON.parse(row.roles as string) as string[],
      createdAt: row.createdAt as string,
      disabledAt: (row.disabledAt as string) ?? null,
      disabledBy: (row.disabledBy as string) ?? null,
      managedBy: (row.managedBy as string) ?? null,
    };
  },

  // ══════════════════════════════════════════════════════════
  // ── Memory ──
  // ══════════════════════════════════════════════════════════

  async setMemory(this: SqliteStorage, record: MemoryRecord): Promise<MemoryRecord> {
    const existing = await this.getMemory(record.ownerGaii, record.key);
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
         aiProvenanceId = ? WHERE ownerGaii = ? AND key = ?`
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
    // ON CONFLICT DO NOTHING makes the create a compare-and-swap against "the key does not exist".
    // changes === 0 means another writer got there first, and the caller re-reads and merges rather
    // than overwriting a subtree it never saw.
    const valueStr = JSON.stringify(record.value);
    const result = this.db.prepare(
      `INSERT INTO memory (ownerGaii, key, value, visibility, groupId, workspaceRef, tags, ttlHours, version, createdAt, updatedAt, flagCount, allowedOrigins, trackable, byteSize, aiProvenanceId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ownerGaii, key) DO NOTHING`
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
    const valueStr = JSON.stringify(record.value);
    // Read the row this replaces so an unnamed group can be inherited (resolveGroupId rule 3). Safe
    // against a racing writer without reading inside the UPDATE: a concurrent change bumps the
    // version, and the WHERE below then matches nothing and this write is refused.
    const existing = await this.getMemory(record.ownerGaii, record.key);
    const groupId = resolveGroupId(record, existing);
    record.groupId = groupId ?? undefined;
    const result = this.db.prepare(
      `UPDATE memory SET value = ?, visibility = ?, groupId = ?, workspaceRef = ?, tags = ?, ttlHours = ?, version = ?,
       updatedAt = ?, flagCount = ?, allowedOrigins = ?, byteSize = ?, aiProvenanceId = ?
       WHERE ownerGaii = ? AND key = ? AND version = ?`
    ).run(
      valueStr, record.visibility, groupId, record.workspaceRef ?? null,
      JSON.stringify(record.tags), record.ttlHours,
      record.version, record.updatedAt,
      record.flagCount ?? 0,
      record.allowedOrigins ? JSON.stringify(record.allowedOrigins) : null,
      Buffer.byteLength(valueStr, 'utf8'),
      record.aiProvenanceId ?? null,
      record.ownerGaii, record.key, expectedVersion,
    );
    if (result.changes === 0) return null; // version conflict
    return record;
  },

  isMemoryExpired(this: SqliteStorage, record: MemoryRecord): boolean {
    if (!record.ttlHours) return false;
    const createdMs = new Date(record.createdAt).getTime();
    return Date.now() > createdMs + record.ttlHours * 3_600_000;
  },

  async getMemory(this: SqliteStorage, ownerGaii: string, key: string): Promise<MemoryRecord | null> {
    const row = this.db.prepare('SELECT * FROM memory WHERE ownerGaii = ? AND key = ?').get(ownerGaii, key) as Record<string, unknown> | undefined;
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

    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;
    // Always newest-first here; `newestFirst` is accepted for parity with the Postgres backend,
    // which defaults to key order and needs the flag to page by recency (see memory.repository.ts).
    const rows = this.db.prepare('SELECT * FROM memory' + whereStr + ' ORDER BY updatedAt DESC LIMIT ? OFFSET ?').all(...params, limit, offset) as Record<string, unknown>[];

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

  async deleteMemory(this: SqliteStorage, ownerGaii: string, key: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM memory WHERE ownerGaii = ? AND key = ?').run(ownerGaii, key);
    return result.changes > 0;
  },

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

  // ══════════════════════════════════════════════════════════
};
