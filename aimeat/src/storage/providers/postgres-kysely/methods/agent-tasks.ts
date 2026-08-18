/**
 * @file src/storage/providers/postgres-kysely/methods/agent-tasks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agent-task domain for the Postgres+Kysely backend (AgentTask / AgentTaskEvent). Backs the
 *   Agent Dashboard: task CRUD, the append-only event log, the per-agent / per-owner status rollups, and
 *   stall detection. Translated 1:1 from the Prisma (mongodb) implementation — the JSON columns
 *   (scope/rules/verification/resources/todos/telemetry/rating/automation, event details) round-trip via
 *   jsonb, and the count/aggregation semantics match: countTasksByAgent groups by status, countTasksByOwner
 *   groups by agent then folds status/doneToday/lastTaskUpdateAt/lastFailedAt, findStalledTasks compares
 *   lastEventAt to a now-threshold. Delete cascades the event log and refuses an 'active' task.
 * @version-history
 *   2026-08-15 — createdBy on insert and read (migration 0037).
 *   v1.0.0 — 2026-07-15 — Phase 5: agent-task domain on Postgres+Kysely.
 */
import { sql } from 'kysely';
import type { Selectable } from 'kysely';
import type { AgentTaskRecord, AgentTaskEventRecord } from '../../../interface.js';
import { LIVE_TASK_STATUSES } from '../../../interface.js';
import type { AgentTask, AgentTaskEvent } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();
const isoOpt = (t: Date | string | null | undefined): string | null => (t == null ? null : (t instanceof Date ? t : new Date(t)).toISOString());

