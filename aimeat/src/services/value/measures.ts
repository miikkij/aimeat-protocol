/**
 * @file src/services/value/measures.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An organism's own measures: "how many offers go out a week", "how many deals are won",
 *   "the median reply time", counted from the rows of the organism's own workspaces by the row aggregate
 *   (storage aggregateWorkspaceRows). A measure is one memory record the organism's creator or an admin
 *   keeps, or their AI writes, under `reports.measure.<organism>.<id>` in the person's own memory (no
 *   new route, tool or table: a record and the prompt that reads it). The organism's value report
 *   (GET /v1/organisms/:id/value) and an organism or workspace report subscription read the reader's
 *   measures and give their numbers.
 *
 *   WHO SEES A NUMBER. A measure is counted only for a reader who may read the workspace it counts
 *   (canReadWorkspace, the gate GET /v1/organisms/:id/workspace uses), decided at every read, so an
 *   admin who cannot open a private workspace learns nothing of its rows from a sum. The reader must be
 *   the organism's creator or an admin; the callers check that before they ask.
 *
 *   WHAT IT COSTS. One aggregate over the space's rows for the window, plus one per period when `per` is
 *   set. A space holds at most quota.ws_rows_max_per_workspace rows (default 50 000); a median past
 *   WORKSPACE_ROW_MEDIAN_CAP numbers is refused and the measure says so rather than run slow.
 *
 *   HOW IT GOES STALE. A measure whose workspace or space is gone, or that its reader can no longer
 *   read, answers with the reason and no number; the person or their AI removes the record.
 * @structure MEASURE_PREFIX · MEASURE_LIMIT · OrganismMeasure · MeasureResult · parseMeasure · readMeasures
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-n-hy-ty-n-kyy-kulu-hy-ty-ja-k-yt-n-rytmi, organism measures).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { WORKSPACE_ROW_FIELD, type WorkspaceRowAggregateQuery } from '../../storage/types/workspace-rows.js';
import { canReadWorkspace } from '../access-guard.js';
import { readWorkspaceManifest } from '../workspace/meta.js';
import { resolveRowSpace, type RowObjectType } from '../workspace-rows/row-space.js';
import { localAccountName } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';

export const MEASURE_PREFIX = 'reports.measure.';
/** How many measures one reader's organism report counts. */
export const MEASURE_LIMIT = 20;

const OPS = ['count', 'sum', 'avg', 'min', 'max', 'median'] as const;
const PERIODS = ['day', 'week', 'month'] as const;
const ID = /^[A-Za-z0-9_-]{1,128}$/;

export interface OrganismMeasure {
  id: string;
  name: string;
  wsId: string;
  /** The row space, by its objectType name or namespace. */
  space: string;
  op: WorkspaceRowAggregateQuery['op'];
  field?: string;
  where?: Array<{ field: string; value: string | number }>;
  per?: 'day' | 'week' | 'month';
  /** A word for the number, such as "offers" or "min"; shown as written. */
  unit?: string;
}

export interface MeasureResult {
  id: string;
  name: string;
  ws_id: string;
  op: OrganismMeasure['op'];
  unit?: string;
  /** The window's answer; null when no row had a number, or when `problem` says why it was not counted. */
  value: number | null;
  rows: number;
  series?: Array<{ period: string; value: number | null; rows: number }>;
  problem?: 'invalid' | 'no-read' | 'no-space' | 'too-many' | 'failed';
  detail?: string;
}

