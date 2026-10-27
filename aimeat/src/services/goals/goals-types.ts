/**
 * @file src/services/goals/goals-types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shapes of an agent goal (wish-agenttien-ohjaus-tavoite-avoin-ty-ja-ketju-homeen-ja-asetuks):
 *   one owner record `agent-goals.<id>` holding the goal, its works, its material and its log. One key per
 *   goal, never one per work: a goal is one thing a person opens, its works are always read together,
 *   and an owner has 1000 keys (CLAUDE.md, "a memory value is a record"). The works and the log are
 *   capped (MAX_WORKS, MAX_LOG) so a goal that runs a round every day stays one bounded record.
 *
 *   A WORK is one piece of the goal: an agent's work (named to an agent, or open to any agent with a
 *   skill it `wants`) or a person's step (choose, approve, answer, do, provide). An agent work becomes
 *   a task only when an agent takes it; the task carries `workTrackingCode = goal:<goal>:<work>`, and
 *   the node trusts that code only after finding the task id on the work in this record.
 * @structure GoalRecord · GoalWork · GoalLogEntry · limits and caps · goalKey() · trackingCode() · parseTrackingCode()
 * @usage import { type GoalRecord, goalKey } from './goals-types.js';
 * @version-history
 *   v1.2.0 — 2026-10-27 — GoalWork.readAsk, readAllowed and readLeftOut: a model work waits for the
 *     owner's one press on a private record an agent without memory:read-as-owner named (secaudit2026oct26).
 *   v1.1.0 — 2026-10-25 — A work the node's model does (`runner: 'model'`, MODEL_TAKER, runKey,
 *     resultsKey), and the status `proposed` for a goal the owner's AI proposed (Jouni, 2026-10-25:
 *     the AI proposes, the person approves; with no agent or computer the node's model does the work).
 *   v1.0.0 — 2026-10-25 — Initial (session cc-jouni-goals).
 */

/**
 * The owner memory prefix every goal lives under. Service-owned (utils/reserved-keys.ts). Not plain
 * `goals.`: an app may keep its own `goals.*` records in the owner's memory, and reserving that would
 * refuse its writes.
 */
export const GOAL_PREFIX = 'agent-goals.';
export const GOAL_TAG = 'aimeat.goal';
export const GOAL_SPEC = 1;

export const MAX_WORKS = 200;
export const MAX_LOG = 300;
export const MAX_MATERIAL = 100;
export const MAX_REACTIONS = 30;
export const MAX_CHANGES = 100;
export const TEXT_MAX = 4000;
export const TITLE_MAX = 200;

/** Defaults the plan settled (docs/internal/2026-10-agenttien-tavoitteet/00-suunnitelma.md). */
export const DEFAULT_LIMITS: GoalLimits = {
  usd: null,
  hops: 5,
  tasksPerDay: 50,
  fixRounds: 4,
  claimMinutes: 30,
};
export const DEFAULT_DAYS = 30;
/** A goal that never ends by itself (rounds) is renewed within this many days or it stops. */
export const RENEW_DAYS = 90;
/** How many times a taken work may be returned to open work before it goes to the person. */
export const MAX_ATTEMPTS = 2;

/**
 * `proposed`: made by the owner's AI with `propose`, waiting for the owner's yes; nothing in it moves
 * until the owner approves it (goals-ops.ts goalActionOp 'approve').
 */
export const GOAL_STATUSES = ['proposed', 'active', 'paused', 'done', 'stopped', 'expired'] as const;
export type GoalStatus = typeof GOAL_STATUSES[number];

/** Who carries the goal: one agent taking the whole thing, a coordinator agent, or a fixed plan. */
export const GOAL_MODES = ['single', 'coordinator', 'plan'] as const;
export type GoalMode = typeof GOAL_MODES[number];

export const WORK_STATUSES = ['waiting', 'open', 'claimed', 'done', 'failed', 'declined', 'cancelled'] as const;
export type WorkStatus = typeof WORK_STATUSES[number];

export const HUMAN_KINDS = ['choose', 'approve', 'answer', 'do', 'provide'] as const;
export type HumanKind = typeof HUMAN_KINDS[number];

export const ROUND_TRIGGERS = ['manual', 'clock', 'condition'] as const;
export type RoundTrigger = typeof ROUND_TRIGGERS[number];

