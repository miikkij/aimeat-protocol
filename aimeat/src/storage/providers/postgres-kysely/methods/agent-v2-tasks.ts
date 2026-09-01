/**
 * @file src/storage/providers/postgres-kysely/methods/agent-v2-tasks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Postgres+Kysely implementation of the Agent v2 task repository (migration 0060).
 * @structure agentV2TasksMethods — create / get / list / settle / deleteByOwner
 * @usage Object.assign(PostgresKyselyStorage.prototype, agentV2TasksMethods)
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V5).
 */
import type { Selectable, UpdateObject } from 'kysely';
import type { AgentV2TaskRecord, AgentV2TaskStatus } from '../../../interface.js';
import type { AgentV2TaskQuery, AgentV2TaskPatch } from '../../../repositories/agent-v2-tasks.repository.js';
import type { DB, AgentV2Task } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { dbError } from '../helpers.js';

function toTask(r: Selectable<AgentV2Task>): AgentV2TaskRecord {
  return {
    taskId: r.taskId,
    status: r.status as AgentV2TaskStatus,
    statusMessage: r.statusMessage ?? null,
    contextId: r.contextId,
    owner: r.owner,
    createdBy: r.createdBy,
    assignedTo: r.assignedTo,
    input: (r.input ?? []) as unknown[],
    result: (r.result ?? null) as unknown[] | null,
    error: (r.error ?? null) as { code: string; message: string } | null,
    createdAt: r.createdAt,
    lastUpdatedAt: r.lastUpdatedAt,
    startedAt: r.startedAt ?? null,
    completedAt: r.completedAt ?? null,
    ttlMs: r.ttlMs === null || r.ttlMs === undefined ? null : Number(r.ttlMs),
    pollIntervalMs: r.pollIntervalMs === null || r.pollIntervalMs === undefined ? null : Number(r.pollIntervalMs),
    metadata: (r.metadata ?? null) as Record<string, unknown> | null,
  };
}

export const agentV2TasksMethods = {
  async createAgentV2Task(this: PostgresKyselyStorage, t: AgentV2TaskRecord): Promise<void> {
    try {
      await this.db.insertInto('AgentV2Task').values({
        taskId: t.taskId, status: t.status, statusMessage: t.statusMessage ?? null,
        contextId: t.contextId, owner: t.owner, createdBy: t.createdBy, assignedTo: t.assignedTo,
        input: JSON.stringify(t.input) as never,
        result: (t.result ? JSON.stringify(t.result) : null) as never,
        error: (t.error ? JSON.stringify(t.error) : null) as never,
        createdAt: t.createdAt, lastUpdatedAt: t.lastUpdatedAt,
        startedAt: t.startedAt ?? null, completedAt: t.completedAt ?? null,
        ttlMs: t.ttlMs ?? null, pollIntervalMs: t.pollIntervalMs ?? null,
        metadata: (t.metadata ? JSON.stringify(t.metadata) : null) as never,
      }).execute();
    } catch (err) { throw dbError('createAgentV2Task', err); }
  },

  async getAgentV2Task(this: PostgresKyselyStorage, owner: string, taskId: string): Promise<AgentV2TaskRecord | null> {
    const r = await this.db.selectFrom('AgentV2Task').selectAll()
      .where('owner', '=', owner).where('taskId', '=', taskId).executeTakeFirst();
    return r ? toTask(r) : null;
  },

  async listAgentV2Tasks(this: PostgresKyselyStorage, owner: string, q: AgentV2TaskQuery): Promise<AgentV2TaskRecord[]> {
    let query = this.db.selectFrom('AgentV2Task').selectAll().where('owner', '=', owner);
    if (q.contextId) query = query.where('contextId', '=', q.contextId);
    if (q.assignedTo) query = query.where('assignedTo', '=', q.assignedTo);
    if (q.createdBy) query = query.where('createdBy', '=', q.createdBy);
    if (q.status && q.status.length > 0) query = query.where('status', 'in', q.status);
    const rows = await query.orderBy('createdAt', 'desc').orderBy('taskId', 'desc')
      .limit(Math.max(1, q.limit ?? 50)).execute();
    return rows.map(toTask);
  },

  /**
   * Conditional on the CURRENT status being one the caller was willing to move from, so the answer
   * is "did THIS call move it" rather than "was it movable a moment ago". A worker completing while
   * the caller cancels is the case it exists for.
   */
  async settleAgentV2Task(
    this: PostgresKyselyStorage, owner: string, taskId: string,
    fromStatuses: AgentV2TaskStatus[], patch: AgentV2TaskPatch, at: string,
  ): Promise<boolean> {
    const set: UpdateObject<DB, 'AgentV2Task'> = { lastUpdatedAt: at };
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.statusMessage !== undefined) set.statusMessage = patch.statusMessage ?? null;
    if (patch.result !== undefined) set.result = (patch.result ? JSON.stringify(patch.result) : null) as never;
    if (patch.error !== undefined) set.error = (patch.error ? JSON.stringify(patch.error) : null) as never;
    if (patch.startedAt !== undefined) set.startedAt = patch.startedAt ?? null;
    if (patch.completedAt !== undefined) set.completedAt = patch.completedAt ?? null;
    if (patch.ttlMs !== undefined) set.ttlMs = patch.ttlMs ?? null;
    if (patch.pollIntervalMs !== undefined) set.pollIntervalMs = patch.pollIntervalMs ?? null;

    const r = await this.db.updateTable('AgentV2Task').set(set)
      .where('owner', '=', owner).where('taskId', '=', taskId)
      .where('status', 'in', fromStatuses)
      .executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0) > 0;
  },

  async deleteAgentV2TasksByOwner(this: PostgresKyselyStorage, owner: string): Promise<number> {
    const r = await this.db.deleteFrom('AgentV2Task').where('owner', '=', owner).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
};
