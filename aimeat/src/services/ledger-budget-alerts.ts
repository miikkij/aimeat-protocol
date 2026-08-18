/**
 * @file ledger-budget-alerts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Threshold alerting for the usage ledger (LEDGER / TARGET-017). Evaluates an
 *   owner's live daily LLM spend against their budget and, when it first crosses the warn
 *   (≥80%) or over (≥100%) threshold on a given UTC day, emits ONE `budget_alert`
 *   notification — carrying the biggest-consumer breakdown — into the owner's notification
 *   inbox (which M-ROOM's ATTN band reads) via notify() + the `notifications` SSE domain.
 *
 *   Dedup is per-day, per-threshold: a small private state record `budget-alerts.<ghii>.<date>`
 *   records which thresholds already fired so repeated calls don't spam. V1 alerts, never
 *   hard-stops (that is a separate operator decision, see the LEDGER spec).
 * @structure
 *   - evaluateBudgetAlerts(storage, ownerGhii) -- evaluate + fire once per threshold per day
 * @usage
 *   import { evaluateBudgetAlerts } from '../services/ledger-budget-alerts.js';
 * @version-history
 *   v1.0.0 -- 2026-07-11 -- Initial creation for LEDGER TARGET-017
 */

import type { Storage } from '../storage/interface.js';
import { getOwnerBudgetStatus } from './ledger-budget.js';
import { notify } from './notify.js';
import { emitChange } from './event-bus.js';
import { logger } from '../utils/logger.js';

interface AlertState { fired: number[]; updatedAt: string }

/**
 * Evaluate one owner's budget status now and emit a budget alert if a threshold was newly
 * crossed today. Best-effort and idempotent within a day. No-op when no budget is set
 * (dailyBudgetUsd ≤ 0) or spend is still under the warn threshold.
 */
export async function evaluateBudgetAlerts(storage: Storage, ownerGhii: string): Promise<void> {
  const status = await getOwnerBudgetStatus(storage, ownerGhii);
  if (status.dailyBudgetUsd <= 0 || status.level === 'ok') return;

  // Which threshold level are we at? over (100%) supersedes warn (80%).
  const crossed = status.level === 'over' ? 100 : 80;

  const stateKey = `budget-alerts.${ownerGhii}.${status.date}`;
  const stateRec = await storage.getMemory(ownerGhii, stateKey);
  const prev = (stateRec?.value as AlertState | undefined)?.fired;
  const fired: number[] = Array.isArray(prev) ? prev : [];
  if (fired.includes(crossed)) return; // already alerted at this level today

  const pct = crossed === 100 ? '100%' : '80%';
  const top = status.topConsumers
    .map(c => `${c.agentGaii} $${c.costUsd.toFixed(4)}`)
    .join(', ');

  await notify(storage, ownerGhii, {
    type: 'budget_alert',
    title: `AI budget ${pct} used ($${status.spentUsd.toFixed(4)} / $${status.dailyBudgetUsd})`,
    body: `Today's LLM spend reached ${pct} of the daily budget.`
      + (top ? ` Top consumers: ${top}.` : ''),
    link: '/v1/profile?tab=agents',
  });
  emitChange('notifications', ownerGhii);

  // Crossing 'over' implies 'warn' too — mark both so we don't later also fire the warn.
  const nextFired = [...new Set([...fired, ...(crossed === 100 ? [80, 100] : [80])])];
  const now = new Date().toISOString();
  await storage.setMemory({
    key: stateKey,
    ownerGaii: ownerGhii,
    value: { fired: nextFired, updatedAt: now } satisfies AlertState,
    visibility: 'private',
    tags: ['ledger', 'budget-alert'],
    ttlHours: 24 * 3, // self-clears a few days after the day it covers
    version: stateRec ? stateRec.version + 1 : 1,
    createdAt: stateRec?.createdAt ?? now,
    updatedAt: now,
  });

  logger.info('ledger: budget alert fired', { ownerGhii, level: status.level, crossed });
}
