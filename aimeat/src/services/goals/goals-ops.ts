/**
 * @file src/services/goals/goals-ops.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every operation on agent goals, once, for every door: the REST routes
 *   (routes/goals.ts), the MCP tools aimeat_goal_set, aimeat_goal_get, aimeat_goal_work and
 *   aimeat_goal_answer (mcp/goals.ts) and, through REST, the CLI dispatch and the HOME pages. Each op
 *   names the caller (goalAccess), changes the goal on its version, and then moves it on
 *   (advanceGoal), so a work that becomes ready, a reaction that fires and a coordinator that should
 *   wake happen whichever door made the change.
 *
 *   WHO ANSWERS A PERSON'S STEP. The owner in person, or the owner's own AI in a conversation (an agent
 *   of mode `workstation`: Claude, Codex, Cursor on the person's machine) when it is neither the goal's
 *   coordinator nor the agent that asked: the person said it to their AI, and the AI passes it on. An
 *   agent answering its own question would make the question mean nothing, so that is refused.
 *
 *   A PROPOSAL. A goal made with `propose` (the person's AI proposing it) waits as `proposed`: nothing
 *   in it moves, its steps do not ask, no work is taken, until the owner in person approves it; the
 *   owner, or the AI that proposed it, declines it, which removes it.
 * @structure listOp · getOp · waitingOp · createOp · patchOp · goalActionOp · attachOp · workOp · answerOp
 * @usage res.json(success(nodeId, await createOp(deps, callerOf(req, nodeId, storage), req.body)));
 * @version-history
 *   v1.2.1 — 2026-10-29 — Approving a proposed goal records approvedAt (secaudit2026oct26 round 8c,
 *     goals-model-spend.ts).
 *   v1.2.0 — 2026-10-27 — An agent's answer to a person's step is logged with the agent's name, not as
 *     "the owner, through their AI" (secaudit2026oct26, goals:person-step-answer-via-self-set-workstation-mode).
 *   v1.1.0 — 2026-10-25 — approve and decline for a proposed goal; a proposal refuses the other actions,
 *     a take and an answer.
 *   v1.0.0 — 2026-10-25 — Initial (session cc-jouni-goals).
 */
import { randomUUID } from 'node:crypto';
import type { CallerContext } from '../caller-context.js';
import { emitDelivery } from '../event-bus.js';
import { logger } from '../../utils/logger.js';
import { UNCHANGED } from '../record-cas.js';
import {
  GoalError, actsForOwner, createGoalRecord, goalAccess, listGoals, logEntry, newId, readGoal, updateGoal,
  type GoalAccess, type GoalDeps,
} from './goals-store.js';
import { GoalInputSchema, GoalPatchSchema, applyPatch, buildGoal, parseInput, previewPatch } from './goals-create.js';
import { appendWorks, claimWork, makeWork, parseWorkSpec, releaseWork } from './goals-work.js';
import { advanceGoal } from './goals-advance.js';
import { mayTake, ownerAgents } from './goals-agents.js';
import { goalSummary, goalView, waitingItems } from './goals-view.js';
import { RENEW_DAYS, TEXT_MAX, goalKey, goalSettled, workSettled, type GoalRecord, type GoalWork, type WorkSpec } from './goals-types.js';

function need<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined || v === '') throw new GoalError(400, 'INVALID_INPUT', `${what} is required.`);
  return v;
}

async function mustRead(deps: GoalDeps, access: GoalAccess, id: string): Promise<GoalRecord> {
  const goal = await readGoal(deps, access.ownerGhii, need(id, 'goal_id'));
  if (!goal) throw new GoalError(404, 'NOT_FOUND', `No goal ${id}.`);
  return goal;
}

// ── Reads ────────────────────────────────────────────────────────────────────────────────────────

export async function listOp(deps: GoalDeps, caller: CallerContext, opts: { status?: string } = {}) {
  const access = goalAccess(caller, 'read');
  const goals = await listGoals(deps, access.ownerGhii);
  const wanted = opts.status ? goals.filter(g => opts.status === 'running' ? !goalSettled(g.status) : g.status === opts.status) : goals;
  return { goals: wanted.map(goalSummary), total: wanted.length };
}

export async function getOp(deps: GoalDeps, caller: CallerContext, id: string) {
  const access = goalAccess(caller, 'read');
  return { goal: goalView(await mustRead(deps, access, id)) };
}

/** Every step across the owner's goals that waits for the person, newest first. */
export async function waitingOp(deps: GoalDeps, caller: CallerContext) {
  const access = goalAccess(caller, 'read');
  const goals = await listGoals(deps, access.ownerGhii);
  const items = goals.filter(g => !goalSettled(g.status)).flatMap(waitingItems).sort((a, b) => b.since.localeCompare(a.since));
  return { waiting: items, total: items.length };
}

