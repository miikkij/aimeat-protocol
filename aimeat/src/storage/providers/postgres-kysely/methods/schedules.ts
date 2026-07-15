/**
 * @file src/storage/providers/postgres-kysely/methods/schedules.ts
 * @description Scheduler domain for the Postgres+Kysely backend (ScheduledJob / ExecutionLog). Backs the
 *   cron scheduler + the agents-card next-run + execution history. Translated 1:1 from the Prisma
 *   implementation. Replaces the listScheduledJobs startup-compat placeholder.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: scheduler on Postgres+Kysely.
 */
import { sql } from 'kysely';
import type { Selectable } from 'kysely';
import type { ExecutionLogEntry, ScheduledJobRecord } from '../../../interface.js';
import type { ExecutionLog, ScheduledJob } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();
const isoOpt = (t: Date | string | null | undefined): string | undefined => (t == null ? undefined : iso(t));

function toJob(r: Selectable<ScheduledJob>): ScheduledJobRecord {
  return {
    id: r.id, name: r.name, type: r.type as ScheduledJobRecord['type'], extensionName: r.extensionName ?? undefined,
    instanceId: r.instanceId ?? undefined, actionId: r.actionId ?? undefined, coreHandler: r.coreHandler ?? undefined,
    cron: r.cron, enabled: r.enabled, input: (r.input ?? undefined) as Record<string, unknown> | undefined,
    lastRunAt: isoOpt(r.lastRunAt), lastRunResult: (r.lastRunResult ?? undefined) as ScheduledJobRecord['lastRunResult'],
    lastRunError: r.lastRunError ?? undefined, lastRunDurationMs: r.lastRunDurationMs ?? undefined, nextRunAt: isoOpt(r.nextRunAt),
    createdBy: r.createdBy, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt), ownerScope: r.ownerScope ?? undefined,
    agentName: r.agentName ?? undefined, agentGaii: r.agentGaii ?? undefined, createdByAgent: r.createdByAgent ?? undefined,
    displayName: r.displayName ?? undefined, description: r.description ?? undefined, purpose: r.purpose ?? undefined,
    timezone: r.timezone ?? undefined, constraints: (r.constraints ?? undefined) as ScheduledJobRecord['constraints'], runCount: r.runCount ?? undefined,
  };
}
function toLog(r: Selectable<ExecutionLog>): ExecutionLogEntry {
  return {
    id: r.id, jobId: r.jobId, jobName: r.jobName, type: r.type as ExecutionLogEntry['type'], extensionName: r.extensionName ?? undefined,
    actionId: r.actionId ?? undefined, trigger: r.trigger as ExecutionLogEntry['trigger'], result: r.result as ExecutionLogEntry['result'],
    errorMessage: r.errorMessage ?? undefined, durationMs: r.durationMs, memoryReads: (r.memoryReads ?? []) as ExecutionLogEntry['memoryReads'],
    memoryWrites: (r.memoryWrites ?? []) as ExecutionLogEntry['memoryWrites'], taskId: r.taskId ?? undefined, createdAt: iso(r.createdAt),
  };
}

const JOB_COLS = ['name', 'type', 'extensionName', 'instanceId', 'actionId', 'coreHandler', 'cron', 'enabled', 'input', 'lastRunAt', 'lastRunResult', 'lastRunError', 'lastRunDurationMs', 'nextRunAt', 'ownerScope', 'agentName', 'agentGaii', 'createdByAgent', 'displayName', 'description', 'purpose', 'timezone', 'constraints', 'runCount'] as const;
const DATE_FIELDS = new Set(['lastRunAt', 'nextRunAt', 'createdAt', 'updatedAt']);
const JSON_FIELDS = new Set(['input', 'constraints']);

