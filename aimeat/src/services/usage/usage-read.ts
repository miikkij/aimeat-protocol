/**
 * @file src/services/usage/usage-read.ts
 * @description The one read path over the serving layer. A caller names a REPORT and a scope; this
 *   resolves it to a declared cut, queries the precomputed rows, and returns them already grouped,
 *   sorted and totalled. Design: docs/internal/telemetria/02-design.md
 *
 *   WHY A REPORT NAME RATHER THAN A CUT NAME. A cut is an internal storage decision — which
 *   dimension set was materialised. A report is what someone wants to see. Keeping them apart means
 *   a cut can be split, renamed or given a finer grain without breaking a URL anyone bookmarked,
 *   and it means the owner and operator versions of the same question ("which models get used")
 *   resolve to DIFFERENT cuts behind ONE name, so neither door has to know about the other's.
 *
 *   OWNER SCOPING IS STRUCTURAL, NOT A FILTER SOMEONE REMEMBERED. An owner-scoped read resolves to
 *   a cut that carries ownerGhii and is always queried with it set. There is no code path here that
 *   takes an ownerGhii from a caller and trusts it: the route passes the resolved identity, and the
 *   cross-owner variants are separate report keys the operator door alone can reach.
 * @structure
 *   - OWNER_REPORTS / NODE_REPORTS -- report name to cut, per scope
 *   - readUsageReport(storage, args) -- the query, grouped and totalled
 *   - usageComputedThrough(storage) -- how fresh the serving layer is
 * @usage
 *   const report = await readUsageReport(storage, { report: 'model', ownerGhii, from, to });
 * @version-history
 *   v1.0.0 — 2026-08-14 — Initial: one read service over the precomputed rollups.
 */
import type { Storage, UsageRollupRow } from '../../storage/interface.js';
import { findCut, type UsageDim } from './rollup-cuts.js';

/** Reports an owner may ask about their OWN usage. Every cut here carries ownerGhii. */
export const OWNER_REPORTS: Record<string, string> = {
  day: 'llm.owner',
  model: 'llm.owner.model',
  app: 'llm.owner.app',
  agent: 'llm.actor',
  tool: 'call.owner.tool',
  surface: 'call.owner.surface',
  'apps-used': 'call.owner.app',
  activity: 'call.owner',
  sold: 'call.provider.coordinate',
};

/** Reports across every owner. Operator-only: the calling route MUST gate on the operator role. */
export const NODE_REPORTS: Record<string, string> = {
  day: 'llm.node',
  model: 'llm.model',
  app: 'llm.app',
  'app-model': 'llm.app.model',
  agent: 'llm.actor',
  user: 'llm.owner',
  tool: 'call.tool',
  surface: 'call.surface',
  'apps-used': 'call.app',
  activity: 'call.node',
  provider: 'call.provider.coordinate',
};

/** Which dimension names a row, for the display label. First match wins. */
const LABEL_ORDER: UsageDim[] = [
  'model', 'appId', 'coordinate', 'actorGaii', 'surface', 'ownerGhii', 'counterpartyGhii', 'provider', 'outcome',
];

export interface UsageGroup {
  /** Display label for this row: the dimension that names it, or the bucket for a time series. */
  key: string;
  /** Every dimension this cut keyed on, so a client can drill without parsing `key`. */
  dims: Partial<Record<UsageDim, string>>;
  calls: number;
  errors: number;
  refusals: number;
  tokens_in: number;
  tokens_out: number;
  total_tokens: number;
  cost_usd: number;
  unpriced_calls: number;
  charged_units: number;
  duration_ms_avg: number;
  duration_ms_max: number;
  /** Distinct actors, undercounted across fold batches. Never use for billing. */
  actors_seen_approx: number;
}

export interface UsageReport {
  report: string;
  cut: string;
  grain: 'hour' | 'day';
  from: string;
  to: string;
  scope: 'owner' | 'node';
  owner: string | null;
  /** Buckets in chronological order, for a chart. Empty unless `series` was asked for. */
  series: Array<{ bucket: string; calls: number; cost_usd: number; total_tokens: number }>;
  groups: UsageGroup[];
  totals: Omit<UsageGroup, 'key' | 'dims'>;
  /**
   * The oldest point both raw streams have been folded through. Everything after it may be missing
   * from these numbers. Stated rather than implied, because a dashboard that silently lags is a
   * dashboard people stop trusting the first time they notice.
   */
  computed_through: string | null;
  /** True when the request asked for a window the archive holds and the hot tables no longer do. */
  beyond_hot_window: boolean;
}

function emptyTotals(): Omit<UsageGroup, 'key' | 'dims'> {
  return {
    calls: 0, errors: 0, refusals: 0, tokens_in: 0, tokens_out: 0, total_tokens: 0,
    cost_usd: 0, unpriced_calls: 0, charged_units: 0,
    duration_ms_avg: 0, duration_ms_max: 0, actors_seen_approx: 0,
  };
}

/** YYYY-MM-DD `days` before today, UTC. */
export function dayNDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export interface ReadUsageArgs {
  report: string;
  scope: 'owner' | 'node';
  /** Required when scope is 'owner'. Ignored — deliberately — when scope is 'node'. */
  ownerGhii?: string;
  from?: string;
  to?: string;
  grain?: 'hour' | 'day';
  /** Also return the per-bucket series (a chart wants it; a table does not). */
  series?: boolean;
  limit?: number;
}

export class UnknownReportError extends Error {
  available: string[];
  constructor(report: string, available: string[]) {
    super(`Unknown report "${report}". Available: ${available.join(', ')}`);
    this.name = 'UnknownReportError';
    this.available = available;
  }
}

