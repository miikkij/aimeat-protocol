/**
 * @file src/services/decide/limits.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shape and size rules a decision request must meet before it leaves the node.
 *
 *   TypeSafe's Jev answers typed questions (noul, choice, score) about a state. It refuses a request
 *   that is too large or has too many options, and it bills for the refusal's round trip in time if
 *   not in money. Checking here first turns a provider 422 into a message a builder can act on,
 *   and it names the question that is wrong.
 *
 *   The token ceiling is the smaller of the two numbers TypeSafe documents (32000), and the estimate
 *   is deliberately conservative (four characters per token), so a request that passes here does
 *   not fail there for size.
 *
 *   The check never throws. It returns every violation it found, so a builder fixes them in one
 *   round rather than one per call.
 * @structure
 *   - DecideLimits, DEFAULT_DECIDE_LIMITS: the numbers
 *   - JevQuestionType, JevQuestion: one question as sent
 *   - LimitViolation: one thing wrong, with the question id when it belongs to one
 *   - estimateTokens(x): conservative token count of a JSON value
 *   - checkDecideRequest(state, questions, limits): [] when the request is fine
 * @usage
 *   import { checkDecideRequest, DEFAULT_DECIDE_LIMITS } from './limits.js';
 *   const problems = checkDecideRequest(state, questions, DEFAULT_DECIDE_LIMITS);
 *   if (problems.length) return res.status(400).json({ error: problems });
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial: request limits for AIMEAT.decide (TARGET-080).
 */
import { logger } from '../../utils/logger.js';

/** The numbers a decision request is held to. */
export interface DecideLimits {
  /** Ceiling on the estimated tokens of `{state, questions}`. */
  maxRequestTokens: number;
  /** Most options one choice question may offer. */
  maxChoiceOptions: number;
  /** Fewest levels one score question may have. */
  minScoreLevels: number;
  /** Most levels one score question may have. */
  maxScoreLevels: number;
  /** Most questions in one request. */
  maxQuestions: number;
}

/** TypeSafe's documented limits; the token ceiling is the smaller of its two documented numbers. */
export const DEFAULT_DECIDE_LIMITS: DecideLimits = Object.freeze({
  maxRequestTokens: 32000,
  maxChoiceOptions: 240,
  minScoreLevels: 2,
  maxScoreLevels: 10,
  maxQuestions: 200,
});

/** The three question kinds Jev answers. */
export type JevQuestionType = 'noul' | 'choice' | 'score';

/** One question as sent to Jev. `criteria` depends on the type (see checkDecideRequest). */
export interface JevQuestion {
  type: JevQuestionType;
  instructions: unknown;
  criteria?: unknown;
}

/** One thing wrong with a request. `question` is the id when the problem belongs to one question. */
export interface LimitViolation {
  question?: string;
  code: string;
  message: string;
}

const ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const TYPES: readonly string[] = ['noul', 'choice', 'score'];

/**
 * Conservative token estimate: Math.ceil(JSON.stringify(x).length / 4).
 * A value JSON cannot serialise (a cycle, a BigInt) counts as Infinity, so it never passes a limit.
 * @param {unknown} x
 * @returns {number}
 */
export function estimateTokens(x: unknown): number {
  try {
    const s = JSON.stringify(x);
    return s === undefined ? 0 : Math.ceil(s.length / 4);
  } catch (err) {
    // Infinity IS the failure: a value JSON cannot write can never be sent, and checkDecideRequest
    // refuses it as TOO_LARGE with a message. Logged so the reason is not only a number.
    logger.warn('[decide] a request could not be written as JSON; refused as too large', { error: String(err) });
    return Infinity;
  }
}

/** True for `{}`-style objects: not null, not an array, not a class instance. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

/** Instructions are present when they are a non-blank string, a non-empty array or a non-empty object. */
function hasInstructions(v: unknown): boolean {
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (v !== null && typeof v === 'object') return Object.keys(v).length > 0;
  return false;
}

/**
 * Check one question's criteria against its type.
 * @param {string} id
 * @param {JevQuestion} q
 * @param {DecideLimits} limits
 * @returns {LimitViolation[]}
 */
