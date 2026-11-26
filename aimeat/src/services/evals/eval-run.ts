/**
 * @file src/services/evals/eval-run.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Run a stored eval set (services/evals/eval-sets.ts) against what its target is now,
 *   and score it against the run of the revision before.
 *
 *     crew    each case is a crew trial on the agent's own runtime (services/crews/ops.ts crewTryStart),
 *             the same run aimeat_crew_try makes; the answer is graded
 *     skill   each case runs twice on the owner's AI: with the skill's SKILL.md as the system text, and
 *     pack    with nothing (a library pack: its aiDoc), so the score says what the text changes
 *
 *   Every case runs `repeats` times, because one run of a model says little: two identical runs of one
 *   task here cost $0.27 and $0.72 (.claude/rules/skills.md). A `judge` expectation is one more model
 *   call per answer, and its verdict is labelled as a judge's.
 *
 *   WHO PAYS, AND WHO SAID SO. Every model call spends the caller's owner's AI allowance through
 *   completeForOwner (services/ai/completion.ts), as the person or as the agent that asked, under the
 *   owner's own policy. Starting a run needs `ai:use`, the word an AI job needs: the owner's grant of it
 *   is the owner's yes, and a tool call without it gets the one-press address where the owner allows
 *   it. `dry_run` answers how many model calls a run makes before any is made.
 *
 *   IN THE BACKGROUND. A run is started and answered at once with its id; the set's `runs` shows it
 *   running, then done or failed. One run per set at a time.
 * @structure startEvalRun(deps, caller, target, opts) · gradeAnswer(answer, expect, judge)
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-stored-eval-sets-for-crews-skills-and-library-packs-scored-p).
 */
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { completeForOwner } from '../ai/completion.js';
import { aiCallerOfPrincipal } from '../ai/caller-context.js';
import { resolveSkillRef } from '../skills.js';
import { getLibraryPacks } from '../../data/library-packs.js';
import { crewTryStart, crewTryWait, resolveCrewAgent, type CrewCaller } from '../crews/ops.js';
import { readCrewState } from '../crews/def-store.js';
import { readEvalSet, recordEvalRun, type ArmResult, type EvalCase, type EvalRun, type EvalSet, type EvalTarget } from './eval-sets.js';

export interface EvalDeps { storage: Storage; config: AimeatConfig }
export interface EvalCaller { principal: string; owner: string; ownerGhii: string; scopes: string[]; roles: string[] }
export type EvalRefusal = { ok: false; status: number; code: string; message: string };

/** The answer a judge's rubric reads, cut so one judge call stays small. */
const ANSWER_FOR_JUDGE = 6000;
const running = new Set<string>();

interface Resolved { revision: string; system?: string; crew?: { name: string; doc: Record<string, unknown> } }

/** What the target is now: its revision, and the text or crew a case runs with. Exported for the set's own check. */
export async function resolveTarget(deps: EvalDeps, caller: EvalCaller, target: EvalTarget): Promise<Resolved | EvalRefusal> {
  if (target.kind === 'skill') {
    try {
      const skill = await resolveSkillRef(deps.storage, deps.config, target.name, { ownerName: caller.owner });
      const text = skill.fileContents['SKILL.md'];
      if (!text) return { ok: false, status: 404, code: 'NOT_FOUND', message: `The skill ${target.name} has no SKILL.md to evaluate.` };
      return { revision: skill.version, system: text };
    } catch (err) {
      return { ok: false, status: 404, code: 'NOT_FOUND', message: `No skill ${target.name} this account can read (${(err as Error)?.message ?? 'not found'}).` };
    }
  }
  if (target.kind === 'pack') {
    const pack = getLibraryPacks().find(p => p.id === target.name);
    if (!pack) return { ok: false, status: 404, code: 'NOT_FOUND', message: `No library pack ${target.name} on this node; aimeat_appdev_overview lists them.` };
    return { revision: pack.version ?? 'unversioned', system: pack.aiDoc };
  }
  const crewCaller: CrewCaller = { principal: caller.principal, owner: caller.owner, scopes: caller.scopes, roles: caller.roles, pipeline: 'evals.run' };
  const agent = await resolveCrewAgent(deps, crewCaller, target.name);
  if (!agent.ok) return { ok: false, status: agent.status, code: agent.code, message: agent.message };
  const state = await readCrewState(deps.storage, agent.agent);
  if (!state.published) return { ok: false, status: 409, code: 'NO_PUBLISHED_CREW', message: `${target.name} has no published crew definition to evaluate; publish one with aimeat_crew_publish.` };
  return { revision: String(state.published.revision), crew: { name: target.name, doc: state.published.doc } };
}

