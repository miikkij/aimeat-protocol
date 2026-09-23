/**
 * @file src/services/decide/rule-validate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shape of a DECISION RULE and the two pure functions every door shares: the
 *   validator that turns what somebody sent into a rule or a list of what is wrong with it, and the
 *   evaluator that turns a rule's thresholds and bands plus the model's answers into an outcome.
 *
 *   A DECISION RULE is a named, reusable definition an owner writes once: the questions (the
 *   node's three types, in English), a threshold per question that counts, and two bands. Running
 *   one produces a DECISION, which is recorded. A rule bound to an irreversible action is a GATE.
 *
 *   HOW ANSWERS BECOME AN OUTCOME. Two steps, both in the rule and neither in the caller's hands:
 *     1. A THRESHOLD is a floor for one answer, in that question's own units: the probability of a
 *        yes/no, the confidence of a choice, the level of a score (counted from 0). An answer under
 *        its floor means the thing the rule tests for is not there: the outcome is `stop`.
 *     2. Otherwise the RESULT is the weakest certainty among the answers the thresholds name (the
 *        probability of a yes/no, the confidence of a choice or a score), and the BANDS cut it: at
 *        or over `act` the caller may act, at or over `ask` a person is asked, under it: stop.
 *   So a question is worded so that a high value means "go ahead", which is how the library's
 *   gate() has always compared. There are no default numbers: TypeSafe's agreement forbids
 *   presenting thresholds as defaults, and a threshold nobody tuned is a guess with a decimal point.
 *
 *   PURE ON PURPOSE. No storage, no config, no clock: the unit tests call these two functions
 *   directly, and the REST route, the MCP tools and the proposal door all validate through here.
 * @structure
 *   DecisionRule · RuleUse · RuleProblem · RULE_ID_RE · validateRule · evaluateRule · RuleEvaluation
 * @usage
 *   const v = validateRule(body, limits);           // { rule } or { problems }
 *   const e = evaluateRule(rule, answers);          // { outcome, result, passed }
 * @version-history
 *   v1.2.0 — 2026-09-23 — A rule may name its decision provider (`provider`).
 *   v1.1.0 — 2026-09-20 — A missing confidence is unknown, not zero: `result` is null when the model
 *     gave no certainty at all and the outcome is then `ask`. A rule whose thresholds name only
 *     scale questions used to answer `stop` whatever the model said.
 *   v1.0.0 — 2026-09-20 — Initial: decision rules on the node.
 */
import type { AiDecisionAnswer, AiDecisionOutcome } from '../../storage/interface.js';
import { checkDecideRequest, estimateTokens, type DecideLimits, type JevQuestion } from './limits.js';

/** Who may run a rule. Enforced on the server, on every door. */
export type RuleUse = 'agent' | 'app' | 'both';

/** What the owner writes. `version`, `createdAt` and `updatedAt` are the store's, not the writer's. */
export interface DecisionRuleInput {
  id: string;
  title: string;
  /** What the rule gates, in plain words ("whether the reply is sent without a person reading it"). */
  decides: string;
  /** The top-level fields a caller may put in the state. Empty means any state. */
  sends: string[];
  /** The node's three question types. English. */
  questions: Record<string, JevQuestion>;
  /** Question id to the floor its answer must reach, in that question's own units. */
  thresholds: Record<string, number>;
  /** Cuts on the result, 0 to 1: at or over `act` act, at or over `ask` ask a person, under it stop. */
  bands: { act: number; ask: number };
  use: RuleUse;
  /** What the gate switch starts at for an agent whose owner never set it. */
  gate: boolean;
  /** A state to try the rule on. Null when none was given. */
  sample: unknown;
  /**
   * The decision provider this rule runs on (services/decide/providers.ts), or absent for "whoever the
   * agent, the owner or the node would pick". A rule that names one fixes it for every call.
   */
  provider?: string;
}

