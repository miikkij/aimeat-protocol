/**
 * @file ai/call.js
 * @description Request helpers shared by every AIMEAT.ai call that sends a JSON body to /v1/ai/* and
 *   reads the node envelope: the typed error built from a failed envelope (code, message and the
 *   refusal's details), the provenance record carried from the envelope's meta, the spend guard every
 *   paid call runs through (the optional confirm dialog and the in-flight collapse of identical
 *   calls), and the Blob conversions for a file or a recording an app holds in memory.
 * @structure outputCap · aiError · withProvenance · postJson · noteSpent · paid · isBlob · blobToBase64 · blobToDataUrl
 * @usage import { postJson, paid } from './call.js';
 *   return paid(opts, { key: ['ai-embed', opts.app_id, text], what: 'Make embeddings' },
 *     () => postJson('/v1/ai/embed', body, 'Embedding failed'));
 * @version-history
 *   v1.3.0 - 2026-11-21 - outputCap(): complete() and stream() send max_tokens only with allowCap: true;
 *     alone it is left out and the console says why once per page (curated pitfall no-max-tokens).
 *   v1.2.0 - 2026-11-07 - noteSpent(): the budget is remembered and `aimeat-ai-used` fires, so the
 *     sign-in pill's bolt follows the app's AI calls.
 *   v1.1.0 - 2026-10-02 - aiError lifts the refusal's `fix` (the person's sentence), `settingsUrl` and
 *     `reason` onto the error, so an app shows the sentence and a link to where the fix is.
 *   v1.0.0 - 2026-09-28 - System 2 plan, V5. Initial: extracted from complete() so image, speak,
 *     transcribe, embed and stream raise the same typed errors and share the same spend guard.
 */
import { makeSession } from '../_core/session.js';
const { authFetch } = makeSession('aimeat-ai.js');
import { once, keyOf, confirmSpend, noteBudget, cancelledError } from '../_core/spend.js';

/** Whether this page was already told that its max_tokens was left out. */
let capWarned = false;

/**
 * The `max_tokens` a text call sends, which is none unless the app says it means it.
 *
 * A cap cuts the answer at that length without a sign the person sees, and a cap an app copied from
 * an example (256, 500) cut answers that were meant to be whole. So `max_tokens` alone is left out
 * of the request, and the console says so once per page with what to do instead: say the length in
 * the prompt and read `truncated`. `allowCap: true` beside it sends the cap as before, for a call
 * that really must stop at a length (a cost ceiling on a batch, a one-word classifier).
 * @param {{ max_tokens?: unknown, allowCap?: boolean }} opts
 * @returns {number|undefined}
 */
export function outputCap(opts) {
  const cap = opts && opts.max_tokens;
  if (cap === undefined || cap === null) return undefined;
  if (opts.allowCap === true) return /** @type {number} */ (cap);
  if (!capWarned) {
    capWarned = true;
    console.warn('[aimeat-ai] max_tokens ' + String(cap) + ' was left out of the request: a cap cuts the '
      + 'answer without a sign. Say the length you want in the prompt and check `truncated` on the '
      + 'answer. Pass allowCap: true beside max_tokens to send the cap anyway.');
  }
  return undefined;
}

/**
 * The Error a failed envelope becomes. `.code` is the node's error code; `.details` carries what the
 * node added to a refusal (a model-policy refusal names the models it would allow, for example).
 *
 * When the AI is off for a reason the person can fix, the refusal says how, and these are lifted
 * onto the error: `.fix`, the sentence to show the person, in their language; `.settingsUrl`, the
 * address of their AI settings opened where the fix is (a link or a button beside the sentence);
 * `.reason`, the reason's name. `.message` stays the node's technical message.
 * @param {any} r  the parsed envelope, or null when there was none
 * @param {string} fallback  the message when the envelope carries none
 * @returns {Error & { code?: string, details?: any, fix?: string, settingsUrl?: string, reason?: string }}
 */
