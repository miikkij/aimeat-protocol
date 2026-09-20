/**
 * @file src/services/ai-daily-budget.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's daily AI budget: the default, and the read of what the owner set.
 *
 *   A LEAF, ON PURPOSE. These two lived in ai-completion.ts, and the ledger's budget alert
 *   (ledger-budget.ts) imported them from there, which closed a cycle: ai-completion → usage-metering
 *   → ledger-budget-alerts → ledger-budget → ai-completion. It imports nothing, so whoever needs the
 *   budget number takes it from here and the cycle is gone. ai-completion.ts re-exports both names.
 * @structure DEFAULT_DAILY_BUDGET_USD · getDailyBudgetUsd
 * @usage import { getDailyBudgetUsd } from './ai-daily-budget.js';
 * @version-history
 *   v1.0.0 — 2026-09-20 — Moved out of ai-completion.ts, unchanged.
 */

/** Default applied when the owner hasn't set an explicit daily budget. A per-app cap defaults to
 *  this same budget (an app may spend the whole "AI apps daily budget"); set app_quotas.<app> to
 *  throttle a single app below it. */
export const DEFAULT_DAILY_BUDGET_USD = 1.0;

export function getDailyBudgetUsd(prefs: Record<string, unknown>): number {
  return typeof prefs.daily_budget_usd === 'number' ? prefs.daily_budget_usd : DEFAULT_DAILY_BUDGET_USD;
}
