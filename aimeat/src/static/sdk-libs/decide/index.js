/**
 * @file decide/index.js
 * @description The aimeat-decide library (TARGET-080). Exposes AIMEAT.decide: typed questions to the
 *   node's decision model (TypeSafe Jev), answered with probabilities, never with text.
 *
 *   WHY IT IS NOT AIMEAT.ai. A decision model is a different kind of model. It classifies, routes,
 *   screens, scores and gates; it does not write. Putting it behind complete() would invite a prompt
 *   where it needs a typed question, and it would appear where a chat model is expected.
 *
 *   THE LAYERS: app to this library to the node to TypeSafe. The key never reaches the browser. The
 *   node removes personal data before anything leaves, puts real option names back into the answers,
 *   meters the call on the owner's AI budget and records the decision. An app must first name
 *   TypeSafe in its data map ("leaves": what goes, to "TypeSafe"), or the node refuses it.
 *
 *   ENGLISH. Write every instruction and criterion in English, whatever language the content is in:
 *   the model is trained on English first. An app that works in several languages translates what it
 *   authors before it asks. This library does not check; a builder who ignores it owns the results.
 *
 *   BATCH BY DEFAULT. ask() takes a MAP of questions, because cost is in the state and answers are
 *   free: thirteen questions in one call cost about what one does. One question is the special case.
 *
 *   THE QUESTIONS ARE DATA. questionSet() reads a set of questions and thresholds from one memory
 *   record the owner can edit without a redeploy; the thresholds are what gate() compares against,
 *   and they are recorded with every decision so the decision can be audited later.
 * @structure yesNo / pickOne / scale (question builders) · ask · gate · questionSet · decisions ·
 *   review · run · settings · attach('decide', …)
 * @usage
 *   <script src="/v1/libs/aimeat-auth.js"></script><script src="/v1/libs/aimeat-decide.js"></script>
 *   const r = await AIMEAT.decide.ask({ text: mail.body }, {
 *     urgent: AIMEAT.decide.yesNo('The sender needs an answer today.'),
 *     topic: AIMEAT.decide.pickOne('What is the message mainly about?', { invoice: 'A bill or payment', meeting: 'Arranging a meeting', other: 'Anything else' }),
 *   }, { subject: mail.key, gates: 'which folder the mail goes to', app_id: 'mail-sorter' });
 *   if (r.answers.urgent.value > 0.8) { ... }
 * @version-history
 *   v1.0.0 - 2026-09-19 - Initial (TARGET-080).
 */
import { makeSession } from '../_core/session.js';
const { authFetch } = makeSession('aimeat-decide.js');
import { attach } from '../_core/namespace.js';

/**
 * Turn an error envelope into an Error a person can act on, with the node's code on `.code`.
 * @param {any} r
 * @returns {Error & { code?: string, details?: any }}
 */
function decideError(r) {
  const code = (r && r.error && r.error.code) || 'UNKNOWN';
  const said = r && r.error && r.error.message;
  const human = {
    DECIDE_DISABLED: 'The decision model is turned off on this node.',
    NO_API_KEY: 'No TypeSafe key is set. The owner adds one in AI settings, or the operator gives the node one.',
    QUOTA_EXHAUSTED: 'The AI budget or allowance is used up for now.',
    APP_QUOTA_EXHAUSTED: 'This app has used its AI budget for today.',
    DATAMAP_REQUIRED: 'This app must say in its data map that data goes to TypeSafe before it can ask.',
    RATE_LIMITED: 'Too many decisions at once. Try again in a moment.',
    INVALID_REQUEST: 'The questions do not fit the model limits.',
  }[code];
  const err = /** @type {Error & { code?: string, details?: any }} */ (new Error(said || human || 'The decision call failed'));
  err.code = code;
  if (r && r.error && r.error.details) err.details = r.error.details;
  return err;
}

/**
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function call(path, init) {
  const r = await authFetch(path, init);
  if (!r || r.ok === false) throw decideError(r);
  return r.data;
}

const post = (/** @type {string} */ path, /** @type {any} */ body) =>
  call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/**
 * A yes/no question. The answer's `value` is the probability (0 to 1) that the statement is true.
 * There is no confidence on this type. Write it in English, as a statement to test.
 * @param {string|object} instructions
 * @param {{ yes?: any, no?: any }} [meaning]  what counts as yes and as no, for boundary cases
 */
function yesNo(instructions, meaning) {
  /** @type {any} */
  const q = { type: 'noul', instructions };
  if (meaning && (meaning.yes !== undefined || meaning.no !== undefined)) {
    q.criteria = {};
    if (meaning.yes !== undefined) q.criteria.true = meaning.yes;
    if (meaning.no !== undefined) q.criteria.false = meaning.no;
  }
  return q;
}

/**
 * Pick one of 2 to 240 options. The answer's `value` is the option name, with `probabilities` per
 * option and a `confidence`. A choice always has a winner, so add an option like "none of these".
 * @param {string|object} instructions
 * @param {Record<string, any>|string[]} options  name to meaning (or null), or just the names
 */
function pickOne(instructions, options) {
  const criteria = Array.isArray(options) ? Object.fromEntries(options.map(o => [String(o), null])) : options;
  return { type: 'choice', instructions, criteria };
}

/**
 * Rate on 2 to 10 ordered levels, lowest first. The answer's `value` is the probability-weighted
 * level (it may fall between two), with `probabilities` per level and a `confidence`. Describe each
 * level as a concrete situation.
 * @param {string|object} instructions
 * @param {any[]} levels
 */
