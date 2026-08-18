/**
 * @file usage-metering.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Records one agent LLM call into the usage ledger (LEDGER / TARGET-016):
 *   prices it (llm-pricing), writes the append-only event (source of truth), increments
 *   the daily rollup (derived), and emits the `agent-usage` SSE domain so FLEET updates
 *   without polling. This is the single choke point every ingest path routes through, so
 *   cost locking + price_ref stamping happen in exactly one place.
 * @structure
 *   - recordUsageEvent(storage, input) -- price + persist + rollup + emit; returns the event
 *   - extractUsageFields(data)          -- pull ledger fields from a telemetry llm_call payload
 * @usage
 *   import { recordUsageEvent } from '../services/usage-metering.js';
 * @version-history
 *   v1.0.0 -- 2026-07-10 -- Initial creation for LEDGER TARGET-016 substrate
 *   v1.2.0 -- 2026-08-01 -- Optional provenanceId on a usage event (TARGET-058): a spend can be
 *     joined to the content it produced. Optional, so no existing ingest path changes.
 *   v1.1.0 -- 2026-07-11 -- After recording, re-evaluate the owner's budget (TARGET-017 alerts)
 */

import { randomUUID } from 'node:crypto';
import type { Storage, AgentUsageEvent } from '../storage/interface.js';
import { priceUsd } from './llm-pricing.js';
import { emitChange } from './event-bus.js';
import { evaluateBudgetAlerts } from './ledger-budget-alerts.js';
import { logger } from '../utils/logger.js';

export interface UsageEventInput {
  /** Who consumed — full GAII (or GHII for owner-direct calls). */
  agentGaii: string;
  /** Whose account pays. */
  ownerGhii: string;
  model: string;
  /** anthropic | openai | openrouter | local | ... (defaults to 'unknown'). */
  provider?: string;
  promptTokens?: number;
  completionTokens?: number;
  /** Authoritative provider-reported cost (e.g. OpenRouter usage.cost); wins over the table. */
  providerCostUsd?: number | null;
  runId?: string;
  /** Ingest source label: crewaimeat | ai-complete | ... */
  source: string;
  /** self-host (own key) vs hosted (node key) — defaults to 'own'. */
  apiKeyScope?: 'own' | 'node';
  organismId?: string;
  workspaceId?: string;
  capabilityId?: string;
  /** The GHII that invoked a capability (consumer) — TARGET-018 double-entry. */
  consumerGhii?: string;
  /** The AI provenance record this call produced (TARGET-058), so a spend can be joined to what it
   *  made. Optional — every existing caller keeps working without it. */
  provenanceId?: string;
  /** Which app spent this, as `owner/filename`. Empty for an agent's own call. */
  appId?: string;
  /** Which door the spend came through: 'app', 'mcp', 'schedule', ''. Matches UsageCall.surface. */
  surface?: string;
  /** Override the record timestamp (defaults to now). */
  ts?: string;
}