function toTask(r: Selectable<AgentTask>): AgentTaskRecord {
  const rec: AgentTaskRecord = {
    id: r.id,
    agentGaii: r.agentGaii,
    ownerGaii: r.ownerGaii,
    createdBy: r.createdBy ?? null,
    title: r.title,
    description: r.description,
    scope: r.scope as unknown as AgentTaskRecord['scope'],
    rules: r.rules as string[],
    verification: r.verification as AgentTaskRecord['verification'],
    todos: r.todos as unknown as AgentTaskRecord['todos'],
    status: r.status as AgentTaskRecord['status'],
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
  if (r.dedupeKey != null) rec.dedupeKey = r.dedupeKey;
  if (r.resources != null) rec.resources = r.resources as AgentTaskRecord['resources'];
  if (r.parentTaskId != null) rec.parentTaskId = r.parentTaskId;
  if (r.workTrackingCode != null) rec.workTrackingCode = r.workTrackingCode;
  if (r.telemetry != null) rec.telemetry = r.telemetry as AgentTaskRecord['telemetry'];
  if (r.lastEventAt != null) rec.lastEventAt = iso(r.lastEventAt);
  if (r.completedAt != null) rec.completedAt = iso(r.completedAt);
  if (r.deliverableKey != null) rec.deliverableKey = r.deliverableKey;
  if (r.rating != null) rec.rating = r.rating as unknown as AgentTaskRecord['rating'];
  if (r.triage != null) rec.triage = r.triage as AgentTaskRecord['triage'];
  if (r.automation != null) rec.automation = r.automation as AgentTaskRecord['automation'];
  return rec;
}

function toEvent(r: Selectable<AgentTaskEvent>): AgentTaskEventRecord {
  const rec: AgentTaskEventRecord = {
    id: r.id,
    taskId: r.taskId,
    type: r.type as AgentTaskEventRecord['type'],
    message: r.message,
    timestamp: iso(r.timestamp),
  };
  if (r.details != null) rec.details = r.details as Record<string, unknown>;
  return rec;
}

export const agentTaskMethods = {
  async createAgentTask(this: PostgresKyselyStorage, record: AgentTaskRecord): Promise<AgentTaskRecord> {
    await this.db.insertInto('AgentTask').values({
      id: record.id,
      agentGaii: record.agentGaii,
      ownerGaii: record.ownerGaii,
      createdBy: record.createdBy ?? null,
      title: record.title,
      description: record.description,
      scope: jsonb(record.scope),
      rules: jsonb(record.rules),
      verification: jsonb(record.verification),
      resources: jsonb(record.resources ?? null),
      todos: jsonb(record.todos),
      status: record.status,
      dedupeKey: record.dedupeKey ?? null,
      parentTaskId: record.parentTaskId ?? null,
      workTrackingCode: record.workTrackingCode ?? null,
      telemetry: jsonb(record.telemetry ?? null),
      lastEventAt: record.lastEventAt ? new Date(record.lastEventAt) : null,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
      completedAt: record.completedAt ? new Date(record.completedAt) : null,
      deliverableKey: record.deliverableKey ?? null,
      rating: jsonb(record.rating ?? null),
      triage: record.triage ?? null,
      automation: jsonb(record.automation ?? null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
    return record;
  },

  async getAgentTask(this: PostgresKyselyStorage, id: string): Promise<AgentTaskRecord | null> {
    const r = await this.db.selectFrom('AgentTask').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toTask(r) : null;
  },

  async findLiveTaskByDedupeKey(this: PostgresKyselyStorage, agentGaii: string, dedupeKey: string): Promise<AgentTaskRecord | null> {
    const r = await this.db.selectFrom('AgentTask').selectAll()
      .where('agentGaii', '=', agentGaii)
      .where('dedupeKey', '=', dedupeKey)
      .where('status', 'in', [...LIVE_TASK_STATUSES])
      .orderBy('createdAt', 'desc')
      .executeTakeFirst();
    return r ? toTask(r) : null;
  },

  async listAgentTasks(this: PostgresKyselyStorage, agentGaii: string, opts?: { status?: string; page?: number; perPage?: number }): Promise<{ tasks: AgentTaskRecord[]; total: number }> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 20;
    let base = this.db.selectFrom('AgentTask').where('agentGaii', '=', agentGaii);
    if (opts?.status) base = base.where('status', '=', opts.status);
    const rows = await base.selectAll().orderBy('updatedAt', 'desc').limit(perPage).offset((page - 1) * perPage).execute();
    const totalRow = await base.select(this.db.fn.countAll<number>().as('n')).executeTakeFirst();
    return { tasks: rows.map(toTask), total: Number(totalRow?.n ?? 0) };
  },

  async listAgentTasksByOwner(this: PostgresKyselyStorage, ownerGaii: string, opts?: { status?: string; agentGaii?: string; page?: number; perPage?: number }): Promise<{ tasks: AgentTaskRecord[]; total: number }> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 20;
    let base = this.db.selectFrom('AgentTask').where('ownerGaii', '=', ownerGaii);
    if (opts?.agentGaii) base = base.where('agentGaii', '=', opts.agentGaii);
    if (opts?.status) base = base.where('status', '=', opts.status);
    const rows = await base.selectAll().orderBy('updatedAt', 'desc').limit(perPage).offset((page - 1) * perPage).execute();
    const totalRow = await base.select(this.db.fn.countAll<number>().as('n')).executeTakeFirst();
    return { tasks: rows.map(toTask), total: Number(totalRow?.n ?? 0) };
  },

  async updateAgentTask(this: PostgresKyselyStorage, id: string, updates: Partial<AgentTaskRecord>): Promise<AgentTaskRecord | null> {
    const existing = await this.getAgentTask(id);
    if (!existing) return null;
    // Merge like the Prisma/SQLite backends: identity + createdAt are immutable, everything else overwrites.
    const merged: AgentTaskRecord = {
      ...existing,
      ...updates,
      id: existing.id,
      agentGaii: existing.agentGaii,
      ownerGaii: existing.ownerGaii,
      createdAt: existing.createdAt,
    };
    const rows = await this.db.updateTable('AgentTask').set({
      title: merged.title,
      description: merged.description,
      scope: jsonb(merged.scope),
      rules: jsonb(merged.rules),
      verification: jsonb(merged.verification),
      resources: jsonb(merged.resources ?? null),
      todos: jsonb(merged.todos),
      status: merged.status,
      parentTaskId: merged.parentTaskId ?? null,
      workTrackingCode: merged.workTrackingCode ?? null,
      telemetry: jsonb(merged.telemetry ?? null),
      lastEventAt: merged.lastEventAt ? new Date(merged.lastEventAt) : null,
      updatedAt: new Date(merged.updatedAt),
      completedAt: merged.completedAt ? new Date(merged.completedAt) : null,
      deliverableKey: merged.deliverableKey ?? null,
      rating: jsonb(merged.rating ?? null),
      triage: merged.triage ?? null,
      automation: jsonb(merged.automation ?? null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).where('id', '=', id).returningAll().execute();
    return rows[0] ? toTask(rows[0]) : null;
  },

  async deleteAgentTask(this: PostgresKyselyStorage, id: string): Promise<boolean> {
    // Any non-active task is deletable; an active (running) task must be cancelled/paused first so we
    // never orphan a live runner. The status guard is also a race safety-net for the route-level check.
    const r = await this.db.deleteFrom('AgentTask').where('id', '=', id).where('status', '!=', 'active').executeTakeFirst();
    if (Number(r.numDeletedRows ?? 0) > 0) {
      await this.db.deleteFrom('AgentTaskEvent').where('taskId', '=', id).execute();
      return true;
    }
    return false;
  },

  async appendTaskEvent(this: PostgresKyselyStorage, event: AgentTaskEventRecord): Promise<AgentTaskEventRecord> {
    // id is DB-generated (matches the Prisma backend, which ignores event.id and returns the created row).
    const [row] = await this.db.insertInto('AgentTaskEvent').values({
      taskId: event.taskId,
      type: event.type,
      message: event.message,
      details: jsonb(event.details ?? null),
      timestamp: new Date(event.timestamp),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).returningAll().execute();
    return toEvent(row);
  },

  async listTaskEvents(this: PostgresKyselyStorage, taskId: string, opts?: { page?: number; perPage?: number }): Promise<{ events: AgentTaskEventRecord[]; total: number }> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 20;
    const rows = await this.db.selectFrom('AgentTaskEvent').selectAll().where('taskId', '=', taskId)
      .orderBy('timestamp', 'asc').limit(perPage).offset((page - 1) * perPage).execute();
    const totalRow = await this.db.selectFrom('AgentTaskEvent').select(this.db.fn.countAll<number>().as('n')).where('taskId', '=', taskId).executeTakeFirst();
    return { events: rows.map(toEvent), total: Number(totalRow?.n ?? 0) };
  },

  async countTasksByAgent(this: PostgresKyselyStorage, agentGaii: string): Promise<{ queued: number; active: number; done: number; failed: number }> {
    const rows = await this.db.selectFrom('AgentTask')
      .select(['status', sql<string>`count(*)`.as('n')])
      .where('agentGaii', '=', agentGaii).groupBy('status').execute();
    const counts = { queued: 0, active: 0, done: 0, failed: 0 };
    for (const row of rows) {
      if (row.status in counts) counts[row.status as keyof typeof counts] = Number(row.n);
    }
    return counts;
  },

  async countTasksByOwner(this: PostgresKyselyStorage, ownerGaii: string): Promise<Record<string, { queued: number; active: number; done: number; failed: number; doneToday: number; lastTaskUpdateAt: string | null; lastFailedAt: string | null }>> {
    // One grouped pass per agent: status buckets via CASE sums, doneToday = done tasks completed on the
    // current UTC day, lastTaskUpdateAt = MAX(updatedAt), lastFailedAt = MAX(updatedAt) of failed tasks.
    const dayStart = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
    const rows = await this.db.selectFrom('AgentTask')
      .select([
        'agentGaii',
        sql<string>`sum(case when status = 'queued' then 1 else 0 end)`.as('queued'),
        sql<string>`sum(case when status = 'active' then 1 else 0 end)`.as('active'),
        sql<string>`sum(case when status = 'done' then 1 else 0 end)`.as('done'),
        sql<string>`sum(case when status = 'failed' then 1 else 0 end)`.as('failed'),
        sql<string>`sum(case when status = 'done' and "completedAt" >= ${dayStart} then 1 else 0 end)`.as('doneToday'),
        sql<Date | null>`max("updatedAt")`.as('lastTaskUpdateAt'),
        sql<Date | null>`max(case when status = 'failed' then "updatedAt" end)`.as('lastFailedAt'),
      ])
      .where('ownerGaii', '=', ownerGaii).groupBy('agentGaii').execute();
    const out: Record<string, { queued: number; active: number; done: number; failed: number; doneToday: number; lastTaskUpdateAt: string | null; lastFailedAt: string | null }> = {};
    for (const r of rows) {
      out[r.agentGaii] = {
        queued: Number(r.queued ?? 0),
        active: Number(r.active ?? 0),
        done: Number(r.done ?? 0),
        failed: Number(r.failed ?? 0),
        doneToday: Number(r.doneToday ?? 0),
        lastTaskUpdateAt: isoOpt(r.lastTaskUpdateAt),
        lastFailedAt: isoOpt(r.lastFailedAt),
      };
    }
    return out;
  },

  async findStalledTasks(this: PostgresKyselyStorage, thresholdMinutes: number): Promise<AgentTaskRecord[]> {
    const threshold = new Date(Date.now() - thresholdMinutes * 60 * 1000);
    const rows = await this.db.selectFrom('AgentTask').selectAll()
      .where('status', '=', 'active')
      .where('lastEventAt', 'is not', null)
      .where('lastEventAt', '<', threshold)
      .execute();
    return rows.map(toTask);
  },
};