// ── Making and changing a goal ───────────────────────────────────────────────────────────────────

export async function createOp(deps: GoalDeps, caller: CallerContext, body: unknown) {
  const access = goalAccess(caller, 'write');
  const input = parseInput(GoalInputSchema, body);
  let goal = buildGoal(access, input);
  const agents = await ownerAgents(deps, access.ownerName);
  const names = new Set(agents.map(a => a.name));
  for (const n of [input.coordinator, ...(input.agents ?? []), ...goal.works.map(w => w.agent)].filter((x): x is string => !!x)) {
    if (!names.has(n)) throw new GoalError(400, 'INVALID_INPUT', `This account has no agent ${n}.`);
  }
  if (input.parent_goal_id) {
    const parent = await mustRead(deps, access, input.parent_goal_id);
    if (goalSettled(parent.status)) throw new GoalError(409, 'CONFLICT', `The goal ${parent.id} is ${parent.status}.`);
    const agentInIt = !!access.agent && parent.works.some(w => w.claimedBy === access.agent);
    const coordinatorMay = access.agent === parent.coordinator && parent.permissions.subgoals;
    if (!access.person && !coordinatorMay && !agentInIt) throw new GoalError(403, 'FORBIDDEN', 'A subgoal is added by the owner, the goal\'s coordinator, or an agent working in the goal.');
    // A subgoal spends from its parent: its limit is what the parent has left, at most.
    if (parent.limits.usd !== null) {
      const left = Math.max(0, parent.limits.usd - parent.spent.usd);
      goal = { ...goal, limits: { ...goal.limits, usd: Math.min(goal.limits.usd ?? left, left) } };
    }
    goal = { ...goal, endsAt: goal.endsAt && parent.endsAt && goal.endsAt > parent.endsAt ? parent.endsAt : goal.endsAt };
  }
  const stored = await createGoalRecord(deps, access.ownerGhii, goal);
  if (input.parent_goal_id) {
    await updateGoal(deps, access.ownerGhii, input.parent_goal_id, cur => ({
      ...cur,
      subgoals: [...cur.subgoals, stored.id],
      log: [...cur.log, logEntry(access.who, 'subgoal', `${access.person ? 'The owner' : access.agent ?? 'An agent'} added the subgoal "${stored.title}".`, input.reason ? { why: input.reason } : {})],
    }));
  }
  const moved = await advanceGoal(deps, access.ownerGhii, stored.id);
  return { goal: goalView(moved ?? stored) };
}

export async function patchOp(deps: GoalDeps, caller: CallerContext, id: string, body: unknown) {
  const access = goalAccess(caller, 'write');
  const patch = parseInput(GoalPatchSchema, body);
  const goal = await mustRead(deps, access, id);
  if (!actsForOwner(access, goal)) throw new GoalError(403, 'FORBIDDEN', 'The owner or the goal\'s coordinator changes a goal.');
  if (patch.preview) return { preview: previewPatch(goal, patch), goal: goalSummary(goal) };
  const ends = previewPatch(goal, patch).ends.map(e => e.work);
  const changed = await updateGoal(deps, access.ownerGhii, id, cur => {
    const next = applyPatch(cur, patch, access);
    if (!ends.length) return next;
    return {
      ...next,
      works: next.works.map(w => ends.includes(w.id) && w.status === 'claimed' ? { ...w, status: 'cancelled' as const, settledAt: new Date().toISOString(), reason: 'ended by a change to the goal' } : w),
    };
  });
  await tellTasks(deps, changed.works.filter(w => ends.includes(w.id)), 'The goal changed and this work is no longer needed. What you did so far stays as material.');
  return { goal: goalView((await advanceGoal(deps, access.ownerGhii, id)) ?? changed) };
}

/** Put a line on each task so the agent doing it reads what happened to its goal. */
async function tellTasks(deps: GoalDeps, works: GoalWork[], message: string): Promise<void> {
  for (const w of works.filter(x => x.taskId)) {
    await deps.storage.appendTaskEvent({ id: randomUUID(), taskId: w.taskId!, type: 'message', message, timestamp: new Date().toISOString() })
      .catch(err => logger.warn('goal: telling a task failed', { taskId: w.taskId, error: String(err) }));
  }
}

