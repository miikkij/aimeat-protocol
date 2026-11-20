/**
 * @file src/services/value/data-report.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What data passed through, without the data: the report `data` of aimeat_usage_report
 *   (the person's own, GET /v1/usage/summary) and of aimeat_admin_usage (the node's, GET
 *   /v1/admin/usage/summary). Counts and bytes by kind, source, direction, size class, classification
 *   label and content class, from the day counts (services/value/data-buffer.ts).
 *
 *   THREE RULES KEEP THE OPERATOR'S REPORT FROM NAMING ANYBODY. Nothing in it is a key, a title, a file
 *   name or a value, because none of those is stored. A group with fewer than VALUE_NODE_MIN_OWNERS
 *   owners behind it is left out and counted in `hidden_groups`, so a small node does not show "one
 *   highly confidential contract" that everyone can attribute. And content at the node's highest
 *   labels (rank HIGH_RANK and above) is counted as one total and never split by content class.
 *   The person's own report has none of those limits: the data is theirs.
 * @structure HIGH_RANK · DataReport · readDataReport
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-n-hy-ty-n-kyy-kulu-hy-ty-ja-k-yt-n-rytmi, phase 2).
 */
import type { Storage } from '../../storage/interface.js';
import type { DataDailyGroup, DataDailyFilter } from '../../storage/types/value.js';
import { dayNDaysAgo } from '../usage/usage-read.js';
import { readNodePolicy } from '../classification/policy.js';
import { VALUE_NODE_MIN_OWNERS } from './report.js';
import { DATA_ENDPOINTS, flushDataCounts } from './data-buffer.js';
import { rhythmOf } from './rhythm.js';

/** A label at or above this rank is counted only as one total in the operator's report. */
export const HIGH_RANK = 30;

type Row = { key: string; count: number; bytes: number; owners?: number };

export interface DataReport {
  report: 'data';
  scope: 'own' | 'node';
  from: string;
  to: string;
  total: { count: number; bytes: number };
  by_kind: Row[];
  by_source: Row[];
  by_direction: Row[];
  by_size: Row[];
  by_level: Row[];
  by_class: Row[];
  /** Node scope: the content at the highest labels, as one total and never by class. */
  high_labels?: { count: number; bytes: number };
  /** Node scope: how many groups were left out for having too few owners behind them. */
  hidden_groups?: number;
  rhythm: ReturnType<typeof rhythmOf>;
  rules: { endpoints: readonly string[]; min_owners: number | null; stored: string };
}

/** The data report for one person or for the node over a span (default the last 30 days). */
export async function readDataReport(
  storage: Storage, nodeId: string,
  scope: { kind: 'own'; ownerGhii: string } | { kind: 'node' },
  opts: { from?: string; to?: string } = {},
): Promise<DataReport> {
  await flushDataCounts();
  const from = opts.from ?? dayNDaysAgo(30);
  const to = opts.to ?? dayNDaysAgo(0);
  const filter: DataDailyFilter = scope.kind === 'own' ? { ownerGhii: scope.ownerGhii, from, to } : { from, to };
  const node = scope.kind === 'node';
  let hidden = 0;

  const highIds = new Set<string>();
  if (node) {
    const policy = await readNodePolicy(storage, nodeId);
    for (const l of policy.labels) if (l.rank >= HIGH_RANK) highIds.add(l.id);
  }

  // A row of source `classified` is an inspection's verdict on an item already counted as a write, so
  // every count but the class leaves it out. The owners behind a merged group are the largest of its
  // parts: a lower bound, so the threshold hides a group rather than shows one too early.
  const groupOf = async (col: DataDailyGroup): Promise<Row[]> => {
    const merged = new Map<string, { count: number; bytes: number; owners: number }>();
    for (const r of await storage.sumDataDaily(filter, [col, 'source'])) {
      if (r.source === 'classified') continue;
      const k = String((r as unknown as Record<string, unknown>)[col] ?? '');
      const had = merged.get(k) ?? { count: 0, bytes: 0, owners: 0 };
      had.count += r.count; had.bytes += r.bytes; had.owners = Math.max(had.owners, r.owners);
      merged.set(k, had);
    }
    const out: Row[] = [];
    for (const [key, v] of merged) {
      if (node && v.owners < VALUE_NODE_MIN_OWNERS) { hidden++; continue; }
      out.push({ key, count: v.count, bytes: v.bytes, ...(node ? { owners: v.owners } : {}) });
    }
    return out.sort((a, b) => b.count - a.count);
  };

  const totalRow = (await storage.sumDataDaily(filter, ['source'])).filter(r => r.source !== 'classified')
    .reduce((t, r) => ({ count: t.count + r.count, bytes: t.bytes + r.bytes }), { count: 0, bytes: 0 });
  // A class row is counted where an inspection gave one; at a high label it never shows by class.
  const classRows = node
    ? (await storage.sumDataDaily(filter, ['contentClass', 'level'])).filter(r => r.contentClass && !highIds.has(r.level ?? ''))
    : (await storage.sumDataDaily(filter, ['contentClass'])).filter(r => r.contentClass);
  const byClass = new Map<string, { count: number; bytes: number; owners: number }>();
  for (const r of classRows) {
    const k = r.contentClass ?? '';
    const had = byClass.get(k) ?? { count: 0, bytes: 0, owners: 0 };
    had.count += r.count; had.bytes += r.bytes; had.owners = Math.max(had.owners, r.owners);
    byClass.set(k, had);
  }
  const by_class: Row[] = [];
  for (const [key, v] of byClass) {
    if (node && v.owners < VALUE_NODE_MIN_OWNERS) { hidden++; continue; }
    by_class.push({ key, count: v.count, bytes: v.bytes, ...(node ? { owners: v.owners } : {}) });
  }
  by_class.sort((a, b) => b.count - a.count);

  const report: DataReport = {
    report: 'data', scope: scope.kind, from, to,
    total: totalRow,
    by_kind: await groupOf('kind'),
    by_source: await groupOf('source'),
    by_direction: await groupOf('direction'),
    by_size: await groupOf('sizeBucket'),
    by_level: (await groupOf('level')).filter(r => !node || !highIds.has(r.key)),
    by_class,
    rhythm: rhythmOf((await storage.sumDataDaily(filter, ['day', 'source'])).filter(r => r.source !== 'classified').map(r => ({ day: r.day ?? '', count: r.count }))),
    rules: {
      endpoints: DATA_ENDPOINTS,
      min_owners: node ? VALUE_NODE_MIN_OWNERS : null,
      stored: 'counts and bytes by kind, source, direction, size class, label and content class; no key, title, file name or value',
    },
  };
  if (node) {
    let hc = 0, hb = 0;
    for (const r of await storage.sumDataDaily(filter, ['level'])) if (highIds.has(r.level ?? '')) { hc += r.count; hb += r.bytes; }
    report.high_labels = { count: hc, bytes: hb };
    report.hidden_groups = hidden;
  }
  return report;
}
