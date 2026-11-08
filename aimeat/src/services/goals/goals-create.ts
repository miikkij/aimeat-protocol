/**
 * @file src/services/goals/goals-create.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Making an agent goal and changing what it is: the input every door sends (validated here
 *   with zod, once), the record a new goal starts as, and the changes its owner or its coordinator may
 *   make later (statement, done-when, limits, participants, coordinator, end date, reactions, rounds).
 *   A change that touches running work is answered first as a preview when `preview` is asked: which
 *   taken works it ends and what they cost so far, so a person or their AI sees it before it happens.
 *   A change to the rounds merges into the rounds the goal has (roundsFrom): a field the caller leaves
 *   out keeps its value, and a clock round with no cron is refused on create and on change.
 * @structure GoalInputSchema · GoalPatchSchema · roundsFrom() · buildGoal() · applyPatch() · previewPatch()
 * @usage const goal = buildGoal(access, GoalInputSchema.parse(body), now);
 * @version-history
 *   v1.2.0 — 2026-11-08 — A change to the rounds keeps what it does not name: the Settings page's save
 *     (trigger and cron only) had removed the goal's time zone and its works per round. A clock round
 *     with an empty cron is refused on change too, not only on create (group k3-goalrounds).
 *   v1.1.0 — 2026-10-27 — Every string field has a length limit from models/input-limits.ts (wish wish-sy-tteiden-validointi-pituusrajat-ja-roskan-torjunta-palveli).
 *   v1.0.0 — 2026-10-25 — Initial (session cc-jouni-goals).
 */
import { z } from 'zod';
import { INPUT_LIMITS } from '../../models/input-limits.js';
import { Cron } from 'croner';
import { GoalError, logEntry, newId, type GoalAccess } from './goals-store.js';
import { WorkSpecSchema, makeWork, parseWorkSpec, appendWorks } from './goals-work.js';
import {
  DEFAULT_DAYS, DEFAULT_LIMITS, GOAL_MODES, GOAL_SPEC, GOAL_TAG, HUMAN_KINDS, MAX_REACTIONS, RENEW_DAYS, ROUND_TRIGGERS, TEXT_MAX, TITLE_MAX,
  type GoalReaction, type GoalRecord,
} from './goals-types.js';

const AgentName = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/i).max(INPUT_LIMITS.name);

const LimitsSchema = z.object({
  usd: z.number().min(0).max(100_000).nullable().optional(),
  hops: z.number().int().min(1).max(50).optional(),
  tasks_per_day: z.number().int().min(1).max(1000).optional(),
  fix_rounds: z.number().int().min(1).max(50).optional(),
  claim_minutes: z.number().int().min(5).max(24 * 60).optional(),
}).strict();

const PermissionsSchema = z.object({
  subgoals: z.boolean().optional(), assign: z.boolean().optional(), own_ai: z.boolean().optional(),
  workflows: z.boolean().optional(), app_tools: z.boolean().optional(), propose_agent: z.boolean().optional(),
  raise_limits: z.boolean().optional(), change_done_when: z.boolean().optional(),
}).strict();

const ReactionSchema = z.object({
  when: z.object({ works: z.array(z.string().max(64)).max(30).optional(), wants: z.string().max(64).optional() }).strict(),
  then: z.object({
    title: z.string().trim().min(1).max(TITLE_MAX), description: z.string().max(TEXT_MAX).optional(),
    agent: AgentName.optional(), wants: z.array(z.string().max(64)).max(10).optional(),
    kind: z.enum(['agent', 'human']).optional(), human_kind: z.enum(HUMAN_KINDS).optional(), final: z.boolean().optional(),
    runner: z.enum(['model']).optional(), model: z.string().trim().min(1).max(200).optional(),
  }).strict(),
}).strict();

const RoundsSchema = z.object({
  trigger: z.enum(ROUND_TRIGGERS),
  cron: z.string().max(100).optional(),
  timezone: z.string().max(64).optional(),
  condition: z.string().max(TEXT_MAX).optional(),
  works: z.array(WorkSpecSchema).max(20).optional(),
}).strict();

