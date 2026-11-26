/**
 * @file src/services/usage/trail-summary.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the node itself recorded an agent or an app doing, summed up: the calls it served
 *   (every MCP tool call and every REST write, services/usage/usage-buffer.ts), how many were refused
 *   or failed, how long they took, which tools and which refusal reasons came up most. Read from the
 *   trail rows (`usage_calls`), never from anything the agent reported about itself.
 *
 *   WHY. An agent's telemetry (aimeat_agent_telemetry_report) and its runtime report
 *   (aimeat_agent_runtime_report) are the agent's own claims, and the node stored them unchecked. The
 *   node serves every call an agent makes to it, so it already holds the record nobody can edit: this
 *   reads it the way an owner asks it ("what has my agent actually done today?"). Self-report is weak
 *   evidence: in METR's 2025 study developers believed they were faster while they were measured
 *   slower. The paper this was asked from (Google, "The New SDLC With Vibe Coding", May 2026) asks
 *   for a trace of every agent run.
 *
 *   BOUNDED. One summary reads at most SUMMARY_ROWS rows of the window and says when it stopped there.
 * @structure summarizeTrailRows(rows) · TrailSummary · SUMMARY_ROWS
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-a-trace-that-the-node-records-of-what-an-agent-or-app-did).
 */
import type { UsageCallRecord } from '../../storage/types/usage.js';

/** The most rows one summary reads. */
export const SUMMARY_ROWS = 5000;
const TOP = 5;

export interface TrailSummary {
  calls: number;
  ok: number;
  refused: number;
  error: number;
  /** Median and 95th percentile of the time the node took, in milliseconds. */
  ms_p50: number | null;
  ms_p95: number | null;
  /** The tools or routes called most, with how often and how often refused or failed. */
  top: Array<{ code: string; calls: number; failed: number }>;
  /** The refusal and error codes seen most. */
  reasons: Array<{ reason: string; count: number }>;
  first_at: string | null;
  last_at: string | null;
  /** True when the window held more rows than one summary reads. */
  truncated: boolean;
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

/** The summary of the rows given, newest or oldest first. */
export function summarizeTrailRows(rows: readonly UsageCallRecord[], truncated = false): TrailSummary {
  const ms = rows.map(r => r.durationMs).filter((n): n is number => typeof n === 'number' && Number.isFinite(n)).sort((a, b) => a - b);
  const byCode = new Map<string, { calls: number; failed: number }>();
  const byReason = new Map<string, number>();
  let ok = 0, refused = 0, error = 0;
  let first: string | null = null, last: string | null = null;
  for (const r of rows) {
    if (r.outcome === 'ok') ok++; else if (r.outcome === 'refused') refused++; else error++;
    const c = byCode.get(r.coordinate) ?? { calls: 0, failed: 0 };
    c.calls++;
    if (r.outcome !== 'ok') c.failed++;
    byCode.set(r.coordinate, c);
    if (r.outcome !== 'ok' && r.reason) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
    if (!first || r.ts < first) first = r.ts;
    if (!last || r.ts > last) last = r.ts;
  }
  return {
    calls: rows.length, ok, refused, error,
    ms_p50: percentile(ms, 50), ms_p95: percentile(ms, 95),
    top: [...byCode.entries()].sort((a, b) => b[1].calls - a[1].calls).slice(0, TOP).map(([code, v]) => ({ code, ...v })),
    reasons: [...byReason.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([reason, count]) => ({ reason, count })),
    first_at: first, last_at: last, truncated,
  };
}
