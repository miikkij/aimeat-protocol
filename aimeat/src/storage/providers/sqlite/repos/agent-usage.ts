/**
 * @file agent-usage.ts
 * @description SQLite implementation of the agent LLM usage ledger (LEDGER / TARGET-016):
 *   append-only usage events + upsert-incremented daily aggregates, plus owner-scoped reads.
 * @version-history
 *   v1.0.0 -- 2026-07-10 -- Initial creation for LEDGER TARGET-016 substrate
 */

import type Database from 'better-sqlite3';
import type {
  AgentUsageEvent,
  AgentUsageDailyRecord,
  UsageDailyFilter,
  UsageEventFilter,
  AdminUsageDailyFilter,
} from '../../../interface.js';

// ── Deserializers ──

function deserializeEvent(row: Record<string, unknown>): AgentUsageEvent {
  return {
    id: row.id as string,
    ts: row.ts as string,
    agentGaii: row.agentGaii as string,
    ownerGhii: row.ownerGhii as string,
    runId: (row.runId as string | null) ?? undefined,
    model: row.model as string,
    provider: row.provider as string,
    promptTokens: row.promptTokens as number,
    completionTokens: row.completionTokens as number,
    costUsd: row.costUsd === null || row.costUsd === undefined ? null : (row.costUsd as number),
    priceRef: (row.priceRef as string | null) ?? null,
    source: row.source as string,
    apiKeyScope: (row.apiKeyScope as 'own' | 'node'),
    organismId: (row.organismId as string | null) ?? undefined,
    workspaceId: (row.workspaceId as string | null) ?? undefined,
    capabilityId: (row.capabilityId as string | null) ?? undefined,
    consumerGhii: (row.consumerGhii as string | null) ?? undefined,
    provenanceId: (row.provenanceId as string | null) ?? undefined,
  };
}

function deserializeDaily(row: Record<string, unknown>): AgentUsageDailyRecord {
  return {
    date: row.date as string,
    agentGaii: row.agentGaii as string,
    ownerGhii: row.ownerGhii as string,
    apiKeyScope: row.apiKeyScope as string,
    model: row.model as string,
    provider: row.provider as string,
    organismId: (row.organismId as string) ?? '',
    workspaceId: (row.workspaceId as string) ?? '',
    promptTokens: row.promptTokens as number,
    completionTokens: row.completionTokens as number,
    costUsd: row.costUsd as number,
    calls: row.calls as number,
    unpricedCalls: row.unpricedCalls as number,
  };
}

// ── Writes ──

export function appendUsageEvent(db: Database.Database, e: AgentUsageEvent): void {
  db.prepare(
    `INSERT INTO agent_usage_event
       (id, ts, agentGaii, ownerGhii, runId, model, provider, promptTokens,
        completionTokens, costUsd, priceRef, source, apiKeyScope,
        organismId, workspaceId, capabilityId, consumerGhii, provenanceId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    e.id,
    e.ts,
    e.agentGaii,
    e.ownerGhii,
    e.runId ?? null,
    e.model,
    e.provider,
    e.promptTokens,
    e.completionTokens,
    e.costUsd,
    e.priceRef,
    e.source,
    e.apiKeyScope,
    e.organismId ?? null,
    e.workspaceId ?? null,
    e.capabilityId ?? null,
    e.consumerGhii ?? null,
    e.provenanceId ?? null,
  );
}

export function incrementUsageDaily(db: Database.Database, d: AgentUsageDailyRecord): void {
  db.prepare(
    `INSERT INTO agent_usage_daily
       (date, agentGaii, ownerGhii, apiKeyScope, model, provider, organismId, workspaceId,
        promptTokens, completionTokens, costUsd, calls, unpricedCalls)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date, agentGaii, ownerGhii, apiKeyScope, model, provider, organismId, workspaceId)
     DO UPDATE SET
       promptTokens     = agent_usage_daily.promptTokens + excluded.promptTokens,
       completionTokens = agent_usage_daily.completionTokens + excluded.completionTokens,
       costUsd          = agent_usage_daily.costUsd + excluded.costUsd,
       calls            = agent_usage_daily.calls + excluded.calls,
       unpricedCalls    = agent_usage_daily.unpricedCalls + excluded.unpricedCalls`
  ).run(
    d.date,
    d.agentGaii,
    d.ownerGhii,
    d.apiKeyScope,
    d.model,
    d.provider,
    d.organismId,
    d.workspaceId,
    d.promptTokens,
    d.completionTokens,
    d.costUsd,
    d.calls,
    d.unpricedCalls,
  );
}

// ── Reads ──

export function queryUsageDaily(db: Database.Database, filter: UsageDailyFilter): AgentUsageDailyRecord[] {
  const clauses: string[] = ['ownerGhii = ?'];
  const params: unknown[] = [filter.ownerGhii];
  if (filter.agentGaii) { clauses.push('agentGaii = ?'); params.push(filter.agentGaii); }
  if (filter.organismId !== undefined) { clauses.push('organismId = ?'); params.push(filter.organismId); }
  if (filter.workspaceId !== undefined) { clauses.push('workspaceId = ?'); params.push(filter.workspaceId); }
  if (filter.from) { clauses.push('date >= ?'); params.push(filter.from); }
  if (filter.to) { clauses.push('date <= ?'); params.push(filter.to); }

  const rows = db.prepare(
    `SELECT * FROM agent_usage_daily
     WHERE ${clauses.join(' AND ')}
     ORDER BY date ASC`
  ).all(...params) as Record<string, unknown>[];
  return rows.map(deserializeDaily);
}

/**
 * OPERATOR-ONLY: daily aggregates across ALL owners in a date range — no ownerGhii clause.
 * The route must gate this on the operator role (see GET /v1/admin/ledger).
 */
export function queryUsageDailyAllOwners(db: Database.Database, filter: AdminUsageDailyFilter): AgentUsageDailyRecord[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.from) { clauses.push('date >= ?'); params.push(filter.from); }
  if (filter.to) { clauses.push('date <= ?'); params.push(filter.to); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = db.prepare(
    `SELECT * FROM agent_usage_daily
     ${where}
     ORDER BY date ASC`
  ).all(...params) as Record<string, unknown>[];
  return rows.map(deserializeDaily);
}

export function listUsageEvents(db: Database.Database, filter: UsageEventFilter): AgentUsageEvent[] {
  const clauses: string[] = ['ownerGhii = ?'];
  const params: unknown[] = [filter.ownerGhii];
  if (filter.agentGaii) { clauses.push('agentGaii = ?'); params.push(filter.agentGaii); }
  if (filter.runId) { clauses.push('runId = ?'); params.push(filter.runId); }
  if (filter.capabilityId) { clauses.push('capabilityId = ?'); params.push(filter.capabilityId); }
  if (filter.hasCapability) { clauses.push("capabilityId IS NOT NULL AND capabilityId != ''"); }
  if (filter.from) { clauses.push('ts >= ?'); params.push(filter.from); }
  if (filter.to) { clauses.push('ts <= ?'); params.push(filter.to); }
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 1000);

  const rows = db.prepare(
    `SELECT * FROM agent_usage_event
     WHERE ${clauses.join(' AND ')}
     ORDER BY ts DESC
     LIMIT ?`
  ).all(...params, limit) as Record<string, unknown>[];
  return rows.map(deserializeEvent);
}
