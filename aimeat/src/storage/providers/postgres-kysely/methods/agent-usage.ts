/**
 * @file src/storage/providers/postgres-kysely/methods/agent-usage.ts
 * @description Agent LLM usage ledger (LEDGER / TARGET-016) for the Postgres+Kysely backend:
 *   append-only per-call events (AgentUsageEvent, the billing-audit source of truth) plus the
 *   upsert-incremented daily rollup (AgentUsageDaily) the UI reads. Translated 1:1 from the Prisma
 *   implementation; the `incrementUsageDaily` upsert ADDS deltas onto the existing daily row on
 *   conflict (composite unique key), mirroring Prisma's `{ increment }` semantics. Both `ts` and
 *   `date` are plain string columns and pass through untouched.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: agent-usage ledger on Postgres+Kysely.
 */
import { randomUUID } from 'node:crypto';
import { sql, type Selectable } from 'kysely';
import type {
  AgentUsageEvent,
  AgentUsageDailyRecord,
  UsageDailyFilter,
  UsageEventFilter,
  AdminUsageDailyFilter,
} from '../../../interface.js';
import type { AgentUsageDaily, AgentUsageEvent as AgentUsageEventRow } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';

function toDaily(r: Selectable<AgentUsageDaily>): AgentUsageDailyRecord {
  return {
    date: r.date,
    agentGaii: r.agentGaii,
    ownerGhii: r.ownerGhii,
    apiKeyScope: r.apiKeyScope,
    model: r.model,
    provider: r.provider,
    organismId: r.organismId ?? '',
    workspaceId: r.workspaceId ?? '',
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    costUsd: r.costUsd,
    calls: r.calls,
    unpricedCalls: r.unpricedCalls,
  };
}

function toEvent(r: Selectable<AgentUsageEventRow>): AgentUsageEvent {
  return {
    id: r.id,
    ts: r.ts,
    agentGaii: r.agentGaii,
    ownerGhii: r.ownerGhii,
    runId: r.runId ?? undefined,
    model: r.model,
    provider: r.provider,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    costUsd: r.costUsd == null ? null : r.costUsd,
    priceRef: r.priceRef ?? null,
    source: r.source,
    apiKeyScope: r.apiKeyScope as 'own' | 'node',
    organismId: r.organismId ?? undefined,
    workspaceId: r.workspaceId ?? undefined,
    capabilityId: r.capabilityId ?? undefined,
    consumerGhii: r.consumerGhii ?? undefined,
    provenanceId: r.provenanceId ?? undefined,
    appId: r.appId ?? '',
    surface: r.surface ?? '',
  };
}

export const agentUsageMethods = {
  async appendUsageEvent(this: PostgresKyselyStorage, event: AgentUsageEvent): Promise<void> {
    await this.db.insertInto('AgentUsageEvent').values({
      id: event.id,
      ts: event.ts,
      agentGaii: event.agentGaii,
      ownerGhii: event.ownerGhii,
      runId: event.runId ?? null,
      model: event.model,
      provider: event.provider,
      promptTokens: event.promptTokens,
      completionTokens: event.completionTokens,
      costUsd: event.costUsd,
      priceRef: event.priceRef,
      source: event.source,
      apiKeyScope: event.apiKeyScope,
      organismId: event.organismId ?? null,
      workspaceId: event.workspaceId ?? null,
      capabilityId: event.capabilityId ?? null,
      consumerGhii: event.consumerGhii ?? null,
      provenanceId: event.provenanceId ?? null,
      appId: event.appId ?? '',
      surface: event.surface ?? '',
    }).execute();
  },

  async incrementUsageDaily(this: PostgresKyselyStorage, d: AgentUsageDailyRecord): Promise<void> {
    // Upsert-ADD: insert a fresh row, or on the composite-unique conflict accumulate the deltas
    // onto the existing row (mirrors Prisma `{ increment }`), never overwriting the running totals.
    await this.db.insertInto('AgentUsageDaily').values({
      id: randomUUID(),
      date: d.date,
      agentGaii: d.agentGaii,
      ownerGhii: d.ownerGhii,
      apiKeyScope: d.apiKeyScope,
      model: d.model,
      provider: d.provider,
      organismId: d.organismId,
      workspaceId: d.workspaceId,
      promptTokens: d.promptTokens,
      completionTokens: d.completionTokens,
      costUsd: d.costUsd,
      calls: d.calls,
      unpricedCalls: d.unpricedCalls,
    }).onConflict((oc) => oc
      .columns(['date', 'agentGaii', 'ownerGhii', 'apiKeyScope', 'model', 'provider', 'organismId', 'workspaceId'])
      .doUpdateSet({
        promptTokens: sql`"AgentUsageDaily"."promptTokens" + ${d.promptTokens}`,
        completionTokens: sql`"AgentUsageDaily"."completionTokens" + ${d.completionTokens}`,
        costUsd: sql`"AgentUsageDaily"."costUsd" + ${d.costUsd}`,
        calls: sql`"AgentUsageDaily"."calls" + ${d.calls}`,
        unpricedCalls: sql`"AgentUsageDaily"."unpricedCalls" + ${d.unpricedCalls}`,
      })).execute();
  },

  async queryUsageDaily(this: PostgresKyselyStorage, filter: UsageDailyFilter): Promise<AgentUsageDailyRecord[]> {
    let q = this.db.selectFrom('AgentUsageDaily').selectAll().where('ownerGhii', '=', filter.ownerGhii);
    if (filter.agentGaii) q = q.where('agentGaii', '=', filter.agentGaii);
    if (filter.organismId !== undefined) q = q.where('organismId', '=', filter.organismId);
    if (filter.workspaceId !== undefined) q = q.where('workspaceId', '=', filter.workspaceId);
    if (filter.from) q = q.where('date', '>=', filter.from);
    if (filter.to) q = q.where('date', '<=', filter.to);
    const rows = await q.orderBy('date', 'asc').execute();
    return rows.map(toDaily);
  },

  async queryUsageDailyAllOwners(this: PostgresKyselyStorage, filter: AdminUsageDailyFilter): Promise<AgentUsageDailyRecord[]> {
    // OPERATOR-ONLY: no ownerGhii filter — the calling route gates on the operator role.
    let q = this.db.selectFrom('AgentUsageDaily').selectAll();
    if (filter.from) q = q.where('date', '>=', filter.from);
    if (filter.to) q = q.where('date', '<=', filter.to);
    const rows = await q.orderBy('date', 'asc').execute();
    return rows.map(toDaily);
  },

  async listUsageEvents(this: PostgresKyselyStorage, filter: UsageEventFilter): Promise<AgentUsageEvent[]> {
    let q = this.db.selectFrom('AgentUsageEvent').selectAll().where('ownerGhii', '=', filter.ownerGhii);
    if (filter.agentGaii) q = q.where('agentGaii', '=', filter.agentGaii);
    if (filter.runId) q = q.where('runId', '=', filter.runId);
    if (filter.capabilityId) q = q.where('capabilityId', '=', filter.capabilityId);
    if (filter.hasCapability) q = q.where('capabilityId', 'is not', null);
    if (filter.from) q = q.where('ts', '>=', filter.from);
    if (filter.to) q = q.where('ts', '<=', filter.to);
    const limit = Math.min(Math.max(filter.limit ?? 200, 1), 1000);
    const rows = await q.orderBy('ts', 'desc').limit(limit).execute();
    return rows.map(toEvent);
  },
};
