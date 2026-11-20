/**
 * @file src/services/value/report.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The value report: what the AI made, what happened to it, what it cost, and what it
 *   saved against the baseline the person gave, for one of four scopes. The same report answers
 *   aimeat_usage_report `report: "value"` (GET /v1/usage/summary), the operator's aimeat_admin_usage
 *   `report: "value"` (GET /v1/admin/usage/summary) and the organism's GET /v1/organisms/:id/value.
 *
 *   WHO SEES WHAT. `own`: the person's own numbers, per agent and per goal. `organism` and `workspace`:
 *   the organism's sums per feature, never per member or per agent, so a lead reading the team's
 *   numbers does not learn whose work was corrected. `node`: the operator's sums per feature, and a
 *   feature with fewer than VALUE_NODE_MIN_OWNERS owners behind it is left out and counted, so a small
 *   node does not name a person through a count.
 *
 *   THE SAVING is counted, not estimated: minutes per result times the results still standing, or
 *   minutes per week or month times the weeks or months that had one. A model reading the report
 *   interprets it; the report itself states only what the node counted.
 * @structure VALUE_NODE_MIN_OWNERS · ValueScope · ValueReport · readValueReport · goalValue
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-n-hy-ty-n-kyy-kulu-hy-ty-ja-k-yt-n-rytmi, phase 2).
 */
import type { Storage, ValueKeyRow, ValueSignal } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { VALUE_SIGNALS } from '../../storage/types/value.js';
import { listGoals } from '../goals/goals-store.js';
import type { GoalRecord } from '../goals/goals-types.js';
import { readUsageReport, dayNDaysAgo } from '../usage/usage-read.js';
import { valueRecordOf, VALUE_READ_ENDPOINTS, REJECTION_WINDOW_DAYS, flushValueSignals } from './signal-buffer.js';
import { rhythmOf, BURST_FACTOR, BURST_WINDOW } from './rhythm.js';
import { TALLY_DOORS } from '../data-map/write-tally-buffer.js';
import { logger } from '../../utils/logger.js';

/** A node-wide group with fewer owners behind it than this is left out of the operator's report. */
export const VALUE_NODE_MIN_OWNERS = 5;

export type ValueScope =
  | { kind: 'own'; ownerGhii: string }
  | { kind: 'organism'; orgId: string; wsId?: string }
  | { kind: 'node' };

type Signals = Record<ValueSignal, number>;
const zero = (): Signals => Object.fromEntries(VALUE_SIGNALS.map(s => [s, 0])) as Signals;

export interface GoalValue {
  goal_id: string;
  title: string;
  status: string;
  baseline: GoalRecord['baseline'] | null;
  /** Results the goal's works delivered. */
  results: number;
  /** Of those still standing: kept as they were, changed by someone else, opened by someone else. */
  as_is: number;
  corrected: number;
  used: number;
  /** Delivered and since deleted, or never made by an AI the node watches. */
  gone: number;
  /** Counted from the baseline; null without one. */
  saving_minutes: number | null;
  cost_usd: number;
}

export interface ValueReport {
  report: 'value';
  scope: ValueScope['kind'];
  from: string;
  to: string;
  signals: Signals;
  correction_bytes: number;
  by_producer?: Array<{ producer: string } & Signals>;
  by_family: Array<{ family: string; owners?: number } & Signals>;
  /** Node scope: how many feature groups were left out for having too few owners behind them. */
  hidden_groups?: number;
  series: Array<{ day: string } & Signals>;
  rhythm: ReturnType<typeof rhythmOf>;
  cost_usd: number | null;
  goals?: GoalValue[];
  /** What the numbers cover and how each signal is told, so a reader does not take more from them. */
  rules: {
    rejection_window_days: number;
    burst: string;
    write_endpoints: readonly string[];
    read_endpoints: readonly string[];
    ai_is: string;
  };
}

function sumsBy<K extends string>(rows: Array<Record<string, unknown> & { signal?: ValueSignal; count: number }>, key: K): Map<string, Signals> {
  const out = new Map<string, Signals>();
  for (const r of rows) {
    const k = String(r[key] ?? '');
    const s = out.get(k) ?? zero();
    if (r.signal) s[r.signal] += r.count;
    out.set(k, s);
  }
  return out;
}

/** What one goal's works delivered and what happened to it since. */
export async function goalValue(storage: Storage, goal: GoalRecord): Promise<GoalValue> {
  const delivered = goal.material.filter(m => m.kind === 'result' && m.ref && m.by);
  const pairs = delivered.map(m => valueRecordOf(m.by, m.ref));
  const states = pairs.length ? await storage.getValueKeys(pairs) : [];
  const byPair = new Map<string, ValueKeyRow>(states.map(s => [`${s.ownerGaii}\u0000${s.key}`, s]));
  let asIs = 0, corrected = 0, used = 0, gone = 0;
  const periods = new Set<string>();
  for (const p of pairs) {
    const s = byPair.get(`${p.ownerGaii}\u0000${p.key}`);
    if (!s) { gone++; continue; }
    if (s.corrections > 0) corrected++; else asIs++;
    if (s.readsByOthers > 0) used++;
    periods.add(goal.baseline?.per === 'month' ? s.producedAt.slice(0, 7) : isoWeek(s.producedAt));
  }
  const b = goal.baseline ?? null;
  const standing = asIs + corrected;
  const saving = !b ? null : b.per === 'result' ? b.minutes * standing : b.minutes * periods.size;
  return {
    goal_id: goal.id, title: goal.title, status: goal.status, baseline: b,
    results: delivered.length, as_is: asIs, corrected, used, gone,
    saving_minutes: saving, cost_usd: Math.round((goal.spent?.usd ?? 0) * 10_000) / 10_000,
  };
}

