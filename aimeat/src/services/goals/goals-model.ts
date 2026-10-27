/**
 * @file src/services/goals/goals-model.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A goal's work that the node's own model does (`runner: 'model'`), for a person with no
 *   agent or computer that fits, or a work that needs none: research from what the model knows,
 *   writing, a summary, a comparison. Jouni's choice of 2026-10-25: "with no suitable agent the
 *   OpenRouter way should be enough", inside the goal's spending limit.
 *
 *   HOW IT RUNS. The work is taken by MODEL_TAKER on the goal's version (the same limits a take
 *   counts: works per day and the spending limit), then started as a background AI job
 *   (services/ai-jobs) with the owner's own key, the job's `app_id` 'goals' and the text an agent's
 *   task would carry, told it has no tools. The job writes its answer to runKey(goal, work); when the
 *   job finishes (ai-jobs/finished-listeners.ts) the answer moves into the goal's one results record
 *   (resultsKey, the newest MAX_RESULTS answers), the temporary record is deleted, and the work is
 *   settled with the job's cost added to the goal's spend. A node restart that ends a job without the
 *   listener is caught by the minute sweep, which reads the job's state (checkModelWorks).
 *
 *   ONE RECORD PER GOAL. A round goal with a model work every day would make 365 keys a year from
 *   per-work answers, and an owner has 1000 (CLAUDE.md, a memory value is a record); the temporary
 *   record lives only while its job runs.
 * @structure runModelWork() · settleModelJob() · checkModelWorks()
 * @usage runModelWork(deps, ownerGhii, goalId, workId);   // goals-advance.ts; settleModelJob from goals-sweep.ts's job listener
 * @version-history
 *   v1.1.0 — 2026-10-27 — A record goes to the model with the reach of whoever named it in the goal; a
 *     private one an agent named and may not read waits for the owner's one press before the work is
 *     taken, and one the owner did not allow is left out (goals-model-reach.ts; secaudit2026oct26,
 *     goals:model-work-runs-as-owner-without-requesting-agent-authority).
 *   v1.0.0 — 2026-10-25 — Initial (session cc-jouni-goals).
 */
import { getActiveAiJobService } from '../ai-jobs/service.js';
import type { AiJobRecord, AiJobLogEntry } from '../ai-jobs/types.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { logger } from '../../utils/logger.js';
import { logEntry, readGoal, updateGoal, type GoalDeps } from './goals-store.js';
import { countTake, taskBody } from './goals-work.js';
import { askOwnerForModelRead, modelInputKeys, modelWorkReadNeed } from './goals-model-reach.js';
import {
  MAX_ATTEMPTS, MAX_RESULTS, MODEL_TAKER, TEXT_MAX, goalSettled, parseRunKey, resultsKey, runKey,
  type GoalRecord, type GoalWork,
} from './goals-types.js';

export const GOALS_APP_ID = 'goals';
const RESULTS_TAG = 'aimeat.goal.results';
const ANSWER_MAX = 20_000;

interface ResultsRecord {
  type: typeof RESULTS_TAG;
  goal: string;
  results: Array<{ work: string; title: string; answer: string; model?: string; costUsd?: number; at: string }>;
}

function parseResults(value: unknown): ResultsRecord | null {
  const v = value as Partial<ResultsRecord> | null;
  return v && v.type === RESULTS_TAG && Array.isArray(v.results) ? v as ResultsRecord : null;
}

/** Who did a model work, as a person reads it in the log. */
function modelWords(work: GoalWork): string {
  return work.model ? `AIMEAT's model (${work.model})` : 'AIMEAT\'s model';
}

