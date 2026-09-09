/**
 * @file src/services/ai-usage-history.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An owner's AI-spend history: the per-day `ai-usage.<gaii>.<day>` records fanned
 *   into a series plus today / 7-day / 30-day rollups, for the profile home card and the spend
 *   chart. Extracted from ai-completion.ts on 2026-09-09 to stay under max-file-lines; a pure move.
 *   The records themselves are still written there (recordAiUsage).
 * @structure
 *   - UsageWindow / UsageHistory — the rollup shapes
 *   - getUsageHistory(storage, gaii, days) — the read
 * @usage  import { getUsageHistory } from '../services/ai-usage-history.js';
 * @version-history
 *   v1.0.0 — 2026-09-09 — Moved out of ai-completion.ts unchanged (it arrived there as v1.5.0 on
 *     2026-07-05 for the AI-spend charts).
 */
import type { Storage } from '../storage/interface.js';
import { todayKey, type UsageRecord } from './ai-completion.js';

/** A rolled-up spend window (today / 7d / 30d) — same per-app shape as a day, summed. */
export interface UsageWindow {
  cost_usd: number;
  tokens: number;
  calls: number;
  /** Transcribed audio seconds in the window (0 before speech-to-text existed). */
  audio_seconds: number;
  per_app: Record<string, { cost_usd: number; tokens: number; calls: number; audio_seconds: number }>;
}

export interface UsageHistory {
  /** Per-day series, oldest → newest, limited to the last `days` retained records. */
  days: UsageRecord[];
  /** Distinct app ids across the returned series, ordered by spend (desc) — stable chart series order. */
  apps: string[];
  /** Rollups: d1 = today's UTC bucket, d7/d30 = trailing 7/30 calendar days. */
  windows: { d1: UsageWindow; d7: UsageWindow; d30: UsageWindow };
}

const emptyWindow = (): UsageWindow => ({ cost_usd: 0, tokens: 0, calls: 0, audio_seconds: 0, per_app: {} });

function accumulateWindow(win: UsageWindow, rec: UsageRecord): void {
  win.cost_usd += rec.total_cost_usd || 0;
  win.tokens += rec.total_tokens || 0;
  win.calls += rec.total_calls || 0;
  win.audio_seconds += rec.audio_seconds || 0;
  for (const [app, m] of Object.entries(rec.per_app || {})) {
    const cur = win.per_app[app] ?? (win.per_app[app] = { cost_usd: 0, tokens: 0, calls: 0, audio_seconds: 0 });
    cur.cost_usd += m.cost_usd || 0;
    cur.tokens += m.tokens || 0;
    cur.calls += m.calls || 0;
    cur.audio_seconds += m.audio_seconds || 0;
  }
}

/**
 * Read an owner's AI-spend history. Every completion persists one `ai-usage.<gaii>.<day>` record
 * (retained forever, ttlHours:null); this fans the prefix into a per-day series plus 24h/7d/30d
 * rollups for the profile home card and the Generator time-series chart. UTC-day granularity —
 * no intra-day data (see /v1/ai/usage for the live "today" number the budget bar uses).
 */
export async function getUsageHistory(storage: Storage, gaii: string, days = 30): Promise<UsageHistory> {
  const records = await storage.listMemory(gaii, { prefix: `ai-usage.${gaii}.` });
  const sorted = records
    .map((r) => r.value as UsageRecord)
    .filter((v): v is UsageRecord => !!v && typeof v.date === 'string')
    .sort((a, b) => a.date.localeCompare(b.date));

  const clampDays = Math.min(Math.max(Math.trunc(days) || 30, 1), 365);
  const series = sorted.slice(-clampDays);

  const today = todayKey();
  const cutoff = (n: number) => new Date(Date.now() - (n - 1) * 86_400_000).toISOString().slice(0, 10);
  const d7cut = cutoff(7);
  const d30cut = cutoff(30);

  const windows = { d1: emptyWindow(), d7: emptyWindow(), d30: emptyWindow() };
  for (const rec of sorted) {
    if (rec.date === today) accumulateWindow(windows.d1, rec);
    if (rec.date >= d7cut) accumulateWindow(windows.d7, rec);
    if (rec.date >= d30cut) accumulateWindow(windows.d30, rec);
  }

  // App ordering derived from the CHARTED series so every dataset has a day to land on.
  const appSpend: Record<string, number> = {};
  for (const rec of series) {
    for (const [app, m] of Object.entries(rec.per_app || {})) {
      appSpend[app] = (appSpend[app] || 0) + (m.cost_usd || 0);
    }
  }
  const apps = Object.keys(appSpend).sort((a, b) => appSpend[b] - appSpend[a]);

  return { days: series, apps, windows };
}
