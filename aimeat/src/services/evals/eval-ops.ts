/**
 * @file src/services/evals/eval-ops.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The eval set operations every surface calls: write a set, read it with its runs, and
 *   start a run. REST: PUT /v1/evals/:kind/:name, GET /v1/evals/:kind/:name, POST
 *   /v1/evals/:kind/:name/run, DELETE /v1/evals/:kind/:name (routes/evals/evals.ts); MCP:
 *   aimeat_eval_set (remove: true removes), aimeat_eval_get, aimeat_eval_run (mcp/evals.ts; with
 *   run_id it finishes an open run). The scope words are on the routes and the tools: memory:write to
 *   write, remove, start or finish a run, memory:read to read. A run spends no AI on the node: the
 *   caller's own AI answers (eval-run.ts), so it asks the word a set write and aimeat_crew_try ask.
 *
 *   WHO. The account the target belongs to: the owner and the owner's agents. An app grant, an
 *   ecosystem app, a visitor from another node and the shared anonymous identity are refused, the
 *   last whichever credential carries it (isAnonymousPrincipal: the token POST /v1/auth/anonymous
 *   mints has role agent and no signed anonymous claim, secaudit2026nov26). A set is the account's own
 *   test of its own work. A crew must be an agent of the account; a skill one the account can read;
 *   a pack one this node serves.
 * @structure evalCallerOf · setEvalFor · getEvalFor · removeEvalFor · runEvalFor
 * @version-history
 *   v1.2.0 — 2026-11-27 — runEvalFor with run_id finishes an open run; the minted anonymous token is
 *     refused (wish-eval-runs-answered-by-the-caller-s-own-ai-not-by-the-node).
 *   v1.1.0 — 2026-11-26 — removeEvalFor.
 *   v1.0.0 — 2026-11-26 — Initial (wish-stored-eval-sets-for-crews-skills-and-library-packs-scored-p).
 */
import type { CallerContext } from '../caller-context.js';
import { localAccountName } from '../../utils/gaii.js';
import { isAnonymousPrincipal } from '../../auth/anonymous-principal.js';
import { checkCases, EVAL_TARGET_KINDS, readEvalSet, removeEvalSet, REPEATS_MAX, writeEvalSet, type EvalTarget, type EvalTargetKind } from './eval-sets.js';
import { finishEvalRun, resolveTarget, startEvalRun, type EvalCaller, type EvalDeps, type EvalRefusal } from './eval-run.js';

type Outcome = { ok: true; status?: number; data: Record<string, unknown> } | EvalRefusal;

const refuse = (status: number, code: string, message: string): EvalRefusal => ({ ok: false, status, code, message });

/** The account's own caller, or the refusal for one that is not acting for an account here. */
export function evalCallerOf(c: CallerContext): EvalCaller | EvalRefusal {
  if (c.visitor || c.kind === 'app' || c.kind === 'ecosystem' || c.kind === 'anonymous' || isAnonymousPrincipal(c.auth) || !c.ownerGhii) {
    return refuse(403, 'FORBIDDEN', 'Eval sets belong to an account: its owner or one of its agents writes and runs them.');
  }
  return { principal: c.principal, owner: localAccountName(c.ownerGhii), ownerGhii: c.ownerGhii, scopes: [...(c.scopes ?? [])], roles: [...(c.auth?.roles ?? [])] };
}

function targetOf(kind: string, name: string): EvalTarget | EvalRefusal {
  if (!EVAL_TARGET_KINDS.includes(kind as EvalTargetKind)) return refuse(400, 'INVALID_INPUT', `kind is one of ${EVAL_TARGET_KINDS.join(', ')}.`);
  const n = name.trim();
  if (!n || n.length > 200) return refuse(400, 'INVALID_INPUT', 'name is the crew\'s agent name, the skill\'s ref or name, or the pack\'s id.');
  return { kind: kind as EvalTargetKind, name: n };
}

/** PUT .../evals/:kind/:name { cases, repeats? }: write the cases; the runs stay. */
export async function setEvalFor(deps: EvalDeps, c: CallerContext, kind: string, name: string, body: unknown): Promise<Outcome> {
  const caller = evalCallerOf(c);
  if ('ok' in caller) return caller;
  const target = targetOf(kind, name);
  if ('ok' in target) return target;
  const resolved = await resolveTarget(deps, caller, target);
  if ('ok' in resolved) return resolved;
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const checked = checkCases(b.cases);
  if (!checked.ok) return refuse(400, 'INVALID_INPUT', checked.message);
  const repeats = b.repeats === undefined ? 3 : Number(b.repeats);
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > REPEATS_MAX) return refuse(400, 'INVALID_INPUT', `repeats is 1 to ${REPEATS_MAX}: how many times each case runs.`);
  const set = await writeEvalSet(deps.storage, caller.ownerGhii, target, checked.cases, repeats, caller.principal);
  return { ok: true, data: { target, cases: set.cases, repeats: set.repeats, runs: set.runs.length, revision_now: resolved.revision, next: 'aimeat_eval_run { kind, name } starts a run: for a skill or a pack it answers with the cases for your own AI to answer and judge; dry_run: true says what a run asks.' } };
}

/** GET .../evals/:kind/:name: the set and its runs, newest first. */
export async function getEvalFor(deps: EvalDeps, c: CallerContext, kind: string, name: string): Promise<Outcome> {
  const caller = evalCallerOf(c);
  if ('ok' in caller) return caller;
  const target = targetOf(kind, name);
  if ('ok' in target) return target;
  const set = await readEvalSet(deps.storage, caller.ownerGhii, target);
  if (!set) return refuse(404, 'NO_EVAL_SET', `There is no eval set for ${target.kind} ${target.name}.`);
  return { ok: true, data: { target, cases: set.cases, repeats: set.repeats, updated_at: set.updatedAt, runs: set.runs } };
}

/**
 * DELETE .../evals/:kind/:name: remove the set with its runs. The target need not exist any more,
 * because a set for a deleted skill or crew is exactly what the account wants to clean away.
 */
export async function removeEvalFor(deps: EvalDeps, c: CallerContext, kind: string, name: string): Promise<Outcome> {
  const caller = evalCallerOf(c);
  if ('ok' in caller) return caller;
  const target = targetOf(kind, name);
  if ('ok' in target) return target;
  const removed = await removeEvalSet(deps.storage, caller.ownerGhii, target, caller.principal);
  if (!removed) return refuse(404, 'NO_EVAL_SET', `There is no eval set for ${target.kind} ${target.name}.`);
  return { ok: true, data: { target, removed: true } };
}

/**
 * POST .../evals/:kind/:name/run: { dry_run? } starts a run or says what it asks; { run_id, results,
 * model? } finishes an open run with the caller's answers or verdicts.
 */
export async function runEvalFor(deps: EvalDeps, c: CallerContext, kind: string, name: string, body: unknown): Promise<Outcome> {
  const caller = evalCallerOf(c);
  if ('ok' in caller) return caller;
  const target = targetOf(kind, name);
  if ('ok' in target) return target;
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (b.run_id !== undefined) return finishEvalRun(deps, caller, target, b);
  return startEvalRun(deps, caller, target, { dryRun: b.dry_run === true });
}
