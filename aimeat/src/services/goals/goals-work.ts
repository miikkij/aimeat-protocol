/**
 * @file src/services/goals/goals-work.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One work of an agent goal, from being made to being settled. A work is made from a
 *   WorkSpec (validated here, once, for every door). An agent's work becomes a task when an agent takes
 *   it: the goal record is written first, on its version, with the work marked taken by that agent, and
 *   only the winner of that write gets a task (services/scheduler-agent-task.ts materialiseAgentTask, the
 *   same wake path a scheduled task uses, so the task-start rules and the permission floor decide as
 *   they do for every task). When the task completes, fails or is declined, settleFromTask() finds the
 *   work by the task id stored on it, never by the code alone, so a task that names a goal it does not
 *   belong to changes nothing.
 * @structure parseWorkSpec() · makeWork() · claimWork() · settleFromTask() · releaseWork() · taskBody()
 * @usage await claimWork(deps, access, goalId, workId);   await settleFromTask(deps, task, 'done', summary);
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (session cc-jouni-goals).
 */
import { z } from 'zod';
import type { AgentTaskRecord } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { materialiseAgentTask } from '../scheduler-agent-task.js';
import { UNCHANGED } from '../record-cas.js';
import {
  GoalError, logEntry, newId, readGoal, updateGoal, type GoalAccess, type GoalDeps,
} from './goals-store.js';
import { agentGaiiOf, agentSpendToday, mayTake, ownerAgents } from './goals-agents.js';
import {
  HUMAN_KINDS, MAX_ATTEMPTS, MAX_WORKS, TEXT_MAX, TITLE_MAX, goalSettled, parseTrackingCode, trackingCode, workSettled,
  type GoalRecord, type GoalWork, type WorkSpec,
} from './goals-types.js';

const OptionSchema = z.object({ id: z.string().min(1).max(64), label: z.string().min(1).max(TITLE_MAX), detail: z.string().max(TEXT_MAX).optional() });

export const WorkSpecSchema = z.object({
  title: z.string().trim().min(1).max(TITLE_MAX),
  description: z.string().max(TEXT_MAX).optional(),
  kind: z.enum(['agent', 'human']).optional(),
  human_kind: z.enum(HUMAN_KINDS).optional(),
  options: z.array(OptionSchema).max(30).optional(),
  multiple: z.boolean().optional(),
  links: z.array(z.object({ url: z.string().url().max(2000), title: z.string().max(TITLE_MAX).optional() })).max(30).optional(),
  texts: z.array(z.string().max(TEXT_MAX)).max(30).optional(),
  prompt: z.string().max(20_000).optional(),
  agent: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/i).optional(),
  wants: z.array(z.string().trim().min(1).max(64)).max(10).optional(),
  after: z.array(z.string().max(64)).max(30).optional(),
  wait_until: z.string().datetime().optional(),
  final: z.boolean().optional(),
}).strict();

/** A caller's work input (snake_case on the wire) as a WorkSpec, or a refusal. */
export function parseWorkSpec(input: unknown): WorkSpec {
  const parsed = WorkSpecSchema.safeParse(input);
  if (!parsed.success) {
    throw new GoalError(400, 'INVALID_INPUT', parsed.error.issues.map(i => `${i.path.join('.') || 'work'}: ${i.message}`).join('; '));
  }
  const w = parsed.data;
  const kind = w.kind ?? (w.human_kind ? 'human' : 'agent');
  if (kind === 'human' && !w.human_kind) throw new GoalError(400, 'INVALID_INPUT', 'A person\'s step names human_kind: choose, approve, answer, do or provide.');
  if (kind === 'human' && w.human_kind === 'choose' && !(w.options?.length)) throw new GoalError(400, 'INVALID_INPUT', 'A choose step lists its options.');
  if (kind === 'agent' && w.human_kind) throw new GoalError(400, 'INVALID_INPUT', 'human_kind belongs to a person\'s step (kind "human").');
  return {
    title: w.title, description: w.description, kind, humanKind: w.human_kind, options: w.options, multiple: w.multiple,
    links: w.links, texts: w.texts, prompt: w.prompt, agent: w.agent, wants: w.wants, after: w.after,
    waitUntil: w.wait_until, final: w.final,
  };
}

