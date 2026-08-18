/**
 * @file ai-usage-admin.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Operator-only cross-user AI-apps spend: a per-day series with a per-app split, grand
 *   per-app totals, per-user top spenders, and overall totals.
 *
 *   IT NO LONGER PAGES THE MEMORY TABLE. This used to fan `listAllMemory({prefix:'ai-usage.'})`
 *   across every owner on every request, 500 rows at a time, and fold the results in memory — a cost
 *   that grows with how long the node has existed rather than with the size of the answer. It now
 *   reads one precomputed cut of UsageRollup. The response shape is unchanged, so the operator Usage
 *   tab needed no change. Design: docs/internal/telemetria/02-design.md
 *
 *   WHY THE SURFACE FILTER IS THE WHOLE POINT. "AI apps spend" has always meant what apps spent
 *   through /v1/ai/complete and the transcription endpoint, NOT what an owner's agents spent
 *   reporting their own LLM calls. Both now land in the same ledger, which is what makes per-app
 *   model reporting possible at all — so the cut carries `surface`, and this reads only 'app'. Drop
 *   that filter and the operator's app figure silently absorbs every agent call on the node.
 * @structure
 *   - getAdminAiUsage(storage, { from, to }) — node-wide AI-apps usage over a date range
 * @usage
 *   import { getAdminAiUsage } from '../services/ai-usage-admin.js';
 *   const data = await getAdminAiUsage(storage, { from: '2026-06-05', to: '2026-07-05' });
 * @version-history
 *   v2.0.0 — 2026-08-14 — Read the precomputed `llm.owner.app.surface` cut instead of paging every
 *     owner's ai-usage memory records. Response shape unchanged.
 *   v1.0.0 — 2026-07-05 — Initial: operator dashboard "AI Apps Usage" aggregate.
 */
import type { Storage } from '../storage/interface.js';
import { queryUsageRollupLive } from './usage/usage-read.js';

type AppTotals = { cost_usd: number; tokens: number; calls: number };

export interface AdminAiUsageDay {
  date: string;
  total_cost_usd: number;
  total_tokens: number;
  total_calls: number;
  per_app: Record<string, AppTotals>;
}

export interface AdminAiUsage {
  from: string;
  to: string;
  /** Per-day totals summed across every owner, oldest → newest. */
  days: AdminAiUsageDay[];
  /** Grand per-app totals across the range. */
  per_app: Record<string, AppTotals>;
  /** Top spenders (per owner), highest cost first. */
  per_user: Array<{ owner_gaii: string } & AppTotals>;
  totals: AppTotals;
  /** Distinct app ids across the range, ordered by spend (desc) — stable chart series order. */
  apps: string[];
}

const isoDay = (offsetDays = 0): string =>
  new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10);

function add(target: AppTotals, cost: number, tokens: number, calls: number): void {
  target.cost_usd += cost || 0;
  target.tokens += tokens || 0;
  target.calls += calls || 0;
}

/**
 * Aggregate AI-apps spend across all owners for the inclusive date range (defaults to the trailing
 * 30 days). One bounded read of the serving layer.
 */
export async function getAdminAiUsage(
  storage: Storage,
  opts: { from?: string; to?: string } = {},
): Promise<AdminAiUsage> {
  const to = opts.to || isoDay(0);
  const from = opts.from || isoDay(29);

  // LIVE (see queryUsageRollupLive): the folded history plus whatever arrived since the last fold,
  // so a spend that just happened is not missing from the operator's figure for five minutes.
  const rows = await queryUsageRollupLive(storage, {
    cut: 'llm.owner.app', grain: 'day', from, to,
  }, 'llm');

  const dayMap = new Map<string, AdminAiUsageDay>();
  const perApp: Record<string, AppTotals> = {};
  const perUser = new Map<string, { owner_gaii: string } & AppTotals>();
  const totals: AppTotals = { cost_usd: 0, tokens: 0, calls: 0 };

  for (const r of rows) {
    // Spend ATTRIBUTED TO AN APP, which is what this view has always meant. Defined by the app id
    // rather than by the door the call came through, so an agent working on behalf of an app counts
    // and an owner's own agent chatter does not. A row with no app id is not app spend.
    if (!r.appId) continue;

    const tokens = r.tokensIn + r.tokensOut;
    const app = r.appId;

    let day = dayMap.get(r.bucket);
    if (!day) {
      day = { date: r.bucket, total_cost_usd: 0, total_tokens: 0, total_calls: 0, per_app: {} };
      dayMap.set(r.bucket, day);
    }
    day.total_cost_usd += r.costUsd;
    day.total_tokens += tokens;
    day.total_calls += r.calls;
    const dp = day.per_app[app] ?? (day.per_app[app] = { cost_usd: 0, tokens: 0, calls: 0 });
    add(dp, r.costUsd, tokens, r.calls);

    const grand = perApp[app] ?? (perApp[app] = { cost_usd: 0, tokens: 0, calls: 0 });
    add(grand, r.costUsd, tokens, r.calls);

    let user = perUser.get(r.ownerGhii);
    if (!user) {
      user = { owner_gaii: r.ownerGhii, cost_usd: 0, tokens: 0, calls: 0 };
      perUser.set(r.ownerGhii, user);
    }
    add(user, r.costUsd, tokens, r.calls);
    add(totals, r.costUsd, tokens, r.calls);
  }

  const days = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  const per_user = [...perUser.values()].sort((a, b) => b.cost_usd - a.cost_usd);
  const apps = Object.keys(perApp).sort((a, b) => perApp[b].cost_usd - perApp[a].cost_usd);

  return { from, to, days, per_app: perApp, per_user, totals, apps };
}
