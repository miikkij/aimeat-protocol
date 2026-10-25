/**
 * @file src/services/goals/goals-hooks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one call the task completion paths make into agent goals: when a task ends (done,
 *   failed or declined), the goal it works for records the result and moves on. A task with no goal
 *   code costs one regular-expression test. It never throws into the task path: a goal that cannot be
 *   updated is logged, and the minute sweep (goals-sweep.ts) moves it on later.
 * @structure onGoalTaskSettled()
 * @usage void onGoalTaskSettled({ storage, config }, task, 'done', message);   // services/agent-task-fanout.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (session cc-jouni-goals).
 */
import type { AgentTaskRecord } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import type { GoalDeps } from './goals-store.js';
import { parseTrackingCode } from './goals-types.js';
import { settleFromTask } from './goals-work.js';
import { advanceGoal } from './goals-advance.js';

export async function onGoalTaskSettled(deps: GoalDeps, task: AgentTaskRecord, outcome: 'done' | 'failed' | 'declined', message: string): Promise<void> {
  const ref = parseTrackingCode(task.workTrackingCode);
  if (!ref) return;
  try {
    const goal = await settleFromTask(deps, task, outcome, message);
    if (goal) await advanceGoal(deps, task.ownerGaii, goal.id);
  } catch (err) {
    logger.warn('goal: a settled task could not move its goal on', { taskId: task.id, goalId: ref.goalId, error: String(err) });
  }
}
