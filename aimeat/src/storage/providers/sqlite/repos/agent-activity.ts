/**
 * @file agent-activity.ts
 * @description SQLite implementation for recording and querying agent activity metrics
 * @version-history
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */

import type Database from 'better-sqlite3';
import type { AgentActivityRecord } from '../../../interface.js';

// ── Helpers ──

function deserializeActivity(row: Record<string, unknown>): AgentActivityRecord {
  return {
    agentGaii: row.agentGaii as string,
    date: row.date as string,
    hour: row.hour as number,
    metric: row.metric as string,
    value: row.value as number,
  };
}

// ── Agent Activity ──

export function recordActivity(db: Database.Database, record: AgentActivityRecord): void {
  db.prepare(
    `INSERT INTO agent_activity (agentGaii, date, hour, metric, value)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(agentGaii, date, hour, metric) DO UPDATE SET
       value = agent_activity.value + excluded.value`
  ).run(
    record.agentGaii,
    record.date,
    record.hour,
    record.metric,
    record.value,
  );
}

export function getActivityHistory(
  db: Database.Database,
  agentGaii: string,
  opts?: { days?: number; granularity?: 'daily' | 'hourly' },
): AgentActivityRecord[] {
  const days = opts?.days ?? 30;
  const granularity = opts?.granularity ?? 'daily';
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  if (granularity === 'daily') {
    const rows = db.prepare(
      `SELECT agentGaii, date, 0 as hour, metric, SUM(value) as value
       FROM agent_activity
       WHERE agentGaii = ? AND date >= ?
       GROUP BY agentGaii, date, metric
       ORDER BY date ASC`
    ).all(agentGaii, cutoffStr) as Record<string, unknown>[];
    return rows.map(deserializeActivity);
  }

  // hourly granularity
  const rows = db.prepare(
    `SELECT * FROM agent_activity
     WHERE agentGaii = ? AND date >= ?
     ORDER BY date ASC, hour ASC`
  ).all(agentGaii, cutoffStr) as Record<string, unknown>[];
  return rows.map(deserializeActivity);
}
