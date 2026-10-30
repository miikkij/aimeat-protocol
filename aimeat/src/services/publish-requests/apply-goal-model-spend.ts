/**
 * @file src/services/publish-requests/apply-goal-model-spend.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner allowed AIMEAT's model to do a goal's work on the AI allowance for an agent
 *   that does not hold ai:use (services/goals/goals-model-spend.ts filed it). The agent joins the
 *   goal's modelSpendAllowed, the work opens, and the goal moves on, so the work runs as it did before
 *   the rule. A goal or work gone since, or a work no longer waiting on this request, ends the request
 *   `outdated`.
 * @structure applyGoalModelSpend
 * @usage registered in appliers.ts under the kind 'goal-model-spend'
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (secaudit2026oct26 round 8c, background-05).
 */
import { logger } from '../../utils/logger.js';
import { answerModelSpend } from '../goals/goals-model-spend.js';
import { advanceGoal } from '../goals/goals-advance.js';
import { GoalError } from '../goals/goals-store.js';
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';

export async function applyGoalModelSpend(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  const goalId = String(request.target.goal ?? '');
  const workId = String(request.target.work ?? '');
  let changed: boolean;
  try {
    changed = goalId && workId ? await answerModelSpend(ctx, ownerGhii, goalId, workId, request.id, true) : false;
  } catch (err) {
    // A goal deleted since closes the request; any other failure is the decision's to answer.
    if (err instanceof GoalError && err.status === 404) return { ok: false, reason: 'the goal was deleted' };
    throw err;
  }
  if (!changed) return { ok: false, reason: 'the work no longer waits for this answer' };
  // The work runs now rather than at the next minute; the sweep would start it too.
  advanceGoal(ctx, ownerGhii, goalId).catch(err => logger.warn('goal: moving on after allowed spending failed', { goalId, error: String(err) }));
  return { ok: true };
}