/** approve, decline (a proposed goal), pause, resume, stop, done, renew, start_round, delete. */
export async function goalActionOp(deps: GoalDeps, caller: CallerContext, id: string, action: string, body: { reason?: unknown } = {}) {
  const access = goalAccess(caller, 'write');
  const goal = await mustRead(deps, access, id);
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, TEXT_MAX) : '';
  const byOwner = actsForOwner(access, goal);
  const now = new Date().toISOString();
  const who = access.person ? 'The owner' : access.agent ?? 'An agent';
  if (goal.status === 'proposed' && action !== 'approve' && action !== 'decline') {
    throw new GoalError(409, 'CONFLICT', 'This goal is a proposal: the owner approves or declines it first.');
  }
  switch (action) {
    case 'approve': {
      // The yes is the person's own: an AI that proposed a goal does not approve it for them.
      if (!access.person) throw new GoalError(403, 'FORBIDDEN', 'The owner approves a proposed goal, signed in themselves.');
      if (goal.status !== 'proposed') throw new GoalError(409, 'CONFLICT', `The goal is ${goal.status}, not a proposal.`);
      const changed = await updateGoal(deps, access.ownerGhii, id, cur => cur.status !== 'proposed' ? UNCHANGED : ({
        // approvedAt: the works in the goal are the owner's own yes (goals-model-spend.ts).
        ...cur, status: 'active', approvedAt: now,
        log: [...cur.log, logEntry(access.who, 'changed', `The owner approved the proposed goal${reason ? `: ${reason}` : '.'}`)],
      }));
      return { goal: goalView((await advanceGoal(deps, access.ownerGhii, id)) ?? changed) };
    }
    case 'decline': {
      if (goal.status !== 'proposed') throw new GoalError(409, 'CONFLICT', `The goal is ${goal.status}, not a proposal.`);
      if (!access.person && goal.createdBy !== access.who) throw new GoalError(403, 'FORBIDDEN', 'The owner, or the AI that proposed it, declines a proposed goal.');
      await deps.storage.deleteMemory(access.ownerGhii, goalKey(id), access.who);
      return { deleted: id };
    }
    case 'pause': case 'resume': case 'stop': {
      if (!byOwner) throw new GoalError(403, 'FORBIDDEN', 'The owner or the goal\'s coordinator pauses, resumes or stops a goal.');
      if (goalSettled(goal.status)) throw new GoalError(409, 'CONFLICT', `The goal is ${goal.status}.`);
      if (action === 'resume' && goal.status !== 'paused') throw new GoalError(409, 'CONFLICT', 'The goal is not paused.');
      if (action === 'pause' && goal.status === 'paused') return { goal: goalView(goal) };
      const status = action === 'pause' ? 'paused' as const : action === 'stop' ? 'stopped' as const : 'active' as const;
      const changed = await updateGoal(deps, access.ownerGhii, id, cur => ({
        ...cur, status,
        ...(action === 'stop' ? { settledAt: now, works: cur.works.map(w => w.status === 'open' || w.status === 'waiting' ? { ...w, status: 'cancelled' as const, settledAt: now } : w) } : {}),
        log: [...cur.log, logEntry(access.who, action === 'pause' ? 'paused' : action === 'stop' ? 'stopped' : 'resumed', `${who} ${action === 'pause' ? 'paused' : action === 'stop' ? 'stopped' : 'resumed'} the goal${reason ? `: ${reason}` : '.'}`)],
      }));
      const running = changed.works.filter(w => w.status === 'claimed');
      if (action !== 'resume') {
        await tellTasks(deps, running, action === 'pause'
          ? 'The goal is paused. Save where you are (complete this task with your state, or leave it waiting); new work starts only when the owner resumes.'
          : 'The goal was stopped. Finish what you are doing and start nothing new for it.');
        for (const w of running) {
          if (w.claimedBy) emitDelivery({ target: `${w.claimedBy}#${goal.owner}@${deps.config.nodeId}`, kind: action === 'pause' ? 'goal_paused' : 'goal_stopped', id: `${id}:${w.id}:${now}`, payload: { goal_id: id, work_id: w.id, task_id: w.taskId } });
        }
        return { goal: goalView(changed) };
      }
      return { goal: goalView((await advanceGoal(deps, access.ownerGhii, id)) ?? changed) };
    }
    case 'done': {
      const coordinatorMay = access.agent === goal.coordinator && (goal.doneWhen.kind === 'check' || goal.permissions.changeDoneWhen);
      if (!access.person && !coordinatorMay) throw new GoalError(403, 'FORBIDDEN', goal.doneWhen.kind === 'human' ? 'The owner says when this goal is done.' : 'The owner or the goal\'s coordinator marks it done.');
      const changed = await updateGoal(deps, access.ownerGhii, id, cur => ({
        ...cur, status: 'done', settledAt: now,
        works: cur.works.map(w => w.status === 'open' || w.status === 'waiting' ? { ...w, status: 'cancelled' as const, settledAt: now } : w),
        log: [...cur.log, logEntry(access.who, 'finished', `${who} marked the goal done${reason ? `: ${reason}` : '.'}`)],
      }));
      return { goal: goalView(changed) };
    }
    case 'renew': {
      if (!access.person) throw new GoalError(403, 'FORBIDDEN', 'The owner renews a goal.');
      const renewBy = new Date(Date.now() + RENEW_DAYS * 86_400_000).toISOString();
      const changed = await updateGoal(deps, access.ownerGhii, id, cur => ({
        ...cur, renewBy: cur.rounds ? renewBy : cur.renewBy,
        endsAt: cur.endsAt && cur.endsAt < renewBy && !cur.rounds ? renewBy : cur.endsAt,
        status: cur.status === 'expired' ? 'active' : cur.status,
        log: [...cur.log, logEntry(access.who, 'changed', `The owner renewed the goal until ${renewBy.slice(0, 10)}.`)],
      }));
      return { goal: goalView(changed) };
    }
    case 'start_round': {
      if (!byOwner) throw new GoalError(403, 'FORBIDDEN', 'The owner or the goal\'s coordinator starts a round.');
      return { goal: goalView(await startRound(deps, access.ownerGhii, id, access.who)) };
    }
    case 'delete': {
      if (!access.person) throw new GoalError(403, 'FORBIDDEN', 'The owner removes a goal.');
      if (!goalSettled(goal.status)) throw new GoalError(409, 'CONFLICT', 'Stop the goal before you remove it.');
      await deps.storage.deleteMemory(access.ownerGhii, goalKey(id), access.who);
      return { deleted: id };
    }
    default:
      throw new GoalError(400, 'INVALID_INPUT', 'action is one of approve, decline, pause, resume, stop, done, renew, start_round, delete.');
  }
}