export const GoalInputSchema = z.object({
  statement: z.string().trim().min(1).max(TEXT_MAX),
  title: z.string().trim().min(1).max(TITLE_MAX).optional(),
  done_when: z.string().max(TEXT_MAX).optional(),
  done_kind: z.enum(['human', 'check', 'all-done']).optional(),
  mode: z.enum(GOAL_MODES).optional(),
  coordinator: AgentName.nullable().optional(),
  substitute: z.union([z.enum(['node', 'wait']), z.object({ agent: AgentName }).strict()]).optional(),
  permissions: PermissionsSchema.optional(),
  agents: z.array(AgentName).max(50).optional(),
  skills: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  any_agent: z.boolean().optional(),
  limits: LimitsSchema.optional(),
  ends_at: z.string().datetime().nullable().optional(),
  workplace: z.object({ organism_id: z.string().max(64), workspace_id: z.string().max(64) }).strict().nullable().optional(),
  plan_workflow_id: z.string().max(128).nullable().optional(),
  works: z.array(WorkSpecSchema).max(50).optional(),
  reactions: z.array(ReactionSchema).max(MAX_REACTIONS).optional(),
  rounds: RoundsSchema.nullable().optional(),
  parent_goal_id: z.string().max(64).optional(),
  reason: z.string().max(TEXT_MAX).optional(),
  /** The goal waits as a proposal for the owner's yes; nothing in it moves before that. */
  propose: z.boolean().optional(),
}).strict();
export type GoalInput = z.infer<typeof GoalInputSchema>;

export const GoalPatchSchema = GoalInputSchema.omit({ works: true, parent_goal_id: true, propose: true }).partial().extend({
  preview: z.boolean().optional(),
  /** For a goal with rounds: the change is for this round only. */
  this_round_only: z.boolean().optional(),
}).strict();
export type GoalPatch = z.infer<typeof GoalPatchSchema>;

export function parseInput<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new GoalError(400, 'INVALID_INPUT', parsed.error.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '));
  return parsed.data;
}

function checkCron(cron: string | undefined, timezone: string | undefined): string | undefined {
  if (!cron) return undefined;
  try {
    const next = new Cron(cron, { timezone: timezone || undefined, paused: true }).nextRun();
    return next ? next.toISOString() : undefined;
  } catch (err) {
    throw new GoalError(400, 'INVALID_INPUT', `rounds.cron is not a cron expression: ${err instanceof Error ? err.message : String(err)}`);
  }
}

type RoundsInput = z.infer<typeof RoundsSchema>;

/** A string that holds only spaces counts as not given. */
const filled = (s: string | undefined): string | undefined => (s && s.trim() ? s : undefined);

/**
 * The rounds a goal runs by, from the caller's input and the rounds it has now (null on create).
 * A field the caller leaves out keeps its current value: the Settings page sends the trigger and the
 * cron, and the goal's time zone and its works per round stay. The exceptions are the fields the new
 * trigger does not use: a manual round keeps no cron, and only a condition round keeps its condition.
 * An empty string or an empty list clears a field. A clock round with no cron is refused before
 * anything is built or written, on create and on change alike.
 */
function roundsFrom(r: RoundsInput, cur: GoalRecord['rounds'] = null): NonNullable<GoalRecord['rounds']> {
  const cron = r.cron !== undefined ? filled(r.cron) : (r.trigger === 'manual' ? undefined : cur?.cron);
  const condition = r.condition !== undefined ? filled(r.condition) : (r.trigger === 'condition' ? cur?.condition : undefined);
  const timezone = r.timezone !== undefined ? filled(r.timezone) : cur?.timezone;
  if (r.trigger === 'clock' && !cron) throw new GoalError(400, 'INVALID_INPUT', 'A goal whose rounds run by the clock names rounds.cron.');
  return {
    trigger: r.trigger, cron, timezone, condition,
    count: cur?.count ?? 0, ...(cur?.lastAt ? { lastAt: cur.lastAt } : {}),
    nextAt: checkCron(cron, timezone),
    template: r.works !== undefined ? r.works.map(w => parseWorkSpec(w)) : (cur?.template ?? []),
  };
}