/** A stored value as a measure, or the reason it is not one. */
export function parseMeasure(id: string, value: unknown): { ok: true; measure: OrganismMeasure } | { ok: false; reason: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'not an object' };
  const v = value as Record<string, unknown>;
  if (typeof v.wsId !== 'string' || !ID.test(v.wsId)) return { ok: false, reason: 'wsId is the workspace id' };
  if (typeof v.space !== 'string' || !v.space.trim()) return { ok: false, reason: 'space names the row space' };
  const op = v.op as OrganismMeasure['op'];
  if (!OPS.includes(op)) return { ok: false, reason: `op is one of ${OPS.join(', ')}` };
  if (op !== 'count' && (typeof v.field !== 'string' || !WORKSPACE_ROW_FIELD.test(v.field))) {
    return { ok: false, reason: 'field names the number to read: k1..k3 or a dotted path into the row' };
  }
  const where: OrganismMeasure['where'] = [];
  if (v.where !== undefined) {
    if (!Array.isArray(v.where) || v.where.length > 5) return { ok: false, reason: 'where is a list of at most five { field, value }' };
    for (const w of v.where as Array<Record<string, unknown>>) {
      if (!w || typeof w.field !== 'string' || !WORKSPACE_ROW_FIELD.test(w.field)
        || (typeof w.value !== 'string' && typeof w.value !== 'number')) {
        return { ok: false, reason: 'each where is { field, value } with a field path and a text or number value' };
      }
      where.push({ field: w.field, value: w.value });
    }
  }
  const per = v.per as OrganismMeasure['per'];
  if (per !== undefined && !PERIODS.includes(per)) return { ok: false, reason: `per is one of ${PERIODS.join(', ')}` };
  return {
    ok: true,
    measure: {
      id, name: typeof v.name === 'string' && v.name.trim() ? v.name.trim().slice(0, 120) : id,
      wsId: v.wsId, space: v.space.trim(), op,
      ...(op !== 'count' ? { field: v.field as string } : {}),
      ...(where.length ? { where } : {}),
      ...(per ? { per } : {}),
      ...(typeof v.unit === 'string' && v.unit.trim() ? { unit: v.unit.trim().slice(0, 24) } : {}),
    },
  };
}

/**
 * The reader's measures of one organism over a window (YYYY-MM-DD, inclusive), optionally only those of
 * one workspace. The reader is a person (GHII) the caller has already found to be the organism's
 * creator or an admin.
 */
export async function readMeasures(
  deps: { storage: Storage; config: AimeatConfig },
  readerGhii: string, orgId: string,
  window: { from: string; to: string; wsId?: string },
): Promise<MeasureResult[]> {
  const { storage, config } = deps;
  const organism = await storage.getOrganism(orgId);
  if (!organism) return [];
  const prefix = `${MEASURE_PREFIX}${orgId}.`;
  const records = await storage.listMemory(readerGhii, { prefix, limit: MEASURE_LIMIT });
  const name = localAccountName(readerGhii);
  const readable = new Map<string, boolean>();
  const out: MeasureResult[] = [];
  for (const rec of records) {
    const id = rec.key.slice(prefix.length);
    const parsed = parseMeasure(id, rec.value);
    if (!parsed.ok) {
      out.push({ id, name: id, ws_id: '', op: 'count', value: null, rows: 0, problem: 'invalid', detail: parsed.reason });
      continue;
    }
    const m = parsed.measure;
    if (window.wsId && m.wsId !== window.wsId) continue;
    const base = { id: m.id, name: m.name, ws_id: m.wsId, op: m.op, ...(m.unit ? { unit: m.unit } : {}) };
    if (!readable.has(m.wsId)) readable.set(m.wsId, await canReadWorkspace(storage, config, organism, name, name, readerGhii, m.wsId));
    if (!readable.get(m.wsId)) { out.push({ ...base, value: null, rows: 0, problem: 'no-read' }); continue; }
    let namespace: string;
    try {
      const manifest = await readWorkspaceManifest(storage, orgId, m.wsId, config.nodeId);
      namespace = resolveRowSpace(manifest?.objectTypes as RowObjectType[] | undefined, m.space).namespace;
    } catch (err) {
      out.push({ ...base, value: null, rows: 0, problem: 'no-space', detail: err instanceof Error ? err.message : String(err) });
      continue;
    }
    const query: WorkspaceRowAggregateQuery = {
      organismId: orgId, wsId: m.wsId, namespace, op: m.op,
      ...(m.field ? { field: m.field } : {}), ...(m.where ? { where: m.where } : {}),
      from: `${window.from}T00:00:00.000Z`, to: `${window.to}T23:59:59.999Z`,
    };
    try {
      const [total] = await storage.aggregateWorkspaceRows(query);
      const series = m.per ? await storage.aggregateWorkspaceRows({ ...query, period: m.per }) : undefined;
      out.push({ ...base, value: total?.value ?? null, rows: total?.rows ?? 0, ...(series ? { series: series.map(s => ({ period: s.period ?? '', value: s.value, rows: s.rows })) } : {}) });
    } catch (err) {
      // The repository refuses a median past its cap rather than run slow; anything else is logged.
      const msg = err instanceof Error ? err.message : String(err);
      const tooMany = msg.startsWith('TOO_MANY_ROWS');
      if (!tooMany) logger.warn('measures: an aggregate failed', { orgId, ws: m.wsId, id: m.id, error: msg });
      out.push({ ...base, value: null, rows: 0, problem: tooMany ? 'too-many' : 'failed', detail: msg });
    }
  }
  return out;
}