/** The Monday of an instant's week, YYYY-MM-DD. */
function isoWeek(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** The value report for one scope over a span (default the last 30 days). */
export async function readValueReport(
  deps: { storage: Storage; config?: AimeatConfig },
  scope: ValueScope,
  opts: { from?: string; to?: string } = {},
): Promise<ValueReport> {
  const { storage } = deps;
  // What waits in the buffer is written first, so the report counts the last seconds too.
  await flushValueSignals();
  const from = opts.from ?? dayNDaysAgo(30);
  const to = opts.to ?? dayNDaysAgo(0);
  const filter = scope.kind === 'own' ? { ownerGhii: scope.ownerGhii, from, to }
    : scope.kind === 'organism' ? { orgId: scope.orgId, ...(scope.wsId ? { wsId: scope.wsId } : {}), from, to }
      : { from, to };

  const bySignal = await storage.sumValueDaily(filter, ['signal']);
  const signals = zero();
  let correctionBytes = 0;
  for (const r of bySignal) {
    if (!r.signal) continue;
    signals[r.signal] += r.count;
    if (r.signal === 'corrected') correctionBytes += r.bytes;
  }

  const byDay = await storage.sumValueDaily(filter, ['day', 'signal']);
  const series = [...sumsBy(byDay as never, 'day').entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, s]) => ({ day, ...s }));
  const rhythm = rhythmOf(series.map(d => ({ day: d.day, count: d.produced + d.refined })));

  const byFamilyRows = await storage.sumValueDaily(filter, ['family', 'signal']);
  const familyOwners = scope.kind === 'node' ? await storage.sumValueDaily(filter, ['family']) : [];
  const ownersOf = new Map(familyOwners.map(r => [r.family ?? '', r.owners]));
  let hidden = 0;
  const by_family = [...sumsBy(byFamilyRows as never, 'family').entries()]
    .filter(([family]) => {
      if (scope.kind !== 'node') return true;
      const keep = (ownersOf.get(family) ?? 0) >= VALUE_NODE_MIN_OWNERS;
      if (!keep) hidden++;
      return keep;
    })
    .map(([family, s]) => ({ family, ...s, ...(scope.kind === 'node' ? { owners: ownersOf.get(family) ?? 0 } : {}) }))
    .sort((a, b) => (b.produced + b.refined) - (a.produced + a.refined));

  const report: ValueReport = {
    report: 'value', scope: scope.kind, from, to, signals, correction_bytes: correctionBytes,
    by_family, series, rhythm, cost_usd: null,
    ...(scope.kind === 'node' ? { hidden_groups: hidden } : {}),
    rules: {
      rejection_window_days: REJECTION_WINDOW_DAYS,
      burst: `a day above ${BURST_FACTOR} times the median of the ${BURST_WINDOW} days before it`,
      write_endpoints: TALLY_DOORS,
      read_endpoints: VALUE_READ_ENDPOINTS,
      ai_is: 'an agent or a scheduled AI job; a person, an app the person uses and an extension are not',
    },
  };

  if (scope.kind === 'own') {
    const byProducer = await storage.sumValueDaily(filter, ['producer', 'signal']);
    report.by_producer = [...sumsBy(byProducer as never, 'producer').entries()]
      .map(([producer, s]) => ({ producer, ...s }))
      .sort((a, b) => (b.produced + b.refined) - (a.produced + a.refined));
    // The goals read the node's config; a caller without it (none today) gets the report without them.
    const goals = deps.config
      ? await listGoals({ storage, config: deps.config }, scope.ownerGhii).catch((err: unknown) => {
        logger.warn('value report: the goals read failed, the report goes without them', { error: String(err) });
        return [] as GoalRecord[];
      })
      : [];
    report.goals = await Promise.all(goals.filter(g => g.baseline || g.material.some(m => m.kind === 'result'))
      .map(g => goalValue(storage, g)));
  }

  if (scope.kind === 'own' || scope.kind === 'node') {
    try {
      const usage = await readUsageReport(storage, scope.kind === 'own'
        ? { report: 'day', scope: 'owner', ownerGhii: scope.ownerGhii, from, to }
        : { report: 'day', scope: 'node', from, to });
      report.cost_usd = Math.round(usage.totals.cost_usd * 10_000) / 10_000;
    } catch (err) {
      logger.warn('value report: the cost read failed, the report goes without it', { error: String(err) });
    }
  }
  return report;
}