/** Take a model work and start its job. A second caller finds it taken and stops; nothing throws out. */
export async function runModelWork(deps: GoalDeps, ownerGhii: string, goalId: string, workId: string): Promise<void> {
  // Each record goes to the model with the reach of whoever named it in the goal. A private record an
  // agent named and may not read waits for the owner's one press, before the work is taken and before
  // any read (goals-model-reach.ts; secaudit2026oct26).
  const before = await readGoal(deps, ownerGhii, goalId);
  const open = before?.works.find(w => w.id === workId && w.status === 'open' && w.runner === 'model');
  if (before && open) {
    const need = await modelWorkReadNeed(deps, ownerGhii, before, open, modelInputKeys(open, taskBody(before, open, true).memoryKeys));
    if (need) { await askOwnerForModelRead(deps, ownerGhii, before, open, need); return; }
  }
  const claimedAt = new Date().toISOString();
  let taken: GoalRecord;
  try {
    taken = await updateGoal(deps, ownerGhii, goalId, cur => {
      const work = cur.works.find(w => w.id === workId);
      if (!work || work.status !== 'open' || work.runner !== 'model' || goalSettled(cur.status) || cur.status !== 'active') return UNCHANGED;
      const counted = countTake(cur);
      const deadlineAt = new Date(Date.now() + cur.limits.claimMinutes * 60_000).toISOString();
      return {
        ...counted,
        works: counted.works.map(w => w.id === workId ? { ...w, status: 'claimed' as const, claimedBy: MODEL_TAKER, claimedAt, deadlineAt, jobId: undefined } : w),
        log: [...counted.log, logEntry('node', 'claimed', `${modelWords(work)} started "${work.title}".`, { workId })],
      };
    });
  } catch (err) {
    // A limit refused the take: the work stays open, and the advance already told the owner.
    logger.info('goal: a model work was not started', { goalId, workId, error: String(err) });
    return;
  }
  const work = taken.works.find(w => w.id === workId);
  if (!work || work.status !== 'claimed' || work.claimedBy !== MODEL_TAKER || work.claimedAt !== claimedAt) return;

  const service = getActiveAiJobService();
  try {
    if (!service) throw new Error('This node runs no background model jobs.');
    const body = taskBody(taken, work, true);
    // The records the owner did not allow are left out; a work left with none of the records it was
    // given stops with the reason (goals-model-reach.ts; secaudit2026oct26).
    const inputKeys = modelInputKeys(work, body.memoryKeys);
    if (body.memoryKeys.length && !inputKeys.length) {
      throw new Error('the owner did not allow the model to read the records this work builds on, so nothing is left for it to work from');
    }
    const started = await service.startJob({
      prompt: `${body.title}\n\n${body.description}`,
      // The records the work builds on (an earlier work's deliverable, the goal's material): the
      // model has no tools, so the job reads them and pastes them into the prompt. Without them an
      // agent's result reached the model only as its one-line summary ("deliverable published to
      // memory at …") and the model wrote from what it knew (aimeat.io, 2026-10-25).
      ...(inputKeys.length ? { input_keys: inputKeys } : {}),
      system_prompt: 'You do one work of a goal for the person who owns it. Write the result itself, complete and ready to use, with no preamble.',
      result_key: runKey(goalId, workId),
      result_visibility: 'private',
      app_id: GOALS_APP_ID,
      // No role: a named role with no provider refuses the call, and the owner's own default model
      // is what "the node's model" means to them. A work may name a model.
      ...(work.model ? { model: work.model } : {}),
    }, { ownerGhii, createdBy: `goal:${goalId}` });
    await updateGoal(deps, ownerGhii, goalId, cur => ({
      ...cur,
      works: cur.works.map(w => w.id === workId && w.claimedAt === claimedAt ? { ...w, jobId: started.job_id } : w),
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('goal: a model work could not start its job', { goalId, workId, error: message });
    await updateGoal(deps, ownerGhii, goalId, cur => ({
      ...cur,
      works: cur.works.map(w => w.id === workId && w.claimedAt === claimedAt
        ? { ...w, status: 'failed' as const, settledAt: new Date().toISOString(), reason: `The model could not start: ${message}`.slice(0, 1000) }
        : w),
      log: [...cur.log, logEntry('node', 'failed', `${modelWords(work)} could not start "${work.title}": ${message.slice(0, 300)}`, { workId })],
    })).catch(e => logger.warn('goal: recording a model start failure failed', { goalId, error: String(e) }));
  }
}

/** Keep the answer in the goal's results record and drop the job's temporary record. */
async function keepAnswer(deps: GoalDeps, ownerGhii: string, goalId: string, work: GoalWork, answer: string, costUsd: number, model?: string): Promise<void> {
  await updateRecord<ResultsRecord | null>(
    deps.storage, ownerGhii, resultsKey(goalId), parseResults,
    cur => {
      const entry = { work: work.id, title: work.title, answer: answer.slice(0, ANSWER_MAX), ...(model ? { model } : {}), costUsd, at: new Date().toISOString() };
      const results = [...(cur?.results ?? []).filter(r => r.work !== work.id), entry].slice(-MAX_RESULTS);
      return { type: RESULTS_TAG, goal: goalId, results };
    },
    { tag: RESULTS_TAG, visibility: 'owner' },
  );
}

/**
 * A goal's model job finished: keep its answer and settle its work. Answers the goal it settled, for
 * the caller to move on (advanceGoal), or null when the job was not a goal's or not this work's.
 */
export async function settleModelJob(deps: GoalDeps, job: AiJobRecord | AiJobLogEntry): Promise<{ ownerGhii: string; goalId: string } | null> {
  if (job.app_id !== GOALS_APP_ID) return null;
  const ref = parseRunKey(job.result_key);
  if (!ref) return null;
  const ownerGhii = job.owner;
  const goal = await readGoal(deps, ownerGhii, ref.goalId);
  const work = goal?.works.find(w => w.id === ref.workId);
  // The key alone proves nothing: the work must name this very job.
  if (!goal || !work || work.jobId !== job.id || work.status !== 'claimed') return null;

  let answer = '';
  if (job.state === 'done') {
    const rec = await deps.storage.getMemory(ownerGhii, job.result_key);
    answer = typeof rec?.value === 'string' ? rec.value : rec?.value === undefined ? '' : JSON.stringify(rec.value);
    if (answer) await keepAnswer(deps, ownerGhii, goal.id, work, answer, job.cost_usd ?? 0, job.model);
  }
  await deps.storage.deleteMemory(ownerGhii, job.result_key)
    .catch(err => logger.info('goal: the model answer\'s temporary record was not deleted', { key: job.result_key, error: String(err) }));

  const cost = Math.max(0, job.cost_usd ?? 0);
  const ok = job.state === 'done' && !!answer;
  const why = job.state === 'cancelled' ? 'the job was cancelled' : job.error?.message ?? (job.state === 'done' ? 'the model gave no answer' : 'the model call failed');
  await updateGoal(deps, ownerGhii, goal.id, cur => {
    const w = cur.works.find(x => x.id === work.id);
    if (!w || w.jobId !== job.id || w.status !== 'claimed') return UNCHANGED;
    const settledAt = new Date().toISOString();
    const spent = { ...cur.spent, usd: Math.round((cur.spent.usd + cost) * 10_000) / 10_000 };
    if (!ok && w.attempts + 1 < MAX_ATTEMPTS && job.state !== 'cancelled') {
      return {
        ...cur, spent,
        works: cur.works.map(x => x.id === w.id ? { ...x, status: 'open' as const, claimedBy: undefined, claimedAt: undefined, deadlineAt: undefined, jobId: undefined, attempts: x.attempts + 1, costUsd: (x.costUsd ?? 0) + cost, reason: why.slice(0, 1000) } : x),
        log: [...cur.log, logEntry('node', 'returned', `${modelWords(w)} could not do "${w.title}" (${why.slice(0, 200)}); it tries once more.`, { workId: w.id })],
      };
    }
    return {
      ...cur, spent,
      works: cur.works.map(x => x.id === w.id
        ? { ...x, status: ok ? 'done' as const : 'failed' as const, settledAt, costUsd: (x.costUsd ?? 0) + cost,
          ...(ok ? { result: { summary: answer.slice(0, TEXT_MAX), deliverableKey: resultsKey(cur.id), by: MODEL_TAKER } } : { reason: why.slice(0, 1000) }) }
        : x),
      log: [...cur.log, logEntry('node', ok ? 'done' : 'failed', ok
        ? `${modelWords(w)} finished "${w.title}" (${cost.toFixed(4)} $).`
        : `${modelWords(w)} could not do "${w.title}": ${why.slice(0, 300)}`, { workId: w.id })],
    };
  });
  return { ownerGhii, goalId: goal.id };
}

/**
 * The sweep's look at a goal's running model works: a job that finished without the listener (a node
 * restart) is settled from its record; a job the node no longer knows goes back to open work.
 */
export async function checkModelWorks(deps: GoalDeps, ownerGhii: string, goal: GoalRecord, now: number): Promise<void> {
  const service = getActiveAiJobService();
  for (const w of goal.works.filter(x => x.status === 'claimed' && x.claimedBy === MODEL_TAKER)) {
    const late = !!w.claimedAt && now - Date.parse(w.claimedAt) > goal.limits.claimMinutes * 60_000;
    const job = w.jobId && service ? await service.getJob(ownerGhii, w.jobId) : null;
    if (job && (job.state === 'done' || job.state === 'failed' || job.state === 'cancelled')) {
      await settleModelJob(deps, job);
      continue;
    }
    if (job || !late) continue;
    await updateGoal(deps, ownerGhii, goal.id, cur => {
      const x = cur.works.find(y => y.id === w.id);
      if (!x || x.status !== 'claimed' || x.jobId !== w.jobId) return UNCHANGED;
      return {
        ...cur,
        works: cur.works.map(y => y.id === w.id ? { ...y, status: 'open' as const, claimedBy: undefined, claimedAt: undefined, deadlineAt: undefined, jobId: undefined, attempts: y.attempts + 1 } : y),
        log: [...cur.log, logEntry('node', 'returned', `The model job of "${w.title}" was lost; the work is open again.`, { workId: w.id })],
      };
    });
  }
}