/** A new work from a spec. `after` names works of the same goal; an unknown one is refused. */
export function makeWork(goal: GoalRecord, spec: WorkSpec, who: string, extra: Partial<GoalWork> = {}): GoalWork {
  const ids = new Set(goal.works.map(w => w.id));
  for (const a of spec.after ?? []) {
    if (!ids.has(a)) throw new GoalError(400, 'INVALID_INPUT', `after names ${a}, which is not a work of this goal.`);
  }
  const blocked = (spec.after ?? []).some(a => goal.works.find(w => w.id === a)?.status !== 'done');
  const now = new Date().toISOString();
  return {
    id: newId('w'),
    title: spec.title,
    description: spec.description ?? '',
    kind: spec.kind ?? 'agent',
    ...(spec.humanKind ? { humanKind: spec.humanKind } : {}),
    ...(spec.options ? { options: spec.options } : {}),
    ...(spec.multiple ? { multiple: true } : {}),
    ...(spec.links ? { links: spec.links } : {}),
    ...(spec.texts ? { texts: spec.texts } : {}),
    ...(spec.prompt ? { prompt: spec.prompt } : {}),
    ...(spec.agent ? { agent: spec.agent } : {}),
    ...(spec.wants?.length ? { wants: spec.wants } : {}),
    ...(spec.after?.length ? { after: spec.after } : {}),
    ...(spec.waitUntil ? { waitUntil: spec.waitUntil } : {}),
    ...(spec.final ? { final: true } : {}),
    status: blocked ? 'waiting' : 'open',
    hop: 0,
    attempts: 0,
    loop: 0,
    createdBy: who,
    createdAt: now,
    ...extra,
  };
}

/** Append works, keeping the record bounded: the oldest settled works of finished rounds go first. */
export function appendWorks(goal: GoalRecord, works: GoalWork[]): GoalRecord {
  let all = [...goal.works, ...works];
  if (all.length > MAX_WORKS) {
    const dropable = all.filter(w => workSettled(w.status));
    const drop = new Set(dropable.slice(0, all.length - MAX_WORKS).map(w => w.id));
    all = all.filter(w => !drop.has(w.id));
    if (all.length > MAX_WORKS) throw new GoalError(409, 'LIMIT', `A goal holds at most ${MAX_WORKS} works that are not finished.`);
  }
  return { ...goal, works: all };
}

/** What the agent is told in its task: the goal, the work, the material and the results it builds on. */
export function taskBody(goal: GoalRecord, work: GoalWork): { title: string; description: string; memoryKeys: string[] } {
  const parts: string[] = [];
  parts.push(`Goal: ${goal.statement}`);
  if (goal.doneWhen.text) parts.push(`Done when: ${goal.doneWhen.text}`);
  if (goal.roundNote && goal.roundNote.round === (work.round ?? 0)) parts.push(`For this round only: ${goal.roundNote.text}`);
  if (work.description) parts.push(`This work: ${work.description}`);
  const before = goal.works.filter(w => w.status === 'done' && w.result?.summary && (work.after?.includes(w.id) || w.id === work.origin?.work || w.id === work.retryOf));
  for (const b of before.slice(-5)) parts.push(`Result of "${b.title}": ${b.result!.summary!.slice(0, 1500)}`);
  if (work.reason) parts.push(`Why this is asked again: ${work.reason}`);
  const material = goal.material.slice(-20);
  if (material.length) parts.push(`Material: ${material.map(m => `${m.title} (${m.kind}: ${m.ref})`).join('; ')}`);
  parts.push(`When you are done, complete the task with what you produced. To hand the next step to another agent, call aimeat_goal_work with action "leave" and goal_id ${goal.id}. Read the whole goal with aimeat_goal_get.`);
  const memoryKeys = [
    ...goal.material.filter(m => m.kind === 'memory' || m.kind === 'result').map(m => m.ref),
    ...before.map(b => b.result?.deliverableKey).filter((k): k is string => !!k),
  ].slice(0, 30);
  return { title: `${work.title} (${goal.title})`.slice(0, 250), description: parts.join('\n\n').slice(0, 9500), memoryKeys };
}

const DAY = 86_400_000;

/** Refuse a take that would pass a limit; answers the goal with the day's counter moved. */
function countTake(goal: GoalRecord): GoalRecord {
  const today = new Date().toISOString().slice(0, 10);
  const dayTasks = goal.spent.day === today ? goal.spent.dayTasks : 0;
  if (dayTasks >= goal.limits.tasksPerDay) throw new GoalError(409, 'LIMIT', `This goal has started ${dayTasks} works today, its limit.`);
  if (goal.limits.usd !== null && goal.spent.usd >= goal.limits.usd) throw new GoalError(409, 'LIMIT', `This goal has spent ${goal.spent.usd.toFixed(2)} $ of its ${goal.limits.usd} $.`);
  return { ...goal, spent: { ...goal.spent, day: today, dayTasks: dayTasks + 1, tasks: goal.spent.tasks + 1 } };
}

/**
 * An agent takes a work (or the node takes it for a named agent). The first write to win the record
 * gets the task; a second caller finds the work taken and is told so.
 */
