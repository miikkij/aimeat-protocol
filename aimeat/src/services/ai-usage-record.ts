/**
 * @file src/services/ai-usage-record.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Today's AI usage record for one owner: its shape, the read, and the one write that
 *   folds a call into it and appends the ledger event. Text completions, transcriptions and decisions
 *   share this record, so the daily budget covers all of them.
 *
 *   A PURE MOVE out of ai-completion.ts (max-file-lines), which re-exports every name, so no
 *   importer changed. The reasons each function is the way it is stayed with the functions.
 * @structure UsageRecord · todayKey · getTodayUsage · recordAiUsage
 * @usage import { getTodayUsage, recordAiUsage, type UsageRecord } from './ai-completion.js';
 * @version-history
 *   v1.1.0 — 2026-09-20 — `per_agent` and the `agent` a call names, for the per-agent daily cap; the
 *     key scope may say 'agent'.
 *   v1.0.0 — 2026-09-20 — Extracted from ai-completion.ts, unchanged.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { recordUsageEvent } from './usage-metering.js';
import { recordAccountEvent } from './account-events.js';
import { canonicalAiAppId, mergePerApp } from './ai-app-id.js';
import { addAgentSpend } from './agent-ai-keys.js';

export interface UsageRecord {
  /** ISO date key (YYYY-MM-DD). */
  date: string;
  total_cost_usd: number;
  total_calls: number;
  total_tokens: number;
  /** Audio seconds transcribed today. Optional: records written before speech-to-text existed do not
   *  have it, and every reader treats a missing value as 0. */
  audio_seconds?: number;
  per_app: Record<string, { cost_usd: number; calls: number; tokens: number; audio_seconds?: number }>;
  /** Spend by the owner's agents, by bare agent name: what the per-agent daily cap is checked
   *  against (services/agent-ai-keys.ts). Absent on a day no agent spent. */
  per_agent?: Record<string, { cost_usd: number; calls: number; tokens: number }>;
  updated_at: string;
}

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export const emptyUsage = (): UsageRecord => ({
  date: todayKey(), total_cost_usd: 0, total_calls: 0, total_tokens: 0,
  per_app: {}, updated_at: new Date().toISOString(),
});

/** Read today's usage record for an owner (used by the daily_limit constraint + the usage route). */
export async function getTodayUsage(storage: Storage, gaii: string): Promise<UsageRecord> {
  const rec = await storage.getMemory(gaii, `ai-usage.${gaii}.${todayKey()}`);
  return (rec?.value as UsageRecord | undefined) ?? emptyUsage();
}

// getUsageHistory and its UsageWindow / UsageHistory shapes live in ai-usage-history.ts since
// 2026-09-09 (a pure move, max-file-lines). The per-day records are still written below.

