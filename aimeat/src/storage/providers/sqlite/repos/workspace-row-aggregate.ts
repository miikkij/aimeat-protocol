/**
 * @file src/storage/providers/sqlite/repos/workspace-row-aggregate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite SQL for aggregateWorkspaceRows: a count, sum, average, minimum, maximum or median
 *   over a row space's rows (types/workspace-rows.ts WorkspaceRowAggregateQuery). A body field is read
 *   with json_extract and a parameter path; a field name never reaches the SQL text unless it is one of
 *   the three index columns. The median reads its numbers and is computed here, the same way on both
 *   providers, so the answers cannot drift.
 * @structure aggregateRows · medianOf
 * @usage import { aggregateRows } from '../repos/workspace-row-aggregate.js';
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-n-hy-ty-n-kyy-kulu-hy-ty-ja-k-yt-n-rytmi, phase 1).
 */
import type Database from 'better-sqlite3';
import {
  WORKSPACE_ROW_FIELD, WORKSPACE_ROW_MEDIAN_CAP,
  type WorkspaceRowAggregateQuery, type WorkspaceRowAggregate,
} from '../../../types/workspace-rows.js';

/** The SQL that reads a field: an index column by name, a body path by json_extract and a parameter. */
function fieldExpr(field: string, args: unknown[]): string {
  if (!WORKSPACE_ROW_FIELD.test(field)) throw new Error(`INVALID_FIELD: ${field}`);
  if (/^k[123]$/.test(field)) return field;
  args.push(`$.${field}`);
  return 'json_extract(body, ?)';
}

function periodExpr(period: WorkspaceRowAggregateQuery['period']): string | null {
  if (period === 'day') return 'substr(occurredAt, 1, 10)';
  if (period === 'month') return 'substr(occurredAt, 1, 7)';
  if (period === 'week') return `date(substr(occurredAt, 1, 10), 'weekday 0', '-6 days')`;
  return null;
}

/** The median of sorted numbers; the mean of the two middle ones for an even count. */
export function medianOf(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function aggregateRows(db: Database.Database, q: WorkspaceRowAggregateQuery): WorkspaceRowAggregate[] {
  const whereArgs: unknown[] = [q.organismId, q.wsId, q.namespace];
  const where = ['organismId = ?', 'wsId = ?', 'namespace = ?'];
  for (const cond of q.where ?? []) {
    const expr = fieldExpr(cond.field, whereArgs);
    where.push(`CAST(${expr} AS TEXT) = ?`);
    whereArgs.push(String(cond.value));
  }
  if (q.from) { where.push('occurredAt >= ?'); whereArgs.push(q.from); }
  if (q.to) { where.push('occurredAt <= ?'); whereArgs.push(q.to); }
  const period = periodExpr(q.period);
  const periodSel = period ?? 'NULL';

  if (q.op === 'count') {
    const sql = `SELECT ${periodSel} AS period, COUNT(*) AS rows FROM workspace_rows WHERE ${where.join(' AND ')}`
      + (period ? ' GROUP BY 1 ORDER BY 1' : '');
    return (db.prepare(sql).all(...whereArgs) as Array<{ period: string | null; rows: number }>)
      .map(r => ({ period: r.period ?? null, value: Number(r.rows), rows: Number(r.rows) }));
  }

  if (!q.field) throw new Error('INVALID_FIELD: this measure needs a field');
  const valueArgs: unknown[] = [];
  const valueExpr = fieldExpr(q.field, valueArgs);
  // A number only: a string, a boolean or an absent field is not summed and does not count as a value.
  const num = `CASE WHEN typeof(${valueExpr}) IN ('integer', 'real') THEN ${valueExpr} END`;
  const numArgs = /^k[123]$/.test(q.field) ? [] : [...valueArgs, ...valueArgs];

  if (q.op === 'median') {
    const sql = `SELECT ${periodSel} AS period, ${num} AS v FROM workspace_rows WHERE ${where.join(' AND ')} LIMIT ?`;
    const rows = db.prepare(sql).all(...numArgs, ...whereArgs, WORKSPACE_ROW_MEDIAN_CAP + 1) as Array<{ period: string | null; v: number | null }>;
    if (rows.length > WORKSPACE_ROW_MEDIAN_CAP) throw new Error(`TOO_MANY_ROWS: a median reads at most ${WORKSPACE_ROW_MEDIAN_CAP} rows`);
    const groups = new Map<string | null, { values: number[]; rows: number }>();
    for (const r of rows) {
      const key = r.period ?? null;
      const g = groups.get(key) ?? { values: [], rows: 0 };
      g.rows += 1;
      if (typeof r.v === 'number') g.values.push(r.v);
      groups.set(key, g);
    }
    return [...groups.entries()]
      .sort((a, b) => String(a[0] ?? '').localeCompare(String(b[0] ?? '')))
      .map(([p, g]) => ({ period: p, value: medianOf(g.values.sort((x, y) => x - y)), rows: g.rows }));
  }

  const fn = { sum: 'SUM', avg: 'AVG', min: 'MIN', max: 'MAX' }[q.op];
  const sql = `SELECT ${periodSel} AS period, ${fn}(${num}) AS v, COUNT(*) AS rows FROM workspace_rows WHERE ${where.join(' AND ')}`
    + (period ? ' GROUP BY 1 ORDER BY 1' : '');
  return (db.prepare(sql).all(...numArgs, ...whereArgs) as Array<{ period: string | null; v: number | null; rows: number }>)
    .map(r => ({ period: r.period ?? null, value: r.v === null || r.v === undefined ? null : Number(r.v), rows: Number(r.rows) }));
}