/** A new round: the round template's works, numbered with the round. Used by the clock sweep too. */
export async function startRound(deps: GoalDeps, ownerGhii: string, id: string, who: string): Promise<GoalRecord> {
  await updateGoal(deps, ownerGhii, id, cur => {
    if (!cur.rounds) throw new GoalError(400, 'INVALID_INPUT', 'This goal does not run in rounds.');
    if (goalSettled(cur.status) || cur.status === 'paused') throw new GoalError(409, 'CONFLICT', `The goal is ${cur.status}.`);
    const round = cur.rounds.count + 1;
    let next: GoalRecord = { ...cur, rounds: { ...cur.rounds, count: round, lastAt: new Date().toISOString() } };
    const specs = cur.rounds.template.length ? cur.rounds.template : [{ title: cur.title, description: cur.rounds.condition ? `${cur.statement}\n\nAct only when this holds: ${cur.rounds.condition}. When it does not, complete the task saying so.` : cur.statement } as WorkSpec];
    const made: GoalWork[] = [];
    for (const s of specs) made.push(makeWork(next, { ...s, after: undefined }, who, { round }));
    next = appendWorks(next, made);
    next.log = [...next.log, logEntry(who, 'round', `Round ${round} started.`)];
    return next;
  });
  return (await advanceGoal(deps, ownerGhii, id))!;
}

export async function attachOp(deps: GoalDeps, caller: CallerContext, id: string, body: Record<string, unknown>) {
  const access = goalAccess(caller, 'write');
  const goal = await mustRead(deps, access, id);
  const kind = String(body.kind ?? '');
  if (!['file', 'memory', 'link', 'text'].includes(kind)) throw new GoalError(400, 'INVALID_INPUT', 'kind is one of file, memory, link, text.');
  const ref = String(need(body.ref as string, 'ref')).slice(0, TEXT_MAX);
  const title = String(body.title ?? ref).slice(0, 200);
  const inGoal = !!access.agent && (goal.works.some(w => w.claimedBy === access.agent) || goal.coordinator === access.agent);
  if (!access.person && !inGoal && caller.kind !== 'agent') throw new GoalError(403, 'FORBIDDEN', 'The owner, the owner\'s AI or an agent working in the goal adds material.');
  if (kind === 'memory' || kind === 'file') {
    // Material names the caller's own record or file: it must be readable by the caller now.
    const rec = kind === 'memory' ? await deps.storage.getMemory(caller.principal, ref) ?? await deps.storage.getMemory(access.ownerGhii, ref) : null;
    if (kind === 'memory' && !rec) throw new GoalError(404, 'NOT_FOUND', `No record ${ref} of yours or of the owner's.`);
  }
  const changed = await updateGoal(deps, access.ownerGhii, id, cur => ({
    ...cur,
    material: [...cur.material, { id: newId('m'), kind: kind as 'file', ref, title, by: access.who, at: new Date().toISOString() }].slice(-100),
    log: [...cur.log, logEntry(access.who, 'material', `${access.person ? 'The owner' : access.agent ?? 'An agent'} added material: ${title}.`)],
  }));
  for (const w of changed.works.filter(x => x.status === 'claimed' && x.claimedBy)) {
    emitDelivery({ target: `${w.claimedBy}#${goal.owner}@${deps.config.nodeId}`, kind: 'goal_updated', id: `${id}:${w.id}:${Date.now()}`, payload: { goal_id: id, work_id: w.id, material: title } });
  }
  await tellTasks(deps, changed.works.filter(w => w.status === 'claimed'), `New material in the goal: ${title} (${kind}: ${ref}).`);
  return { goal: goalView((await advanceGoal(deps, access.ownerGhii, id)) ?? changed) };
}

