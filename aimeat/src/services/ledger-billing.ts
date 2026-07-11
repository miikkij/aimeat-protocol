/**
 * @file ledger-billing.ts
 * @description Owner monthly billing rollup for the usage ledger (LEDGER / TARGET-019): the
 *   technical basis for the "running the house is a subscription" hosted-billing model. Rolls
 *   an owner's daily aggregates up to a month, split by api_key_scope — `own` (the owner's own
 *   API key, NOT billed) vs `node` (the node's key, the billable hosted usage). Exports as JSON
 *   or CSV to attach to an invoice.
 *
 *   This module meters only; it makes NO pricing decision (margin/subscription price are the
 *   operator's, not this target's). The per-event `price_ref` audit trail lives on the raw
 *   events (queryable via /v1/ledger/usage/runs) so any summary row is traceable to the price
 *   version it was computed with.
 * @structure
 *   - getOwnerMonthlyBilling(storage, ownerGhii, month) -- structured monthly summary
 *   - billingToCsv(summary)                              -- CSV rows for an invoice attachment
 * @usage
 *   import { getOwnerMonthlyBilling, billingToCsv } from '../services/ledger-billing.js';
 * @version-history
 *   v1.0.0 -- 2026-07-11 -- Initial creation for LEDGER TARGET-019
 */

import type { Storage, AgentUsageDailyRecord } from '../storage/interface.js';

interface Bucket {
  cost_usd: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  calls: number;
  unpriced_calls: number;
}

export interface ModelLine extends Bucket {
  model: string;
  provider: string;
  /** 'own' (self-host, not billed) or 'node' (hosted, billable). */
  api_key_scope: string;
}

export interface MonthlyBilling {
  month: string;
  owner_ghii: string;
  totals: Bucket;
  /** api_key_scope = 'node' — the node's key, the billable hosted usage. */
  billable: Bucket;
  /** api_key_scope = 'own' — the owner's own key, NOT billed. */
  self_host: Bucket;
  by_model: ModelLine[];
  /** Operator's hosted margin ratio, echoed from prefs (0 = pass-through). Pricing is the
   *  operator's decision — this field just carries it for the invoice basis. */
  margin_ratio: number;
  /** Audit note: every summary figure is traceable to its price_ref via the raw events. */
  audit: string;
}

function emptyBucket(): Bucket {
  return { cost_usd: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0, unpriced_calls: 0 };
}

function add(b: Bucket, r: AgentUsageDailyRecord): void {
  b.cost_usd += r.costUsd;
  b.prompt_tokens += r.promptTokens;
  b.completion_tokens += r.completionTokens;
  b.total_tokens += r.promptTokens + r.completionTokens;
  b.calls += r.calls;
  b.unpriced_calls += r.unpricedCalls;
}

/** Current UTC month as YYYY-MM. */
function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/**
 * Roll one owner's usage up to a calendar month (default current UTC month), split by
 * api_key_scope and broken down per model. `month` is YYYY-MM; days are string-compared, so
 * a `to` of `${month}-31` safely covers any month length.
 */
export async function getOwnerMonthlyBilling(
  storage: Storage,
  ownerGhii: string,
  month?: string,
): Promise<MonthlyBilling> {
  const m = month ?? currentMonth();
  const rows = await storage.queryUsageDaily({ ownerGhii, from: `${m}-01`, to: `${m}-31` });

  const totals = emptyBucket();
  const billable = emptyBucket();
  const selfHost = emptyBucket();
  const modelMap = new Map<string, ModelLine>();

  for (const r of rows) {
    add(totals, r);
    add(r.apiKeyScope === 'node' ? billable : selfHost, r);

    const key = `${r.apiKeyScope}\0${r.provider}\0${r.model}`;
    let line = modelMap.get(key);
    if (!line) {
      line = { model: r.model, provider: r.provider, api_key_scope: r.apiKeyScope, ...emptyBucket() };
      modelMap.set(key, line);
    }
    add(line, r);
  }

  const prefsRecord = await storage.getMemory(ownerGhii, 'openrouter.settings');
  const prefs = (prefsRecord?.value as Record<string, unknown>) ?? {};
  const margin = typeof prefs.ledger_hosted_margin === 'number' && prefs.ledger_hosted_margin >= 0
    ? prefs.ledger_hosted_margin : 0;

  const by_model = [...modelMap.values()].sort((a, b) => b.cost_usd - a.cost_usd);

  return {
    month: m,
    owner_ghii: ownerGhii,
    totals,
    billable,
    self_host: selfHost,
    by_model,
    margin_ratio: margin,
    audit: 'Per-event price_ref retained on raw usage events; drill via /v1/ledger/usage/runs.',
  };
}

/** Escape a CSV field (RFC 4180): quote when it contains a comma, quote, or newline. */
function csvField(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Render the per-model lines as CSV for an invoice attachment. */
export function billingToCsv(summary: MonthlyBilling): string {
  const header = [
    'month', 'owner_ghii', 'api_key_scope', 'provider', 'model',
    'cost_usd', 'prompt_tokens', 'completion_tokens', 'total_tokens', 'calls', 'unpriced_calls',
  ];
  const lines = [header.join(',')];
  for (const r of summary.by_model) {
    lines.push([
      summary.month, summary.owner_ghii, r.api_key_scope, r.provider, r.model,
      r.cost_usd, r.prompt_tokens, r.completion_tokens, r.total_tokens, r.calls, r.unpriced_calls,
    ].map(csvField).join(','));
  }
  return lines.join('\n') + '\n';
}