export interface GoalLimits {
  /** Spending limit for the whole goal in US dollars; null = no limit set. */
  usd: number | null;
  /** How many times work may pass from one agent's result to the next before it waits for the person. */
  hops: number;
  tasksPerDay: number;
  /** Back-and-forth rounds between two agents (a coder and a reviewer) before it waits for the person. */
  fixRounds: number;
  /** A taken work with no progress for this long returns to open work. */
  claimMinutes: number;
}

export interface GoalOption { id: string; label: string; detail?: string }
export interface GoalLink { url: string; title?: string }

export interface GoalWork {
  id: string;
  title: string;
  description: string;
  kind: 'agent' | 'human';
  humanKind?: HumanKind;
  /** For choose: the choices; `multiple` lets the person pick several. */
  options?: GoalOption[];
  multiple?: boolean;
  /** For do: links and ready texts the person uses, or a ready prompt for any AI. */
  links?: GoalLink[];
  texts?: string[];
  prompt?: string;
  /** Named agent (account-local name), or absent for open work. */
  agent?: string;
  /**
   * 'model': the node's own model does the work as a background AI job with the owner's key
   * (services/goals/goals-model.ts), when no agent or computer is needed or there is none. No agent
   * takes it; it runs inside the goal's spending limit.
   */
  runner?: 'model';
  /** For a model work: the model to use; absent, the owner's own default model. */
  model?: string;
  /** For a model work: the background job that does it. */
  jobId?: string;
  /** When the owner was told that a model work waits because the goal reached its spending limit. */
  limitAt?: string;
  /**
   * A model work that waits for the owner's one press: an agent without memory:read-as-owner named
   * these private records (services/goals/goals-model-reach.ts). The request id and the agent.
   */
  readAsk?: { requestId: string; agent: string; keys: string[] };
  /** Records the owner allowed the model to read for this work, and records left out on a no. */
  readAllowed?: string[];
  readLeftOut?: string[];
  /** Skills an open work asks for; an agent whose tags hold one of them may take it. */
  wants?: string[];
  /** Agents that may not take this work: the one whose own result produced it. */
  exclude?: string[];
  status: WorkStatus;
  /** How many times work has passed from one result to the next to reach this one. */
  hop: number;
  round?: number;
  /** Works that must be done first; while one is not, this work is `waiting`. */
  after?: string[];
  /** A person's step that waits for an outside answer until this time (ISO). */
  waitUntil?: string;
  /** The person's step that ends the goal when approved. */
  final?: boolean;
  taskId?: string;
  claimedBy?: string;
  claimedAt?: string;
  deadlineAt?: string;
  attempts: number;
  createdBy: string;
  createdAt: string;
  settledAt?: string;
  result?: {
    summary?: string;
    deliverableKey?: string;
    /** A person's answer: option ids, a text, approve true/false, or a file key. */
    answer?: unknown;
    by?: string;
  };
  reason?: string;
  /** A rejected result asked again: the work it replaces. */
  retryOf?: string;
  /** For an approve step: the work whose result is approved; a rejection asks it again. */
  approveOf?: string;
  /** For an approve step the node made at a limit: the work that waits for the person's yes. */
  held?: WorkSpec;
  /** Who produced the result this work continues from: the agent and its work. */
  origin?: { agent?: string; work?: string };
  /** Back-and-forth count between two agents along this chain. */
  loop: number;
  /** When the node offered this open work to the agents that may take it. */
  offeredAt?: string;
  /** The agent's node-measured spend when it took the work, to count what the work cost. */
  spendAtClaim?: number;
  costUsd?: number;
  /** When the owner was told about this person's step. */
  notifiedAt?: string;
  /** When the owner was told that no agent took this open work. */
  nobodyAt?: string;
}

/** What a caller gives to make a work. */
export interface WorkSpec {
  title: string;
  description?: string;
  kind?: 'agent' | 'human';
  humanKind?: HumanKind;
  options?: GoalOption[];
  multiple?: boolean;
  links?: GoalLink[];
  texts?: string[];
  prompt?: string;
  agent?: string;
  wants?: string[];
  runner?: 'model';
  model?: string;
  after?: string[];
  waitUntil?: string;
  final?: boolean;
}

export interface GoalReaction {
  id: string;
  /** Fires once when every work named (or every work wanting this skill, in the same round) is done. */
  when: { works?: string[]; wants?: string };
  then: {
    title: string;
    description?: string;
    agent?: string;
    wants?: string[];
    kind?: 'agent' | 'human';
    humanKind?: HumanKind;
    final?: boolean;
    runner?: 'model';
    model?: string;
  };
  firedRounds: number[];
}

