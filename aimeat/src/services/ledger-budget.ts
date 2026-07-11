/**
 * @file ledger-budget.ts
 * @description Budget tracking for the usage ledger (LEDGER / TARGET-017): computes an owner's
 *   actual daily LLM spend from the ledger daily aggregates and compares it to their
 *   `daily_budget_usd`, producing a status (ok / warn ≥80% / over ≥100%) with a per-agent
 *   breakdown of the biggest consumers. This lives in node-core (not behind an MCP inspect
 *   call) so budget evaluation never depends on operator approval to run.
 *
 *   V1 reports and alerts — it does NOT hard-stop runs at the limit (that is a separate
 *   operator decision, see the LEDGER spec). Alert emission on threshold crossing lives in
 *   ledger-budget-alerts.ts; this module is the pure computation the route + alerter share.
 * @structure
 *   - getOwnerBudgetStatus(storage, ownerGhii, opts) -- spend vs budget + per-agent breakdown
 * @usage
 *   import { getOwnerBudgetStatus } from '../services/ledger-budget.js';
 * @version-history
 *   v1.0.0 -- 2026-07-11 -- Initial creation for LEDGER TARGET-017
 */

import type { Storage } from '../storage/interface.js';
import { getDailyBudgetUsd } from './ai-completion.js';

/** Default alert thresholds (fraction of daily budget). Overridable per owner via prefs. */
export const DEFAULT_WARN_RATIO = 0.8;
export const DEFAULT_OVER_RATIO = 1.0;

export interface AgentSpend {
  agentGaii: string;
  costUsd: number;
  calls: number;
}

export interface BudgetStatus {
  /** UTC date YYYY-MM-DD the status is for. */
  date: string;
  dailyBudgetUsd: number;
  spentUsd: number;
  remainingUsd: number;
  /** spentUsd / budget; 0 when budget is 0 (no budget set → never "over"). */
  ratio: number;
  level: 'ok' | 'warn' | 'over';
  thresholds: { warn: number; over: number };
  /** Per-agent spend, biggest first. */
  perAgent: AgentSpend[];
  /** The biggest consumers (top 5) — carried into alerts. */
  topConsumers: AgentSpend[];
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Read owner's warn/over thresholds from prefs, falling back to the defaults. */
function readThresholds(prefs: Record<string, unknown>): { warn: number; over: number } {
  const num = (v: unknown, d: number): number =>
    typeof v === 'number' && isFinite(v) && v > 0 ? v : d;
  return {
    warn: num(prefs.ledger_budget_warn_ratio, DEFAULT_WARN_RATIO),
    over: num(prefs.ledger_budget_over_ratio, DEFAULT_OVER_RATIO),
  };
}

/**
 * Compute one owner's spend-vs-budget status for a day (default today, UTC). Reads the
 * ledger daily aggregates and the owner's `openrouter.settings` budget. Pure — no writes,
 * no alerts.
 */
export async function getOwnerBudgetStatus(
  storage: Storage,
  ownerGhii: string,
  opts?: { date?: string },
): Promise<BudgetStatus> {
  const date = opts?.date ?? todayUtc();

  const rows = await storage.queryUsageDaily({ ownerGhii, from: date, to: date });

  const perAgentMap = new Map<string, AgentSpend>();
  let spentUsd = 0;
  for (const r of rows) {
    spentUsd += r.costUsd;
    let a = perAgentMap.get(r.agentGaii);
    if (!a) { a = { agentGaii: r.agentGaii, costUsd: 0, calls: 0 }; perAgentMap.set(r.agentGaii, a); }
    a.costUsd += r.costUsd;
    a.calls += r.calls;
  }
  const perAgent = [...perAgentMap.values()].sort((x, y) => y.costUsd - x.costUsd);

  const prefsRecord = await storage.getMemory(ownerGhii, 'openrouter.settings');
  const prefs = (prefsRecord?.value as Record<string, unknown>) ?? {};
  const dailyBudgetUsd = getDailyBudgetUsd(prefs);
  const thresholds = readThresholds(prefs);

  const ratio = dailyBudgetUsd > 0 ? spentUsd / dailyBudgetUsd : 0;
  const level: BudgetStatus['level'] =
    dailyBudgetUsd > 0 && ratio >= thresholds.over ? 'over'
      : dailyBudgetUsd > 0 && ratio >= thresholds.warn ? 'warn'
        : 'ok';

  return {
    date,
    dailyBudgetUsd,
    spentUsd,
    remainingUsd: Math.max(0, dailyBudgetUsd - spentUsd),
    ratio,
    level,
    thresholds,
    perAgent,
    topConsumers: perAgent.slice(0, 5),
  };
}