/** How many model calls one run makes: every case, repeat and arm, and a judge per answer that has one. */
function callsOf(set: EvalSet, arms: number): number {
  const judges = set.cases.reduce((n, c) => n + c.expect.filter(e => e.kind === 'judge').length, 0);
  return set.repeats * (set.cases.length + judges) * arms;
}

/** One answer from the owner's AI, with or without a system text. */
async function ask(deps: EvalDeps, caller: EvalCaller, prompt: string, system?: string): Promise<{ content: string; model: string }> {
  const r = await completeForOwner(deps.storage, deps.config, caller.principal, {
    ...aiCallerOfPrincipal(caller.principal), prompt, ...(system ? { systemPrompt: system } : {}),
  });
  return { content: r.content, model: r.model };
}

/** Whether one answer meets one case's expectations; the failures say which, and a judge's are marked. */
export async function gradeAnswer(
  answer: string, expect: EvalCase['expect'], judge: (rubric: string, answer: string) => Promise<boolean>,
): Promise<string[]> {
  const failures: string[] = [];
  const lower = answer.toLowerCase();
  for (const e of expect) {
    if (e.kind === 'contains' && !lower.includes(e.value.toLowerCase())) failures.push(`does not contain "${e.value.slice(0, 80)}"`);
    if (e.kind === 'not_contains' && lower.includes(e.value.toLowerCase())) failures.push(`contains "${e.value.slice(0, 80)}"`);
    if (e.kind === 'judge' && !(await judge(e.value, answer))) failures.push(`judge (a model's verdict): ${e.value.slice(0, 80)}`);
  }
  return failures;
}

async function runArm(deps: EvalDeps, caller: EvalCaller, set: EvalSet, answerOf: (c: EvalCase) => Promise<string>): Promise<ArmResult> {
  const judge = async (rubric: string, answer: string) => {
    const r = await ask(deps, caller,
      `You grade one answer against a rubric. Reply with exactly PASS or FAIL.\n\nRubric: ${rubric}\n\nAnswer:\n${answer.slice(0, ANSWER_FOR_JUDGE)}`);
    return /\bPASS\b/.test(r.content) && !/\bFAIL\b/.test(r.content);
  };
  const cases = [];
  for (const c of set.cases) {
    let passed = 0;
    const failures: string[] = [];
    for (let i = 0; i < set.repeats; i++) {
      const fails = await gradeAnswer(await answerOf(c), c.expect, judge);
      if (fails.length === 0) passed++;
      else if (failures.length < 3) failures.push(fails.join('; '));
    }
    cases.push({ id: c.id, passed, of: set.repeats, failures });
  }
  const score = cases.length ? Math.round((cases.reduce((s, c) => s + c.passed / c.of, 0) / cases.length) * 1000) / 1000 : 0;
  return { score, cases };
}

/**
 * Start a run of the set, or (dryRun) answer what it would cost. Answers at once; the run goes on in
 * the background and lands in the set's `runs`.
 */
