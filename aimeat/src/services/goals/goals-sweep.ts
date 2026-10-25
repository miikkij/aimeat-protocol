/**
 * @file src/services/goals/goals-sweep.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The minute sweep over every active agent goal on the node. It does what no request
 *   does: a taken work whose task has not moved for the goal's claim time goes back to open work (the
 *   agent's machine may have gone off; the work is not lost), and after MAX_ATTEMPTS it goes to the
 *   person instead; a goal past its end date, or a round goal past its renewal date, expires and wakes
 *   nobody any more; a goal whose rounds run by the clock starts its round when the cron says so; and
 *   every goal is moved on (advanceGoal), which gives offered work to the first free agent after the
 *   grace and tells the owner about work nobody took.
 * @structure SWEEP_MS · sweepGoals() · sweepOne() · scheduleGoalSweep()
 * @usage scheduleGoalSweep({ storage, config });   // server-bootstrap/service-init.ts
 * @version-history
 *   v1.1.0 — 2026-10-25 — The node's model works: settled when their job finishes (the finished-job
 *     listener registered here) and checked each minute (checkModelWorks); a proposed goal waits.
 *   v1.0.0 — 2026-10-25 — Initial (session cc-jouni-goals).
 */
import { randomUUID } from 'node:crypto';
import { Cron } from 'croner';
import { logger } from '../../utils/logger.js';
import { LIVE_TASK_STATUSES } from '../../storage/types/agents-messaging.js';
import { UNCHANGED } from '../record-cas.js';
import { logEntry, parseGoal, updateGoal, type GoalDeps } from './goals-store.js';
import { advanceGoal } from './goals-advance.js';
import { startRound } from './goals-ops.js';
import { checkModelWorks, settleModelJob } from './goals-model.js';
import { onAiJobFinished } from '../ai-jobs/finished-listeners.js';
import { GOAL_PREFIX, MAX_ATTEMPTS, MODEL_TAKER, goalSettled, type GoalRecord } from './goals-types.js';

export const SWEEP_MS = 60_000;

/** Return taken works that stopped moving; answers the ids of the tasks to mark failed. */
async function returnStuck(deps: GoalDeps, ownerGhii: string, goal: GoalRecord, now: number): Promise<void> {
  const stuck: Array<{ workId: string; taskId?: string }> = [];
  // A work the node's model does has a job, not a task: checkModelWorks reads it.
  for (const w of goal.works.filter(x => x.status === 'claimed' && x.claimedBy !== MODEL_TAKER)) {
    const limit = goal.limits.claimMinutes * 60_000;
    if (!w.taskId) {
      if (w.claimedAt && now - Date.parse(w.claimedAt) > limit) stuck.push({ workId: w.id });
      continue;
    }
    const task = await deps.storage.getAgentTask(w.taskId);
    if (!task) { stuck.push({ workId: w.id }); continue; }
    if (!(LIVE_TASK_STATUSES as readonly string[]).includes(task.status) && task.status !== 'stalled') continue;
    // A task not yet started waits for the owner's OK or for its agent's start rule, not for the agent's
    // work: only a started task can be stuck.
    if (task.status === 'queued' || task.status === 'draft' || task.status === 'revision_requested' || task.status === 'paused') continue;
    const moved = Date.parse(task.lastEventAt ?? task.updatedAt ?? w.claimedAt ?? task.createdAt);
    if (now - moved > limit) stuck.push({ workId: w.id, taskId: w.taskId });
  }
  if (!stuck.length) return;
  const ids = new Set(stuck.map(s => s.workId));
  await updateGoal(deps, ownerGhii, goal.id, cur => {
    const hits = cur.works.filter(w => ids.has(w.id) && w.status === 'claimed');
    if (!hits.length) return UNCHANGED;
    const log = [...cur.log];
    const works = cur.works.map(w => {
      if (!ids.has(w.id) || w.status !== 'claimed') return w;
      const attempts = w.attempts + 1;
      const who = w.claimedBy ?? 'the agent';
      if (attempts >= MAX_ATTEMPTS) {
        log.push(logEntry('node', 'failed', `"${w.title}" did not move in ${cur.limits.claimMinutes} minutes twice; it waits for you.`, { workId: w.id }));
        return { ...w, status: 'failed' as const, attempts, settledAt: new Date(now).toISOString(), reason: `No progress from ${who} in ${cur.limits.claimMinutes} minutes, twice.` };
      }
      log.push(logEntry('node', 'returned', `${who} did not move "${w.title}" in ${cur.limits.claimMinutes} minutes, so it went back to open work from where it was.`, { workId: w.id }));
      return { ...w, status: 'open' as const, attempts, claimedBy: undefined, claimedAt: undefined, deadlineAt: undefined, taskId: undefined, offeredAt: undefined, exclude: [...(w.exclude ?? []), ...(w.claimedBy ? [w.claimedBy] : [])] };
    });
    return { ...cur, works, log };
  });
  for (const s of stuck.filter(x => x.taskId)) {
    await deps.storage.updateAgentTask(s.taskId!, { status: 'failed', updatedAt: new Date(now).toISOString() })
      .catch(err => logger.warn('goal: marking a stuck task failed', { taskId: s.taskId, error: String(err) }));
    await deps.storage.appendTaskEvent({ id: randomUUID(), taskId: s.taskId!, type: 'failed', message: 'No progress within the goal\'s time; the work went back to open work.', timestamp: new Date(now).toISOString() })
      .catch(err => logger.warn('goal: noting a stuck task failed', { taskId: s.taskId, error: String(err) }));
  }
}

