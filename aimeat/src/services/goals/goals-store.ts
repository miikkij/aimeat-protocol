/**
 * @file src/services/goals/goals-store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reading and writing one agent goal record, and deciding who may read or change it.
 *   Every write goes through updateRecord (services/record-cas.ts), so two agents taking the same open
 *   work at the same moment cannot both win: the second write finds a newer version, reads again and
 *   sees the work taken. The prefix `agent-goals.` is service-owned (utils/reserved-keys.ts), so no memory
 *   route writes a goal for anyone and this file is its one writer.
 *
 *   WHO MAY DO WHAT. A goal belongs to its owner. The owner in person reads and changes everything. An
 *   agent of the same owner reads the owner's goals with task:read and acts with task:write: it takes
 *   open work it is allowed to take, leaves the next work in a goal it works in, and, when it is the
 *   goal's coordinator, does what the goal's permissions allow. An app, an ecosystem app, a visitor and
 *   the anonymous identity are refused: a goal moves the owner's agents, which is the owner's to decide.
 * @structure GoalError · parseGoal() · readGoal() · listGoals() · updateGoal() · goalAccess() · agentNameOf() · newId()
 * @usage const g = await readGoal(deps, ownerGhii, id); await updateGoal(deps, ownerGhii, id, cur => ({ ...cur }));
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (session cc-jouni-goals).
 */
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { CallerContext } from '../caller-context.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { parseGAII, localAccountOf } from '../../utils/gaii.js';
import { emitChange } from '../event-bus.js';
import { GOAL_PREFIX, GOAL_TAG, MAX_LOG, MAX_CHANGES, goalKey, type GoalRecord, type GoalLogEntry } from './goals-types.js';

export interface GoalDeps { storage: Storage; config: AimeatConfig }

/** A refusal every door renders in its own shape: an HTTP status and code, or `CODE: message`. */
export class GoalError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export function newId(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString('hex')}`;
}

/** The stored value as a goal record, or null when it is not one. */
export function parseGoal(value: unknown): GoalRecord | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<GoalRecord>;
  if (v.type !== GOAL_TAG || typeof v.id !== 'string' || !Array.isArray(v.works)) return null;
  return v as GoalRecord;
}

export async function readGoal(deps: GoalDeps, ownerGhii: string, id: string): Promise<GoalRecord | null> {
  if (!/^[a-z0-9-]{4,64}$/.test(id)) return null;
  const rec = await deps.storage.getMemory(ownerGhii, goalKey(id));
  return parseGoal(rec?.value);
}

/** Every goal of one owner, newest change first. */
export async function listGoals(deps: GoalDeps, ownerGhii: string): Promise<GoalRecord[]> {
  const rows = await deps.storage.listMemory(ownerGhii, { prefix: GOAL_PREFIX });
  return rows.map(r => parseGoal(r.value)).filter((g): g is GoalRecord => !!g)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Change one goal on its version. `mutate` may run more than once on a conflict, so it reads only what
 * it is given. It answers UNCHANGED to write nothing, or throws a GoalError to refuse. The log and the
 * change list are trimmed here, once, so no caller can grow the record past its caps.
 */
export async function updateGoal(
  deps: GoalDeps, ownerGhii: string, id: string,
  mutate: (cur: GoalRecord) => GoalRecord | typeof UNCHANGED | Promise<GoalRecord | typeof UNCHANGED>,
): Promise<GoalRecord> {
  let missing = false;
  const out = await updateRecord<GoalRecord | null>(
    deps.storage, ownerGhii, goalKey(id), parseGoal,
    async cur => {
      if (!cur) { missing = true; return UNCHANGED; }
      const next = await mutate(cur);
      if (next === UNCHANGED) return UNCHANGED;
      next.updatedAt = new Date().toISOString();
      if (next.log.length > MAX_LOG) next.log = next.log.slice(-MAX_LOG);
      if (next.changes.length > MAX_CHANGES) next.changes = next.changes.slice(-MAX_CHANGES);
      return next;
    },
    { tag: GOAL_TAG, visibility: 'owner' },
  );
  if (missing || !out) throw new GoalError(404, 'NOT_FOUND', `No goal ${id}.`);
  emitChange('goals', ownerGhii);
  return out;
}

/** Write a new goal; refuses when the id is taken. */
export async function createGoalRecord(deps: GoalDeps, ownerGhii: string, goal: GoalRecord): Promise<GoalRecord> {
  let taken = false;
  const out = await updateRecord<GoalRecord | null>(
    deps.storage, ownerGhii, goalKey(goal.id), parseGoal,
    cur => { if (cur) { taken = true; return UNCHANGED; } return goal; },
    { tag: GOAL_TAG, visibility: 'owner' },
  );
  if (taken || !out) throw new GoalError(409, 'CONFLICT', `A goal ${goal.id} exists already.`);
  emitChange('goals', ownerGhii);
  return out;
}

export function logEntry(who: string, kind: GoalLogEntry['kind'], what: string, extra: Partial<GoalLogEntry> = {}): GoalLogEntry {
  return { at: new Date().toISOString(), who, kind, what, ...extra };
}

/**
 * The account-local agent name of an agent principal of this owner, or null. The account is read with
 * localAccountOf, so an agent of another node whose owner has the same local name is not this owner's.
 */
export function agentNameOf(principal: string, ownerName: string): string | null {
  const p = parseGAII(principal);
  return p && localAccountOf(principal) === ownerName ? p.agent : null;
}

export interface GoalAccess {
  ownerGhii: string;
  ownerName: string;
  /** The account holder in person. */
  person: boolean;
  /** The calling agent's name, when an agent of this owner calls. */
  agent: string | null;
  /** How the caller is named in a goal's log. */
  who: string;
}

/**
 * Who the caller is to the owner's goals, or a refusal. `write` asks for task:write, a read for
 * task:read; the owner in person passes both, as requireScope does everywhere.
 */
export function goalAccess(caller: CallerContext, mode: 'read' | 'write'): GoalAccess {
  if (caller.visitor || caller.kind === 'anonymous') throw new GoalError(403, 'FORBIDDEN', 'Goals belong to an account on this node; sign in as its owner or one of its agents.');
  if (caller.kind === 'app' || caller.kind === 'ecosystem') throw new GoalError(403, 'FORBIDDEN', 'An app cannot read or move its owner\'s goals; the owner or one of the owner\'s agents can.');
  const word = mode === 'read' ? 'task:read' : 'task:write';
  if (!caller.has(word)) throw new GoalError(403, 'SCOPE_DENIED', `This needs the permission ${word}.`);
  const agent = caller.kind === 'agent' ? agentNameOf(caller.principal, caller.owner) : null;
  if (caller.kind === 'agent' && !agent) throw new GoalError(403, 'FORBIDDEN', 'Only an agent of this account may act on its goals.');
  return {
    ownerGhii: caller.ownerGhii,
    ownerName: caller.owner,
    person: caller.inPerson,
    agent,
    who: caller.inPerson ? 'owner' : caller.principal,
  };
}

/** True when the caller may change the goal as its owner would: the person, or its coordinator. */
export function actsForOwner(access: GoalAccess, goal: GoalRecord): boolean {
  return access.person || (!!access.agent && goal.coordinator === access.agent);
}
