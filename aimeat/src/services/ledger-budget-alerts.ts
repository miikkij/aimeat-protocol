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
 *   2026-10-18 -- The threshold is marked fired with updateRecord (on the version read) before the
 *     alert is sent, and unmarked again when the send fails.
 *   v1.0.0 -- 2026-07-11 -- Initial creation for LEDGER TARGET-017
 */

import type { Storage } from '../storage/interface.js';
import { getOwnerBudgetStatus } from './ledger-budget.js';
import { notify } from './notify.js';
import { emitChange } from './event-bus.js';
import { logger } from '../utils/logger.js';
import { updateRecord, UNCHANGED } from './record-cas.js';

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
  // Crossing 'over' implies 'warn' too — mark both so we don't later also fire the warn.
  const marks = crossed === 100 ? [80, 100] : [80];
  const stateOpts = { tag: 'budget-alert', tags: ['ledger', 'budget-alert'], ttlHours: 24 * 3 }; // self-clears a few days after the day it covers
  const stateOf = (v: unknown): AlertState => {
    const prev = (v as AlertState | undefined)?.fired;
    return { fired: Array.isArray(prev) ? prev : [], updatedAt: (v as AlertState | undefined)?.updatedAt ?? '' };
  };

  // The level is marked fired BEFORE the alert is sent, on the version that was read (updateRecord):
  // of two usage events at once, one marks it and sends, and the other re-reads it as fired.
  const claim: { before: number[] | null } = { before: null };
  await updateRecord(storage, ownerGhii, stateKey, stateOf, cur => {
    claim.before = null;
    if (cur.fired.includes(crossed)) return UNCHANGED; // already alerted at this level today
    claim.before = cur.fired;
    return { fired: [...new Set([...cur.fired, ...marks])], updatedAt: new Date().toISOString() };
  }, stateOpts);
  const firedBefore = claim.before;
  if (!firedBefore) return;

  const pct = crossed === 100 ? '100%' : '80%';
  const top = status.topConsumers
    .map(c => `${c.agentGaii} $${c.costUsd.toFixed(4)}`)
    .join(', ');

  try {
    await notify(storage, ownerGhii, {
      type: 'budget_alert',
      title: `AI budget ${pct} used ($${status.spentUsd.toFixed(4)} / $${status.dailyBudgetUsd})`,
      body: `Today's LLM spend reached ${pct} of the daily budget.`
        + (top ? ` Top consumers: ${top}.` : ''),
      link: '/v1/profile?tab=agents',
    });
  } catch (err) {
    // The alert did not go out, so the level is unmarked again and the next usage event tries again.
    await updateRecord(storage, ownerGhii, stateKey, stateOf,
      cur => ({ fired: cur.fired.filter(n => firedBefore.includes(n) || !marks.includes(n)), updatedAt: new Date().toISOString() }),
      stateOpts).catch((undo: unknown) => logger.warn('ledger: budget alert mark not undone', { ownerGhii, error: String(undo) }));
    throw err;
  }
  emitChange('notifications', ownerGhii);

  logger.info('ledger: budget alert fired', { ownerGhii, level: status.level, crossed });
}
