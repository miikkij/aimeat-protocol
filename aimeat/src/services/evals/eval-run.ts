/**
 * @file src/services/evals/eval-run.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Run a stored eval set (services/evals/eval-sets.ts) against what its target is now,
 *   and score it against the run of the revision before.
 *
 *   WHOSE AI ANSWERS. The node calls no model for an eval. The AI that builds with the skill or the
 *   pack and uses it (Claude Code, Codex, any client over MCP or REST) answers the cases and judges
 *   them on its own model and its own account; the node stores the set, hands out the cases with the
 *   exact text of the revision, grades the words, and keeps the score:
 *
 *     skill   startEvalRun opens a run and answers with the cases and the target's text (a skill's
 *     pack    SKILL.md, a pack's aiDoc). The caller answers every case `repeats` times twice: with the
 *             text as its only instructions, and with nothing, so the score says what the text
 *             changes. finishEvalRun takes the answers and the caller's judge verdicts, and scores.
 *     crew    each case is a crew trial on the agent's own runtime and model (services/crews/ops.ts
 *             crewTryStart), the same run aimeat_crew_try makes. When the set has a `judge`
 *             expectation the run waits for the caller's verdicts on the crew's answers; without one
 *             the node scores it at once.
 *
 *   A judge verdict is recorded as the caller's: the failure reads "judge (the caller's verdict)".
 *   The node never spends the account's AI allowance or the node's provider key on an eval
 *   (wish-eval-runs-answered-by-the-caller-s-own-ai-not-by-the-node). The model calls of the first
 *   build went through the node's provider and let an agent pass its owner's per-agent cap
 *   (secaudit2026nov26, eval-run.ts:ask:ai-call-keyed-by-caller-principal-not-payer).
 *
 *   ONE RUN PER SET AT A TIME. A crew run still collecting trials blocks the next start for up to 15
 *   minutes. A run waiting for the caller blocks nothing: a new start closes it as superseded, so a
 *   caller that went away never locks the set. Every change of the run is made on the set's version.
 * @structure packRevision(version, aiDoc) · resolveTarget · gradeAnswer(answer, expect, verdicts) ·
 *   startEvalRun(deps, caller, target, opts) · finishEvalRun(deps, caller, target, body)
 * @version-history
 *   v2.0.0 — 2026-11-27 — The caller's own AI answers and judges; the node calls no model. A waiting
 *     run is finished with finishEvalRun; a crew with a judge waits for the caller's verdicts.
 *   v1.1.0 — 2026-11-26 — A pack's revision names a hash of its AI text: the served packs have no
 *     version, so every run read as "unversioned" and none was ever compared with the one before.
 *   v1.0.0 — 2026-11-26 — Initial (wish-stored-eval-sets-for-crews-skills-and-library-packs-scored-p).
 */