/** One goal: expiry, a clock round, stuck work, and the move-on. */
export async function sweepOne(deps: GoalDeps, ownerGhii: string, goal: GoalRecord, now = Date.now()): Promise<void> {
  // A proposal waits for the owner's yes: nothing in it moves, and it does not expire on its own.
  if (goalSettled(goal.status) || goal.status === 'proposed') return;
  const ended = (goal.endsAt && Date.parse(goal.endsAt) <= now) || (goal.renewBy && Date.parse(goal.renewBy) <= now);
  if (ended) {
    await updateGoal(deps, ownerGhii, goal.id, cur => goalSettled(cur.status) ? UNCHANGED : ({
      ...cur, status: 'expired', settledAt: new Date(now).toISOString(),
      works: cur.works.map(w => w.status === 'open' || w.status === 'waiting' ? { ...w, status: 'cancelled' as const } : w),
      log: [...cur.log, logEntry('node', 'expired', cur.endsAt && Date.parse(cur.endsAt) <= now ? 'The goal reached its end date. Its results stay; it wakes nobody any more.' : 'The goal was not renewed in time. Renew it to let its rounds run again.')],
    }));
    return;
  }
  if (goal.status === 'paused') return;
  if (goal.rounds?.trigger === 'clock' || goal.rounds?.trigger === 'condition') {
    const next = goal.rounds.nextAt ? Date.parse(goal.rounds.nextAt) : NaN;
    if (goal.rounds.cron && Number.isFinite(next) && next <= now) {
      let following: string | undefined;
      try { following = new Cron(goal.rounds.cron, { timezone: goal.rounds.timezone || undefined, paused: true }).nextRun(new Date(now + 1000))?.toISOString(); }
      catch (err) { logger.warn('goal: a round cron no longer parses', { goalId: goal.id, error: String(err) }); }
      // The next time is written first, on the version, so two nodes' sweeps cannot both start the round.
      let mine = false;
      await updateGoal(deps, ownerGhii, goal.id, cur => {
        if (!cur.rounds || cur.rounds.nextAt !== goal.rounds!.nextAt) return UNCHANGED;
        mine = true;
        return { ...cur, rounds: { ...cur.rounds, nextAt: following } };
      });
      if (mine) await startRound(deps, ownerGhii, goal.id, 'node').catch(err => logger.warn('goal: a round did not start', { goalId: goal.id, error: String(err) }));
    }
  }
  await returnStuck(deps, ownerGhii, goal, now);
  await checkModelWorks(deps, ownerGhii, goal, now);
  await advanceGoal(deps, ownerGhii, goal.id);
}

/** Every active goal on the node, once. */
export async function sweepGoals(deps: GoalDeps): Promise<void> {
  const { items } = await deps.storage.listAllMemoryMeta({ prefix: GOAL_PREFIX, limit: 5000, excludeVersionRows: true });
  for (const meta of items) {
    try {
      const rec = await deps.storage.getMemory(meta.ownerGaii, meta.key);
      const goal = parseGoal(rec?.value);
      if (goal && !goalSettled(goal.status)) await sweepOne(deps, meta.ownerGaii, goal);
    } catch (err) {
      logger.warn('goal sweep: one goal failed', { key: meta.key, error: String(err) });
    }
  }
}

export function scheduleGoalSweep(deps: GoalDeps): void {
  // A goal's model work settles the moment its job finishes; the sweep is only the fallback.
  onAiJobFinished(async job => {
    const settled = await settleModelJob(deps, job);
    if (settled) await advanceGoal(deps, settled.ownerGhii, settled.goalId);
  });
  const run = () => { sweepGoals(deps).catch(err => logger.warn('goal sweep failed', { error: String(err) })); };
  setTimeout(run, 30_000);
  setInterval(run, SWEEP_MS);
}