export async function claimWork(
  deps: GoalDeps, ownerGhii: string, ownerName: string, goalId: string, workId: string, agentName: string, who: string,
): Promise<{ goal: GoalRecord; taskId: string }> {
  const agents = await ownerAgents(deps, ownerName);
  const agent = agents.find(a => a.name === agentName);
  if (!agent) throw new GoalError(404, 'NOT_FOUND', `No agent ${agentName} on this account.`);
  const spendAtClaim = await agentSpendToday(deps, ownerGhii, agentName);
  const claimedAt = new Date().toISOString();

  const taken = await updateGoal(deps, ownerGhii, goalId, cur => {
    if (goalSettled(cur.status)) throw new GoalError(409, 'CONFLICT', `The goal is ${cur.status}.`);
    if (cur.status === 'paused') throw new GoalError(409, 'CONFLICT', 'The goal is paused; its owner resumes it.');
    const work = cur.works.find(w => w.id === workId);
    if (!work) throw new GoalError(404, 'NOT_FOUND', `No work ${workId} in this goal.`);
    if (work.status !== 'open') throw new GoalError(409, 'CONFLICT', work.status === 'claimed' ? `${work.claimedBy ?? 'Another agent'} took this work already.` : `The work is ${work.status}.`);
    if (!mayTake(cur, work, agent)) throw new GoalError(403, 'FORBIDDEN', `${agentName} may not take this work: it asks for ${work.agent ? `the agent ${work.agent}` : `one of the skills ${(work.wants ?? []).join(', ') || 'none'}`}, and the goal lets ${cur.participants.anyAgent ? 'any agent' : 'its listed agents'} take part.`);
    const counted = countTake(cur);
    const deadlineAt = new Date(Date.now() + cur.limits.claimMinutes * 60_000).toISOString();
    return {
      ...counted,
      works: counted.works.map(w => w.id === workId ? { ...w, status: 'claimed' as const, claimedBy: agentName, claimedAt, deadlineAt, spendAtClaim } : w),
      log: [...counted.log, logEntry(who, 'claimed', `${agentName} took "${work.title}".`, { workId })],
    };
  });

  const work = taken.works.find(w => w.id === workId)!;
  const body = taskBody(taken, work);
  let taskId: string;
  try {
    taskId = await materialiseAgentTask(deps.storage, { config: deps.config, emitResourceUpdated: () => {} }, {
      owner: ownerGhii,
      agentGaii: agent.gaii,
      agentName,
      parentRef: `goal:${goalId}`,
      title: body.title,
      description: body.description,
      ...(body.memoryKeys.length ? { resources: { memoryKeys: body.memoryKeys } } : {}),
      verification: { userExpects: taken.doneWhen.text || work.title, technicalChecks: [] },
      workTrackingCode: trackingCode(goalId, workId),
      startedBy: `Started from the goal "${taken.title}"`,
    });
  } catch (err) {
    // The task could not be made: the work goes back to open, so another agent may take it.
    logger.warn('goal: a taken work could not become a task', { goalId, workId, error: String(err) });
    await updateGoal(deps, ownerGhii, goalId, cur => ({
      ...cur,
      works: cur.works.map(w => w.id === workId && w.claimedAt === claimedAt ? { ...w, status: 'open' as const, claimedBy: undefined, claimedAt: undefined, deadlineAt: undefined } : w),
      log: [...cur.log, logEntry('node', 'returned', `"${work.title}" went back to open work: its task could not be made.`, { workId })],
    }));
    throw new GoalError(500, 'TASK_FAILED', 'The work could not become a task for the agent; it is open again.');
  }
  const goal = await updateGoal(deps, ownerGhii, goalId, cur => ({
    ...cur,
    works: cur.works.map(w => w.id === workId && w.claimedAt === claimedAt ? { ...w, taskId } : w),
  }));
  return { goal, taskId };
}

/** An agent gives a work it took back to open work, with its reason. */
export async function releaseWork(deps: GoalDeps, access: GoalAccess, goalId: string, workId: string, reason: string): Promise<GoalRecord> {
  return updateGoal(deps, access.ownerGhii, goalId, cur => {
    const work = cur.works.find(w => w.id === workId);
    if (!work) throw new GoalError(404, 'NOT_FOUND', `No work ${workId} in this goal.`);
    if (work.status !== 'claimed') throw new GoalError(409, 'CONFLICT', `The work is ${work.status}.`);
    if (!access.person && work.claimedBy !== access.agent && cur.coordinator !== access.agent) {
      throw new GoalError(403, 'FORBIDDEN', 'Only the agent that took the work, the goal\'s coordinator or its owner can give it back.');
    }
    return {
      ...cur,
      works: cur.works.map(w => w.id === workId ? { ...w, status: 'open' as const, claimedBy: undefined, claimedAt: undefined, deadlineAt: undefined, taskId: undefined, offeredAt: undefined, attempts: w.attempts + 1, exclude: [...(w.exclude ?? []), ...(work.claimedBy ? [work.claimedBy] : [])] } : w),
      log: [...cur.log, logEntry(access.who, 'returned', `"${work.title}" went back to open work${reason ? `: ${reason}` : ''}.`, { workId })],
    };
  });
}