import { createHash, randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { resolveSkillRef } from '../skills.js';
import { getLibraryPacks } from '../../data/library-packs.js';
import { crewTryStart, crewTryWait, resolveCrewAgent, type CrewCaller } from '../crews/ops.js';
import { readCrewState } from '../crews/def-store.js';
import { readEvalSet, RUNS_KEPT, updateEvalSet, type ArmResult, type EvalCase, type EvalRun, type EvalSet, type EvalTarget } from './eval-sets.js';

/**
 * A library pack's revision: what the eval measures is its AI text, and the served SDK packs carry
 * no version number, so the revision always names a hash of that text (`text:<12 hex>`), after the
 * version when there is one. A changed text is then a new revision even when nobody bumped a number.
 */
export function packRevision(version: string | undefined, aiDoc: string): string {
  const text = `text:${createHash('sha256').update(aiDoc, 'utf8').digest('hex').slice(0, 12)}`;
  return version ? `${version} ${text}` : text;
}

export interface EvalDeps { storage: Storage; config: AimeatConfig }
export interface EvalCaller { principal: string; owner: string; ownerGhii: string; scopes: string[]; roles: string[] }
export type EvalRefusal = { ok: false; status: number; code: string; message: string };
type Started = { ok: true; status?: number; data: Record<string, unknown> } | EvalRefusal;

/** A crew's answer kept for the caller to judge, cut so the set's one record stays small. */
const PENDING_ANSWER_MAX = 4000;
/** One answer the caller sends; the node reads it for the words and keeps none of it. */
export const ANSWER_MAX = 20_000;
/** A crew run still collecting trials after this long was left by a process that stopped: it no longer blocks. */
const RUN_STALE_MS = 15 * 60_000;

const refuse = (status: number, code: string, message: string): EvalRefusal => ({ ok: false, status, code, message });
const round3 = (n: number) => Math.round(n * 1000) / 1000;

interface Resolved { revision: string; text?: string; crew?: { name: string; doc: Record<string, unknown> } }

/** What the target is now: its revision, and the text or crew a case runs with. Exported for the set's own check. */
export async function resolveTarget(deps: EvalDeps, caller: EvalCaller, target: EvalTarget): Promise<Resolved | EvalRefusal> {
  if (target.kind === 'skill') {
    try {
      const skill = await resolveSkillRef(deps.storage, deps.config, target.name, { ownerName: caller.owner });
      const text = skill.fileContents['SKILL.md'];
      if (!text) return refuse(404, 'NOT_FOUND', `The skill ${target.name} has no SKILL.md to evaluate.`);
      return { revision: skill.version, text };
    } catch (err) {
      return refuse(404, 'NOT_FOUND', `No skill ${target.name} this account can read (${(err as Error)?.message ?? 'not found'}).`);
    }
  }
  if (target.kind === 'pack') {
    const pack = getLibraryPacks().find(p => p.id === target.name);
    if (!pack) return refuse(404, 'NOT_FOUND', `No library pack ${target.name} on this node; aimeat_appdev_overview lists them.`);
    return { revision: packRevision(pack.version, pack.aiDoc), text: pack.aiDoc };
  }
  const crewCaller: CrewCaller = { principal: caller.principal, owner: caller.owner, scopes: caller.scopes, roles: caller.roles, pipeline: 'evals.run' };
  const agent = await resolveCrewAgent(deps, crewCaller, target.name);
  if (!agent.ok) return refuse(agent.status, agent.code, agent.message);
  const state = await readCrewState(deps.storage, agent.agent);
  if (!state.published) return refuse(409, 'NO_PUBLISHED_CREW', `${target.name} has no published crew definition to evaluate; publish one with aimeat_crew_publish.`);
  return { revision: String(state.published.revision), crew: { name: target.name, doc: state.published.doc } };
}

const judgesOf = (c: EvalCase) => c.expect.filter(e => e.kind === 'judge').length;

/**
 * Whether one answer meets one case's expectations. The node reads the words itself; a `judge`
 * expectation takes the caller's verdict, in the order the judges stand in the case. The failures
 * say which, and a judge's are marked as the caller's.
 */
export function gradeAnswer(answer: string, expect: EvalCase['expect'], verdicts: readonly boolean[]): string[] {
  const failures: string[] = [];
  const lower = answer.toLowerCase();
  let j = 0;
  for (const e of expect) {
    if (e.kind === 'contains' && !lower.includes(e.value.toLowerCase())) failures.push(`does not contain "${e.value.slice(0, 80)}"`);
    if (e.kind === 'not_contains' && lower.includes(e.value.toLowerCase())) failures.push(`contains "${e.value.slice(0, 80)}"`);
    if (e.kind === 'judge' && verdicts[j++] !== true) failures.push(`judge (the caller's verdict): ${e.value.slice(0, 80)}`);
  }
  return failures;
}

/** One graded answer: a case, a repeat (1-based), its answer and the verdicts on its judges. */
interface Graded { case: string; repeat: number; answer: string; verdicts: boolean[] }

function scoreArm(set: EvalSet, graded: Graded[]): ArmResult {
  const cases = set.cases.map(c => {
    let passed = 0;
    const failures: string[] = [];
    for (const g of graded.filter(x => x.case === c.id)) {
      const fails = gradeAnswer(g.answer, c.expect, g.verdicts);
      if (fails.length === 0) passed++;
      else if (failures.length < 3) failures.push(fails.join('; '));
    }
    return { id: c.id, passed, of: set.repeats, failures };
  });
  const score = cases.length ? round3(cases.reduce((s, c) => s + c.passed / c.of, 0) / cases.length) : 0;
  return { score, cases };
}

/** The newest finished run of another revision, as the score to compare with. */
function previousOf(runs: EvalRun[], revision: string, score: number): EvalRun['previous'] | undefined {
  const before = runs.find(r => r.status === 'done' && r.revision !== revision && r.with);
  return before?.with ? { revision: before.revision, score: before.with.score, delta: round3(score - before.with.score) } : undefined;
}

class RunConflict extends Error { constructor(readonly refusal: EvalRefusal) { super(refusal.message); } }

/** Change one run on the set's version; `change` gets the live run and answers the new one, or throws RunConflict. */
async function changeRun(
  deps: EvalDeps, caller: EvalCaller, target: EvalTarget, runId: string, change: (live: EvalRun, set: EvalSet) => EvalRun,
): Promise<EvalRun> {
  let out: EvalRun | undefined;
  await updateEvalSet(deps.storage, caller.ownerGhii, target, live => {
    if (!live) throw new RunConflict(refuse(404, 'NO_EVAL_SET', 'The eval set was removed while it ran.'));
    const run = live.runs.find(r => r.id === runId);
    if (!run) throw new RunConflict(refuse(404, 'NO_EVAL_RUN', `There is no run ${runId} of this set; aimeat_eval_get lists its runs.`));
    out = change(run, live);
    return { ...live, runs: live.runs.map(r => (r.id === runId ? out! : r)) };
  });
  return out!;
}

/** What one start asks of the caller and of the crew's runtime. The node itself calls no model. */
function planOf(set: EvalSet, target: EvalTarget, resolved: Resolved) {
  const arms = resolved.text ? 2 : 1;
  const judges = set.cases.reduce((n, c) => n + judgesOf(c), 0);
  return {
    target, revision: resolved.revision, cases: set.cases.length, repeats: set.repeats, arms,
    answers_to_write: resolved.crew ? 0 : set.repeats * set.cases.length * arms,
    verdicts_to_give: set.repeats * judges * arms,
    crew_trials: resolved.crew ? set.repeats * set.cases.length : 0,
    node_model_calls: 0,
    cost: resolved.crew
      ? 'The node calls no model. Each crew trial runs on the agent\'s own runtime and model; a judge is your own AI\'s verdict.'
      : 'The node calls no model. Your own AI writes every answer and gives every judge verdict, on your own model and account.',
  };
}

const HOW_TO_ANSWER = [
  'For every case and every repeat, write two answers to the prompt, each in a fresh context that sees nothing else of this conversation:',
  '"with": the text above is your only instructions. "without": no instructions at all.',
  'Then read each answer against the case\'s judge rubrics, in the order they stand, and give true (it meets the rubric) or false.',
  'Do not edit an answer to pass: the words are graded by the node as you send them.',
].join(' ');

/**
 * Start a run of the set, or (dryRun) say what it asks. A skill's or pack's run waits for the caller's
 * answers (finishEvalRun); a crew's collects its trials in the background.
 */
export async function startEvalRun(
  deps: EvalDeps, caller: EvalCaller, target: EvalTarget, opts: { dryRun?: boolean } = {},
): Promise<Started> {
  const set = await readEvalSet(deps.storage, caller.ownerGhii, target);
  if (!set) return refuse(404, 'NO_EVAL_SET', `There is no eval set for ${target.kind} ${target.name}: write one with aimeat_eval_set.`);
  const resolved = await resolveTarget(deps, caller, target);
  if ('ok' in resolved) return resolved;
  const plan = planOf(set, target, resolved);
  if (opts.dryRun) return { ok: true, data: { dry_run: true, ...plan } };

  const run: EvalRun = {
    id: `evalrun-${randomBytes(6).toString('hex')}`, at: new Date().toISOString(), by: caller.principal,
    status: resolved.crew ? 'running' : 'open', revision: resolved.revision, repeats: set.repeats,
    ...(resolved.crew ? {} : { awaiting: 'answers' as const }),
  };
  try {
    await updateEvalSet(deps.storage, caller.ownerGhii, target, live => {
      if (!live) throw new RunConflict(refuse(404, 'NO_EVAL_SET', `There is no eval set for ${target.kind} ${target.name}.`));
      if (live.runs.some(r => r.status === 'running' && Date.now() - Date.parse(r.at) < RUN_STALE_MS)) {
        throw new RunConflict(refuse(409, 'EVAL_RUNNING', 'The crew\'s trials of this set are going on; read the run with aimeat_eval_get and start the next when it ends.'));
      }
      const now = new Date().toISOString();
      // A run waiting for its caller blocks nothing: the new start closes it, so a caller that went away never locks the set.
      const closed = live.runs.map(r => (r.status === 'open' || r.status === 'running'
        ? { ...r, status: 'failed' as const, error: `Superseded by ${run.id}.`, pending: undefined, awaiting: undefined, finished_at: now }
        : r));
      return { ...live, runs: [run, ...closed].slice(0, RUNS_KEPT) };
    });
  } catch (err) {
    if (err instanceof RunConflict) return err.refusal;
    throw err;
  }

  if (!resolved.crew) {
    return { ok: true, status: 201, data: {
      run_id: run.id, status: 'open', ...plan,
      text: resolved.text,
      cases: set.cases.map(c => ({ id: c.id, prompt: c.prompt, judges: c.expect.filter(e => e.kind === 'judge').map(e => e.value) })),
      how: HOW_TO_ANSWER,
      send: 'aimeat_eval_run { kind, name, run_id, model, results: [{ case, arm: "with" | "without", repeat: 1..repeats, answer, verdicts: [true|false per judge] }] }, every case, arm and repeat once.',
    } };
  }
  void collectCrewTrials(deps, caller, target, set, resolved, run.id);
  return { ok: true, status: 202, data: { run_id: run.id, status: 'running', ...plan, read: 'aimeat_eval_get shows the run; when it says open, awaiting verdicts, judge the answers it lists and send them with aimeat_eval_run { run_id, results }.' } };
}

/** A crew's trials, one per case and repeat, then the score, or a wait for the caller's verdicts. */
async function collectCrewTrials(deps: EvalDeps, caller: EvalCaller, target: EvalTarget, set: EvalSet, resolved: Resolved, runId: string): Promise<void> {
  const crew = resolved.crew!;
  const crewCaller: CrewCaller = { principal: caller.principal, owner: caller.owner, scopes: caller.scopes, roles: caller.roles, pipeline: 'evals.run' };
  try {
    const answers: Graded[] = [];
    for (const c of set.cases) {
      for (let repeat = 1; repeat <= set.repeats; repeat++) {
        const started = await crewTryStart(deps, crewCaller, crew.name, crew.doc, c.prompt);
        if (!started.ok) throw new Error(`${started.code}: ${started.message}`);
        const done = await crewTryWait(deps, crewCaller, crew.name, started.try_id, started.timeout_ms);
        if (!done.ok) throw new Error(`${done.code}: ${done.message}`);
        const answer = done.status !== 'done' ? `${done.status}: ${String(done.error ?? '')}`
          : typeof done.result === 'string' ? done.result : JSON.stringify(done.result ?? '');
        answers.push({ case: c.id, repeat, answer, verdicts: [] });
      }
    }
    const needsJudge = set.cases.some(c => judgesOf(c) > 0);
    await changeRun(deps, caller, target, runId, (live, latest) => {
      if (live.status !== 'running') return live; // superseded while the trials ran
      if (needsJudge) {
        return { ...live, status: 'open', awaiting: 'verdicts', pending: answers.map(a => ({ case: a.case, repeat: a.repeat, answer: a.answer.slice(0, PENDING_ANSWER_MAX) })) };
      }
      const withArm = scoreArm(set, answers);
      const previous = previousOf(latest.runs, live.revision, withArm.score);
      return { ...live, status: 'done', with: withArm, ...(previous ? { previous } : {}), finished_at: new Date().toISOString() };
    });
  } catch (err) {
    logger.warn('eval run failed', { target: `${target.kind}:${target.name}`, error: String(err) });
    await changeRun(deps, caller, target, runId, live => (live.status !== 'running' ? live
      : { ...live, status: 'failed', error: String((err as Error)?.message ?? err).slice(0, 400), finished_at: new Date().toISOString() }))
      .catch(e => logger.warn('eval run: the failure was not recorded', { error: String(e) }));
  }
}

/** Read the caller's results against what the open run awaits: every slot once, nothing else. */
function readResults(set: EvalSet, run: EvalRun, raw: unknown): { ok: true; arms: Record<'with' | 'without', Graded[]> } | EvalRefusal {
  if (!Array.isArray(raw) || raw.length === 0) return refuse(400, 'INVALID_INPUT', 'results is the list of { case, arm, repeat, answer, verdicts }.');
  const answersRun = run.awaiting === 'answers';
  const armNames: Array<'with' | 'without'> = answersRun ? ['with', 'without'] : ['with'];
  const byCase = new Map(set.cases.map(c => [c.id, c]));
  const pending = new Map((run.pending ?? []).map(p => [`${p.case}|${p.repeat}`, p.answer]));
  const seen = new Set<string>();
  const arms: Record<'with' | 'without', Graded[]> = { with: [], without: [] };
  for (const [i, item] of raw.entries()) {
    const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const at = `results[${i}]`;
    const c = byCase.get(String(r.case ?? ''));
    if (!c) return refuse(400, 'INVALID_INPUT', `${at}.case is not a case of this set: ${set.cases.map(x => x.id).join(', ')}.`);
    const arm = (r.arm === undefined ? 'with' : r.arm) as 'with' | 'without';
    if (!armNames.includes(arm)) return refuse(400, 'INVALID_INPUT', `${at}.arm is ${armNames.join(' or ')}.`);
    const repeat = Number(r.repeat);
    if (!Number.isInteger(repeat) || repeat < 1 || repeat > run.repeats) return refuse(400, 'INVALID_INPUT', `${at}.repeat is 1 to ${run.repeats}.`);
    const slot = `${c.id}|${arm}|${repeat}`;
    if (seen.has(slot)) return refuse(400, 'INVALID_INPUT', `${at}: case ${c.id}, arm ${arm}, repeat ${repeat} is sent twice.`);
    seen.add(slot);
    const verdicts = r.verdicts === undefined ? [] : r.verdicts;
    if (!Array.isArray(verdicts) || verdicts.length !== judgesOf(c) || verdicts.some(v => typeof v !== 'boolean')) {
      return refuse(400, 'INVALID_INPUT', `${at}.verdicts is ${judgesOf(c)} true or false, one per judge of case ${c.id}, in their order.`);
    }
    let answer: string;
    if (answersRun) {
      if (typeof r.answer !== 'string' || r.answer.length > ANSWER_MAX) return refuse(400, 'INVALID_INPUT', `${at}.answer is the answer your AI wrote, at most ${ANSWER_MAX} characters.`);
      answer = r.answer;
    } else {
      answer = pending.get(`${c.id}|${repeat}`) ?? '';
    }
    arms[arm].push({ case: c.id, repeat, answer, verdicts: verdicts as boolean[] });
  }
  const missing: string[] = [];
  for (const c of set.cases) for (const arm of armNames) for (let k = 1; k <= run.repeats; k++) if (!seen.has(`${c.id}|${arm}|${k}`)) missing.push(`${c.id} ${arm} ${k}`);
  if (missing.length) return refuse(400, 'INVALID_INPUT', `results lacks ${missing.length} of case, arm and repeat: ${missing.slice(0, 10).join('; ')}${missing.length > 10 ? '; …' : ''}.`);
  return { ok: true, arms };
}

/**
 * Finish an open run with the caller's results: the answers (a skill or a pack) or the verdicts on the
 * crew's answers, graded and scored against the revision before. The answers are not kept.
 */
export async function finishEvalRun(deps: EvalDeps, caller: EvalCaller, target: EvalTarget, body: Record<string, unknown>): Promise<Started> {
  const runId = typeof body.run_id === 'string' ? body.run_id : '';
  const model = typeof body.model === 'string' ? body.model.trim().slice(0, 120) : '';
  try {
    const done = await changeRun(deps, caller, target, runId, (live, set) => {
      if (live.status !== 'open') {
        throw new RunConflict(refuse(409, 'EVAL_RUN_NOT_OPEN', `Run ${runId} is ${live.status}${live.error ? ` (${live.error})` : ''}; only a run waiting for answers or verdicts takes results.`));
      }
      const read = readResults(set, live, body.results);
      if (!read.ok) throw new RunConflict(read);
      const withArm = scoreArm(set, read.arms.with);
      const withoutArm = live.awaiting === 'answers' ? scoreArm(set, read.arms.without) : undefined;
      const previous = previousOf(set.runs.filter(r => r.id !== live.id), live.revision, withArm.score);
      return {
        ...live, pending: undefined, awaiting: undefined, status: 'done', with: withArm, ...(withoutArm ? { without: withoutArm } : {}), ...(previous ? { previous } : {}),
        ...(model ? { model } : {}), answered_by: caller.principal, finished_at: new Date().toISOString(),
      };
    });
    return { ok: true, data: { run_id: done.id, status: done.status, revision: done.revision, with: done.with, ...(done.without ? { without: done.without } : {}), ...(done.previous ? { previous: done.previous } : {}) } };
  } catch (err) {
    if (err instanceof RunConflict) return err.refusal;
    throw err;
  }
}
