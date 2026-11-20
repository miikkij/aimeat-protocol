/**
 * @file src/services/value/usage-rhythm.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the node is used for and when: the operator's report `rhythm` (aimeat_admin_usage,
 *   GET /v1/admin/usage/summary). Read from the usage layer the node already keeps (the `tool` and
 *   `activity` reports), so it adds no table: each tool call is folded into the feature it belongs to,
 *   the period is set against the one before it, and the day series of all calls gets its bursts, week
 *   and season (services/value/rhythm.ts). Counts only, never a person.
 * @structure FEATURES · featureOf · UsageRhythm · readUsageRhythm
 * @version-history
 *   v1.1.0 — 2026-11-20 — A call is read by its coordinate, a REST route by its first path segment.
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-n-hy-ty-n-kyy-kulu-hy-ty-ja-k-yt-n-rytmi, phase 2).
 */
import type { Storage } from '../../storage/interface.js';
import { readUsageReport, dayNDaysAgo } from '../usage/usage-read.js';
import { rhythmOf } from './rhythm.js';

/** The features a tool name belongs to, by its prefix; the first match wins. */
export const FEATURES: ReadonlyArray<[feature: string, prefixes: string[]]> = [
  ['memory', ['aimeat_memory_', 'aimeat_context_', 'aimeat_discover', 'aimeat_knowledge_']],
  ['workspaces', ['aimeat_workspace_']],
  ['goals', ['aimeat_goal_']],
  ['tasks', ['aimeat_task_', 'aimeat_v2_task_', 'aimeat_work_']],
  ['apps', ['aimeat_app_', 'aimeat_designbook_']],
  ['organisms', ['aimeat_organism_', 'aimeat_team_']],
  ['boards', ['aimeat_board_']],
  ['messages', ['aimeat_dm_', 'aimeat_message_', 'aimeat_v2_message_', 'aimeat_mail_']],
  ['agents', ['aimeat_agent_', 'aimeat_crew_']],
  ['skills', ['aimeat_skill_', 'aimeat_handbook_']],
  ['reports', ['aimeat_usage_', 'aimeat_overview', 'aimeat_admin_']],
];

/** A REST route's first path segment after /v1/ and the feature it belongs to. */
const ROUTE_FEATURES: Readonly<Record<string, string>> = {
  memory: 'memory', context: 'memory', knowledge: 'memory', discover: 'memory', files: 'memory', storage: 'memory',
  organisms: 'organisms', teams: 'organisms', workspaces: 'workspaces',
  goals: 'goals', tasks: 'tasks', work: 'tasks', apps: 'apps', designbook: 'apps', appcat: 'apps',
  boards: 'boards', messages: 'messages', dm: 'messages', mail: 'messages', agents: 'agents', crews: 'agents',
  skills: 'skills', handbook: 'skills', usage: 'reports', admin: 'reports', overview: 'reports',
};

/**
 * The feature a call belongs to. A call is named by its coordinate: an MCP tool's name
 * (`aimeat_memory_write`) or a REST route (`POST /v1/memory/x`); a workspace route under
 * /v1/organisms/:id/workspace counts as workspaces.
 */
export function featureOf(coordinate: string): string {
  for (const [feature, prefixes] of FEATURES) if (prefixes.some(p => coordinate.startsWith(p))) return feature;
  const path = /\/v1\/([^/?\s]+)(\/[^?\s]*)?/.exec(coordinate);
  if (path) {
    if (path[1] === 'organisms' && /\/workspace/.test(path[2] ?? '')) return 'workspaces';
    return ROUTE_FEATURES[path[1]] ?? 'other';
  }
  return 'other';
}

export interface UsageRhythm {
  report: 'rhythm';
  from: string;
  to: string;
  /** Calls per feature in the period and in the period of the same length before it. */
  features: Array<{ feature: string; calls: number; previous: number; change: number | null }>;
  rhythm: ReturnType<typeof rhythmOf>;
}

function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

async function callsByFeature(storage: Storage, from: string, to: string): Promise<Map<string, number>> {
  const r = await readUsageReport(storage, { report: 'tool', scope: 'node', from, to, limit: 2000 });
  const out = new Map<string, number>();
  for (const g of r.groups) {
    const dims = g.dims as Record<string, string | undefined>;
    const tool = String(dims.coordinate ?? dims.tool ?? g.key);
    const f = featureOf(tool);
    out.set(f, (out.get(f) ?? 0) + g.calls);
  }
  return out;
}

/** The node's use per feature and its rhythm over a span (default the last 30 days). */
export async function readUsageRhythm(storage: Storage, opts: { from?: string; to?: string } = {}): Promise<UsageRhythm> {
  const from = opts.from ?? dayNDaysAgo(30);
  const to = opts.to ?? dayNDaysAgo(0);
  const span = Math.max(1, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1);
  const [now, before] = await Promise.all([
    callsByFeature(storage, from, to),
    callsByFeature(storage, shiftDay(from, -span), shiftDay(from, -1)),
  ]);
  const features = [...new Set([...now.keys(), ...before.keys()])].map(feature => {
    const calls = now.get(feature) ?? 0;
    const previous = before.get(feature) ?? 0;
    return { feature, calls, previous, change: previous ? Math.round(((calls - previous) / previous) * 1000) / 1000 : null };
  }).sort((a, b) => b.calls - a.calls);
  // The whole node's calls per day, over a year when the store holds one, so the season can be told.
  const activity = await readUsageReport(storage, { report: 'activity', scope: 'node', from: shiftDay(to, -400), to, series: true });
  const series = activity.series.map(s => ({ day: s.bucket.slice(0, 10), count: s.calls }));
  return { report: 'rhythm', from, to, features, rhythm: rhythmOf(series) };
}