function reactionFrom(r: z.infer<typeof ReactionSchema>): GoalReaction {
  if (!r.when.works?.length && !r.when.wants) throw new GoalError(400, 'INVALID_INPUT', 'A reaction names the works it waits for (when.works) or a skill (when.wants).');
  return {
    id: newId('r'), when: r.when, firedRounds: [],
    then: {
      title: r.then.title, description: r.then.description, agent: r.then.agent, wants: r.then.wants,
      kind: r.then.kind ?? (r.then.human_kind ? 'human' : 'agent'), humanKind: r.then.human_kind, final: r.then.final,
      ...(r.then.runner ? { runner: r.then.runner } : {}), ...(r.then.model ? { model: r.then.model } : {}),
    },
  };
}

const PERMISSION_DEFAULTS: GoalRecord['permissions'] = {
  subgoals: true, assign: true, ownAi: true, workflows: true, appTools: true,
  proposeAgent: false, raiseLimits: false, changeDoneWhen: false,
};

function permissionsFrom(p: z.infer<typeof PermissionsSchema> | undefined, base = PERMISSION_DEFAULTS): GoalRecord['permissions'] {
  if (!p) return base;
  return {
    subgoals: p.subgoals ?? base.subgoals, assign: p.assign ?? base.assign, ownAi: p.own_ai ?? base.ownAi,
    workflows: p.workflows ?? base.workflows, appTools: p.app_tools ?? base.appTools,
    // Money and a new agent are the person's to approve; the floor stays whatever these say.
    proposeAgent: p.propose_agent ?? base.proposeAgent, raiseLimits: p.raise_limits ?? base.raiseLimits,
    changeDoneWhen: p.change_done_when ?? base.changeDoneWhen,
  };
}

function limitsFrom(l: z.infer<typeof LimitsSchema> | undefined, base = DEFAULT_LIMITS): GoalRecord['limits'] {
  return {
    usd: l?.usd === undefined ? base.usd : l.usd,
    hops: l?.hops ?? base.hops,
    tasksPerDay: l?.tasks_per_day ?? base.tasksPerDay,
    fixRounds: l?.fix_rounds ?? base.fixRounds,
    claimMinutes: l?.claim_minutes ?? base.claimMinutes,
  };
}

