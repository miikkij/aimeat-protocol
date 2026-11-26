/**
 * @file src/services/evals/eval-sets.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A stored eval set for one crew, skill or library pack, and the runs made of it: the
 *   cases (a prompt and what a good answer does), and per run the revision it ran against, the score
 *   and the score of the revision before. services/evals/eval-run.ts runs a set.
 *
 *   WHY. A crew had a demo (aimeat_crew_try runs one prompt and stores nothing) and no regression
 *   suite; a skill's measurement ran only in this repository and only through one vendor's command
 *   line. The paper this was asked from (Google, "The New SDLC With Vibe Coding", May 2026): "A working
 *   demo proves an agent can succeed once. A passing eval suite proves it succeeds reliably."
 *
 *   ONE CASE is an id, a prompt, and one to five expectations, each one of: `contains` (the answer
 *   holds the words, any case), `not_contains`, or `judge` (a rubric a model reads beside the answer
 *   and answers PASS or FAIL). No pattern of the builder's own runs on the node: a regular expression
 *   from outside against model output is a way to stall the process.
 *
 *   WHERE. One record per set in the node namespace NS, which no principal can address, so a score is
 *   only ever what the node measured. Readable and writable by the account the target belongs to (the
 *   owner and the owner's agents). The newest RUNS_KEPT runs are kept.
 * @structure EvalTarget · EvalCase · EvalRun · EvalSet · checkCases · readEvalSet · writeEvalSet · recordEvalRun
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-stored-eval-sets-for-crews-skills-and-library-packs-scored-p).
 */
import type { Storage } from '../../storage/interface.js';

const NS = 'eval-sets';
export const CASES_MAX = 10;
export const REPEATS_MAX = 5;
export const RUNS_KEPT = 10;
const TEXT_MAX = 2000;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export type EvalTargetKind = 'crew' | 'skill' | 'pack';
export const EVAL_TARGET_KINDS: readonly EvalTargetKind[] = ['crew', 'skill', 'pack'];
export const EXPECT_KINDS = ['contains', 'not_contains', 'judge'] as const;
export type ExpectKind = typeof EXPECT_KINDS[number];

export interface EvalTarget { kind: EvalTargetKind; name: string }

export interface EvalCase {
  id: string;
  prompt: string;
  expect: Array<{ kind: ExpectKind; value: string }>;
}

export interface CaseResult { id: string; passed: number; of: number; failures: string[] }
export interface ArmResult { score: number; cases: CaseResult[] }

export interface EvalRun {
  id: string;
  at: string;
  by: string;
  status: 'running' | 'done' | 'failed';
  /** The version of the target the run measured: a crew's revision, a skill's or a pack's version. */
  revision: string;
  repeats: number;
  /** With the target: the crew, or the model with the skill's or pack's text. */
  with?: ArmResult;
  /** Without it, for a skill or a pack: the same model with nothing, so the score says what the text changes. */
  without?: ArmResult;
  /** The score of the newest earlier run of another revision, and that revision. */
  previous?: { revision: string; score: number; delta: number };
  model?: string;
  error?: string;
  finished_at?: string;
}

export interface EvalSet {
  spec: 'aimeat.evalset/1';
  owner: string;
  target: EvalTarget;
  cases: EvalCase[];
  repeats: number;
  updatedAt: string;
  updatedBy: string;
  runs: EvalRun[];
}

