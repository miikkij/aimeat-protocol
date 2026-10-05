/**
 * @file src/storage/providers/sqlite/methods/schedules.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/schedules.ts (scheduleMethods), so a
 *   fix in one provider finds its twin by file name. Bodies moved verbatim from the files named in the
 *   version history; bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure scheduleMethods
 * @usage Object.assign(SqliteStorage.prototype, scheduleMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — 12 methods (createScheduledJob, getScheduledJob, listScheduledJobs, …) moved here
 *     from federation-oauth.ts so the file mirrors postgres-kysely/methods/schedules.ts (secaudit 2026-10,
 *     M8).
 */
import type { ScheduledJobRecord, ExecutionLogEntry } from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

export const scheduleMethods = {

  // ══════════════════════════════════════════════════════════
  // ── Scheduled Jobs ──
  // ══════════════════════════════════════════════════════════

  async createScheduledJob(this: SqliteStorage, record: ScheduledJobRecord): Promise<ScheduledJobRecord> {
    try {
      this.db.prepare(
        `INSERT INTO scheduled_jobs (id, name, type, extensionName, instanceId, actionId,
         coreHandler, cron, enabled, input, lastRunAt, lastRunResult, lastRunError,
         lastRunDurationMs, nextRunAt, createdBy, createdAt, updatedAt,
         ownerScope, agentName, agentGaii, createdByAgent, displayName, description,
         purpose, timezone, constraints, runCount, createdByApp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        record.id, record.name, record.type,
        record.extensionName ?? null, record.instanceId ?? null, record.actionId ?? null,
        record.coreHandler ?? null, record.cron, record.enabled ? 1 : 0,
        record.input ? JSON.stringify(record.input) : null,
        record.lastRunAt ?? null, record.lastRunResult ?? null, record.lastRunError ?? null,
        record.lastRunDurationMs ?? null, record.nextRunAt ?? null,
        record.createdBy, record.createdAt, record.updatedAt,
        record.ownerScope ?? null, record.agentName ?? null, record.agentGaii ?? null,
        record.createdByAgent ? 1 : 0, record.displayName ?? null, record.description ?? null,
        record.purpose ?? null, record.timezone ?? null,
        record.constraints ? JSON.stringify(record.constraints) : null,
        record.runCount ?? 0, record.createdByApp ?? null,
      );
      return record;
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) {
        throw new Error(`Scheduled job "${record.id}" already exists`, { cause: err });
      }
      throw err;
    }
  },

  async getScheduledJob(this: SqliteStorage, id: string): Promise<ScheduledJobRecord | null> {
    const row = this.db.prepare('SELECT * FROM scheduled_jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeScheduledJob(row) : null;
  },

  async listScheduledJobs(this: SqliteStorage, filter?: { type?: string; extensionName?: string; enabled?: boolean; ownerScope?: string; agentGaii?: string }): Promise<ScheduledJobRecord[]> {
    let sql = 'SELECT * FROM scheduled_jobs';
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter?.type) { conditions.push('type = ?'); params.push(filter.type); }
    if (filter?.extensionName) { conditions.push('extensionName = ?'); params.push(filter.extensionName); }
    if (filter?.enabled !== undefined) { conditions.push('enabled = ?'); params.push(filter.enabled ? 1 : 0); }
    if (filter?.ownerScope) { conditions.push('ownerScope = ?'); params.push(filter.ownerScope); }
    if (filter?.agentGaii) { conditions.push('agentGaii = ?'); params.push(filter.agentGaii); }
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeScheduledJob(r));
  },

  async updateScheduledJob(this: SqliteStorage, id: string, updates: Partial<ScheduledJobRecord>): Promise<ScheduledJobRecord | null> {
    const existing = await this.getScheduledJob(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE scheduled_jobs SET name = ?, type = ?, extensionName = ?, instanceId = ?,
       actionId = ?, coreHandler = ?, cron = ?, enabled = ?, input = ?,
       lastRunAt = ?, lastRunResult = ?, lastRunError = ?, lastRunDurationMs = ?,
       nextRunAt = ?, createdBy = ?, createdAt = ?, updatedAt = ?,
       ownerScope = ?, agentName = ?, agentGaii = ?, createdByAgent = ?,
       displayName = ?, description = ?, purpose = ?, timezone = ?,
       constraints = ?, runCount = ?, createdByApp = ? WHERE id = ?`
    ).run(
      updated.name, updated.type,
      updated.extensionName ?? null, updated.instanceId ?? null, updated.actionId ?? null,
      updated.coreHandler ?? null, updated.cron, updated.enabled ? 1 : 0,
      updated.input ? JSON.stringify(updated.input) : null,
      updated.lastRunAt ?? null, updated.lastRunResult ?? null, updated.lastRunError ?? null,
      updated.lastRunDurationMs ?? null, updated.nextRunAt ?? null,
      updated.createdBy, updated.createdAt, updated.updatedAt,
      updated.ownerScope ?? null, updated.agentName ?? null, updated.agentGaii ?? null,
      updated.createdByAgent ? 1 : 0, updated.displayName ?? null, updated.description ?? null,
      updated.purpose ?? null, updated.timezone ?? null,
      updated.constraints ? JSON.stringify(updated.constraints) : null,
      updated.runCount ?? 0, updated.createdByApp ?? null, id,
    );
    return updated;
  },

  async deleteScheduledJob(this: SqliteStorage, id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM scheduled_jobs WHERE id = ?').run(id);
    return result.changes > 0;
  },

  /** One conditional UPDATE. lastFireAt is always written by toISOString, so text order is time order. */
  async claimScheduledFire(this: SqliteStorage, id: string, fireAt: string): Promise<boolean> {
    const at = new Date(fireAt).toISOString();
    const result = this.db.prepare(
      'UPDATE scheduled_jobs SET lastFireAt = ? WHERE id = ? AND (lastFireAt IS NULL OR lastFireAt < ?)',
    ).run(at, id, at);
    return result.changes === 1;
  },

  deserializeScheduledJob(this: SqliteStorage, row: Record<string, unknown>): ScheduledJobRecord {
    const record: ScheduledJobRecord = {
      id: row.id as string,
      name: row.name as string,
      type: row.type as ScheduledJobRecord['type'],
      cron: row.cron as string,
      enabled: (row.enabled as number) === 1,
      createdBy: row.createdBy as string,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.extensionName) record.extensionName = row.extensionName as string;
    if (row.instanceId) record.instanceId = row.instanceId as string;
    if (row.actionId) record.actionId = row.actionId as string;
    if (row.coreHandler) record.coreHandler = row.coreHandler as string;
    if (row.input) record.input = JSON.parse(row.input as string);
    if (row.lastRunAt) record.lastRunAt = row.lastRunAt as string;
    if (row.lastRunResult) record.lastRunResult = row.lastRunResult as ScheduledJobRecord['lastRunResult'];
    if (row.lastRunError) record.lastRunError = row.lastRunError as string;
    if (row.lastRunDurationMs !== null && row.lastRunDurationMs !== undefined) record.lastRunDurationMs = row.lastRunDurationMs as number;
    if (row.nextRunAt) record.nextRunAt = row.nextRunAt as string;
    if (row.ownerScope) record.ownerScope = row.ownerScope as string;
    if (row.agentName) record.agentName = row.agentName as string;
    if (row.agentGaii) record.agentGaii = row.agentGaii as string;
    if ((row.createdByAgent as number) === 1) record.createdByAgent = true;
    if (row.createdByApp) record.createdByApp = row.createdByApp as string;
    if (row.displayName) record.displayName = row.displayName as string;
    if (row.description) record.description = row.description as string;
    if (row.purpose) record.purpose = row.purpose as string;
    if (row.timezone) record.timezone = row.timezone as string;
    if (row.constraints) record.constraints = JSON.parse(row.constraints as string);
    if (row.runCount !== null && row.runCount !== undefined) record.runCount = row.runCount as number;
    return record;
  },

  // ══════════════════════════════════════════════════════════
  // ── Execution Log ──
  // ══════════════════════════════════════════════════════════

  async createExecutionLog(this: SqliteStorage, entry: ExecutionLogEntry): Promise<ExecutionLogEntry> {
    this.db.prepare(
      `INSERT INTO execution_log (id, jobId, jobName, type, extensionName, actionId,
       "trigger", result, errorMessage, durationMs, memoryReads, memoryWrites, taskId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      entry.id, entry.jobId, entry.jobName, entry.type,
      entry.extensionName ?? null, entry.actionId ?? null,
      entry.trigger, entry.result, entry.errorMessage ?? null,
      entry.durationMs,
      JSON.stringify(entry.memoryReads),
      JSON.stringify(entry.memoryWrites),
      entry.taskId ?? null,
      entry.createdAt,
    );
    return entry;
  },

  async listExecutionLogs(this: SqliteStorage, filter?: {
    jobId?: string; extensionName?: string; trigger?: string; result?: string;
    limit?: number; offset?: number;
  }): Promise<ExecutionLogEntry[]> {
    let sql = 'SELECT * FROM execution_log';
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter?.jobId) { conditions.push('jobId = ?'); params.push(filter.jobId); }
    if (filter?.extensionName) { conditions.push('extensionName = ?'); params.push(filter.extensionName); }
    if (filter?.trigger) { conditions.push('"trigger" = ?'); params.push(filter.trigger); }
    if (filter?.result) { conditions.push('result = ?'); params.push(filter.result); }
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY createdAt DESC';
    if (filter?.limit) { sql += ' LIMIT ?'; params.push(filter.limit); }
    if (filter?.offset) { sql += ' OFFSET ?'; params.push(filter.offset); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeExecutionLog(r));
  },

  async countExecutionLogs(this: SqliteStorage, filter?: {
    jobId?: string; extensionName?: string; trigger?: string; result?: string;
  }): Promise<number> {
    let sql = 'SELECT COUNT(*) as cnt FROM execution_log';
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter?.jobId) { conditions.push('jobId = ?'); params.push(filter.jobId); }
    if (filter?.extensionName) { conditions.push('extensionName = ?'); params.push(filter.extensionName); }
    if (filter?.trigger) { conditions.push('"trigger" = ?'); params.push(filter.trigger); }
    if (filter?.result) { conditions.push('result = ?'); params.push(filter.result); }
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    const row = this.db.prepare(sql).get(...params) as Record<string, unknown>;
    return (row.cnt as number) ?? 0;
  },

  async pruneExecutionLogs(this: SqliteStorage, beforeDate: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM execution_log WHERE createdAt < ?').run(beforeDate);
    return result.changes;
  },

  deserializeExecutionLog(this: SqliteStorage, row: Record<string, unknown>): ExecutionLogEntry {
    return {
      id: row.id as string,
      jobId: row.jobId as string,
      jobName: row.jobName as string,
      type: row.type as ExecutionLogEntry['type'],
      extensionName: (row.extensionName as string) || undefined,
      actionId: (row.actionId as string) || undefined,
      trigger: row.trigger as ExecutionLogEntry['trigger'],
      result: row.result as ExecutionLogEntry['result'],
      errorMessage: (row.errorMessage as string) || undefined,
      durationMs: row.durationMs as number,
      memoryReads: JSON.parse(row.memoryReads as string || '[]'),
      memoryWrites: JSON.parse(row.memoryWrites as string || '[]'),
      taskId: (row.taskId as string) || undefined,
      createdAt: row.createdAt as string,
    };
  },
};
