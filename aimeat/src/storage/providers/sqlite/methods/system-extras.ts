/**
 * @file src/storage/providers/sqlite/methods/system-extras.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/system-extras.ts
 *   (systemPromptMethods, replicationQueueMethods), so a fix in one provider finds its twin by file name.
 *   Bodies moved verbatim from the files named in the version history; bound to SqliteStorage via the
 *   prototype merge in ../index.ts.
 * @structure systemPromptMethods, replicationQueueMethods
 * @usage Object.assign(SqliteStorage.prototype, systemPromptMethods, replicationQueueMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — enqueueReplication, dequeueReplication, markReplicationSent, markReplicationFailed,
 *     pruneReplicationQueue, replicationQueueSize, deserializeReplicationEntry moved here from
 *     federation-oauth.ts; 10 methods (deserializeSystemPrompt, deserializeSystemPromptVersion,
 *     listSystemPrompts, …) moved here from packages.ts so the file mirrors
 *     postgres-kysely/methods/system-extras.ts (secaudit 2026-10, M8).
 */
import type {
  ReplicationQueueEntry, SystemPromptRecord, SystemPromptVersionRecord,
} from '../../../interface.js';
import type { SqliteStorage } from '../index.js';
import { randomUUID } from 'node:crypto';

export const systemPromptMethods = {
  // ── System Prompts ────────────────────────────────────────────────

  deserializeSystemPrompt(this: SqliteStorage, row: Record<string, unknown>): SystemPromptRecord {
    return {
      id: row.id as string,
      group: row.grp as string,
      name: row.name as string,
      description: row.description as string,
      content: row.content as string,
      locales: row.locales ? JSON.parse(row.locales as string) : undefined,
      active: row.active === 1,
      variables: JSON.parse(row.variables as string),
      usedIn: JSON.parse(row.usedIn as string),
      version: row.version as number,
      updatedAt: row.updatedAt as string,
      updatedBy: row.updatedBy as string,
    };
  },

  deserializeSystemPromptVersion(this: SqliteStorage, row: Record<string, unknown>): SystemPromptVersionRecord {
    return {
      promptId: row.promptId as string,
      version: row.version as number,
      content: row.content as string,
      locales: row.locales ? JSON.parse(row.locales as string) : undefined,
      changedBy: row.changedBy as string,
      changedAt: row.changedAt as string,
      changeNote: row.changeNote as string | undefined,
    };
  },

  async listSystemPrompts(this: SqliteStorage, opts?: { group?: string }): Promise<SystemPromptRecord[]> {
    const sql = opts?.group
      ? 'SELECT * FROM system_prompts WHERE grp = ? ORDER BY grp, name'
      : 'SELECT * FROM system_prompts ORDER BY grp, name';
    const rows = (opts?.group
      ? this.db.prepare(sql).all(opts.group)
      : this.db.prepare(sql).all()) as Record<string, unknown>[];
    return rows.map(r => this.deserializeSystemPrompt(r));
  },

  async getSystemPrompt(this: SqliteStorage, id: string): Promise<SystemPromptRecord | null> {
    const row = this.db.prepare('SELECT * FROM system_prompts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeSystemPrompt(row) : null;
  },

  async upsertSystemPrompt(this: SqliteStorage, record: SystemPromptRecord): Promise<SystemPromptRecord> {
    this.db.prepare(
      `INSERT INTO system_prompts (id, grp, name, description, content, locales, active, variables, usedIn, version, updatedAt, updatedBy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         grp = excluded.grp, name = excluded.name, description = excluded.description,
         content = excluded.content, locales = excluded.locales, active = excluded.active,
         variables = excluded.variables, usedIn = excluded.usedIn, version = excluded.version,
         updatedAt = excluded.updatedAt, updatedBy = excluded.updatedBy`
    ).run(
      record.id, record.group, record.name, record.description, record.content,
      record.locales ? JSON.stringify(record.locales) : null,
      record.active ? 1 : 0,
      JSON.stringify(record.variables), JSON.stringify(record.usedIn),
      record.version, record.updatedAt, record.updatedBy,
    );
    return record;
  },

  async getSystemPromptVersions(this: SqliteStorage, promptId: string): Promise<SystemPromptVersionRecord[]> {
    const rows = this.db.prepare(
      'SELECT * FROM system_prompt_versions WHERE promptId = ? ORDER BY version DESC'
    ).all(promptId) as Record<string, unknown>[];
    return rows.map(r => this.deserializeSystemPromptVersion(r));
  },

  async getSystemPromptVersion(this: SqliteStorage, promptId: string, version: number): Promise<SystemPromptVersionRecord | null> {
    const row = this.db.prepare(
      'SELECT * FROM system_prompt_versions WHERE promptId = ? AND version = ?'
    ).get(promptId, version) as Record<string, unknown> | undefined;
    return row ? this.deserializeSystemPromptVersion(row) : null;
  },

  async createSystemPromptVersion(this: SqliteStorage, record: SystemPromptVersionRecord): Promise<SystemPromptVersionRecord> {
    this.db.prepare(
      `INSERT INTO system_prompt_versions (promptId, version, content, locales, changedBy, changedAt, changeNote)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.promptId, record.version, record.content,
      record.locales ? JSON.stringify(record.locales) : null,
      record.changedBy, record.changedAt, record.changeNote ?? null,
    );
    return record;
  },

  async pruneSystemPromptVersions(this: SqliteStorage, promptId: string, keepCount: number): Promise<number> {
    const result = this.db.prepare(
      `DELETE FROM system_prompt_versions WHERE promptId = ? AND version NOT IN (
         SELECT version FROM system_prompt_versions WHERE promptId = ? ORDER BY version DESC LIMIT ?
       )`
    ).run(promptId, promptId, keepCount);
    return result.changes;
  },

  async deleteAllSystemPrompts(this: SqliteStorage): Promise<void> {
    this.db.prepare('DELETE FROM system_prompt_versions').run();
    this.db.prepare('DELETE FROM system_prompts').run();
  },
};

export const replicationQueueMethods = {

  // ══════════════════════════════════════════════════════════
  // ── Replication Queue (B.1) ──
  // ══════════════════════════════════════════════════════════

  async enqueueReplication(this: SqliteStorage, entry: Omit<ReplicationQueueEntry, 'id' | 'attempts' | 'lastAttemptAt' | 'status'>): Promise<string> {
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO replication_queue (id, type, targetPeers, payload, createdAt, attempts, lastAttemptAt, status)
       VALUES (?, ?, ?, ?, ?, 0, NULL, 'pending')`
    ).run(
      id,
      entry.type,
      JSON.stringify(entry.targetPeers),
      JSON.stringify(entry.payload),
      entry.createdAt,
    );
    return id;
  },

  async dequeueReplication(this: SqliteStorage, peerId: string, limit: number): Promise<ReplicationQueueEntry[]> {
    // Fetch all pending entries ordered by creation time
    const rows = this.db.prepare(
      `SELECT * FROM replication_queue WHERE status = 'pending' ORDER BY createdAt ASC`
    ).all() as Record<string, unknown>[];
    const results: ReplicationQueueEntry[] = [];
    for (const row of rows) {
      const peers = JSON.parse(row.targetPeers as string) as string[];
      if (peers.includes(peerId)) {
        results.push(this.deserializeReplicationEntry(row));
        if (results.length >= limit) break;
      }
    }
    return results;
  },

  async markReplicationSent(this: SqliteStorage, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(
      `UPDATE replication_queue SET status = 'sent' WHERE id IN (${placeholders})`
    ).run(...ids);
  },

  async markReplicationFailed(this: SqliteStorage, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      `UPDATE replication_queue SET status = 'failed', attempts = attempts + 1, lastAttemptAt = ? WHERE id = ?`
    );
    for (const id of ids) {
      stmt.run(now, id);
    }
  },

  async pruneReplicationQueue(this: SqliteStorage, maxAge: Date): Promise<number> {
    const maxAgeIso = maxAge.toISOString();
    const result = this.db.prepare(
      `DELETE FROM replication_queue WHERE createdAt < ? OR status = 'sent'`
    ).run(maxAgeIso);
    return result.changes;
  },

  async replicationQueueSize(this: SqliteStorage): Promise<number> {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM replication_queue').get() as { cnt: number };
    return row.cnt;
  },

  deserializeReplicationEntry(this: SqliteStorage, row: Record<string, unknown>): ReplicationQueueEntry {
    return {
      id: row.id as string,
      type: row.type as ReplicationQueueEntry['type'],
      targetPeers: JSON.parse(row.targetPeers as string),
      payload: row.payload ? JSON.parse(row.payload as string) : null,
      createdAt: row.createdAt as string,
      attempts: row.attempts as number,
      lastAttemptAt: (row.lastAttemptAt as string) || null,
      status: row.status as ReplicationQueueEntry['status'],
    };
  },
};