export const scheduleMethods = {
  async createScheduledJob(this: PostgresKyselyStorage, r: ScheduledJobRecord): Promise<ScheduledJobRecord> {
    await this.db.insertInto('ScheduledJob').values({
      id: r.id, name: r.name, type: r.type, extensionName: r.extensionName ?? null, instanceId: r.instanceId ?? null,
      actionId: r.actionId ?? null, coreHandler: r.coreHandler ?? null, cron: r.cron, enabled: r.enabled, input: jsonb(r.input ?? null),
      lastRunAt: r.lastRunAt ? new Date(r.lastRunAt) : null, lastRunResult: r.lastRunResult ?? null, lastRunError: r.lastRunError ?? null,
      lastRunDurationMs: r.lastRunDurationMs ?? null, nextRunAt: r.nextRunAt ? new Date(r.nextRunAt) : null, createdBy: r.createdBy,
      createdAt: new Date(r.createdAt), updatedAt: new Date(r.updatedAt), ownerScope: r.ownerScope ?? null, agentName: r.agentName ?? null,
      agentGaii: r.agentGaii ?? null, createdByAgent: r.createdByAgent ?? false, displayName: r.displayName ?? null, description: r.description ?? null,
      purpose: r.purpose ?? null, timezone: r.timezone ?? null, constraints: jsonb(r.constraints ?? null), runCount: r.runCount ?? 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
    return r;
  },
  async getScheduledJob(this: PostgresKyselyStorage, id: string): Promise<ScheduledJobRecord | null> {
    const r = await this.db.selectFrom('ScheduledJob').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toJob(r) : null;
  },
  async listScheduledJobs(this: PostgresKyselyStorage, filter?: { type?: string; extensionName?: string; enabled?: boolean; ownerScope?: string; agentGaii?: string }): Promise<ScheduledJobRecord[]> {
    let q = this.db.selectFrom('ScheduledJob').selectAll();
    if (filter?.type !== undefined) q = q.where('type', '=', filter.type);
    if (filter?.extensionName !== undefined) q = q.where('extensionName', '=', filter.extensionName);
    if (filter?.enabled !== undefined) q = q.where('enabled', '=', filter.enabled);
    if (filter?.ownerScope !== undefined) q = q.where('ownerScope', '=', filter.ownerScope);
    if (filter?.agentGaii !== undefined) q = q.where('agentGaii', '=', filter.agentGaii);
    return (await q.execute()).map(toJob);
  },
  async updateScheduledJob(this: PostgresKyselyStorage, id: string, updates: Partial<ScheduledJobRecord>): Promise<ScheduledJobRecord | null> {
    const data: Record<string, unknown> = {};
    for (const k of JOB_COLS) {
      const v = (updates as Record<string, unknown>)[k];
      if (v === undefined) continue;
      if (JSON_FIELDS.has(k)) data[k] = jsonb(v ?? null);
      else if (DATE_FIELDS.has(k)) data[k] = v ? new Date(v as string) : null;
      else data[k] = v;
    }
    data.updatedAt = new Date();
    const rows = await this.db.updateTable('ScheduledJob').set(data as never).where('id', '=', id).returningAll().execute();
    return rows[0] ? toJob(rows[0]) : null;
  },
  async deleteScheduledJob(this: PostgresKyselyStorage, id: string): Promise<boolean> {
    const r = await this.db.deleteFrom('ScheduledJob').where('id', '=', id).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  async createExecutionLog(this: PostgresKyselyStorage, entry: ExecutionLogEntry): Promise<ExecutionLogEntry> {
    await this.db.insertInto('ExecutionLog').values({
      id: entry.id, jobId: entry.jobId, jobName: entry.jobName, type: entry.type, extensionName: entry.extensionName ?? null,
      actionId: entry.actionId ?? null, trigger: entry.trigger, result: entry.result, errorMessage: entry.errorMessage ?? null,
      durationMs: entry.durationMs, memoryReads: jsonb(entry.memoryReads ?? []), memoryWrites: jsonb(entry.memoryWrites ?? []),
      taskId: entry.taskId ?? null, createdAt: new Date(entry.createdAt),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
    return entry;
  },
  async listExecutionLogs(this: PostgresKyselyStorage, filter?: { jobId?: string; extensionName?: string; trigger?: string; result?: string; limit?: number; offset?: number }): Promise<ExecutionLogEntry[]> {
    let q = this.db.selectFrom('ExecutionLog').selectAll();
    if (filter?.jobId) q = q.where('jobId', '=', filter.jobId);
    if (filter?.extensionName) q = q.where('extensionName', '=', filter.extensionName);
    if (filter?.trigger) q = q.where('trigger', '=', filter.trigger);
    if (filter?.result) q = q.where('result', '=', filter.result);
    const rows = await q.orderBy('createdAt', 'desc').limit(filter?.limit ?? 100).offset(filter?.offset ?? 0).execute();
    return rows.map(toLog);
  },
  async countExecutionLogs(this: PostgresKyselyStorage, filter?: { jobId?: string; extensionName?: string; trigger?: string; result?: string }): Promise<number> {
    let q = this.db.selectFrom('ExecutionLog').select(sql<number>`count(*)`.as('n'));
    if (filter?.jobId) q = q.where('jobId', '=', filter.jobId);
    if (filter?.extensionName) q = q.where('extensionName', '=', filter.extensionName);
    if (filter?.trigger) q = q.where('trigger', '=', filter.trigger);
    if (filter?.result) q = q.where('result', '=', filter.result);
    const r = await q.executeTakeFirst();
    return Number(r?.n ?? 0);
  },
  async pruneExecutionLogs(this: PostgresKyselyStorage, beforeDate: string): Promise<number> {
    const r = await this.db.deleteFrom('ExecutionLog').where('createdAt', '<', new Date(beforeDate)).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
};