export function aiError(r, fallback) {
  const e = r && r.error;
  const err = /** @type {Error & { code?: string, details?: any, fix?: string, settingsUrl?: string, reason?: string }} */ (new Error((e && e.message) || fallback));
  err.code = (e && e.code) || 'UNKNOWN';
  if (e && e.details !== undefined && e.details !== null) {
    err.details = e.details;
    if (typeof e.details.fix === 'string') err.fix = e.details.fix;
    if (typeof e.details.settingsUrl === 'string') err.settingsUrl = e.details.settingsUrl;
    if (typeof e.details.reason === 'string') err.reason = e.details.reason;
  }
  return err;
}

/**
 * The envelope's data, with the provenance record from its meta as `provenance`. The record rides in
 * `meta`, never in `data`, so the data shape every published app reads stays as it is.
 * @param {any} r
 * @returns {any}
 */
export function withProvenance(r) {
  return r.meta && r.meta.provenance ? { ...r.data, provenance: r.meta.provenance } : r.data;
}

/**
 * POST a JSON body through the signed-in session and return the envelope's data. Throws aiError on
 * a failed envelope. The budget block of a successful answer is remembered for the next confirm.
 * @param {string} path
 * @param {any} body
 * @param {string} fallback  the error message when the node gives none
 * @returns {Promise<any>}
 */
export async function postJson(path, body, fallback) {
  const r = await authFetch(path, { method: 'POST', body: JSON.stringify(body) });
  if (!r || !r.ok) throw aiError(r, fallback);
  if (r.data) noteSpent(r.data.budget);
  return withProvenance(r);
}

/**
 * Remember the budget block an AI call returned (the spend guard's noteBudget) and tell the page that
 * AI power was spent: the `aimeat-ai-used` window event, on which the sign-in pill reads its bolt
 * again (auth/ai-state.js). An event the page hears, never a timer.
 * @param {any} budget
 */
export function noteSpent(budget) {
  if (!budget) return;
  noteBudget(budget);
  if (typeof window !== 'undefined' && typeof CustomEvent === 'function') window.dispatchEvent(new CustomEvent('aimeat-ai-used'));
}

/**
 * Run a paid call behind the spend guard.
 *   - `opts.confirm: true` (or an object for AIMEAT.spend.confirm) asks the person first; a cancel
 *     rejects with `.code === 'SPEND_CANCELLED'`. `how.estimate` fills the price line when the
 *     caller gave none.
 *   - Identical calls (same `how.key` parts) collapse while one is in flight; `opts.allowDuplicate`
 *     opts out and `opts.dedupeMs` also returns the result to a call made that long after it.
 * @template T
 * @param {any} opts  the caller's options
 * @param {{ key: any[], what: string, label?: string, remember?: string,
 *   estimate?: () => Promise<string|undefined> }} how
 * @param {() => Promise<T>} call
 * @returns {Promise<T>}
 */
export function paid(opts, how, call) {
  const run = async () => {
    if (opts.confirm) {
      const c = typeof opts.confirm === 'object' ? opts.confirm : {};
      let estimate = c.estimate;
      if (!estimate && how.estimate) {
        try { estimate = await how.estimate(); } catch { estimate = undefined; }
      }
      const okToSpend = await confirmSpend({
        what: c.what || how.what,
        detail: c.detail, estimate, remaining: c.remaining,
        okLabel: c.okLabel, cancelLabel: c.cancelLabel,
        remember: c.remember || how.remember || ('ai:' + (opts.app_id || 'app')),
      });
      if (!okToSpend) throw cancelledError(how.label || 'The AI request');
    }
    return call();
  };
  if (opts.allowDuplicate) return run();
  return once(keyOf(how.key), run, { ttlMs: opts.dedupeMs || 0 });
}

/**
 * True for a Blob or a File.
 * @param {any} v
 * @returns {v is Blob}
 */
export function isBlob(v) {
  return typeof Blob !== 'undefined' && v instanceof Blob;
}

/**
 * The bytes of a Blob as base64, converted in 8 kB slices so a large recording does not overflow the
 * argument list of String.fromCharCode.
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

/**
 * A Blob as a data: URL, the form /v1/ai/complete accepts for a file.
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export async function blobToDataUrl(blob) {
  return 'data:' + (blob.type || 'application/octet-stream') + ';base64,' + await blobToBase64(blob);
}