export interface GoalMaterial {
  id: string;
  kind: 'file' | 'memory' | 'link' | 'text' | 'result';
  ref: string;
  title: string;
  by: string;
  at: string;
}

export interface GoalLogEntry {
  at: string;
  /** Who: a principal, `node`, or the person. */
  who: string;
  kind: 'created' | 'changed' | 'offered' | 'claimed' | 'progress' | 'done' | 'failed' | 'declined'
    | 'returned' | 'asked' | 'answered' | 'decision' | 'paused' | 'resumed' | 'stopped' | 'finished'
    | 'expired' | 'material' | 'subgoal' | 'round' | 'limit' | 'reaction';
  what: string;
  /** For a coordinator's decision: why it did it. */
  why?: string;
  workId?: string;
}

export interface GoalChange { v: number; at: string; who: string; what: string; where: string }

export interface GoalRecord {
  type: typeof GOAL_TAG;
  spec: number;
  id: string;
  owner: string;
  statement: string;
  title: string;
  doneWhen: { kind: 'human' | 'check' | 'all-done'; text: string };
  status: GoalStatus;
  mode: GoalMode;
  /** Account-local agent name of the coordinator, or null (the node carries it by rules). */
  coordinator: string | null;
  /** Who keeps the goal moving while the coordinator is away: the node's rules, an agent, or nobody. */
  substitute: 'node' | 'wait' | { agent: string };
  /** What the coordinator may do without asking. */
  permissions: {
    subgoals: boolean; assign: boolean; ownAi: boolean; workflows: boolean; appTools: boolean;
    proposeAgent: boolean; raiseLimits: boolean; changeDoneWhen: boolean;
  };
  participants: { agents: string[]; skills: string[]; anyAgent: boolean };
  limits: GoalLimits;
  endsAt: string | null;
  renewBy: string | null;
  workplace: { organismId: string; workspaceId: string } | null;
  planWorkflowId: string | null;
  parentGoalId: string | null;
  subgoals: string[];
  rounds: { trigger: RoundTrigger; cron?: string; timezone?: string; condition?: string; count: number; lastAt?: string; nextAt?: string; template: WorkSpec[] } | null;
  reactions: GoalReaction[];
  material: GoalMaterial[];
  works: GoalWork[];
  log: GoalLogEntry[];
  changes: GoalChange[];
  spent: { usd: number; tasks: number; day: string; dayTasks: number };
  /** A change the owner made for one round only; works of that round read it. */
  roundNote?: { round: number; text: string };
  /** The coordinator's last wake: when, and the task that carried it. */
  wake?: { at: string; taskId?: string };
  plannedBy: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  settledAt?: string;
}

export function goalKey(id: string): string { return `${GOAL_PREFIX}${id}`; }

/** Who a model work is taken by, in `claimedBy` and the log. */
export const MODEL_TAKER = 'model';
/** Where a model work's job writes its answer, until the goal moves it into the goal's results record. */
export const MODEL_RUN_PREFIX = 'goal-runs.';
/** One record per goal holding the model works' whole answers (the work keeps the first TEXT_MAX characters). */
export const RESULTS_PREFIX = 'goal-results.';
/** How many answers a goal's results record keeps; the oldest go first. */
export const MAX_RESULTS = 50;
export function runKey(goalId: string, workId: string): string { return `${MODEL_RUN_PREFIX}${goalId}.${workId}`; }
export function parseRunKey(key: string): { goalId: string; workId: string } | null {
  const m = /^goal-runs\.([a-z0-9-]{4,64})\.([a-z0-9-]{2,64})$/.exec(key);
  return m ? { goalId: m[1], workId: m[2] } : null;
}
export function resultsKey(goalId: string): string { return `${RESULTS_PREFIX}${goalId}`; }

/** The code a goal's task carries in `workTrackingCode`. */
export function trackingCode(goalId: string, workId: string): string { return `goal:${goalId}:${workId}`; }

export function parseTrackingCode(code: string | undefined | null): { goalId: string; workId: string } | null {
  const m = /^goal:([a-z0-9-]{4,64}):([a-z0-9-]{2,64})$/.exec(code ?? '');
  return m ? { goalId: m[1], workId: m[2] } : null;
}

/** True for a status a goal no longer moves out of by itself. */
export function goalSettled(status: GoalStatus): boolean {
  return status === 'done' || status === 'stopped' || status === 'expired';
}

export function workSettled(status: WorkStatus): boolean {
  return status === 'done' || status === 'failed' || status === 'declined' || status === 'cancelled';
}