function scale(instructions, levels) {
  return { type: 'score', instructions, criteria: levels };
}

/**
 * Ask. `questions` is a map of your ids to questions (use yesNo, pickOne, scale). Returns
 * `{ decision_id, model, answers: { id: { type, value, probabilities?, confidence? } }, cached,
 * scrub: { removed, total }, usage, key_source }`.
 * @param {any} state  what is judged: a string, an object with named fields, or an array
 * @param {Record<string, any>} questions
 * @param {{ subject?: string, gates?: string, thresholds?: Record<string, number>, names?: string[], public_content?: boolean, cache?: boolean, app_id?: string }} [opts]
 */
async function ask(state, questions, opts) {
  if (!questions || typeof questions !== 'object') throw new Error('questions map required');
  return post('/v1/ai/decide', { state, questions, ...(opts || {}) });
}

/**
 * Ask, then compare each answer with its threshold. Returns the decision plus `passed`: for each id
 * with a threshold, true when the value (a probability, or a score level) reaches it; for a choice,
 * true when the confidence reaches it. The thresholds are recorded with the decision.
 * @param {any} state
 * @param {Record<string, any>} questions
 * @param {Record<string, number>} thresholds
 * @param {{ subject?: string, gates?: string, names?: string[], app_id?: string }} [opts]
 */
async function gate(state, questions, thresholds, opts) {
  const r = await ask(state, questions, { ...(opts || {}), thresholds });
  /** @type {Record<string, boolean>} */
  const passed = {};
  for (const [id, t] of Object.entries(thresholds || {})) {
    const a = r.answers && r.answers[id];
    if (!a) continue;
    const v = a.type === 'choice' ? (a.confidence ?? 0) : Number(a.value);
    passed[id] = v >= t;
  }
  return { ...r, passed };
}

/**
 * Read a question set the owner can edit without a redeploy: one memory record holding
 * `{ questions: {...}, thresholds: {...} }`. Needs aimeat-data (AIMEAT.data).
 * @param {string} key
 */
async function questionSet(key) {
  const A = /** @type {any} */ (globalThis).AIMEAT;
  if (!A || !A.data || typeof A.data.get !== 'function') throw new Error('questionSet() needs aimeat-data.js');
  const rec = await A.data.get(key);
  const v = rec && typeof rec === 'object' && 'value' in rec ? rec.value : rec;
  if (!v || typeof v !== 'object' || !v.questions) throw new Error(`No question set at ${key}`);
  return { questions: v.questions, thresholds: v.thresholds || {} };
}

/**
 * What was decided, newest first. `{ subject }` answers "what did an AI decide about this record".
 * @param {{ subject?: string, app_id?: string, limit?: number, before?: string, id?: string }} [q]
 */
async function decisions(q) {
  const o = q || {};
  if (o.id) return call(`/v1/ai/decisions/${encodeURIComponent(o.id)}`);
  const p = new URLSearchParams();
  for (const k of /** @type {const} */ (['subject', 'app_id', 'limit', 'before'])) {
    if (o[k] !== undefined) p.set(k, String(o[k]));
  }
  const qs = p.toString();
  return call(`/v1/ai/decisions${qs ? `?${qs}` : ''}`);
}

/**
 * Record that a person confirmed or overrode a decision. Call it when the person decided, not for them.
 * @param {string} id
 * @param {'confirmed'|'overridden'} outcome
 * @param {{ note?: string, override?: any }} [extra]
 */
function review(id, outcome, extra) {
  return post(`/v1/ai/decisions/${encodeURIComponent(id)}/review`, { outcome, ...(extra || {}) });
}

/** The same questions over many records, in the background. */
const run = {
  /**
   * @param {Record<string, any>} questions
   * @param {{ items?: {subject: string, state: any}[], keys?: string[], prefix?: string, fields?: string[], gates?: string, thresholds?: Record<string, number>, names?: string[], app_id?: string }} source
   */
  start(questions, source) { return post('/v1/ai/decide/runs', { questions, ...(source || {}) }); },
  /** @param {string} id */
  get(id) { return call(`/v1/ai/decide/runs/${encodeURIComponent(id)}`); },
  list() { return call('/v1/ai/decide/runs'); },
  /** @param {string} id */
  resume(id) { return post(`/v1/ai/decide/runs/${encodeURIComponent(id)}/resume`, {}); },
  /** @param {string} id */
  stop(id) { return post(`/v1/ai/decide/runs/${encodeURIComponent(id)}/stop`, {}); },
  /**
   * Poll until the run is no longer running. Resolves with the run and its per-item results.
   * @param {string} id
   * @param {{ intervalMs?: number, timeoutMs?: number }} [opts]
   */
  async waitFor(id, opts) {
    const interval = Math.max(1000, (opts && opts.intervalMs) || 3000);
    const until = Date.now() + ((opts && opts.timeoutMs) || 30 * 60_000);
    for (;;) {
      const r = await run.get(id);
      if (r.state !== 'running' || Date.now() > until) return r;
      await new Promise(res => setTimeout(res, interval));
    }
  },
};

/** The owner's settings as the node shows them: never the key. */
function settings() { return call('/v1/ai/decide/settings'); }

export const decide = { yesNo, pickOne, scale, ask, gate, questionSet, decisions, review, run, settings };

attach('decide', decide);
