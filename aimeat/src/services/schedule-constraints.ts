/**
 * @file schedule-constraints.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Extensible, opt-in budget/run guards for recurring schedules.
 *   Each guard is a registry entry implementing a pre-fire check() (and optional
 *   post-run hook). Guards are stored on ScheduledJobRecord.constraints as a JSON
 *   array, so adding a new guard type later is one REGISTRY entry + a UI toggle —
 *   no schema migration. All guards are disabled unless explicitly toggled on.
 *
 *   v1 guards:
 *     - max_runs    { limit }              — stop after N successful fires
 *     - daily_limit { limit }              — cap today's AI spend (USD) for the
 *                                            owner before an `ai` fire; sourced
 *                                            from the guard, falling back to the
 *                                            agent's dailySpendLimit.
 * @structure
 *   - REGISTRY: Record<type, ConstraintDef>
 *   - evaluateConstraints(schedule, ctx) — pre-fire gate (allow/deny + disable hint)
 *   - applyAfterRun(schedule, ctx)       — post-fire constraint-state updates
 *   - mergeConstraintDefaults(...)       — inherit agent defaults at creation
 * @version-history
 *   v1.0.0 — 2026-06-03 — Initial registry (max_runs, daily_limit)
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, ScheduledJobRecord, ScheduleConstraint, AgentRecord } from '../storage/interface.js';
import { getTodayUsage } from './ai-completion.js';

export interface ConstraintContext {
  storage: Storage;
  config: AimeatConfig;
  /** Owner GHII whose spend/usage the guard checks (for daily_limit). */
  ownerGaii?: string;
  /** The target agent record, when the schedule belongs to one. */
  agent?: AgentRecord | null;
}

export interface ConstraintCheckResult {
  allow: boolean;
  reason?: string;
  /** When true, the scheduler should disable the schedule entirely (e.g. max_runs reached). */
  disable?: boolean;
}

export interface ConstraintDef {
  type: string;
  /** Pre-fire gate. allow=false skips this fire (logged as 'skipped'). */
  check(schedule: ScheduledJobRecord, constraint: ScheduleConstraint, ctx: ConstraintContext): Promise<ConstraintCheckResult>;
  /** Optional post-successful-fire state mutation; returns the updated constraint state. */
  onAfterRun?(schedule: ScheduledJobRecord, constraint: ScheduleConstraint, ctx: ConstraintContext): Promise<Record<string, unknown> | void>;
}

const numParam = (constraint: ScheduleConstraint, key: string): number | undefined => {
  const v = constraint.params?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
};

const REGISTRY: Record<string, ConstraintDef> = {
  // ── Stop after N successful fires ──
  max_runs: {
    type: 'max_runs',
    async check(schedule, constraint) {
      const limit = numParam(constraint, 'limit');
      if (limit === undefined || limit <= 0) return { allow: true };
      const ran = schedule.runCount ?? 0;
      if (ran >= limit) {
        return { allow: false, disable: true, reason: `max_runs reached (${ran}/${limit})` };
      }
      return { allow: true };
    },
  },

  // ── Cap today's AI spend (USD) for the owner before an ai-kind fire ──
  daily_limit: {
    type: 'daily_limit',
    async check(schedule, constraint, ctx) {
      // Only the `ai` path has a real per-day spend signal today (ai-usage.<gaii>.<day>).
      // For other kinds the guard is a no-op (documented); kept extensible.
      if (schedule.type !== 'ai') return { allow: true };
      const limit = numParam(constraint, 'limit') ?? ctx.agent?.dailySpendLimit ?? undefined;
      if (limit === undefined || limit === null || limit <= 0) return { allow: true };
      const owner = ctx.ownerGaii ?? schedule.ownerScope;
      if (!owner) return { allow: true };
      const usage = await getTodayUsage(ctx.storage, owner);
      if (usage.total_cost_usd >= limit) {
        return { allow: false, reason: `daily AI spend limit reached ($${usage.total_cost_usd.toFixed(4)} / $${limit})` };
      }
      return { allow: true };
    },
  },
};

/** True if a guard type is known to the registry. */
export function isKnownConstraint(type: string): boolean {
  return type in REGISTRY;
}

/** The set of guard types the node currently supports (for UI + validation). */
export function knownConstraintTypes(): string[] {
  return Object.keys(REGISTRY);
}

/**
 * Evaluate all enabled+known guards before a fire. Returns the first denial
 * (with an optional `disable` hint), else allow.
 */
export async function evaluateConstraints(
  schedule: ScheduledJobRecord,
  ctx: ConstraintContext,
): Promise<ConstraintCheckResult> {
  const constraints = schedule.constraints ?? [];
  for (const c of constraints) {
    if (!c.enabled) continue;
    const def = REGISTRY[c.type];
    if (!def) continue; // unknown guard type — ignore (forward-compatible)
    const result = await def.check(schedule, c, ctx);
    if (!result.allow) return result;
  }
  return { allow: true };
}

/**
 * Apply post-fire state updates. Returns the new constraints array if any guard
 * mutated its state, else undefined (no write needed).
 */
export async function applyAfterRun(
  schedule: ScheduledJobRecord,
  ctx: ConstraintContext,
): Promise<ScheduleConstraint[] | undefined> {
  const constraints = schedule.constraints ?? [];
  let changed = false;
  const next = await Promise.all(constraints.map(async (c) => {
    if (!c.enabled) return c;
    const def = REGISTRY[c.type];
    if (!def?.onAfterRun) return c;
    const patch = await def.onAfterRun(schedule, c, ctx);
    if (patch) { changed = true; return { ...c, state: { ...(c.state ?? {}), ...patch } }; }
    return c;
  }));
  return changed ? next : undefined;
}

/**
 * At schedule creation, inherit the agent's default guards for any guard type
 * the new schedule didn't specify. Explicit per-schedule guards win.
 */
export function mergeConstraintDefaults(
  scheduleConstraints: ScheduleConstraint[] | undefined,
  agentDefaults: ScheduleConstraint[] | undefined,
): ScheduleConstraint[] | undefined {
  if (!agentDefaults?.length) return scheduleConstraints;
  const out: ScheduleConstraint[] = [...(scheduleConstraints ?? [])];
  const present = new Set(out.map(c => c.type));
  for (const d of agentDefaults) {
    if (!present.has(d.type)) out.push({ ...d });
  }
  return out.length ? out : undefined;
}
