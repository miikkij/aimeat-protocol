/**
 * @file ledger-admin.ts
 * @description Operator-only cross-user aggregation of the agent LLM usage ledger (LEDGER /
 *   TARGET-016). Reads the daily rollup across ALL owners (storage.queryUsageDailyAllOwners — NOT
 *   owner-scoped) and folds it into node-wide totals, a per-day series (stacked bar), per-user
 *   "top spenders", per-agent, and per-model breakdowns. Read-only — no writes, no new tables.
 *
 *   SECURITY: the cross-owner read is deliberately un-scoped; the calling route
 *   (GET /v1/admin/ledger) MUST gate on the operator role. This service performs NO caller check.
 * @structure
 *   - getAdminLedger(storage, { from, to }) — node-wide agent ledger over a date range
 * @usage
 *   import { getAdminLedger } from '../services/ledger-admin.js';
 * @version-history
 *   v1.0.0 — 2026-07-11 — Initial: operator dashboard cross-user agent-ledger aggregate.
 */
import type { Storage } from '../storage/interface.js';

interface Totals {
  cost_usd: number;
  total_tokens: number;
  calls: number;
  unpriced_calls: number;
}

export interface AdminLedgerDay {
  date: string;
  cost_usd: number;
  total_tokens: number;
  calls: number;
  /** Per-model split for this day (stacked chart series), like AI-usage's per_app. */
  per_model: Record<string, { cost_usd: number; total_tokens: number; calls: number }>;
}

export interface AdminLedger {
  from: string;
  to: string;
  totals: Totals;
  /** Per-day totals summed across every owner, oldest → newest. */
  days: AdminLedgerDay[];
  /** Top spenders (per owner), highest cost first; `agents` = distinct agents that spent. */
  per_user: Array<{ owner_ghii: string; agents: number } & Totals>;
  /** Per agent, highest cost first; drill by `owner_ghii`. */
  per_agent: Array<{ agent_gaii: string; owner_ghii: string } & Totals>;
  /** Per model, highest cost first; `providers` = where the model ran (openrouter/nvidia/…). */
  per_model: Array<{ model: string; providers: string[] } & Totals>;
}

const isoDay = (offsetDays = 0): string =>
  new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10);

function blank(): Totals {
  return { cost_usd: 0, total_tokens: 0, calls: 0, unpriced_calls: 0 };
}

function add(t: Totals, cost: number, tokens: number, calls: number, unpriced: number): void {
  t.cost_usd += cost || 0;
  t.total_tokens += tokens || 0;
  t.calls += calls || 0;
  t.unpriced_calls += unpriced || 0;
}

/**
 * Aggregate agent LLM ledger spend across ALL owners for the inclusive date range (defaults to the
 * trailing 30 days). The daily table is already per-day aggregated, so one query covers the range.
 */
export async function getAdminLedger(
  storage: Storage,
  opts: { from?: string; to?: string } = {},
): Promise<AdminLedger> {
  const to = opts.to || isoDay(0);
  const from = opts.from || isoDay(29);

  const rows = await storage.queryUsageDailyAllOwners({ from, to });

  const totals = blank();
  const dayMap = new Map<string, AdminLedgerDay>();
  const userMap = new Map<string, { owner_ghii: string; agents: Set<string> } & Totals>();
  const agentMap = new Map<string, { agent_gaii: string; owner_ghii: string } & Totals>();
  const modelMap = new Map<string, { model: string; providers: Set<string> } & Totals>();

  for (const r of rows) {
    const tokens = (r.promptTokens || 0) + (r.completionTokens || 0);
    add(totals, r.costUsd, tokens, r.calls, r.unpricedCalls);

    let day = dayMap.get(r.date);
    if (!day) {
      day = { date: r.date, cost_usd: 0, total_tokens: 0, calls: 0, per_model: {} };
      dayMap.set(r.date, day);
    }
    day.cost_usd += r.costUsd || 0;
    day.total_tokens += tokens;
    day.calls += r.calls || 0;
    const dm = day.per_model[r.model] ?? (day.per_model[r.model] = { cost_usd: 0, total_tokens: 0, calls: 0 });
    dm.cost_usd += r.costUsd || 0;
    dm.total_tokens += tokens;
    dm.calls += r.calls || 0;

    let u = userMap.get(r.ownerGhii);
    if (!u) {
      u = { owner_ghii: r.ownerGhii, agents: new Set<string>(), ...blank() };
      userMap.set(r.ownerGhii, u);
    }
    u.agents.add(r.agentGaii);
    add(u, r.costUsd, tokens, r.calls, r.unpricedCalls);

    let a = agentMap.get(r.agentGaii);
    if (!a) {
      a = { agent_gaii: r.agentGaii, owner_ghii: r.ownerGhii, ...blank() };
      agentMap.set(r.agentGaii, a);
    }
    add(a, r.costUsd, tokens, r.calls, r.unpricedCalls);

    let m = modelMap.get(r.model);
    if (!m) {
      m = { model: r.model, providers: new Set<string>(), ...blank() };
      modelMap.set(r.model, m);
    }
    if (r.provider && r.provider !== 'unknown') m.providers.add(r.provider);
    add(m, r.costUsd, tokens, r.calls, r.unpricedCalls);
  }

  const days = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  const per_user = [...userMap.values()]
    .map(({ agents, ...rest }) => ({ ...rest, agents: agents.size }))
    .sort((a, b) => b.cost_usd - a.cost_usd);
  const per_agent = [...agentMap.values()].sort((a, b) => b.cost_usd - a.cost_usd);
  const per_model = [...modelMap.values()]
    .map(({ providers, ...rest }) => ({ ...rest, providers: [...providers].sort() }))
    .sort((a, b) => b.cost_usd - a.cost_usd);

  return { from, to, totals, days, per_user, per_agent, per_model };
}