function checkCriteria(id: string, q: JevQuestion, limits: DecideLimits): LimitViolation[] {
  const c = q.criteria;
  if (q.type === 'noul') {
    if (c === undefined || c === null) return [];
    if (!isPlainObject(c) || Object.keys(c).some(k => k !== 'true' && k !== 'false')) {
      return [{ question: id, code: 'BAD_CRITERIA',
        message: `Yes-or-no question '${id}' may describe only 'true' and 'false' in its criteria, or leave criteria out.` }];
    }
    return [];
  }
  if (q.type === 'choice') {
    if (!isPlainObject(c)) {
      return [{ question: id, code: 'BAD_CRITERIA',
        message: `Choice question '${id}' needs criteria as an object: one key per option, the value describing it (or null).` }];
    }
    const n = Object.keys(c).length;
    if (n < 2) {
      return [{ question: id, code: 'TOO_FEW_OPTIONS',
        message: `Choice question '${id}' has ${n} option${n === 1 ? '' : 's'}; it needs at least 2.` }];
    }
    if (n > limits.maxChoiceOptions) {
      return [{ question: id, code: 'TOO_MANY_OPTIONS',
        message: `Choice question '${id}' has ${n} options; the limit is ${limits.maxChoiceOptions}. Walk a large taxonomy in stages.` }];
    }
    return [];
  }
  // score
  if (!Array.isArray(c)) {
    return [{ question: id, code: 'BAD_CRITERIA',
      message: `Score question '${id}' needs criteria as a list of level descriptions, lowest first.` }];
  }
  if (c.length < limits.minScoreLevels) {
    return [{ question: id, code: 'TOO_FEW_LEVELS',
      message: `Score question '${id}' has ${c.length} level${c.length === 1 ? '' : 's'}; it needs at least ${limits.minScoreLevels}.` }];
  }
  if (c.length > limits.maxScoreLevels) {
    return [{ question: id, code: 'TOO_MANY_LEVELS',
      message: `Score question '${id}' has ${c.length} levels; the limit is ${limits.maxScoreLevels}. Merge neighbouring levels or ask two questions.` }];
  }
  return [];
}

/**
 * Validate shape + limits. Returns [] when fine. Never throws.
 * @param {unknown} state the state the questions are about (already scrubbed)
 * @param {Record<string, JevQuestion>} questions question id → question
 * @param {DecideLimits} limits usually DEFAULT_DECIDE_LIMITS
 * @returns {LimitViolation[]}
 */
export function checkDecideRequest(
  state: unknown,
  questions: Record<string, JevQuestion>,
  limits: DecideLimits,
): LimitViolation[] {
  const out: LimitViolation[] = [];
  if (!isPlainObject(questions) || Object.keys(questions).length === 0) {
    return [{ code: 'NO_QUESTIONS', message: 'Send at least one question, as an object of question id to question.' }];
  }
  const ids = Object.keys(questions);
  if (ids.length > limits.maxQuestions) {
    out.push({ code: 'TOO_MANY_QUESTIONS',
      message: `The request has ${ids.length} questions; the limit is ${limits.maxQuestions}. Split it into several requests.` });
  }
  for (const id of ids) {
    if (!ID_RE.test(id)) {
      out.push({ question: id, code: 'BAD_ID',
        message: `Question id '${id.slice(0, 80)}' may use only letters, digits, '_', '.' and '-', up to 64 characters.` });
    }
    const q = questions[id] as unknown;
    if (!isPlainObject(q) || typeof q.type !== 'string' || !TYPES.includes(q.type)) {
      out.push({ question: id, code: 'BAD_TYPE',
        message: `Question '${id}' needs a type of 'noul', 'choice' or 'score'.` });
      continue;
    }
    const question = q as unknown as JevQuestion;
    if (!hasInstructions(question.instructions)) {
      out.push({ question: id, code: 'NO_INSTRUCTIONS',
        message: `Question '${id}' needs instructions: a sentence, an object or a list that says what to decide.` });
    }
    out.push(...checkCriteria(id, question, limits));
  }
  const tokens = estimateTokens({ state, questions });
  if (tokens > limits.maxRequestTokens) {
    out.push({ code: 'TOO_LARGE',
      message: Number.isFinite(tokens)
        ? `The request is about ${tokens} tokens; the limit is ${limits.maxRequestTokens}. Send a smaller state: the fields the questions need, not the whole record.`
        : 'The request cannot be written as JSON (it has a cycle or a value JSON does not carry). Send plain data.' });
  }
  return out;
}