// ── Works ────────────────────────────────────────────────────────────────────────────────────────

/** The keys of a works request that name the request, not the work (a flat work is read without them). */
const REQUEST_KEYS = new Set(['action', 'goal_id', 'work_id', 'reason', 'work']);

/** The work an agent most recently took in this goal: what its next work continues from. */
function latestOf(goal: GoalRecord, agent: string): GoalWork | undefined {
  return [...goal.works].reverse().find(w => w.claimedBy === agent);
}

export async function workOp(deps: GoalDeps, caller: CallerContext, action: string, body: Record<string, unknown>) {
  if (action === 'available') return availableOp(deps, caller);
  const access = goalAccess(caller, 'write');
  const goalId = String(need(body.goal_id as string, 'goal_id'));
  const goal = await mustRead(deps, access, goalId);
  const workId = typeof body.work_id === 'string' ? body.work_id : '';
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, TEXT_MAX) : '';
  switch (action) {
    case 'claim': {
      if (!access.agent) throw new GoalError(400, 'INVALID_INPUT', 'An agent takes a work for itself; the owner gives one with action "add" and an agent named.');
      const out = await claimWork(deps, access.ownerGhii, access.ownerName, goalId, need(workId, 'work_id'), access.agent, access.who);
      return { goal: goalView(out.goal), task_id: out.taskId };
    }
    case 'release': {
      const changed = await releaseWork(deps, access, goalId, need(workId, 'work_id'), reason);
      return { goal: goalView((await advanceGoal(deps, access.ownerGhii, goalId)) ?? changed) };
    }
    case 'add': case 'leave': {
      // The work comes inside `work`, or flat beside the request's own keys, which are not the work's.
      const flat = Object.fromEntries(Object.entries(body).filter(([k]) => !REQUEST_KEYS.has(k)));
      const spec = parseWorkSpec(body.work ?? flat);
      const coordinatorMay = access.agent === goal.coordinator && goal.permissions.assign;
      const from = access.agent ? latestOf(goal, access.agent) : undefined;
      if (action === 'add' && !access.person && !coordinatorMay && caller.kind !== 'agent') throw new GoalError(403, 'FORBIDDEN', 'The owner or the goal\'s coordinator adds work.');
      if (action === 'leave' && !from && !coordinatorMay && !access.person) throw new GoalError(403, 'FORBIDDEN', 'An agent leaves the next work in a goal it works in.');
      if (goalSettled(goal.status)) throw new GoalError(409, 'CONFLICT', `The goal is ${goal.status}.`);
      const changed = await updateGoal(deps, access.ownerGhii, goalId, cur => leaveInto(cur, spec, access, action === 'leave' ? latestOf(cur, access.agent ?? '') : undefined, reason));
      return { goal: goalView((await advanceGoal(deps, access.ownerGhii, goalId)) ?? changed) };
    }
    case 'reroute': {
      if (!actsForOwner(access, goal)) throw new GoalError(403, 'FORBIDDEN', 'The owner or the goal\'s coordinator moves a work.');
      const to = typeof body.agent === 'string' ? body.agent : undefined;
      const wants = Array.isArray(body.wants) ? (body.wants as unknown[]).map(String).slice(0, 10) : undefined;
      if (!to && !wants) throw new GoalError(400, 'INVALID_INPUT', 'Name the agent it moves to, or the skills (wants) for open work.');
      if (to && !(await ownerAgents(deps, access.ownerName)).some(a => a.name === to)) throw new GoalError(400, 'INVALID_INPUT', `This account has no agent ${to}.`);
      const old = goal.works.find(w => w.id === workId);
      const changed = await updateGoal(deps, access.ownerGhii, goalId, cur => {
        const work = cur.works.find(w => w.id === workId);
        if (!work) throw new GoalError(404, 'NOT_FOUND', `No work ${workId} in this goal.`);
        if (workSettled(work.status)) throw new GoalError(409, 'CONFLICT', `The work is ${work.status}.`);
        const moved: GoalWork = { ...work, status: 'open', agent: to, wants: to ? work.wants : wants, claimedBy: undefined, claimedAt: undefined, deadlineAt: undefined, taskId: undefined, offeredAt: undefined };
        const material = work.claimedBy ? [...cur.material, { id: newId('m'), kind: 'text' as const, ref: `What ${work.claimedBy} did before the move is in its task ${work.taskId ?? ''}.`, title: `${work.title}: work before the move`, by: 'node', at: new Date().toISOString() }] : cur.material;
        return {
          ...cur, material,
          works: cur.works.map(w => w.id === workId ? moved : w),
          log: [...cur.log, logEntry(access.who, 'changed', `"${work.title}" moved to ${to ?? `open work for ${wants!.join(', ')}`}${reason ? `: ${reason}` : '.'}`, { workId, ...(reason ? { why: reason } : {}) })],
        };
      });
      if (old?.status === 'claimed') await tellTasks(deps, [old], 'This work was moved to another agent. Stop it; what you did so far stays as material.');
      return { goal: goalView((await advanceGoal(deps, access.ownerGhii, goalId)) ?? changed) };
    }
    case 'reject': {
      if (!actsForOwner(access, goal)) throw new GoalError(403, 'FORBIDDEN', 'The owner or the goal\'s coordinator asks for a result again.');
      const changed = await updateGoal(deps, access.ownerGhii, goalId, cur => rejectInto(cur, workId, reason, access));
      return { goal: goalView((await advanceGoal(deps, access.ownerGhii, goalId)) ?? changed) };
    }
    default:
      throw new GoalError(400, 'INVALID_INPUT', 'action is one of available, claim, release, add, leave, reroute, reject.');
  }
}

