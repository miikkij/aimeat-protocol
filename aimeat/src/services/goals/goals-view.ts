/**
 * @file src/services/goals/goals-view.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a goal looks like to its reader: a short summary for lists and the HOME cards
 *   (progress, who works now, what waits for the person, what was spent), the whole goal for its page,
 *   and the steps across goals that wait for the person. Field names are snake_case, as every other
 *   REST answer on this node. The internal bookkeeping (the spend at take time) is left out.
 * @structure goalSummary() · goalView() · waitingItems()
 * @usage res.json(success(nodeId, { goal: goalView(goal) }));
 * @version-history
 *   v1.3.0 — 2026-10-29 — A model work waiting for the owner's answer on spending the AI allowance
 *     shows `spend_request` (secaudit2026oct26 round 8c).
 *   v1.2.0 — 2026-10-27 — A model work waiting for the owner's answer on records shows `read_request`
 *     (secaudit2026oct26).
 *   v1.1.0 — 2026-10-25 — A work shows its runner, model and job; a proposed goal waits as one item.
 *   v1.0.0 — 2026-10-25 — Initial (session cc-jouni-goals).
 */
import { NOBODY_MS } from './goals-advance.js';
import type { GoalRecord, GoalWork } from './goals-types.js';

function workView(w: GoalWork) {
  return {
    id: w.id, title: w.title, description: w.description, kind: w.kind,
    ...(w.humanKind ? { human_kind: w.humanKind } : {}),
    ...(w.options ? { options: w.options } : {}),
    ...(w.multiple ? { multiple: true } : {}),
    ...(w.links ? { links: w.links } : {}),
    ...(w.texts ? { texts: w.texts } : {}),
    ...(w.prompt ? { prompt: w.prompt } : {}),
    agent: w.agent ?? null, wants: w.wants ?? [], runner: w.runner ?? null, model: w.model ?? null, job_id: w.jobId ?? null, status: w.status, hop: w.hop, loop: w.loop, round: w.round ?? 0,
    after: w.after ?? [], wait_until: w.waitUntil ?? null, final: !!w.final,
    task_id: w.taskId ?? null, claimed_by: w.claimedBy ?? null, claimed_at: w.claimedAt ?? null, deadline_at: w.deadlineAt ?? null,
    attempts: w.attempts, created_by: w.createdBy, created_at: w.createdAt, settled_at: w.settledAt ?? null,
    result: w.result ?? null, reason: w.reason ?? null, retry_of: w.retryOf ?? null, origin: w.origin ?? null,
    held: w.held ? { title: w.held.title, agent: w.held.agent ?? null, wants: w.held.wants ?? [] } : null,
    offered_at: w.offeredAt ?? null, nobody_took: !!w.nobodyAt, cost_usd: w.costUsd ?? 0,
    // A model work waiting for the owner's answer on records an agent named (goals-model-reach.ts).
    ...(w.readAsk ? { read_request: { request_id: w.readAsk.requestId || null, records: w.readAsk.keys, agent: w.readAsk.agent } } : {}),
    // A model work waiting for the owner's answer on spending the AI allowance (goals-model-spend.ts).
    ...(w.spendAsk ? { spend_request: { request_id: w.spendAsk.requestId || null, agent: w.spendAsk.agent } } : {}),
  };
}

function progress(goal: GoalRecord) {
  const round = goal.rounds?.count ?? 0;
  const inRound = goal.rounds ? goal.works.filter(w => (w.round ?? 0) === round) : goal.works;
  return {
    total: inRound.length,
    done: inRound.filter(w => w.status === 'done').length,
    running: inRound.filter(w => w.status === 'claimed').length,
    open: inRound.filter(w => w.status === 'open' && w.kind === 'agent').length,
    waiting_for_you: inRound.filter(w => w.status === 'open' && w.kind === 'human').length,
    round,
  };
}

export function goalSummary(goal: GoalRecord) {
  return {
    id: goal.id, title: goal.title, statement: goal.statement, status: goal.status, mode: goal.mode,
    coordinator: goal.coordinator, done_when: goal.doneWhen,
    progress: progress(goal),
    working_now: goal.works.filter(w => w.status === 'claimed').map(w => ({ agent: w.claimedBy, work: w.title, work_id: w.id })),
    spent: { usd: goal.spent.usd, tasks: goal.spent.tasks }, limits: goal.limits,
    ends_at: goal.endsAt, renew_by: goal.renewBy,
    rounds: goal.rounds ? { trigger: goal.rounds.trigger, cron: goal.rounds.cron ?? null, count: goal.rounds.count, last_at: goal.rounds.lastAt ?? null, next_at: goal.rounds.nextAt ?? null } : null,
    parent_goal_id: goal.parentGoalId, subgoals: goal.subgoals,
    updated_at: goal.updatedAt, created_at: goal.createdAt,
  };
}

export function goalView(goal: GoalRecord) {
  return {
    ...goalSummary(goal),
    substitute: goal.substitute, permissions: goal.permissions, participants: goal.participants,
    workplace: goal.workplace, plan_workflow_id: goal.planWorkflowId,
    rounds: goal.rounds ? { ...goalSummary(goal).rounds, condition: goal.rounds.condition ?? null, timezone: goal.rounds.timezone ?? null, template: goal.rounds.template } : null,
    round_note: goal.roundNote ?? null,
    reactions: goal.reactions,
    works: goal.works.map(workView),
    material: goal.material,
    log: goal.log,
    changes: goal.changes,
    planned_by: goal.plannedBy, created_by: goal.createdBy, settled_at: goal.settledAt ?? null,
  };
}

/** One thing that waits for the person: a step, open work nobody took, or a whole proposed goal. */
export interface WaitingItem {
  goal_id: string;
  goal: string;
  kind: 'step' | 'nobody_took' | 'proposal';
  work: ReturnType<typeof workView> | null;
  since: string;
  statement?: string;
  proposed_by?: string;
  works?: number;
}

/** The steps in one goal that wait for the person, and the open work nobody took. */
export function waitingItems(goal: GoalRecord): WaitingItem[] {
  const now = Date.now();
  // A proposal is one thing to decide: the whole goal, before any of its steps.
  if (goal.status === 'proposed') {
    return [{ goal_id: goal.id, goal: goal.title, kind: 'proposal' as const, work: null, statement: goal.statement, proposed_by: goal.createdBy, works: goal.works.length, since: goal.createdAt }];
  }
  const steps = goal.works.filter(w => w.kind === 'human' && w.status === 'open').map(w => ({
    goal_id: goal.id, goal: goal.title, kind: 'step' as const, work: workView(w), since: w.notifiedAt ?? w.createdAt,
  }));
  const nobody = goal.works.filter(w => w.kind === 'agent' && w.status === 'open' && w.offeredAt && now - Date.parse(w.offeredAt) >= NOBODY_MS).map(w => ({
    goal_id: goal.id, goal: goal.title, kind: 'nobody_took' as const, work: workView(w), since: w.offeredAt!,
  }));
  return [...steps, ...nobody];
}
