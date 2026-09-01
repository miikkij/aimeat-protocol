/**
 * @file src/storage/providers/sqlite/methods/agent-v2-tasks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite implementation of the Agent v2 task repository.
 * @structure agentV2TasksMethods — create / get / list / settle / deleteByOwner
 * @usage Object.assign(SqliteStorage.prototype, agentV2TasksMethods)
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V5).
 */
import type { AgentV2TaskRecord, AgentV2TaskStatus } from '../../../interface.js';
import type { AgentV2TaskQuery, AgentV2TaskPatch } from '../../../repositories/agent-v2-tasks.repository.js';
import type { SqliteStorage } from '../index.js';

function toTask(row: Record<string, unknown>): AgentV2TaskRecord {
  return {
    taskId: row.taskId as string,
    status: row.status as AgentV2TaskStatus,
    statusMessage: (row.statusMessage as string) ?? null,
    contextId: row.contextId as string,
    owner: row.owner as string,
    createdBy: row.createdBy as string,
    assignedTo: row.assignedTo as string,
    input: JSON.parse((row.input as string) || '[]') as unknown[],
    result: row.result ? JSON.parse(row.result as string) as unknown[] : null,
    error: row.error ? JSON.parse(row.error as string) as { code: string; message: string } : null,
    createdAt: row.createdAt as string,
    lastUpdatedAt: row.lastUpdatedAt as string,
    startedAt: (row.startedAt as string) ?? null,
    completedAt: (row.completedAt as string) ?? null,
    ttlMs: row.ttlMs === null || row.ttlMs === undefined ? null : Number(row.ttlMs),
    pollIntervalMs: row.pollIntervalMs === null || row.pollIntervalMs === undefined ? null : Number(row.pollIntervalMs),
    metadata: row.metadata ? JSON.parse(row.metadata as string) as Record<string, unknown> : null,
  };
}

export const agentV2TasksMethods = {
  async createAgentV2Task(this: SqliteStorage, t: AgentV2TaskRecord): Promise<void> {
    this.db.prepare(
      `INSERT INTO agent_v2_tasks
         (taskId, status, statusMessage, contextId, owner, createdBy, assignedTo, input, result, error,
          createdAt, lastUpdatedAt, startedAt, completedAt, ttlMs, pollIntervalMs, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      t.taskId, t.status, t.statusMessage ?? null, t.contextId, t.owner, t.createdBy, t.assignedTo,
      JSON.stringify(t.input), t.result ? JSON.stringify(t.result) : null,
      t.error ? JSON.stringify(t.error) : null,
      t.createdAt, t.lastUpdatedAt, t.startedAt ?? null, t.completedAt ?? null,
      t.ttlMs ?? null, t.pollIntervalMs ?? null, t.metadata ? JSON.stringify(t.metadata) : null,
    );
  },

  async getAgentV2Task(this: SqliteStorage, owner: string, taskId: string): Promise<AgentV2TaskRecord | null> {
    const row = this.db.prepare('SELECT * FROM agent_v2_tasks WHERE owner = ? AND taskId = ?')
      .get(owner, taskId) as Record<string, unknown> | undefined;
    return row ? toTask(row) : null;
  },

  async listAgentV2Tasks(this: SqliteStorage, owner: string, q: AgentV2TaskQuery): Promise<AgentV2TaskRecord[]> {
    const where: string[] = ['owner = ?'];
    const args: unknown[] = [owner];
    if (q.contextId) { where.push('contextId = ?'); args.push(q.contextId); }
    if (q.assignedTo) { where.push('assignedTo = ?'); args.push(q.assignedTo); }
    if (q.createdBy) { where.push('createdBy = ?'); args.push(q.createdBy); }
    if (q.status && q.status.length > 0) {
      where.push(`status IN (${q.status.map(() => '?').join(', ')})`);
      args.push(...q.status);
    }
    args.push(Math.max(1, q.limit ?? 50));
    const rows = this.db.prepare(
      `SELECT * FROM agent_v2_tasks WHERE ${where.join(' AND ')} ORDER BY createdAt DESC, taskId DESC LIMIT ?`
    ).all(...args) as Record<string, unknown>[];
    return rows.map(toTask);
  },

  /**
   * Conditional on the CURRENT status being one the caller was willing to move from, so the answer
   * is "did THIS call move it" rather than "was it movable a moment ago". A worker completing while
   * the caller cancels is the case it exists for.
   */
  async settleAgentV2Task(
    this: SqliteStorage, owner: string, taskId: string,
    fromStatuses: AgentV2TaskStatus[], patch: AgentV2TaskPatch, at: string,
  ): Promise<boolean> {
    const sets: string[] = ['lastUpdatedAt = ?'];
    const args: unknown[] = [at];
    if (patch.status !== undefined) { sets.push('status = ?'); args.push(patch.status); }
    if (patch.statusMessage !== undefined) { sets.push('statusMessage = ?'); args.push(patch.statusMessage ?? null); }
    if (patch.result !== undefined) { sets.push('result = ?'); args.push(patch.result ? JSON.stringify(patch.result) : null); }
    if (patch.error !== undefined) { sets.push('error = ?'); args.push(patch.error ? JSON.stringify(patch.error) : null); }
    if (patch.startedAt !== undefined) { sets.push('startedAt = ?'); args.push(patch.startedAt ?? null); }
    if (patch.completedAt !== undefined) { sets.push('completedAt = ?'); args.push(patch.completedAt ?? null); }
    if (patch.ttlMs !== undefined) { sets.push('ttlMs = ?'); args.push(patch.ttlMs ?? null); }
    if (patch.pollIntervalMs !== undefined) { sets.push('pollIntervalMs = ?'); args.push(patch.pollIntervalMs ?? null); }
    args.push(owner, taskId, ...fromStatuses);
    const res = this.db.prepare(
      `UPDATE agent_v2_tasks SET ${sets.join(', ')}
       WHERE owner = ? AND taskId = ? AND status IN (${fromStatuses.map(() => '?').join(', ')})`
    ).run(...args);
    return res.changes > 0;
  },

  async deleteAgentV2TasksByOwner(this: SqliteStorage, owner: string): Promise<number> {
    return this.db.prepare('DELETE FROM agent_v2_tasks WHERE owner = ?').run(owner).changes;
  },
};