async function upsertUsage(storage: Storage, gaii: string, value: UsageRecord): Promise<void> {
  const key = `ai-usage.${gaii}.${todayKey()}`;
  const existing = await storage.getMemory(gaii, key);
  const now = new Date().toISOString();
  await storage.setMemory({
    key, ownerGaii: gaii, value, visibility: 'private', tags: ['ai', 'usage'],
    ttlHours: null,
    version: existing ? existing.version + 1 : 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

/**
 * Record what yesterday cost, once. Silent when there was no spend: "you spent nothing" is not news,
 * and a feed that says it every morning is a feed people stop reading.
 */
async function reportYesterdaysSpend(
  storage: Storage, gaii: string, config?: AimeatConfig,
): Promise<void> {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const rec = (await storage.getMemory(gaii, `ai-usage.${gaii}.${yesterday}`))?.value as UsageRecord | undefined;
  if (!rec || !(rec.total_cost_usd > 0)) return;
  await recordAccountEvent(storage, {
    ownerGhii: gaii,
    kind: 'ai_spend_daily',
    subject: yesterday,
    link: '/v1/profile?tab=usage',
    data: {
      day: yesterday,
      amount: `$${rec.total_cost_usd < 1 ? rec.total_cost_usd.toFixed(4) : rec.total_cost_usd.toFixed(2)}`,
      calls: String(rec.total_calls ?? 0),
    },
  }, config);
}

/**
 * Fold one call into today's usage record and persist it. Text completions and transcriptions share
 * ONE record, so the daily budget covers both and the spend charts show them together — an owner
 * whose budget is being eaten by voice messages sees it in the same place as everything else.
 *
 * IT WRITES TWO PLACES, AND THEY ARE NOT REDUNDANT. The per-day memory record is the LIVE budget
 * counter: it must be readable in one get before every completion, so it stays a single small key
 * and carries no model dimension. The ledger event is the REPORTING row: append-only, priced,
 * carrying model, provider and appId. Before this, only the first existed, which is why per-app
 * model reporting had no data behind it. Both are written here rather than at the two call sites,
 * so a third caller cannot arrive and write only one of them.
 */
const usageWrites = new WeakMap<Storage, Map<string, Promise<unknown>>>();

/** Serialize the read/modify/write across overlapping voice stages on this node. */
export async function recordAiUsage(...args: Parameters<typeof appendAiUsage>): Promise<UsageRecord> {
  const [storage, gaii] = args;
  let pending = usageWrites.get(storage);
  if (!pending) { pending = new Map(); usageWrites.set(storage, pending); }
  const previous = pending.get(gaii) ?? Promise.resolve();
  const next = previous.then(() => appendAiUsage(...args), () => appendAiUsage(...args));
  pending.set(gaii, next);
  try { return await next; } finally { if (pending.get(gaii) === next) pending.delete(gaii); }
}

async function appendAiUsage(
  storage: Storage, gaii: string, usage: UsageRecord,
  call: {
    costUsd: number; tokens: number; audioSeconds?: number; appId?: string;
    /** Ledger dimensions. Omitted only by a caller that genuinely has no model to name. */
    model?: string; provider?: string; promptTokens?: number; completionTokens?: number;
    source?: string;
    /** Which key paid. The ledger has carried this dimension since it was written; before the node
     *  had a key of its own there was only one possible answer, so it was hardcoded. */
    apiKeyScope?: 'agent' | 'own' | 'node';
    /** The bare name of the owner's agent that asked, when one did. Feeds `per_agent`. */
    agent?: string;
  },
  /** The node's config, so the event window is the operator's number. Optional: the two callers
   *  have it, and a caller that does not gets the default rather than a compile error. */
  config?: AimeatConfig,
): Promise<UsageRecord> {
  usage = await getTodayUsage(storage, gaii);
  const updated: UsageRecord = {
    date: todayKey(),
    total_cost_usd: usage.total_cost_usd + call.costUsd,
    total_calls: usage.total_calls + 1,
    total_tokens: usage.total_tokens + call.tokens,
    audio_seconds: (usage.audio_seconds ?? 0) + (call.audioSeconds ?? 0),
    // Folded on write, so a day that began under an older name continues as one app.
    per_app: mergePerApp(usage.per_app, gaii),
    ...(usage.per_agent || call.agent ? { per_agent: addAgentSpend(usage.per_agent, call.agent, call) } : {}),
    updated_at: new Date().toISOString(),
  };
  const appKey = canonicalAiAppId(call.appId, gaii) || '_unknown';
  const existing = updated.per_app[appKey] ?? { cost_usd: 0, calls: 0, tokens: 0 };
  updated.per_app[appKey] = {
    cost_usd: existing.cost_usd + call.costUsd,
    calls: existing.calls + 1,
    tokens: existing.tokens + call.tokens,
    audio_seconds: (existing.audio_seconds ?? 0) + (call.audioSeconds ?? 0),
  };
  // THE DAY BEFORE, told once. A row per completion would be the loudest thing on the account and
  // the least interesting; what a person wants told is what a day cost. `usage.total_calls === 0`
  // means this is the first call of a new UTC day for them, so yesterday's record is final and can
  // be reported — one extra read per owner per active day, and no marker to keep in step.
  if ((usage.total_calls ?? 0) === 0) {
    void reportYesterdaysSpend(storage, gaii, config).catch(err =>
      logger.warn('[ai] daily spend digest is best-effort', { gaii, error: String(err) }));
  }

  await upsertUsage(storage, gaii, updated);

  // The reporting half. Best-effort on purpose: the owner has already been served and the budget
  // counter above is already correct, so a ledger failure must not surface as a failed completion.
  // It is logged rather than swallowed, because an operator seeing this knows spend is happening
  // that their reports will not show.
  if (call.model) {
    try {
      await recordUsageEvent(storage, {
        agentGaii: gaii,
        ownerGhii: gaii,
        model: call.model,
        provider: call.provider,
        promptTokens: call.promptTokens ?? 0,
        completionTokens: call.completionTokens ?? 0,
        // The provider's own figure when we have it. `costUsd` here is already either the exact
        // reported cost or this node's estimate, and priceUsd() prefers what it is given.
        providerCostUsd: call.costUsd,
        source: call.source ?? 'ai-complete',
        // The ledger's split is who is BILLED: the node's key, or the person's own money. An
        // agent's key is the person's own money, so it is 'own' here; the decision record and
        // today's `per_agent` are where the agent is named.
        apiKeyScope: call.apiKeyScope === 'node' ? 'node' : 'own',
        appId: canonicalAiAppId(call.appId, gaii) ?? '',
        surface: 'app',
      });
    } catch (err) {
      logger.warn('[ai] ledger event failed; the budget counter is still correct', {
        gaii, model: call.model, error: String(err),
      });
    }
  }

  return updated;
}
