/**
 * @file src/storage/providers/postgres-kysely/methods/agent-misc.ts
 * @description Four small agent-support domains for the Postgres+Kysely backend, grouped into one
 *   module: agent directives + owner defaults (AgentDirective / OwnerAgentDefault), agent activity
 *   counters (AgentActivity — an upsert-accumulate on the [agentGaii,date,hour,metric] unique key),
 *   telemetry + webhook delivery logs (TelemetryEvent / WebhookDeliveryLog), and sharing groups
 *   (SharingGroup). Translated 1:1 from the Prisma (Mongo) implementations; the accumulate mirrors
 *   Prisma `{ increment }` and countEntriesReferencingGroup sums Memory + StorageFile rows carrying
 *   the group id — identical to the Prisma count.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: agent directives/activity/webhook/sharing-group on Postgres+Kysely.
 */
import { sql, type Selectable } from 'kysely';
import type {
  AgentActivityRecord,
  AgentDirectivesRecord,
  OwnerAgentDefaults,
  SharingGroupRecord,
  TelemetryEvent,
  WebhookDeliveryLog,
} from '../../../interface.js';
import type {
  AgentActivity,
  AgentDirective,
  OwnerAgentDefault,
  SharingGroup,
  TelemetryEvent as TelemetryEventRow,
  WebhookDeliveryLog as WebhookDeliveryLogRow,
} from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();

// ── Mappers ──

function toDirectivesRecord(r: Selectable<AgentDirective>): AgentDirectivesRecord {
  const record: AgentDirectivesRecord = {
    agentGaii: r.agentGaii,
    purpose: r.purpose,
    rules: r.rules as unknown as AgentDirectivesRecord['rules'],
    memoryAreas: r.memoryAreas as unknown as AgentDirectivesRecord['memoryAreas'],
    resources: r.resources as unknown as AgentDirectivesRecord['resources'],
    updatedAt: iso(r.updatedAt),
  };
  if (r.budgetLimits) record.budgetLimits = r.budgetLimits as unknown as AgentDirectivesRecord['budgetLimits'];
  return record;
}

function toOwnerDefaultsRecord(r: Selectable<OwnerAgentDefault>): OwnerAgentDefaults {
  const record: OwnerAgentDefaults = {
    ownerGaii: r.ownerGaii,
    rules: r.rules as unknown as OwnerAgentDefaults['rules'],
    updatedAt: iso(r.updatedAt),
  };
  if (r.defaultTokenBudget != null) record.defaultTokenBudget = r.defaultTokenBudget;
  if (r.defaultMemoryAreas) record.defaultMemoryAreas = r.defaultMemoryAreas as unknown as OwnerAgentDefaults['defaultMemoryAreas'];
  return record;
}

function toActivityRecord(r: Selectable<AgentActivity>): AgentActivityRecord {
  return { agentGaii: r.agentGaii, date: r.date, hour: r.hour, metric: r.metric, value: r.value };
}