/** A work made into a goal by `access`. Leaving it from one's own work counts the chain. */
function leaveInto(cur: GoalRecord, spec: WorkSpec, access: GoalAccess, from: GoalWork | undefined, reason: string): GoalRecord {
  const hop = from ? from.hop + 1 : 0;
  // Back and forth: the agent hands work to the one whose result it was working on.
  const target = spec.agent;
  const loop = from && target && from.origin?.agent === target ? from.loop + 1 : (from?.loop ?? 0);
  const round = cur.rounds?.count ?? 0;
  const extra: Partial<GoalWork> = { hop, loop, round, ...(from && access.agent ? { origin: { agent: access.agent, work: from.id } } : {}) };
  // An agent's own result never gives it the next work: that is the self-wake guard.
  if (access.agent && !spec.agent) extra.exclude = [access.agent];
  if (spec.agent && spec.agent === access.agent && from) throw new GoalError(400, 'INVALID_INPUT', 'An agent does not hand work to itself; it continues its own task.');
  const overHops = from && hop > cur.limits.hops;
  const overLoops = loop > cur.limits.fixRounds;
  if ((overHops || overLoops) && (spec.kind ?? 'agent') === 'agent') {
    const why = overLoops ? `${loop - 1} rounds back and forth, this goal's limit` : `${hop - 1} passes from one result to the next, this goal's limit`;
    const step = makeWork(cur, { title: `Continue: ${spec.title}?`, description: `The work has gone ${why}. Approve to let it continue once more.`, kind: 'human', humanKind: 'approve' }, 'node', { held: spec, hop, loop, round });
    return { ...appendWorks(cur, [step]), log: [...cur.log, logEntry('node', 'limit', `"${spec.title}" waits for the owner's yes: ${why}.`, { workId: step.id })] };
  }
  const work = makeWork(cur, spec, access.who, extra);
  return {
    ...appendWorks(cur, [work]),
    log: [...cur.log, logEntry(access.who, 'changed', `${access.person ? 'The owner' : access.agent ?? 'An agent'} added "${work.title}"${work.agent ? ` for ${work.agent}` : work.wants?.length ? ` for an agent that knows ${work.wants.join(' or ')}` : ''}.`, { workId: work.id, ...(reason ? { why: reason } : {}) })],
  };
}