/** The oldest point both streams have been folded through; null before the first fold. */
export async function usageComputedThrough(storage: Storage): Promise<string | null> {
  const [llm, call] = await Promise.all([
    storage.getUsageCursor('llm'),
    storage.getUsageCursor('call'),
  ]);
  const points = [llm?.lastTs, call?.lastTs].filter((t): t is string => !!t);
  if (points.length === 0) return null;
  // The OLDER of the two: a report is only as fresh as its least fresh input, and claiming the
  // newer would overstate exactly when one stream has fallen behind.
  return points.sort()[0];
}

/** Fold one stored row into a group accumulator. */
function addRow(target: Omit<UsageGroup, 'key' | 'dims'>, r: UsageRollupRow, durationCalls: { n: number; sum: number }): void {
  target.calls += r.calls;
  target.errors += r.errors;
  target.refusals += r.refusals;
  target.tokens_in += r.tokensIn;
  target.tokens_out += r.tokensOut;
  target.total_tokens += r.tokensIn + r.tokensOut;
  target.cost_usd += r.costUsd;
  target.unpriced_calls += r.unpricedCalls;
  target.charged_units += r.chargedUnits;
  target.actors_seen_approx += r.actorsSeen;
  if (r.durationMsMax > target.duration_ms_max) target.duration_ms_max = r.durationMsMax;
  durationCalls.n += r.calls;
  durationCalls.sum += r.durationMsSum;
}

/**
 * Read one report. The window defaults to the trailing 30 days; a `grain` the cut does not
 * materialise falls back to the one it does, rather than answering with an empty chart the caller
 * has no way to explain.
 */
export async function readUsageReport(storage: Storage, args: ReadUsageArgs): Promise<UsageReport> {
  const table = args.scope === 'owner' ? OWNER_REPORTS : NODE_REPORTS;
  const cutName = table[args.report];
  if (!cutName) throw new UnknownReportError(args.report, Object.keys(table));

  const cut = findCut(cutName);
  if (!cut) throw new UnknownReportError(args.report, Object.keys(table));

  const grain: 'hour' | 'day' = args.grain && cut.grains.includes(args.grain)
    ? args.grain
    : (cut.grains.includes('day') ? 'day' : cut.grains[0]);

  const from = args.from ?? dayNDaysAgo(30);
  const to = args.to ?? dayNDaysAgo(0);

  const rows = await storage.queryUsageRollup({
    cut: cutName,
    grain,
    from,
    to: grain === 'hour' ? `${to}T23` : to,
    // The whole reason owner scoping is safe here: an owner report is a cut that CARRIES ownerGhii,
    // and the value comes from the route's resolved identity, never from a query parameter.
    ownerGhii: args.scope === 'owner' ? args.ownerGhii : undefined,
    limit: 50_000,
  });

  // ── Group by the cut's dimension tuple ──
  const groups = new Map<string, { g: UsageGroup; d: { n: number; sum: number } }>();
  const totals = emptyTotals();
  const totalDuration = { n: 0, sum: 0 };
  const series = new Map<string, { bucket: string; calls: number; cost_usd: number; total_tokens: number }>();

  for (const r of rows) {
    const dims: Partial<Record<UsageDim, string>> = {};
    for (const d of cut.dims) {
      const value = r[d];
      if (value) dims[d] = value;
    }
    const key = cut.dims.length === 0
      // A cut with no dimensions is a pure time series, so the bucket IS the row's identity.
      ? r.bucket
      : (LABEL_ORDER.map(d => dims[d]).find(v => !!v) ?? '(unattributed)');
    const groupKey = cut.dims.length === 0 ? r.bucket : cut.dims.map(d => r[d]).join(' ');

    let entry = groups.get(groupKey);
    if (!entry) {
      entry = { g: { key, dims, ...emptyTotals() }, d: { n: 0, sum: 0 } };
      groups.set(groupKey, entry);
    }
    addRow(entry.g, r, entry.d);
    addRow(totals, r, totalDuration);

    if (args.series) {
      const s = series.get(r.bucket) ?? { bucket: r.bucket, calls: 0, cost_usd: 0, total_tokens: 0 };
      s.calls += r.calls;
      s.cost_usd += r.costUsd;
      s.total_tokens += r.tokensIn + r.tokensOut;
      series.set(r.bucket, s);
    }
  }

  for (const { g, d } of groups.values()) {
    g.duration_ms_avg = d.n > 0 ? Math.round(d.sum / d.n) : 0;
  }
  totals.duration_ms_avg = totalDuration.n > 0 ? Math.round(totalDuration.sum / totalDuration.n) : 0;

  const limit = Math.min(Math.max(args.limit ?? 200, 1), 2000);
  const ordered = [...groups.values()].map(e => e.g).sort((a, b) => {
    // A time series reads chronologically; everything else reads worst-or-biggest first, which is
    // what someone opening a usage report is actually looking for.
    if (cut.dims.length === 0) return a.key.localeCompare(b.key);
    if (b.cost_usd !== a.cost_usd) return b.cost_usd - a.cost_usd;
    return b.calls - a.calls;
  }).slice(0, limit);

  const hotWindowStart = dayNDaysAgo(Number(process.env.AIMEAT_USAGE_HOT_DAYS) || 90);

  return {
    report: args.report,
    cut: cutName,
    grain,
    from,
    to,
    scope: args.scope,
    owner: args.scope === 'owner' ? (args.ownerGhii ?? null) : null,
    series: [...series.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)),
    groups: ordered,
    totals,
    computed_through: await usageComputedThrough(storage),
    // The rollups themselves go back further than raw does. Saying so is what stops someone
    // drilling into an old month and reading an empty raw list as "nothing happened".
    beyond_hot_window: from < hotWindowStart,
  };
}