/** The record a new goal starts as. Its works are made here; nothing runs until it is written. */
export function buildGoal(access: GoalAccess, input: GoalInput, now = new Date()): GoalRecord {
  const iso = now.toISOString();
  const rounds = input.rounds ?? null;
  const madeRounds = rounds ? roundsFrom(rounds) : null;
  const mode = input.mode ?? (input.coordinator ? 'coordinator' : 'single');
  if (mode === 'coordinator' && !input.coordinator) throw new GoalError(400, 'INVALID_INPUT', 'A goal in coordinator mode names its coordinator (an agent of this account).');
  const endsAt = input.ends_at === undefined
    ? (rounds ? null : new Date(now.getTime() + DEFAULT_DAYS * 86_400_000).toISOString())
    : input.ends_at;
  const statement = input.statement;
  let goal: GoalRecord = {
    type: GOAL_TAG, spec: GOAL_SPEC, id: newId('g'), owner: access.ownerName,
    statement, title: (input.title ?? statement.split(/[.!?\n]/)[0]).slice(0, TITLE_MAX),
    doneWhen: { kind: input.done_kind ?? (input.done_when ? 'human' : 'all-done'), text: input.done_when ?? '' },
    status: input.propose ? 'proposed' : 'active', mode, coordinator: input.coordinator ?? null,
    substitute: input.substitute ?? 'node',
    permissions: permissionsFrom(input.permissions),
    participants: { agents: input.agents ?? [], skills: input.skills ?? [], anyAgent: input.any_agent ?? (!input.agents?.length && !input.skills?.length) },
    limits: limitsFrom(input.limits),
    endsAt,
    renewBy: rounds ? new Date(now.getTime() + RENEW_DAYS * 86_400_000).toISOString() : null,
    workplace: input.workplace ? { organismId: input.workplace.organism_id, workspaceId: input.workplace.workspace_id } : null,
    planWorkflowId: input.plan_workflow_id ?? null,
    parentGoalId: input.parent_goal_id ?? null,
    subgoals: [],
    rounds: madeRounds,
    reactions: (input.reactions ?? []).map(reactionFrom),
    material: [], works: [], log: [], changes: [],
    spent: { usd: 0, tasks: 0, day: iso.slice(0, 10), dayTasks: 0 },
    plannedBy: access.who, createdBy: access.who, createdAt: iso, updatedAt: iso,
  };
  // The works the caller gave are made one by one, so a later work's `after` may name an earlier one
  // by its position: "#1" is the first work given.
  const made: string[] = [];
  for (const raw of input.works ?? []) {
    const spec = parseWorkSpec(raw);
    spec.after = spec.after?.map(a => /^#\d+$/.test(a) ? made[Number(a.slice(1)) - 1] ?? a : a);
    const work = makeWork(goal, spec, access.who, { round: 0 });
    goal = appendWorks(goal, [work]);
    made.push(work.id);
  }
  // A single-agent goal with no works is one open work: the whole goal, for whoever takes it.
  if (!goal.works.length && !rounds && mode === 'single') {
    goal = appendWorks(goal, [makeWork(goal, { title: goal.title, description: statement, wants: input.skills }, access.who, { round: 0 })]);
  }
  goal.log.push(logEntry(access.who, 'created', input.propose
    ? `The goal was proposed and waits for the owner's yes${input.reason ? `: ${input.reason}` : '.'}`
    : `The goal was made${input.reason ? `: ${input.reason}` : '.'}`));
  goal.changes.push({ v: 1, at: iso, who: access.who, what: 'made the goal', where: access.person ? 'person' : 'agent' });
  return goal;
}

/** What a change would end: the taken works it removes from the goal, and what they cost so far. */
export function previewPatch(goal: GoalRecord, patch: GoalPatch): { ends: Array<{ work: string; title: string; agent?: string; costUsd: number }>; note: string } {
  const ends: Array<{ work: string; title: string; agent?: string; costUsd: number }> = [];
  if (patch.agents || patch.skills || patch.any_agent === false) {
    const agents = new Set(patch.agents ?? goal.participants.agents);
    for (const w of goal.works.filter(x => x.status === 'claimed' && x.claimedBy && !agents.has(x.claimedBy) && !(patch.any_agent ?? goal.participants.anyAgent))) {
      ends.push({ work: w.id, title: w.title, agent: w.claimedBy, costUsd: w.costUsd ?? 0 });
    }
  }
  return { ends, note: ends.length ? 'These taken works end; what they did so far stays as material.' : 'No running work ends with this change.' };
}

/** The goal after a change by `access`. Refuses what the caller may not change. */
export function applyPatch(goal: GoalRecord, patch: GoalPatch, access: GoalAccess): GoalRecord {
  const coordinatorOnly = !access.person;
  if (coordinatorOnly) {
    if (patch.limits && !goal.permissions.raiseLimits) throw new GoalError(403, 'FORBIDDEN', 'The coordinator may not change the limits; it asks the owner.');
    if ((patch.done_when !== undefined || patch.done_kind !== undefined) && !goal.permissions.changeDoneWhen) throw new GoalError(403, 'FORBIDDEN', 'The coordinator may not change when the goal is done; it asks the owner.');
    if (patch.permissions || patch.coordinator !== undefined || patch.ends_at !== undefined) throw new GoalError(403, 'FORBIDDEN', 'Only the owner changes who coordinates, what it may do and when the goal ends.');
  }
  const next: GoalRecord = { ...goal };
  const what: string[] = [];
  // A change for this round only is a note the round's works read; the goal itself stays as it was,
  // so the next round starts from the goal again (scenario 20, docs/internal/2026-10-agenttien-tavoitteet).
  if (patch.this_round_only) {
    if (!goal.rounds) throw new GoalError(400, 'INVALID_INPUT', 'this_round_only is for a goal that runs in rounds.');
    const text = patch.statement ?? patch.reason;
    if (!text) throw new GoalError(400, 'INVALID_INPUT', 'Say what changes for this round in statement or reason.');
    const now = new Date().toISOString();
    const v = (goal.changes[goal.changes.length - 1]?.v ?? 0) + 1;
    return {
      ...goal,
      roundNote: { round: goal.rounds.count, text },
      changes: [...goal.changes, { v, at: now, who: access.who, what: `for round ${goal.rounds.count} only: ${text}`, where: access.person ? 'person' : 'agent' }],
      log: [...goal.log, logEntry(access.who, 'changed', `For this round only: ${text}`)],
    };
  }
  if (patch.statement !== undefined) { next.statement = patch.statement; what.push('the goal'); }
  if (patch.title !== undefined) { next.title = patch.title; what.push('the title'); }
  if (patch.done_when !== undefined || patch.done_kind !== undefined) {
    next.doneWhen = { kind: patch.done_kind ?? goal.doneWhen.kind, text: patch.done_when ?? goal.doneWhen.text };
    what.push('when it is done');
  }
  if (patch.mode !== undefined) { next.mode = patch.mode; what.push('how work is shared'); }
  if (patch.coordinator !== undefined) { next.coordinator = patch.coordinator; what.push('the coordinator'); }
  if (next.mode === 'coordinator' && !next.coordinator) throw new GoalError(400, 'INVALID_INPUT', 'A goal in coordinator mode names its coordinator.');
  if (patch.substitute !== undefined) { next.substitute = patch.substitute; what.push('the substitute'); }
  if (patch.permissions) { next.permissions = permissionsFrom(patch.permissions, goal.permissions); what.push('the coordinator\'s permissions'); }
  if (patch.agents || patch.skills || patch.any_agent !== undefined) {
    next.participants = { agents: patch.agents ?? goal.participants.agents, skills: patch.skills ?? goal.participants.skills, anyAgent: patch.any_agent ?? goal.participants.anyAgent };
    what.push('who takes part');
  }
  if (patch.limits) { next.limits = limitsFrom(patch.limits, goal.limits); what.push('the limits'); }
  if (patch.ends_at !== undefined) { next.endsAt = patch.ends_at; what.push('the end date'); }
  if (patch.workplace !== undefined) { next.workplace = patch.workplace ? { organismId: patch.workplace.organism_id, workspaceId: patch.workplace.workspace_id } : null; what.push('where the results show'); }
  if (patch.plan_workflow_id !== undefined) { next.planWorkflowId = patch.plan_workflow_id; what.push('the plan'); }
  if (patch.reactions) { next.reactions = patch.reactions.map(reactionFrom); what.push('the reactions'); }
  // A change to the rounds merges into the rounds the goal has: what the caller leaves out stays
  // (roundsFrom), so a save that names only the trigger and the cron keeps the time zone and the works.
  if (patch.rounds !== undefined) {
    next.rounds = patch.rounds ? roundsFrom(patch.rounds, goal.rounds) : null;
    what.push('the rounds');
  }
  if (!what.length) throw new GoalError(400, 'INVALID_INPUT', 'Nothing to change.');
  const v = (goal.changes[goal.changes.length - 1]?.v ?? 0) + 1;
  const now = new Date().toISOString();
  const summary = `changed ${what.join(', ')}${patch.this_round_only ? ' (this round only)' : ''}`;
  next.changes = [...goal.changes, { v, at: now, who: access.who, what: summary + (patch.reason ? `: ${patch.reason}` : ''), where: access.person ? 'person' : 'agent' }];
  next.log = [...goal.log, logEntry(access.who, 'changed', `${access.person ? 'The owner' : 'The coordinator'} ${summary}.`, patch.reason ? { why: patch.reason } : {})];
  return next;
}