function nonNegInt(v: unknown): number {
  return typeof v === 'number' && isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

/**
 * Record one LLM call. Appends the immutable event first (billing source of truth); if that
 * succeeds, increments the daily rollup (rebuildable from raw, so a rollup failure is logged
 * but non-fatal). Throws if the raw append fails, so the ingest caller can decide how to
 * surface it. Emits `agent-usage` scoped to the owner on success.
 */
export async function recordUsageEvent(storage: Storage, input: UsageEventInput): Promise<AgentUsageEvent> {
  const ts = input.ts ?? new Date().toISOString();
  const provider = input.provider && input.provider.trim() ? input.provider.trim() : 'unknown';
  const promptTokens = nonNegInt(input.promptTokens);
  const completionTokens = nonNegInt(input.completionTokens);

  const { costUsd, priceRef } = priceUsd({
    model: input.model,
    provider,
    promptTokens,
    completionTokens,
    providerCostUsd: input.providerCostUsd,
  });

  const event: AgentUsageEvent = {
    id: randomUUID(),
    ts,
    agentGaii: input.agentGaii,
    ownerGhii: input.ownerGhii,
    runId: input.runId,
    model: input.model,
    provider,
    promptTokens,
    completionTokens,
    costUsd,
    priceRef,
    source: input.source,
    apiKeyScope: input.apiKeyScope ?? 'own',
    organismId: input.organismId,
    workspaceId: input.workspaceId,
    capabilityId: input.capabilityId,
    consumerGhii: input.consumerGhii,
    provenanceId: input.provenanceId,
    appId: input.appId ?? '',
    surface: input.surface ?? '',
  };

  // 1. Source of truth — must persist (billing audit, TARGET-019). Let failures propagate.
  await storage.appendUsageEvent(event);

  // 2. Derived rollup — rebuildable from raw, so a failure here is logged, not thrown.
  try {
    await storage.incrementUsageDaily({
      date: ts.slice(0, 10), // UTC date (ts is an ISO string)
      agentGaii: event.agentGaii,
      ownerGhii: event.ownerGhii,
      apiKeyScope: event.apiKeyScope,
      model: event.model,
      provider: event.provider,
      organismId: event.organismId ?? '',
      workspaceId: event.workspaceId ?? '',
      promptTokens: event.promptTokens,
      completionTokens: event.completionTokens,
      costUsd: costUsd ?? 0,
      calls: 1,
      unpricedCalls: costUsd === null ? 1 : 0,
    });
  } catch (err) {
    logger.warn('usage-metering: daily rollup failed (rebuildable from raw)', {
      id: event.id, error: String(err),
    });
  }

  emitChange('agent-usage', event.ownerGhii);

  // 3. Budget watch (TARGET-017): re-evaluate the owner's day against their budget and fire a
  //    threshold alert if newly crossed. This is the metering choke point, so budget detection
  //    reacts to spend in real time. Best-effort — a failure here never affects the recorded event.
  try {
    await evaluateBudgetAlerts(storage, event.ownerGhii);
  } catch (err) {
    logger.warn('usage-metering: budget alert eval failed', { id: event.id, error: String(err) });
  }

  return event;
}

/**
 * Pull ledger fields out of a telemetry `llm_call` payload. Tolerant of field-name
 * variants agents already send (prompt_tokens/tokens_in, completion_tokens/tokens_out).
 * Returns null when there isn't enough to record a usage event (no model) — the caller
 * then only bumps the legacy activity counters, preserving backward compatibility.
 */
export function extractUsageFields(data: Record<string, unknown>): {
  model: string;
  provider?: string;
  promptTokens: number;
  completionTokens: number;
  providerCostUsd?: number | null;
  runId?: string;
  apiKeyScope?: 'own' | 'node';
  organismId?: string;
  workspaceId?: string;
  capabilityId?: string;
  consumerGhii?: string;
  provenanceId?: string;
  appId?: string;
} | null {
  const model = typeof data.model === 'string' ? data.model.trim() : '';
  if (!model) return null;

  const num = (v: unknown): number => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : 0);
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

  const promptTokens = num(data.prompt_tokens) || num(data.tokens_in);
  const completionTokens = num(data.completion_tokens) || num(data.tokens_out);

  const rawCost = data.cost_usd ?? data.cost;
  const providerCostUsd = typeof rawCost === 'number' && isFinite(rawCost) && rawCost >= 0 ? rawCost : undefined;

  const scope = str(data.api_key_scope);
  const apiKeyScope = scope === 'node' || scope === 'own' ? scope : undefined;

  return {
    model,
    provider: str(data.provider),
    promptTokens,
    completionTokens,
    providerCostUsd,
    runId: str(data.run_id),
    apiKeyScope,
    organismId: str(data.organism_id),
    workspaceId: str(data.workspace_id),
    capabilityId: str(data.capability_id),
    consumerGhii: str(data.consumer_ghii),
    // An agent reporting its own call may say which provenance record it produced (TARGET-058).
    // This is a CLAIM by the agent, stored on the agent's own row — it grants nothing: resolving
    // that id still goes through the authorized /v1/provenance/:id, which checks ownership itself.
    provenanceId: str(data.provenance_id),
    // Which app this call was made FOR. Same class of field as organism_id and capability_id above:
    // a CLAIM by the reporting agent, stored on its own row, granting nothing. It is what makes an
    // agent's work on behalf of an app show up in the per-app view instead of vanishing into
    // "unattributed" — the app is what the spend was for, whichever door reported it.
    appId: str(data.app_id),
  };
}

/**
 * Turn one telemetry event into a priced usage event, when it carries what pricing needs.
 *
 * An `llm_call` with a model becomes an append-only ledger row; a bare one only bumps the activity
 * counters its caller already wrote. A ledger failure never fails the telemetry report — the
 * client's own buffer and retry is the durability guarantee, and refusing the report would cost the
 * counters too.
 *
 * Both doors did this, written out twice. The ledger is what an owner is billed from, so two copies
 * of "does this count" is two answers to what something cost.
 */
export async function recordTelemetryUsage(
    storage: Storage,
    ctx: { agentGaii: string; ownerGhii: string; taskId?: string },
    type: string,
    data: Record<string, unknown> | undefined,
): Promise<void> {
    if (type !== 'llm_call') return;
    const fields = extractUsageFields(data ?? {});
    if (!fields) return;
    try {
        await recordUsageEvent(storage, {
            ...fields,
            agentGaii: ctx.agentGaii,
            ownerGhii: ctx.ownerGhii,
            runId: fields.runId ?? ctx.taskId,
            source: 'telemetry',
        });
    } catch (err) {
        logger.warn('ledger: usage event write failed (telemetry accepted)', {
            agentGaii: ctx.agentGaii, error: String(err),
        });
    }
}
