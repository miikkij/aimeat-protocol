/**
 * @file ai/call.js
 * @description Request helpers shared by every AIMEAT.ai call that sends a JSON body to /v1/ai/* and
 *   reads the node envelope: the typed error built from a failed envelope (code, message and the
 *   refusal's details), the provenance record carried from the envelope's meta, the spend guard every
 *   paid call runs through (the optional confirm dialog and the in-flight collapse of identical
 *   calls), and the Blob conversions for a file or a recording an app holds in memory.
 * @structure aiError · withProvenance · postJson · paid · isBlob · blobToBase64 · blobToDataUrl
 * @usage import { postJson, paid } from './call.js';
 *   return paid(opts, { key: ['ai-embed', opts.app_id, text], what: 'Make embeddings' },
 *     () => postJson('/v1/ai/embed', body, 'Embedding failed'));
 * @version-history
 *   v1.0.0 - 2026-09-28 - System 2 plan, V5. Initial: extracted from complete() so image, speak,
 *     transcribe, embed and stream raise the same typed errors and share the same spend guard.
 */
import { makeSession } from '../_core/session.js';
const { authFetch } = makeSession('aimeat-ai.js');
import { once, keyOf, confirmSpend, noteBudget, cancelledError } from '../_core/spend.js';

/**
 * The Error a failed envelope becomes. `.code` is the node's error code; `.details` carries what the
 * node added to a refusal (a model-policy refusal names the models it would allow, for example).
 * @param {any} r  the parsed envelope, or null when there was none
 * @param {string} fallback  the message when the envelope carries none
 * @returns {Error & { code?: string, details?: any }}
 */
export function aiError(r, fallback) {
  const e = r && r.error;
  const err = /** @type {Error & { code?: string, details?: any }} */ (new Error((e && e.message) || fallback));
  err.code = (e && e.code) || 'UNKNOWN';
  if (e && e.details !== undefined && e.details !== null) err.details = e.details;
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
  if (r.data) noteBudget(r.data.budget);
  return withProvenance(r);
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
