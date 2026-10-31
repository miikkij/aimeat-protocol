/**
 * @file kpi-rollup.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Compute a measurability KPI's current value from a workspace's OWN published records —
 *   the `source: { from:'records', ... }` aggregation of the organism-measurability convention. PURE
 *   (no IO): the caller passes the already-listed workspace records + the manifest objectTypes, so the
 *   read authorization that already gated those records is inherited and there is no extra storage hit.
 *   Only the `from:'records'` source form is computed; a free-text string `source` (you measure it by
 *   hand) — or the agent-ops telemetry/wallet/quota sources (design §5, not built) — returns null, and
 *   the caller keeps the KPI's declared `current`. Records are collapsed to their PUBLISHED instance
 *   (`.latest` ?? bare; drafts + `.version.N` history ignored), matching every workspace read surface.
 *   Design: docs/internal/2026-06-23-organism-measurability-design.md (Phase B).
 * @structure
 *   - RecordsKpiSource · isRecordsSource(source)
 *   - evaluateRecordsKpi(records, objectTypes, root, source) → number | null
 * @usage
 *   import { isRecordsSource, evaluateRecordsKpi } from '../services/kpi-rollup.js';
 *   if (isRecordsSource(kpi.source)) current = evaluateRecordsKpi(items, objectTypes, root, kpi.source);
 * @version-history
 *   v1.0.0 — 2026-06-23 — Initial: sum/count/avg/min/max over a space's published records, with an
 *     optional structured equality filter { field, value }. Workspace-local (source.space resolves
 *     within the same workspace); org-level / cross-workspace sources are deferred.
 *   2026-11-01 — A record's id is read from the end of its key (spaceRowAt), so a record whose id
 *     holds a dot is aggregated under its whole id; it was left out (secaudit2026oct31w2 round 10b).
 */
import type { MemoryRecord } from '../storage/interface.js';
import { spacePrefixesOf, spaceRowAt } from './workspace-record-key.js';

export type KpiAgg = 'sum' | 'count' | 'avg' | 'min' | 'max';

/** A KPI source that aggregates the organism's own published records. `space` is an objectType NAME
 *  (preferred) or its namespace, within the same workspace. `field` is required for sum/avg/min/max
 *  (ignored by count); `equals` is an optional structured filter (NOT an expression string — by design,
 *  to avoid a predicate parser / injection surface). */
export interface RecordsKpiSource {
  from: 'records';
  space: string;
  agg: KpiAgg;
  field?: string;
  equals?: { field: string; value: unknown };
}

type ObjType = { name?: unknown; namespace?: unknown };

const AGGS = new Set<KpiAgg>(['sum', 'count', 'avg', 'min', 'max']);

/** Type guard: is this a computable `from:'records'` source (vs a string recipe or an agent-ops source)? */
export function isRecordsSource(source: unknown): source is RecordsKpiSource {
  if (!source || typeof source !== 'object') return false;
  const s = source as Record<string, unknown>;
  return s.from === 'records' && typeof s.space === 'string' && AGGS.has(s.agg as KpiAgg);
}

/**
 * Aggregate a workspace's published records for a `from:'records'` KPI. Returns the number, or null
 * when it cannot be computed (space not found in this workspace; sum/avg/min/max with no `field` or no
 * numeric rows). `count` always returns a number (0 when nothing matches). `root` is the workspace root
 * WITHOUT a trailing dot, e.g. `organism.{id}.w.{ws}`.
 */
export function evaluateRecordsKpi(
  records: MemoryRecord[],
  objectTypes: ObjType[],
  root: string,
  source: RecordsKpiSource,
): number | null {
  // Resolve the space → namespace via a DECLARED objectType (name first, then namespace). A `space`
  // that matches no objectType is a misconfigured KPI → null (don't silently aggregate an empty
  // phantom namespace, which would mask a typo as "0"). An existing-but-empty space still sums to 0.
  const ot = objectTypes.find(o => o.name === source.space) ?? objectTypes.find(o => o.namespace === source.space);
  const namespace = typeof ot?.namespace === 'string' ? ot.namespace : undefined;
  if (!namespace) return null;

  // Collapse to published instances: prefer `.latest`, else a bare write; ignore `.draft` + `.version.N`.
  const nsPrefix = `${root}.${namespace}.`;
  const prefixes = spacePrefixesOf(root, objectTypes);
  const current = new Map<string, MemoryRecord>();
  for (const r of records) {
    // The id is read from the end of the key (spaceRowAt), so a record whose id holds a dot counts
    // once under its whole id (secaudit2026oct31w2 round 10b).
    const row = spaceRowAt(r.key, nsPrefix, prefixes);
    if (row?.copy !== 'bare' && row?.copy !== 'latest') continue;   // draft / version.N → not the published value
    const prev = current.get(row.id);
    if (!prev || row.copy === 'latest') current.set(row.id, r);
  }

  const rows = [...current.values()]
    .map(r => r.value)
    .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v));
  const matched = source.equals
    ? rows.filter(v => v[source.equals!.field] === source.equals!.value)
    : rows;

  if (source.agg === 'count') return matched.length;
  if (!source.field) return null;   // sum/avg/min/max need a field to aggregate
  const nums: number[] = [];
  for (const v of matched) {
    const n = v[source.field];
    if (typeof n === 'number' && Number.isFinite(n)) nums.push(n);
  }
  if (source.agg === 'sum') return nums.reduce((a, b) => a + b, 0);
  if (nums.length === 0) return null;   // avg/min/max of an empty set is undefined
  if (source.agg === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length;
  if (source.agg === 'min') return Math.min(...nums);
  return Math.max(...nums);   // 'max'
}
