/**
 * @file ai-usage-admin.ts
 * @description Operator-only cross-user AI-spend aggregation. Every AI completion persists one
 *   per-owner, per-UTC-day usage record (`ai-usage.<gaii>.<day>`, retained forever). This service
 *   fans the shared `ai-usage.` key prefix across ALL owners via storage.listAllMemory() and folds
 *   the records into node-wide rollups: a per-day series (for a stacked bar), grand per-app totals,
 *   per-user "top spenders", and overall totals. Read-only reporting — no writes, no new tables.
 * @structure
 *   - getAdminAiUsage(storage, { from, to }) — node-wide AI usage over a date range
 * @usage
 *   import { getAdminAiUsage } from '../services/ai-usage-admin.js';
 *   const data = await getAdminAiUsage(storage, { from: '2026-06-05', to: '2026-07-05' });
 * @version-history
 *   v1.0.0 — 2026-07-05 — Initial: operator dashboard "AI Apps Usage" aggregate.
 */
import type { Storage, MemoryRecord } from '../storage/interface.js';
import type { UsageRecord } from './ai-completion.js';

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
 * Aggregate AI spend across all owners for the given inclusive date range (defaults to the trailing
 * 30 days). Pages through the memory table so no single query has to hold every record in memory.
 */
export async function getAdminAiUsage(
  storage: Storage,
  opts: { from?: string; to?: string } = {},
): Promise<AdminAiUsage> {
  const to = opts.to || isoDay(0);
  const from = opts.from || isoDay(29);

  // Page through every owner's `ai-usage.*` record.
  const PAGE = 500;
  let offset = 0;
  const items: MemoryRecord[] = [];
  for (;;) {
    const { items: page, total } = await storage.listAllMemory({ prefix: 'ai-usage.', limit: PAGE, offset });
    items.push(...page);
    offset += page.length;
    if (page.length === 0 || offset >= total) break;
  }

  const dayMap = new Map<string, AdminAiUsageDay>();
  const perApp: Record<string, AppTotals> = {};
  const perUser = new Map<string, { owner_gaii: string } & AppTotals>();
  const totals: AppTotals = { cost_usd: 0, tokens: 0, calls: 0 };

  for (const rec of items) {
    const v = rec.value as UsageRecord | undefined;
    if (!v || typeof v.date !== 'string') continue;
    if (v.date < from || v.date > to) continue;

    let day = dayMap.get(v.date);
    if (!day) {
      day = { date: v.date, total_cost_usd: 0, total_tokens: 0, total_calls: 0, per_app: {} };
      dayMap.set(v.date, day);
    }
    day.total_cost_usd += v.total_cost_usd || 0;
    day.total_tokens += v.total_tokens || 0;
    day.total_calls += v.total_calls || 0;

    let user = perUser.get(rec.ownerGaii);
    if (!user) {
      user = { owner_gaii: rec.ownerGaii, cost_usd: 0, tokens: 0, calls: 0 };
      perUser.set(rec.ownerGaii, user);
    }
    add(user, v.total_cost_usd, v.total_tokens, v.total_calls);
    add(totals, v.total_cost_usd, v.total_tokens, v.total_calls);

    for (const [app, m] of Object.entries(v.per_app || {})) {
      const grand = perApp[app] ?? (perApp[app] = { cost_usd: 0, tokens: 0, calls: 0 });
      add(grand, m.cost_usd, m.tokens, m.calls);
      const dp = day.per_app[app] ?? (day.per_app[app] = { cost_usd: 0, tokens: 0, calls: 0 });
      add(dp, m.cost_usd, m.tokens, m.calls);
    }
  }

  const days = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  const per_user = [...perUser.values()].sort((a, b) => b.cost_usd - a.cost_usd);
  const apps = Object.keys(perApp).sort((a, b) => perApp[b].cost_usd - perApp[a].cost_usd);

  return { from, to, days, per_app: perApp, per_user, totals, apps };
}