const keyOf = (owner: string, t: EvalTarget) => `evalset.${Buffer.from(`${owner}|${t.kind}|${t.name}`, 'utf8').toString('hex')}`;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Read a written list of cases: shapes, bounds and unique ids. */
export function checkCases(input: unknown): { ok: true; cases: EvalCase[] } | { ok: false; message: string } {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, message: 'cases is a list of 1 to 10 { id, prompt, expect: [{ kind, value }] }.' };
  if (input.length > CASES_MAX) return { ok: false, message: `At most ${CASES_MAX} cases: each run calls a model for every case, repeat and arm.` };
  const seen = new Set<string>();
  const out: EvalCase[] = [];
  for (const [i, raw] of input.entries()) {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const at = `cases[${i}]`;
    const id = str(r.id);
    if (!ID_RE.test(id) || seen.has(id)) return { ok: false, message: `${at}.id is a short lowercase name (letters, digits, hyphens), used once.` };
    seen.add(id);
    const prompt = str(r.prompt);
    if (!prompt || prompt.length > TEXT_MAX) return { ok: false, message: `${at}.prompt is what is asked, at most ${TEXT_MAX} characters.` };
    const expect = Array.isArray(r.expect) ? r.expect : [];
    if (expect.length === 0 || expect.length > 5) return { ok: false, message: `${at}.expect is 1 to 5 { kind: contains | not_contains | judge, value }.` };
    const checked: EvalCase['expect'] = [];
    for (const [j, e] of expect.entries()) {
      const x = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>;
      const kind = x.kind as ExpectKind;
      const value = str(x.value);
      if (!EXPECT_KINDS.includes(kind)) return { ok: false, message: `${at}.expect[${j}].kind is one of ${EXPECT_KINDS.join(', ')}.` };
      if (!value || value.length > TEXT_MAX) return { ok: false, message: `${at}.expect[${j}].value is the words (contains, not_contains) or the rubric (judge), at most ${TEXT_MAX} characters.` };
      checked.push({ kind, value });
    }
    out.push({ id, prompt, expect: checked });
  }
  return { ok: true, cases: out };
}

export async function readEvalSet(storage: Storage, owner: string, target: EvalTarget): Promise<EvalSet | null> {
  const rec = await storage.getMemory(NS, keyOf(owner, target));
  const v = rec?.value as EvalSet | undefined;
  return v && v.spec === 'aimeat.evalset/1' && v.owner === owner ? v : null;
}

/** Change the set on its version: `change` gets what is stored (or null) and answers what to store. */
export async function updateEvalSet(
  storage: Storage, owner: string, target: EvalTarget, change: (live: EvalSet | null) => EvalSet,
): Promise<EvalSet> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const rec = await storage.getMemory(NS, keyOf(owner, target));
    const live = rec?.value && (rec.value as EvalSet).spec === 'aimeat.evalset/1' ? rec.value as EvalSet : null;
    const next = change(live);
    const now = new Date().toISOString();
    const record = {
      key: keyOf(owner, target), ownerGaii: NS, value: next, visibility: 'private' as const, tags: ['eval-set'], ttlHours: null,
      version: (rec?.version ?? 0) + 1, createdAt: rec?.createdAt ?? now, updatedAt: now,
    };
    const saved = rec ? await storage.setMemoryIfVersion(record, rec.version) : await storage.createMemoryIfAbsent(record);
    if (saved) return next;
  }
  throw new Error('The eval set changed repeatedly. Try again.');
}

/** Write the cases (and the repeats); the runs stay. */
export async function writeEvalSet(
  storage: Storage, owner: string, target: EvalTarget, cases: EvalCase[], repeats: number, by: string,
): Promise<EvalSet> {
  return updateEvalSet(storage, owner, target, live => ({
    spec: 'aimeat.evalset/1', owner, target, cases, repeats,
    updatedAt: new Date().toISOString(), updatedBy: by, runs: live?.runs ?? [],
  }));
}

/** Put a run in (new or finished), newest first, keeping RUNS_KEPT. */
export async function recordEvalRun(storage: Storage, owner: string, target: EvalTarget, run: EvalRun): Promise<void> {
  await updateEvalSet(storage, owner, target, live => {
    if (!live) throw new Error('The eval set was removed while it ran.');
    const others = live.runs.filter(r => r.id !== run.id);
    return { ...live, runs: [run, ...others].slice(0, RUNS_KEPT) };
  });
}