/** A done result asked again, with the reason: a new work that carries the old result and why. */
function rejectInto(cur: GoalRecord, workId: string, reason: string, access: GoalAccess): GoalRecord {
  const work = cur.works.find(w => w.id === workId);
  if (!work) throw new GoalError(404, 'NOT_FOUND', `No work ${workId} in this goal.`);
  if (work.status !== 'done') throw new GoalError(409, 'CONFLICT', 'Only a finished result can be asked again.');
  if (!reason) throw new GoalError(400, 'INVALID_INPUT', 'Say what was not good (reason): the next agent reads it.');
  // The retry is done the way the work was: by the same named agent, as open work for the same
  // skills, or by the node's model (a model work asked again stays the model's, not open work).
  const retry = makeWork(cur, { title: work.title, description: work.description, agent: work.agent, wants: work.wants, runner: work.runner, model: work.model }, access.who, {
    hop: work.hop + 1, round: work.round, retryOf: work.id, reason, origin: { agent: work.claimedBy, work: work.id }, loop: work.loop,
  });
  const base = appendWorks(cur, [retry]);
  return {
    ...base,
    works: base.works.map(w => w.id === workId ? { ...w, status: 'declined' as const, reason } : w),
    log: [...cur.log, logEntry(access.who, 'declined', `${access.person ? 'The owner' : 'The coordinator'} asked "${work.title}" again: ${reason}`, { workId: retry.id })],
  };
}

/** Open work across the owner's goals that the calling agent may take now. */
async function availableOp(deps: GoalDeps, caller: CallerContext) {
  const access = goalAccess(caller, 'read');
  if (!access.agent) throw new GoalError(400, 'INVALID_INPUT', 'action "available" is for an agent: it lists the open work it may take.');
  const me = (await ownerAgents(deps, access.ownerName)).find(a => a.name === access.agent);
  if (!me) return { works: [], total: 0 };
  const goals = (await listGoals(deps, access.ownerGhii)).filter(g => g.status === 'active');
  const works = goals.flatMap(g => g.works.filter(w => w.status === 'open' && mayTake(g, w, me)).map(w => ({
    goal_id: g.id, goal: g.title, work_id: w.id, title: w.title, description: w.description, wants: w.wants ?? [], hop: w.hop,
  })));
  return { works, total: works.length };
}

// ── A person's step ──────────────────────────────────────────────────────────────────────────────

export async function answerOp(deps: GoalDeps, caller: CallerContext, goalId: string, workId: string, body: Record<string, unknown>) {
  const access = goalAccess(caller, 'write');
  const goal = await mustRead(deps, access, goalId);
  const work = goal.works.find(w => w.id === workId);
  if (!work) throw new GoalError(404, 'NOT_FOUND', `No work ${workId} in this goal.`);
  if (work.kind !== 'human') throw new GoalError(400, 'INVALID_INPUT', 'That work is an agent\'s; an agent completes it through its task.');
  if (work.status !== 'open') throw new GoalError(409, 'CONFLICT', `The step is ${work.status}.`);
  if (goal.status === 'proposed') throw new GoalError(409, 'CONFLICT', 'This goal is a proposal: the owner approves it first.');
  if (!access.person) {
    const me = (await ownerAgents(deps, access.ownerName)).find(a => a.name === access.agent);
    // The person's own AI writes the person's questions when it makes the goal for them, and answers
    // them when the person tells it. What it may not do is answer as an agent that works in the goal:
    // the coordinator, or an agent that took a work here and left the step while working.
    const worksHere = goal.coordinator === access.agent || goal.works.some(w => w.claimedBy === access.agent);
    const asked = worksHere && work.createdBy === access.who;
    if (me?.mode !== 'workstation' || asked || goal.coordinator === access.agent) {
      throw new GoalError(403, 'FORBIDDEN', 'The owner answers this, in person or through their own AI in a conversation; the agent that asked may not answer itself.');
    }
  }
  const answer = readAnswer(work, body);
  const now = new Date().toISOString();
  const changed = await updateGoal(deps, access.ownerGhii, goalId, cur => {
    const w = cur.works.find(x => x.id === workId);
    if (!w || w.status !== 'open') throw new GoalError(409, 'CONFLICT', 'The step was answered already.');
    const rejected = w.humanKind === 'approve' && answer.approve === false;
    let next: GoalRecord = {
      ...cur,
      works: cur.works.map(x => x.id === workId ? { ...x, status: rejected ? 'declined' as const : 'done' as const, settledAt: now, result: { answer, by: access.who }, ...(rejected && answer.reason ? { reason: String(answer.reason) } : {}) } : x),
      // The log names the agent that answered for the owner (secaudit2026oct26, decision 2026-10-27).
      log: [...cur.log, logEntry(access.who, 'answered', `${access.person ? 'The owner' : `The agent ${access.agent}, for the owner,`} answered "${w.title}"${describeAnswer(w, answer)}.`, { workId })],
    };
    if (w.humanKind === 'provide' && answer.ref) {
      next.material = [...next.material, { id: newId('m'), kind: answer.kind === 'file' ? 'file' as const : answer.kind === 'memory' ? 'memory' as const : 'text' as const, ref: String(answer.ref), title: w.title, by: access.who, at: now }].slice(-100);
    }
    if (w.humanKind === 'approve' && !rejected && w.held) {
      next = appendWorks(next, [makeWork(next, w.held, 'node', { hop: w.hop, loop: 0, round: w.round })]);
    }
    // A rejected approval asks again the result it approves: the work it names (approveOf), or, for a
    // step a plan put after a work ("after"), the last finished work it waited for. The asked-again
    // work gets an approval step of its own, so the person sees the new result before it counts.
    const approved = w.approveOf ?? [...(w.after ?? [])].reverse().find(id => cur.works.find(x => x.id === id)?.status === 'done');
    if (w.humanKind === 'approve' && rejected && approved) {
      next = rejectInto(next, approved, String(answer.reason ?? 'The owner did not approve it.'), access);
      const retry = [...next.works].reverse().find(x => x.retryOf === approved);
      if (retry) {
        next = appendWorks(next, [makeWork(next, { title: w.title, description: w.description, kind: 'human', humanKind: 'approve', after: [retry.id], final: w.final }, 'node', { approveOf: retry.id, hop: w.hop, round: w.round })]);
      }
    }
    if (w.final && !rejected && w.humanKind === 'approve') {
      next = { ...next, status: 'done', settledAt: now, log: [...next.log, logEntry(access.who, 'finished', access.person
        ? 'The owner approved the result: the goal is done.'
        : `The agent ${access.agent} approved the result for the owner: the goal is done.`)] };
    }
    return next;
  });
  return { goal: goalView((await advanceGoal(deps, access.ownerGhii, goalId)) ?? changed) };
}