export interface DecisionRule extends DecisionRuleInput {
  spec: 'aimeat.decision-rule/v1';
  /** Bumped on every change to the questions, so old and new decisions can be told apart. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** One thing wrong with a rule. `field` is the path a form would mark. */
export interface RuleProblem { field: string; code: string; message: string }

export const RULE_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const FIELD_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const USES: readonly string[] = ['agent', 'app', 'both'];
const MAX_SAMPLE_BYTES = 64 * 1024;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The number of levels of a score question, or 0 when it is not one. */
function levelsOf(q: JevQuestion | undefined): number {
  return q?.type === 'score' && Array.isArray(q.criteria) ? q.criteria.length : 0;
}

/**
 * Validate what somebody sent as a rule. Returns every problem found, so a person or an agent fixes
 * them in one round. Never throws.
 */
export function validateRule(
  raw: unknown, limits: DecideLimits,
): { rule: DecisionRuleInput; problems: [] } | { rule: null; problems: RuleProblem[] } {
  const problems: RuleProblem[] = [];
  const bad = (field: string, code: string, message: string): void => { problems.push({ field, code, message }); };
  if (!isObj(raw)) return { rule: null, problems: [{ field: '', code: 'NOT_AN_OBJECT', message: 'A decision rule is an object.' }] };

  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!RULE_ID_RE.test(id)) bad('id', 'BAD_ID', "id: lower-case letters, digits and '-', starting with a letter or digit, at most 63 characters.");

  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!title || title.length > 120) bad('title', 'BAD_TITLE', 'title: a name of 1 to 120 characters.');

  const decides = typeof raw.decides === 'string' ? raw.decides.trim() : '';
  if (!decides || decides.length > 500) bad('decides', 'BAD_DECIDES', 'decides: say in plain words what this rule gates, in 1 to 500 characters.');

  let sends: string[] = [];
  if (raw.sends !== undefined) {
    if (!Array.isArray(raw.sends) || raw.sends.length > 50 || raw.sends.some(f => typeof f !== 'string' || !FIELD_RE.test(f))) {
      bad('sends', 'BAD_SENDS', "sends: a list of at most 50 field names (letters, digits, '_', '.', '-').");
    } else {
      sends = [...new Set(raw.sends as string[])];
    }
  }

  const questions = raw.questions as Record<string, JevQuestion>;
  const shape = checkDecideRequest('', questions, limits);
  for (const v of shape) bad(v.question ? `questions.${v.question}` : 'questions', v.code, v.message);
  const known = isObj(raw.questions) ? raw.questions as Record<string, JevQuestion> : {};

  const thresholds: Record<string, number> = {};
  if (!isObj(raw.thresholds) || Object.keys(raw.thresholds).length === 0) {
    bad('thresholds', 'NO_THRESHOLDS', 'thresholds: name at least one question and the value its answer must reach.');
  } else {
    for (const [qid, t] of Object.entries(raw.thresholds)) {
      const q = known[qid];
      if (!q) { bad(`thresholds.${qid}`, 'UNKNOWN_QUESTION', `thresholds names '${qid}', which is not one of this rule's questions.`); continue; }
      if (typeof t !== 'number' || !Number.isFinite(t)) { bad(`thresholds.${qid}`, 'BAD_THRESHOLD', `The threshold for '${qid}' must be a number.`); continue; }
      const top = q.type === 'score' ? Math.max(0, levelsOf(q) - 1) : 1;
      if (t < 0 || t > top) {
        bad(`thresholds.${qid}`, 'BAD_THRESHOLD', q.type === 'score'
          ? `The threshold for score question '${qid}' is a level from 0 to ${top}.`
          : `The threshold for '${qid}' is a number from 0 to 1.`);
        continue;
      }
      thresholds[qid] = t;
    }
  }

  let bands = { act: 0, ask: 0 };
  const b = raw.bands;
  if (!isObj(b) || typeof b.act !== 'number' || typeof b.ask !== 'number' || !Number.isFinite(b.act) || !Number.isFinite(b.ask)) {
    bad('bands', 'BAD_BANDS', 'bands: { act, ask }, two numbers from 0 to 1.');
  } else if (b.ask < 0 || b.act > 1 || b.ask > b.act) {
    bad('bands', 'BANDS_NOT_ORDERED', 'bands: 0 ≤ ask ≤ act ≤ 1. At or over act the caller acts, at or over ask a person is asked, under it the caller stops.');
  } else {
    bands = { act: b.act, ask: b.ask };
  }

  const use = typeof raw.use === 'string' ? raw.use : '';
  if (!USES.includes(use)) bad('use', 'BAD_USE', "use: 'agent', 'app' or 'both'.");

  if (raw.gate !== undefined && typeof raw.gate !== 'boolean') bad('gate', 'BAD_GATE', 'gate: true or false.');

  let sample: unknown = null;
  if (raw.sample !== undefined && raw.sample !== null) {
    // estimateTokens is a quarter of the JSON length, and Infinity for a value JSON cannot carry
    // (it logs that case itself), so one comparison refuses both.
    if (estimateTokens(raw.sample) * 4 > MAX_SAMPLE_BYTES) bad('sample', 'SAMPLE_TOO_LARGE', 'sample: a state of at most 64 kB that JSON can carry.');
    else {
      sample = raw.sample;
      const extra = fieldsOutside(sends, sample);
      if (extra.length) bad('sample', 'SAMPLE_OUTSIDE_SENDS', `sample carries ${extra.map(f => `'${f}'`).join(', ')}, which sends does not list.`);
    }
  }

  // Only the shape here: whether the provider exists and can carry the questions needs the node,
  // and putRule checks it (services/decide/rules.ts).
  let provider: string | undefined;
  if (raw.provider !== undefined && raw.provider !== null && raw.provider !== '') {
    if (typeof raw.provider !== 'string' || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(raw.provider)) {
      bad('provider', 'BAD_PROVIDER', 'provider: the id of a decision provider, or leave it out.');
    } else {
      provider = raw.provider;
    }
  }

  if (problems.length) return { rule: null, problems };
  return {
    rule: {
      id, title, decides, sends, questions: known, thresholds, bands, use: use as RuleUse, gate: raw.gate === true, sample,
      ...(provider ? { provider } : {}),
    },
    problems: [],
  };
}