function toSharingGroupRecord(r: Selectable<SharingGroup>): SharingGroupRecord {
  const record: SharingGroupRecord = {
    id: r.id,
    name: r.name,
    ownerGaii: r.ownerGaii,
    members: r.members as unknown as SharingGroupRecord['members'],
    defaultPermissions: r.defaultPermissions as unknown as SharingGroupRecord['defaultPermissions'],
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
  if (r.description) record.description = r.description;
  return record;
}

function toTelemetryEvent(r: Selectable<TelemetryEventRow>): TelemetryEvent {
  const event: TelemetryEvent = {
    id: r.id,
    agentGaii: r.agentGaii,
    type: r.type as TelemetryEvent['type'],
    data: r.data as Record<string, unknown>,
    createdAt: iso(r.createdAt),
  };
  if (r.sessionId != null) event.sessionId = r.sessionId;
  if (r.taskId != null) event.taskId = r.taskId;
  return event;
}

function toDeliveryLog(r: Selectable<WebhookDeliveryLogRow>): WebhookDeliveryLog {
  const log: WebhookDeliveryLog = {
    id: r.id,
    agentGaii: r.agentGaii,
    event: r.event,
    payload: r.payload as Record<string, unknown>,
    status: r.status as WebhookDeliveryLog['status'],
    attemptCount: r.attemptCount,
    latencyMs: r.latencyMs,
    createdAt: iso(r.createdAt),
  };
  if (r.httpStatus != null) log.httpStatus = r.httpStatus;
  if (r.errorMessage != null) log.errorMessage = r.errorMessage;
  return log;
}

// ── 1. Agent Directives + Owner Defaults (AgentDirective / OwnerAgentDefault) ──

export const agentDirectiveMethods = {
  async getAgentDirectives(this: PostgresKyselyStorage, agentGaii: string): Promise<AgentDirectivesRecord | null> {
    const r = await this.db.selectFrom('AgentDirective').selectAll().where('agentGaii', '=', agentGaii).executeTakeFirst();
    return r ? toDirectivesRecord(r) : null;
  },

  async upsertAgentDirectives(this: PostgresKyselyStorage, record: AgentDirectivesRecord): Promise<AgentDirectivesRecord> {
    await this.db.insertInto('AgentDirective').values({
      agentGaii: record.agentGaii,
      purpose: record.purpose,
      rules: jsonb(record.rules),
      memoryAreas: jsonb(record.memoryAreas),
      resources: jsonb(record.resources),
      budgetLimits: jsonb(record.budgetLimits ?? null),
      updatedAt: new Date(record.updatedAt),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).onConflict(oc => oc.column('agentGaii').doUpdateSet({
      purpose: record.purpose,
      rules: jsonb(record.rules),
      memoryAreas: jsonb(record.memoryAreas),
      resources: jsonb(record.resources),
      budgetLimits: jsonb(record.budgetLimits ?? null),
      updatedAt: new Date(record.updatedAt),
    } as never)).execute();
    return record;
  },

  async deleteAgentDirectives(this: PostgresKyselyStorage, agentGaii: string): Promise<boolean> {
    const r = await this.db.deleteFrom('AgentDirective').where('agentGaii', '=', agentGaii).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  async getOwnerAgentDefaults(this: PostgresKyselyStorage, ownerGaii: string): Promise<OwnerAgentDefaults | null> {
    const r = await this.db.selectFrom('OwnerAgentDefault').selectAll().where('ownerGaii', '=', ownerGaii).executeTakeFirst();
    return r ? toOwnerDefaultsRecord(r) : null;
  },

  async upsertOwnerAgentDefaults(this: PostgresKyselyStorage, record: OwnerAgentDefaults): Promise<OwnerAgentDefaults> {
    await this.db.insertInto('OwnerAgentDefault').values({
      ownerGaii: record.ownerGaii,
      rules: jsonb(record.rules),
      defaultTokenBudget: record.defaultTokenBudget ?? null,
      defaultMemoryAreas: jsonb(record.defaultMemoryAreas ?? []),
      updatedAt: new Date(record.updatedAt),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).onConflict(oc => oc.column('ownerGaii').doUpdateSet({
      rules: jsonb(record.rules),
      defaultTokenBudget: record.defaultTokenBudget ?? null,
      defaultMemoryAreas: jsonb(record.defaultMemoryAreas ?? []),
      updatedAt: new Date(record.updatedAt),
    } as never)).execute();
    return record;
  },
};

// ── 2. Agent Activity (AgentActivity — upsert-accumulate on [agentGaii,date,hour,metric]) ──

export const agentActivityMethods = {
  async recordActivity(this: PostgresKyselyStorage, record: AgentActivityRecord): Promise<void> {
    // Upsert-ADD: fresh row, or on the composite-unique conflict accumulate the delta onto the
    // existing counter (mirrors Prisma `{ increment }`), never overwriting the running value.
    await this.db.insertInto('AgentActivity').values({
      agentGaii: record.agentGaii,
      date: record.date,
      hour: record.hour,
      metric: record.metric,
      value: record.value,
    }).onConflict(oc => oc
      .columns(['agentGaii', 'date', 'hour', 'metric'])
      .doUpdateSet({ value: sql`"AgentActivity"."value" + ${record.value}` })).execute();
  },

  async getActivityHistory(this: PostgresKyselyStorage, agentGaii: string, opts?: { days?: number; granularity?: 'daily' | 'hourly' }): Promise<AgentActivityRecord[]> {
    const days = opts?.days ?? 30;
    const granularity = opts?.granularity ?? 'daily';
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    if (granularity === 'daily') {
      const rows = await this.db.selectFrom('AgentActivity')
        .select(['agentGaii', 'date', 'metric'])
        .select(sql<number>`SUM("value")::int`.as('value'))
        .where('agentGaii', '=', agentGaii)
        .where('date', '>=', cutoffStr)
        .groupBy(['agentGaii', 'date', 'metric'])
        .orderBy('date', 'asc')
        .execute();
      return rows.map(r => ({ agentGaii: r.agentGaii, date: r.date, hour: 0, metric: r.metric, value: Number(r.value) }));
    }

    // hourly granularity
    const rows = await this.db.selectFrom('AgentActivity').selectAll()
      .where('agentGaii', '=', agentGaii)
      .where('date', '>=', cutoffStr)
      .orderBy('date', 'asc')
      .orderBy('hour', 'asc')
      .execute();
    return rows.map(toActivityRecord);
  },
};

// ── 3. Telemetry + Webhook Delivery Log (TelemetryEvent / WebhookDeliveryLog) ──

export const agentWebhookMethods = {
  async appendTelemetry(this: PostgresKyselyStorage, event: TelemetryEvent): Promise<void> {
    await this.db.insertInto('TelemetryEvent').values({
      id: event.id,
      agentGaii: event.agentGaii,
      type: event.type,
      data: jsonb(event.data),
      sessionId: event.sessionId ?? null,
      taskId: event.taskId ?? null,
      createdAt: new Date(event.createdAt),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
  },

  async listTelemetry(this: PostgresKyselyStorage, agentGaii: string, opts: { since?: string; type?: string; limit?: number }): Promise<TelemetryEvent[]> {
    let q = this.db.selectFrom('TelemetryEvent').selectAll().where('agentGaii', '=', agentGaii);
    if (opts.type) q = q.where('type', '=', opts.type);
    if (opts.since) q = q.where('createdAt', '>', new Date(opts.since));
    const rows = await q.orderBy('createdAt', 'desc').limit(opts.limit ?? 50).execute();
    return rows.map(toTelemetryEvent);
  },

  async appendDeliveryLog(this: PostgresKyselyStorage, log: WebhookDeliveryLog): Promise<void> {
    await this.db.insertInto('WebhookDeliveryLog').values({
      id: log.id,
      agentGaii: log.agentGaii,
      event: log.event,
      payload: jsonb(log.payload),
      status: log.status,
      httpStatus: log.httpStatus ?? null,
      errorMessage: log.errorMessage ?? null,
      attemptCount: log.attemptCount,
      latencyMs: log.latencyMs,
      createdAt: new Date(log.createdAt),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
  },

  async listDeliveryLog(this: PostgresKyselyStorage, agentGaii: string, limit?: number): Promise<WebhookDeliveryLog[]> {
    const rows = await this.db.selectFrom('WebhookDeliveryLog').selectAll()
      .where('agentGaii', '=', agentGaii).orderBy('createdAt', 'desc').limit(limit ?? 50).execute();
    return rows.map(toDeliveryLog);
  },

  async pruneDeliveryLog(this: PostgresKyselyStorage, agentGaii: string, keepCount: number): Promise<number> {
    // Cutoff = the keepCount-th newest row's createdAt; delete everything at or older than it.
    const cutoffRows = await this.db.selectFrom('WebhookDeliveryLog').select('createdAt')
      .where('agentGaii', '=', agentGaii).orderBy('createdAt', 'desc').limit(1).offset(keepCount).execute();
    if (cutoffRows.length === 0) return 0;
    const cutoff = cutoffRows[0].createdAt;
    const r = await this.db.deleteFrom('WebhookDeliveryLog')
      .where('agentGaii', '=', agentGaii).where('createdAt', '<=', cutoff).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
};

// ── 4. Sharing Groups (SharingGroup) ──

export const sharingGroupMethods = {
  async createSharingGroup(this: PostgresKyselyStorage, record: SharingGroupRecord): Promise<SharingGroupRecord> {
    await this.db.insertInto('SharingGroup').values({
      id: record.id,
      name: record.name,
      description: record.description ?? null,
      ownerGaii: record.ownerGaii,
      members: jsonb(record.members),
      defaultPermissions: jsonb(record.defaultPermissions),
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
    return record;
  },

  async getSharingGroup(this: PostgresKyselyStorage, id: string): Promise<SharingGroupRecord | null> {
    const r = await this.db.selectFrom('SharingGroup').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toSharingGroupRecord(r) : null;
  },

  async listSharingGroups(this: PostgresKyselyStorage, ownerGaii: string): Promise<SharingGroupRecord[]> {
    const rows = await this.db.selectFrom('SharingGroup').selectAll()
      .where('ownerGaii', '=', ownerGaii).orderBy('createdAt', 'desc').execute();
    return rows.map(toSharingGroupRecord);
  },

  async listSharingGroupsByMember(this: PostgresKyselyStorage, identifier: string): Promise<SharingGroupRecord[]> {
    // JSON member arrays aren't filtered in SQL (parity with Mongo) — load all, filter in memory.
    const rows = await this.db.selectFrom('SharingGroup').selectAll().execute();
    return rows
      .filter(r => {
        const members = r.members as unknown as Array<{ identifier: string }>;
        return Array.isArray(members) && members.some(m => m.identifier === identifier);
      })
      .map(toSharingGroupRecord);
  },

  async updateSharingGroup(this: PostgresKyselyStorage, id: string, updates: Partial<SharingGroupRecord>): Promise<SharingGroupRecord | null> {
    const existing = await this.getSharingGroup(id);
    if (!existing) return null;
    const merged: SharingGroupRecord = {
      ...existing,
      ...updates,
      id: existing.id,
      ownerGaii: existing.ownerGaii,
      createdAt: existing.createdAt,
    };
    const rows = await this.db.updateTable('SharingGroup').set({
      name: merged.name,
      description: merged.description ?? null,
      members: jsonb(merged.members),
      defaultPermissions: jsonb(merged.defaultPermissions),
      updatedAt: new Date(),
    } as never).where('id', '=', id).returningAll().execute();
    return rows[0] ? toSharingGroupRecord(rows[0]) : null;
  },

  async deleteSharingGroup(this: PostgresKyselyStorage, id: string): Promise<boolean> {
    const r = await this.db.deleteFrom('SharingGroup').where('id', '=', id).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  async countEntriesReferencingGroup(this: PostgresKyselyStorage, groupId: string): Promise<number> {
    // Both Memory rows and StorageFile rows can carry a group id — sum both (matches Prisma).
    const [mem, file] = await Promise.all([
      this.db.selectFrom('Memory').select(eb => eb.fn.countAll().as('c')).where('groupId', '=', groupId).executeTakeFirst(),
      this.db.selectFrom('StorageFile').select(eb => eb.fn.countAll().as('c')).where('groupId', '=', groupId).executeTakeFirst(),
    ]);
    return Number(mem?.c ?? 0) + Number(file?.c ?? 0);
  },
};