/**
 * A goal's task settled. Called from the task completion, failure and decline paths
 * (services/agent-task-fanout.ts) for every task; a task with no goal code returns at once.
 */
export async function settleFromTask(
  deps: GoalDeps, task: AgentTaskRecord, outcome: 'done' | 'failed' | 'declined', message: string,
): Promise<GoalRecord | null> {
  const ref = parseTrackingCode(task.workTrackingCode);
  if (!ref) return null;
  const ownerGhii = task.ownerGaii;
  const goal = await readGoal(deps, ownerGhii, ref.goalId);
  if (!goal) return null;
  if (ref.workId === 'coord') {
    return updateGoal(deps, ownerGhii, ref.goalId, cur => cur.wake?.taskId === task.id
      ? { ...cur, wake: { at: cur.wake.at }, log: [...cur.log, logEntry(task.agentGaii, 'decision', `The coordinator handled what happened${message ? `: ${message.slice(0, 500)}` : '.'}`)] }
      : UNCHANGED);
  }
  const agentName = goal.works.find(w => w.id === ref.workId && w.taskId === task.id)?.claimedBy;
  const spentNow = agentName ? await agentSpendToday(deps, ownerGhii, agentName) : 0;
  return updateGoal(deps, ownerGhii, ref.goalId, cur => {
    const work = cur.works.find(w => w.id === ref.workId);
    // The code alone proves nothing: the work must name this very task.
    if (!work || work.taskId !== task.id || work.status !== 'claimed') return UNCHANGED;
    const cost = Math.max(0, spentNow - (work.spendAtClaim ?? spentNow));
    const settledAt = new Date().toISOString();
    const spent = { ...cur.spent, usd: Math.round((cur.spent.usd + cost) * 10_000) / 10_000 };
    if (outcome === 'failed' && work.attempts + 1 < MAX_ATTEMPTS) {
      return {
        ...cur, spent,
        works: cur.works.map(w => w.id === work.id ? { ...w, status: 'open' as const, claimedBy: undefined, claimedAt: undefined, deadlineAt: undefined, taskId: undefined, offeredAt: undefined, attempts: w.attempts + 1, costUsd: (w.costUsd ?? 0) + cost, reason: message.slice(0, 1000) || w.reason } : w),
        log: [...cur.log, logEntry(task.agentGaii, 'returned', `"${work.title}" failed and went back to open work${message ? `: ${message.slice(0, 300)}` : '.'}`, { workId: work.id })],
      };
    }
    const status = outcome;
    const result = { summary: message.slice(0, TEXT_MAX), ...(task.deliverableKey ? { deliverableKey: task.deliverableKey } : {}), by: work.claimedBy };
    const material = outcome === 'done' && task.deliverableKey
      ? [...cur.material, { id: newId('m'), kind: 'result' as const, ref: task.deliverableKey, title: work.title, by: task.agentGaii, at: settledAt }].slice(-100)
      : cur.material;
    return {
      ...cur, spent, material,
      works: cur.works.map(w => w.id === work.id ? { ...w, status, settledAt, result, costUsd: (w.costUsd ?? 0) + cost } : w),
      log: [...cur.log, logEntry(task.agentGaii, outcome, outcome === 'done'
        ? `${work.claimedBy ?? 'The agent'} finished "${work.title}"${message ? `: ${message.slice(0, 300)}` : '.'}`
        : `${work.claimedBy ?? 'The agent'} ${outcome === 'declined' ? 'declined' : 'could not do'} "${work.title}"${message ? `: ${message.slice(0, 300)}` : '.'}`, { workId: work.id })],
    };
  });
}

/** The live tasks a goal holds, for a stop or a pause to tell them. */
export function liveTaskIds(goal: GoalRecord): string[] {
  return goal.works.filter(w => w.status === 'claimed' && w.taskId).map(w => w.taskId!);
}

/** How long ago a time was, in days (for the expiry and the renewal). */
export function daysSince(iso: string | undefined, now = Date.now()): number {
  return iso ? (now - Date.parse(iso)) / DAY : Infinity;
}

/** The agent GAII of a work's taker, for a delivery. */
export function takerGaii(deps: GoalDeps, goal: GoalRecord, work: GoalWork): string | null {
  return work.claimedBy ? agentGaiiOf(deps, work.claimedBy, goal.owner) : null;
}