/**
 * The top-level fields of a state that the rule's `sends` does not list. Empty `sends` allows any
 * state; a listed `sends` allows only an object whose fields are all on the list.
 */
export function fieldsOutside(sends: string[], state: unknown): string[] {
  if (!sends.length) return [];
  if (!isObj(state)) return ['(the state must be an object with the fields this rule sends)'];
  return Object.keys(state).filter(k => !sends.includes(k));
}

export interface RuleEvaluation {
  outcome: AiDecisionOutcome;
  /** The weakest certainty among the thresholded answers, 0 to 1, or null when the model gave none. */
  result: number | null;
  /** Per thresholded question: did its answer reach its floor. */
  passed: Record<string, boolean>;
}

/** The value a threshold is compared with: a probability, a confidence, or a score level. */
function floorValue(a: AiDecisionAnswer): number {
  if (a.type === 'choice') return a.confidence ?? 0;
  return Number(a.value);
}

/**
 * How sure the model was of this answer, 0 to 1, or null when it did not say.
 *
 * A yes/no has no confidence field: its probability IS how sure it is. A pick-one and a scale carry
 * `confidence`, and the provider's contract makes it OPTIONAL — which is why null and not 0. Reading
 * a missing confidence as 0 made every rule whose thresholds name only scale questions answer `stop`
 * whatever the model said, and no test could see it because the E2E stand-in always sends one.
 */
function certainty(a: AiDecisionAnswer): number | null {
  if (a.type === 'noul') return Number(a.value);
  return typeof a.confidence === 'number' ? a.confidence : null;
}

/** Thresholds and bands applied to the answers. A thresholded question the model did not answer fails. */
export function evaluateRule(
  rule: Pick<DecisionRuleInput, 'thresholds' | 'bands'>, answers: Record<string, AiDecisionAnswer>,
): RuleEvaluation {
  const passed: Record<string, boolean> = {};
  const known: number[] = [];
  for (const [qid, floor] of Object.entries(rule.thresholds)) {
    const a = answers[qid];
    passed[qid] = !!a && floorValue(a) >= floor;
    const c = a ? certainty(a) : null;
    if (typeof c === 'number' && Number.isFinite(c)) known.push(Math.max(0, Math.min(1, c)));
  }
  const result = known.length ? Math.min(...known) : null;
  const allPassed = Object.values(passed).every(Boolean);
  // A thresholded question that failed decides on its own. Otherwise the bands need a number, and
  // when the model gave none the rule cannot band: that is a person's to look at, not a refusal.
  const outcome: AiDecisionOutcome = !allPassed
    ? 'stop'
    : result === null ? 'ask'
      : result >= rule.bands.act ? 'act' : result >= rule.bands.ask ? 'ask' : 'stop';
  return { outcome, result, passed };
}