function readAnswer(work: GoalWork, body: Record<string, unknown>): Record<string, unknown> {
  switch (work.humanKind) {
    case 'choose': {
      const chosen = Array.isArray(body.options) ? (body.options as unknown[]).map(String) : typeof body.option === 'string' ? [body.option] : [];
      const ids = new Set((work.options ?? []).map(o => o.id));
      if (!chosen.length || chosen.some(c => !ids.has(c))) throw new GoalError(400, 'INVALID_INPUT', `Choose with options: one or more of ${[...ids].join(', ')}.`);
      if (chosen.length > 1 && !work.multiple) throw new GoalError(400, 'INVALID_INPUT', 'This step takes one choice.');
      return { options: chosen, ...(typeof body.text === 'string' ? { text: body.text.slice(0, TEXT_MAX) } : {}) };
    }
    case 'approve':
      if (typeof body.approve !== 'boolean') throw new GoalError(400, 'INVALID_INPUT', 'Answer an approve step with approve: true or false.');
      if (body.approve === false && typeof body.reason !== 'string') throw new GoalError(400, 'INVALID_INPUT', 'Say why it is not approved (reason): the next agent reads it.');
      return { approve: body.approve, ...(typeof body.reason === 'string' ? { reason: body.reason.slice(0, TEXT_MAX) } : {}) };
    case 'answer':
      if (typeof body.text !== 'string' || !body.text.trim()) throw new GoalError(400, 'INVALID_INPUT', 'Answer with text.');
      return { text: body.text.slice(0, TEXT_MAX) };
    case 'do':
      return { done: true, ...(typeof body.text === 'string' ? { text: body.text.slice(0, TEXT_MAX) } : {}) };
    case 'provide': {
      const kind = typeof body.kind === 'string' ? body.kind : 'text';
      const ref = typeof body.ref === 'string' ? body.ref : typeof body.text === 'string' ? body.text : '';
      if (!ref) throw new GoalError(400, 'INVALID_INPUT', 'Give the file (kind "file", ref = its storage key), a record (kind "memory") or the text.');
      return { kind, ref: ref.slice(0, TEXT_MAX) };
    }
    default:
      throw new GoalError(400, 'INVALID_INPUT', 'This step has no kind.');
  }
}

function describeAnswer(work: GoalWork, a: Record<string, unknown>): string {
  if (work.humanKind === 'choose') {
    const labels = (a.options as string[]).map(id => work.options?.find(o => o.id === id)?.label ?? id);
    return `: ${labels.join(', ')}`;
  }
  if (work.humanKind === 'approve') return a.approve ? ': approved' : `: not approved${a.reason ? ` (${a.reason})` : ''}`;
  if (work.humanKind === 'do') return ': done';
  return '';
}
