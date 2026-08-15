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
import type {
  Storage, UsageRollupRow, UsageRollupDelta, UsageRollupFilter,
} from '../../storage/interface.js';
import { findCut, type UsageDim } from './rollup-cuts.js';
import { pendingRollupDeltas } from './rollup-engine.js';
import { pendingUsageCalls } from './usage-buffer.js';

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

/**
 * The separator inside an in-memory grouping key. A dimension value can contain a space, a slash or
 * a colon (`apptool:alice/app.html`, an owner GHII, a model id), so a printable separator would let
 * two DIFFERENT dimension tuples collide into one bucket and silently merge two rows' numbers. A
 * control character cannot appear in any of them. Written as an escape rather than a literal, so it
 * stays visible in an editor and the file stays text to grep.
 */
const DIM_SEPARATOR = '\u0000';

/**
 * Which dimension NAMES a row, for the display label. First match wins.
 *
 * `outcome` is deliberately absent. It qualifies a row rather than identifying one, and having it
 * as a fallback made an app-opens table label an unattributed row "ok" — a heading that reads like
 * an app name and is not one. A row none of these can name is honestly "(unattributed)".
 */
const LABEL_ORDER: UsageDim[] = [
  'model', 'appId', 'coordinate', 'actorGaii', 'surface', 'ownerGhii', 'counterpartyGhii', 'provider',
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

/** A delta carries no id or updatedAt; a reader only ever sums, so both are cosmetic here. */
function deltaAsRow(d: UsageRollupDelta): UsageRollupRow {
  return { ...d, id: '', extra: d.extra ?? {}, updatedAt: '' };
}

/** Does a not-yet-folded delta belong in the answer this filter asked for? */
function deltaMatches(d: UsageRollupDelta, filter: UsageRollupFilter, grain: 'hour' | 'day'): boolean {
  if (d.cut !== filter.cut || d.grain !== grain) return false;
  if (filter.from && d.bucket < filter.from) return false;
  if (filter.to && d.bucket > filter.to) return false;
  if (filter.ownerGhii && d.ownerGhii !== filter.ownerGhii) return false;
  if (filter.appId && d.appId !== filter.appId) return false;
  if (filter.actorGaii && d.actorGaii !== filter.actorGaii) return false;
  if (filter.counterpartyGhii && d.counterpartyGhii !== filter.counterpartyGhii) return false;
  return true;
}

/**
 * Read a cut INCLUDING what the fold has not caught up on yet.
 *
 * The stored rows answer the history; the pending deltas answer the last few minutes. Merging them
 * here rather than making every caller do it is what lets both the owner reports and the two
 * operator aggregates be live and bounded at the same time — the alternative was either a stale
 * dashboard or the full-table scan this whole layer replaced.
 *
 * Exported because the operator aggregates (ledger-admin, ai-usage-admin) compose their own shapes
 * from the same cuts and must not accidentally read only the folded half.
 */
export async function queryUsageRollupLive(
  storage: Storage,
  filter: UsageRollupFilter,
  stream: 'llm' | 'call',
): Promise<UsageRollupRow[]> {
  const grain = filter.grain ?? 'day';
  const [stored, pending] = await Promise.all([
    storage.queryUsageRollup({ ...filter, grain }),
    pendingRollupDeltas(storage, stream, stream === 'call' ? pendingUsageCalls({}) : []),
  ]);
  const extra = pending.filter(d => deltaMatches(d, filter, grain)).map(deltaAsRow);
  return extra.length ? [...stored, ...extra] : stored;
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

  const rows = await queryUsageRollupLive(storage, {
    cut: cutName,
    grain,
    from,
    to: grain === 'hour' ? `${to}T23` : to,
    // The whole reason owner scoping is safe here: an owner report is a cut that CARRIES ownerGhii,
    // and the value comes from the route's resolved identity, never from a query parameter.
    ownerGhii: args.scope === 'owner' ? args.ownerGhii : undefined,
    limit: 50_000,
  }, cut.stream);

  // ── Group by the cut's dimension tuple ──
  const groups = new Map<string, { g: UsageGroup; d: { n: number; sum: number } }>();
  const totals = emptyTotals();
  const totalDuration = { n: 0, sum: 0 };
  const series = new Map<string, { bucket: string; calls: number; cost_usd: number; total_tokens: number }>();

  // The dimensions a row is actually GROUPED by, after two removals.
  //
  //   ownerGhii, when the scope already pinned it. An owner-scoped read of `llm.owner` pins the only
  //   dimension that cut has, so what is left to distinguish one row from another is time — which is
  //   why "spend per day" groups by bucket instead of showing one row labelled with the reader's own
  //   identity.
  //
  //   outcome, always. It QUALIFIES a call, it does not identify one, and `refusals` and `errors`
  //   are already metrics on every row. Grouping by it too split one surface into an ok row and an
  //   error row that both read "mcp", which is a table that answers no question anyone asked.
  //
  // Derived rather than declared per report, so a new cut gets the right shape with nothing for its
  // author to remember.
  const groupDims = cut.dims.filter(d =>
    d !== 'outcome' && !(d === 'ownerGhii' && args.scope === 'owner'));
  const isTimeSeries = groupDims.length === 0;

  for (const r of rows) {
    const dims: Partial<Record<UsageDim, string>> = {};
    for (const d of groupDims) {
      const value = r[d];
      if (value) dims[d] = value;
    }
    const key = isTimeSeries
      // Nothing but time distinguishes these rows, so the bucket IS the row's identity.
      ? r.bucket
      : (LABEL_ORDER.map(d => dims[d]).find(v => !!v) ?? '(unattributed)');
    const groupKey = isTimeSeries ? r.bucket : groupDims.map(d => r[d]).join(DIM_SEPARATOR);

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
    if (isTimeSeries) return a.key.localeCompare(b.key);
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
