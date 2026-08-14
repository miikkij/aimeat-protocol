/**
 * @file ledger-admin.ts
 * @description Operator-only cross-user aggregation of the agent LLM usage ledger (LEDGER /
 *   TARGET-016): node-wide totals, a per-day series with a per-model split, per-user "top spenders",
 *   per-agent and per-model breakdowns.
 *
 *   IT NO LONGER SCANS. This used to read every AgentUsageDaily row for every owner in the range and
 *   fold them in memory on each request, which grows with the node rather than with the answer. It
 *   now reads two precomputed cuts of UsageRollup (`llm.model` for the model and time dimensions,
 *   `llm.actor` for the agent and owner ones), which are bounded by real cardinality and already
 *   aggregated. The response shape is byte-for-byte what it was, so the operator Usage tab needed no
 *   change. Design: docs/internal/telemetria/02-design.md
 *
 *   THE ONE NUMBER THAT IS NOT A SUM. `per_user[].agents` is a distinct count, so it is derived from
 *   the per-agent cut's ROWS rather than from the rollup's own `actorsSeen` — that column undercounts
 *   an actor seen in two fold batches, and a "how many agents does this user run" that drifts
 *   downward is worse than no number.
 *
 *   SECURITY: the cross-owner read is deliberately un-scoped; the calling route
 *   (GET /v1/admin/ledger) MUST gate on the operator role. This service performs NO caller check.
 * @structure
 *   - getAdminLedger(storage, { from, to }) — node-wide agent ledger over a date range
 * @usage
 *   import { getAdminLedger } from '../services/ledger-admin.js';
 * @version-history
 *   v2.0.0 — 2026-08-14 — Read the precomputed UsageRollup cuts instead of scanning every owner's
 *     daily rows. Response shape unchanged.
 *   v1.0.0 — 2026-07-11 — Initial: operator dashboard cross-user agent-ledger aggregate.
 */
import type { Storage, UsageRollupRow } from '../storage/interface.js';
import { queryUsageRollupLive } from './usage/usage-read.js';

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

/** Fold one rollup row's metrics into a totals accumulator. */
function add(t: Totals, r: UsageRollupRow): void {
  t.cost_usd += r.costUsd;
  t.total_tokens += r.tokensIn + r.tokensOut;
  t.calls += r.calls;
  t.unpriced_calls += r.unpricedCalls;
}

/**
 * Aggregate agent LLM ledger spend across ALL owners for the inclusive date range (defaults to the
 * trailing 30 days). Two bounded reads of the serving layer, folded into the five shapes the
 * operator tab renders.
 */
export async function getAdminLedger(
  storage: Storage,
  opts: { from?: string; to?: string } = {},
): Promise<AdminLedger> {
  const to = opts.to || isoDay(0);
  const from = opts.from || isoDay(29);

  // LIVE, not merely folded: an operator who just watched a spend happen must see it. The top-up is
  // bounded by the fold interval, so this stays two small reads however long the node has run.
  const [modelRows, actorRows] = await Promise.all([
    // (bucket × model × provider) — carries the time axis, the model axis, and the grand totals.
    queryUsageRollupLive(storage, { cut: 'llm.model', grain: 'day', from, to }, 'llm'),
    // (owner × agent) per day — carries the per-agent and per-user axes.
    queryUsageRollupLive(storage, { cut: 'llm.actor', grain: 'day', from, to }, 'llm'),
  ]);

  const totals = blank();
  const dayMap = new Map<string, AdminLedgerDay>();
  const modelMap = new Map<string, { model: string; providers: Set<string> } & Totals>();

  for (const r of modelRows) {
    add(totals, r);

    let day = dayMap.get(r.bucket);
    if (!day) {
      day = { date: r.bucket, cost_usd: 0, total_tokens: 0, calls: 0, per_model: {} };
      dayMap.set(r.bucket, day);
    }
    const tokens = r.tokensIn + r.tokensOut;
    day.cost_usd += r.costUsd;
    day.total_tokens += tokens;
    day.calls += r.calls;
    const dm = day.per_model[r.model] ?? (day.per_model[r.model] = { cost_usd: 0, total_tokens: 0, calls: 0 });
    dm.cost_usd += r.costUsd;
    dm.total_tokens += tokens;
    dm.calls += r.calls;

    let m = modelMap.get(r.model);
    if (!m) {
      m = { model: r.model, providers: new Set<string>(), ...blank() };
      modelMap.set(r.model, m);
    }
    if (r.provider && r.provider !== 'unknown') m.providers.add(r.provider);
    add(m, r);
  }

  const agentMap = new Map<string, { agent_gaii: string; owner_ghii: string } & Totals>();
  const userMap = new Map<string, { owner_ghii: string; agents: Set<string> } & Totals>();

  for (const r of actorRows) {
    let a = agentMap.get(r.actorGaii);
    if (!a) {
      a = { agent_gaii: r.actorGaii, owner_ghii: r.ownerGhii, ...blank() };
      agentMap.set(r.actorGaii, a);
    }
    add(a, r);

    let u = userMap.get(r.ownerGhii);
    if (!u) {
      u = { owner_ghii: r.ownerGhii, agents: new Set<string>(), ...blank() };
      userMap.set(r.ownerGhii, u);
    }
    // Distinct from the ROWS, not from actorsSeen: this is a count of agents, and it must not drift.
    if (r.actorGaii) u.agents.add(r.actorGaii);
    add(u, r);
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