export async function startEvalRun(
  deps: EvalDeps, caller: EvalCaller, target: EvalTarget, opts: { dryRun?: boolean } = {},
): Promise<{ ok: true; data: Record<string, unknown> } | EvalRefusal> {
  const set = await readEvalSet(deps.storage, caller.ownerGhii, target);
  if (!set) return { ok: false, status: 404, code: 'NO_EVAL_SET', message: `There is no eval set for ${target.kind} ${target.name}: write one with aimeat_eval_set.` };
  const resolved = await resolveTarget(deps, caller, target);
  if ('ok' in resolved) return resolved;
  const arms = resolved.system ? 2 : 1;
  const calls = callsOf(set, arms) - (resolved.crew ? set.repeats * set.cases.length : 0);
  const crewTrials = resolved.crew ? set.repeats * set.cases.length : 0;
  const plan = {
    target, revision: resolved.revision, cases: set.cases.length, repeats: set.repeats, arms,
    model_calls: calls, crew_trials: crewTrials,
    cost: 'Every model call spends this account\'s AI allowance through its own AI settings; a crew trial runs on the agent\'s own machine and model.',
  };
  if (opts.dryRun) return { ok: true, data: { dry_run: true, ...plan } };
  const lock = `${caller.ownerGhii}|${target.kind}|${target.name}`;
  if (running.has(lock)) return { ok: false, status: 409, code: 'EVAL_RUNNING', message: 'A run of this set is going on; read it with aimeat_eval_get and start the next when it ends.' };
  running.add(lock);
  const run: EvalRun = { id: `evalrun-${randomBytes(6).toString('hex')}`, at: new Date().toISOString(), by: caller.principal, status: 'running', revision: resolved.revision, repeats: set.repeats };
  await recordEvalRun(deps.storage, caller.ownerGhii, target, run);
  void (async () => {
    try {
      let model: string | undefined;
      const answerWith = async (c: EvalCase): Promise<string> => {
        if (resolved.crew) {
          const crewCaller: CrewCaller = { principal: caller.principal, owner: caller.owner, scopes: caller.scopes, roles: caller.roles, pipeline: 'evals.run' };
          const started = await crewTryStart(deps, crewCaller, resolved.crew.name, resolved.crew.doc, c.prompt);
          if (!started.ok) throw new Error(`${started.code}: ${started.message}`);
          const done = await crewTryWait(deps, crewCaller, resolved.crew.name, started.try_id, started.timeout_ms);
          if (!done.ok) throw new Error(`${done.code}: ${done.message}`);
          if (done.status !== 'done') return `${done.status}: ${String(done.error ?? '')}`;
          return typeof done.result === 'string' ? done.result : JSON.stringify(done.result ?? '');
        }
        const r = await ask(deps, caller, c.prompt, resolved.system);
        model = r.model;
        return r.content;
      };
      const withArm = await runArm(deps, caller, set, answerWith);
      const withoutArm = resolved.system ? await runArm(deps, caller, set, async c => (await ask(deps, caller, c.prompt)).content) : undefined;
      const latest = await readEvalSet(deps.storage, caller.ownerGhii, target);
      const before = (latest?.runs ?? []).find(r => r.status === 'done' && r.revision !== resolved.revision && r.with);
      await recordEvalRun(deps.storage, caller.ownerGhii, target, {
        ...run, status: 'done', with: withArm, ...(withoutArm ? { without: withoutArm } : {}), ...(model ? { model } : {}),
        ...(before?.with ? { previous: { revision: before.revision, score: before.with.score, delta: Math.round((withArm.score - before.with.score) * 1000) / 1000 } } : {}),
        finished_at: new Date().toISOString(),
      });
    } catch (err) {
      logger.warn('eval run failed', { target: `${target.kind}:${target.name}`, error: String(err) });
      await recordEvalRun(deps.storage, caller.ownerGhii, target, { ...run, status: 'failed', error: String((err as Error)?.message ?? err).slice(0, 400), finished_at: new Date().toISOString() })
        .catch(e => logger.warn('eval run: the failure was not recorded', { error: String(e) }));
    } finally {
      running.delete(lock);
    }
  })();
  return { ok: true, data: { run_id: run.id, status: 'running', ...plan, read: 'aimeat_eval_get answers the run when it ends.' } };
}
