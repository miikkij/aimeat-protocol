/**
 * @file ai/job.js
 * @description `AIMEAT.ai.job.*` — a model call that takes minutes, without an app holding a fetch
 *   open for them.
 *
 *   `AIMEAT.ai.complete()` next door is the right call when the answer arrives in seconds. It is the
 *   wrong one when it does not: a browser tab that navigates away, a laptop that sleeps or a proxy
 *   that gives up takes the answer with it, and the money is spent either way. A job survives all
 *   three. Start it, keep the id, and read `result_key` when it says done.
 *
 *   THE REFUSALS ARE TURNED INTO HUMAN WORDS ONCE, HERE. Every app would otherwise write its own
 *   sentence for "the node is busy", and most would write none at all and show a raw code. The codes
 *   stay on `.code` for an app that wants to branch on them.
 * @structure job — start / get / list / cancel / waitFor
 * @usage
 *   const { job_id } = await AIMEAT.ai.job.start({ prompt, result_key: 'report.latest' });
 *   const done = await AIMEAT.ai.job.waitFor(job_id);
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial.
 */
import { makeSession } from '../_core/session.js';
const { authFetch } = makeSession('aimeat-ai.js');

/**
 * Say what happened in words a person can act on. The node's own message is used when there is one,
 * because it carries the numbers (how many are queued, how big the prompt was); these are the
 * fallbacks and the framing.
 * @param {any} r  the envelope
 * @returns {Error & { code?: string, retryAfterSeconds?: number }}
 */
function jobError(r) {
  const code = (r && r.error && r.error.code) || 'UNKNOWN';
  const said = r && r.error && r.error.message;
  const human = {
    AI_JOB_QUEUE_FULL: 'The node is busy right now. Try again in a moment.',
    AI_JOB_LIMIT_REACHED: 'You already have a lot of AI jobs waiting. Something may be looping — check the list before starting more.',
    AI_JOB_CHAIN_TOO_DEEP: 'A chain of jobs kept calling itself and was stopped.',
    AI_JOB_PROMPT_TOO_LARGE: 'The prompt and the records it reads are too big to send. Read fewer records, or smaller ones.',
    AI_JOB_CALLBACK_FORBIDDEN: 'The on_done action does not belong to this account.',
    AI_JOB_ALREADY_TERMINAL: 'That job has already finished; there is nothing left to stop.',
    NOT_FOUND: 'No such job.',
  }[code];
  const err = /** @type {Error & { code?: string, retryAfterSeconds?: number }} */ (
    new Error(said || human || 'The AI job call failed'));
  err.code = code;
  if (r && r.error && typeof r.error.retry_after_s === 'number') err.retryAfterSeconds = r.error.retry_after_s;
  return err;
}

const TERMINAL = ['done', 'failed', 'cancelled'];

export const job = {
  /**
   * Start one. Returns `{ job_id, state, queue_position }` — a position, never an ETA, because
   * nobody knows how long a model will take.
   *
   * `result_key` is required and is where the answer lands, in the signed-in person's own
   * namespace. `input_keys` names records that are READ AND PASTED INTO the prompt: the model has no
   * tools and cannot fetch anything itself, and a record that does not exist is stated as missing so
   * it cannot be invented.
   *
   * Error codes on `.code`: AI_JOB_QUEUE_FULL (with `.retryAfterSeconds`), AI_JOB_LIMIT_REACHED,
   * AI_JOB_CHAIN_TOO_DEEP, AI_JOB_PROMPT_TOO_LARGE, AI_JOB_CALLBACK_FORBIDDEN, plus everything
   * AIMEAT.ai.complete() can raise about keys and budgets.
   */
  async start(opts) {
    if (!opts || typeof opts !== 'object') throw new Error('opts object required');
    if (!opts.result_key) throw new Error('opts.result_key required');
    if (!opts.prompt && !opts.prompt_key) throw new Error('opts.prompt or opts.prompt_key required');
    const body = {
      prompt: opts.prompt,
      prompt_key: opts.prompt_key,
      input_keys: opts.input_keys,
      result_key: opts.result_key,
      result_visibility: opts.result_visibility,
      model: opts.model,
      system_prompt: opts.system_prompt,
      json: opts.json,
      app_id: opts.app_id,
      on_done: opts.on_done,
    };
    const r = await authFetch('/v1/ai/jobs', { method: 'POST', body: JSON.stringify(body) });
    if (!r || !r.ok) throw jobError(r);
    return r.data;
  },

  /** One job's record: state, cost, where the answer went, and why it failed if it did. */
  async get(jobId) {
    if (!jobId) throw new Error('jobId required');
    const r = await authFetch('/v1/ai/jobs/' + encodeURIComponent(jobId));
    if (!r || !r.ok) throw jobError(r);
    return r.data;
  },

  /** The jobs. `state` defaults to the live ones (queued + running). */
  async list(opts) {
    const q = new URLSearchParams();
    if (opts && opts.state) q.set('state', opts.state);
    if (opts && opts.limit) q.set('limit', String(opts.limit));
    const qs = q.toString();
    const r = await authFetch('/v1/ai/jobs' + (qs ? '?' + qs : ''));
    if (!r || !r.ok) throw jobError(r);
    return (r.data && r.data.jobs) || [];
  },

  /** Stop one, queued or running. A finished job raises AI_JOB_ALREADY_TERMINAL. */
  async cancel(jobId) {
    if (!jobId) throw new Error('jobId required');
    const r = await authFetch('/v1/ai/jobs/' + encodeURIComponent(jobId) + '/cancel', { method: 'POST', body: '{}' });
    if (!r || !r.ok) throw jobError(r);
    return r.data;
  },

  /**
   * Poll until the job is done, failed or cancelled, and hand back its record.
   *
   * A convenience over `get`, not a different mechanism: the tab may still close, and the job
   * carries on regardless. `onState` is called each time the state changes, which is what a progress
   * line in the UI wants. `timeoutMs` gives up WAITING; it never cancels the job, because a caller
   * that stopped watching has not decided to throw the answer away — call `cancel()` for that.
   */
  async waitFor(jobId, opts) {
    const intervalMs = (opts && opts.intervalMs) || 3000;
    const timeoutMs = (opts && opts.timeoutMs) || 30 * 60_000;
    const onState = opts && opts.onState;
    const startedAt = Date.now();
    let last = null;
    for (;;) {
      const rec = await job.get(jobId);
      if (rec && rec.state !== last) { last = rec.state; if (onState) onState(rec.state, rec); }
      if (rec && TERMINAL.indexOf(rec.state) >= 0) return rec;
      if (Date.now() - startedAt > timeoutMs) {
        const err = /** @type {Error & { code?: string }} */ (
          new Error('Stopped waiting for the AI job; it is still running. Read it later with AIMEAT.ai.job.get().'));
        err.code = 'AI_JOB_WAIT_TIMEOUT';
        throw err;
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  },
};
