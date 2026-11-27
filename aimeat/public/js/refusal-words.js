/**
 * @file public/js/refusal-words.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A refused call in the reader's language. The server's `error.message` is written in
 *   English for an AI; a page says the same refusal to a person by its `error.code`: the page's own
 *   words for that code (`<prefix><CODE>`), else the words every page shares (`refusal.<CODE>`),
 *   else the page's one sentence for the action that failed. The server's message is never shown,
 *   with two exceptions that are already in the person's language: a 402 INSUFFICIENT_MORSELS, whose
 *   message api.js writes from the locale, and a 400 VALIDATION_ERROR, whose per-field messages the
 *   server writes in the request's language (js/field-errors.js).
 * @structure refusalCode(err) · refusalText(err, prefix, fallbackKey, vars) · runOutcomeWords(outcome)
 * @usage
 *   import { refusalText } from '/js/refusal-words.js';
 *   catch (e) { showToast(refusalText(e, 'contacts.refusal.', 'contacts.refusal.addFailed'), true); }
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial: Contacts, Offers and Scheduler said the server's English sentence;
 *     runOutcomeWords is the one reading of a manual run's outcome for Scheduler and Offers.
 */
import { t } from '/js/i18n.js';
import { fieldErrorsOf } from '/js/field-errors.js';

/**
 * The refusal's code from what api.js threw (err.code), from an `ok: false` envelope a service
 * returned without throwing (err.error.code), or from the envelope api.js kept (err.response).
 * @param {any} err
 * @returns {string}
 */
export function refusalCode(err) {
  return String(err?.code || err?.error?.code || err?.response?.error?.code || '');
}

/** The words of `key`, or '' when the locale has none (t() answers the key itself then). */
function wordsOf(key, vars) {
  const w = t(key, vars);
  return w && w !== key ? w : '';
}

/**
 * The sentence a person reads for a refused call: what happened and what to do.
 * @param {any} err what api.js threw, or the `ok: false` envelope a service returned
 * @param {string|string[]} prefix the page's own words for a code, e.g. 'contacts.refusal.' (with
 *   the dot); a list is read in order, the action's own words before the page's
 * @param {string} fallbackKey the page's sentence for this action when the code has no words
 * @param {Record<string, string|number>} [vars] values the words name ({name}, {email})
 * @returns {string}
 */
export function refusalText(err, prefix, fallbackKey, vars) {
  const code = refusalCode(err);
  if (code === 'INSUFFICIENT_MORSELS' && err?.message) return String(err.message);
  if (code === 'VALIDATION_ERROR') {
    const first = Object.values(fieldErrorsOf(err))[0];
    if (first) return first;
  }
  if (code) {
    for (const p of [...(Array.isArray(prefix) ? prefix : [prefix]), 'refusal.']) {
      const own = wordsOf(p + code, vars);
      if (own) return own;
    }
  }
  return wordsOf(fallbackKey, vars) || t('refusal.generic');
}

/**
 * What "Run now" did, as the toast says it: POST /v1/schedules/:id/trigger answers `outcome` (the
 * scheduler's JobOutcome code). A run that did not happen is said as one, never as a start; the
 * scheduler's own `reason` is English for an AI and is not shown (the run log has it).
 * @param {string|null|undefined} outcome
 * @returns {{ text: string, error: boolean }}
 */
export function runOutcomeWords(outcome) {
  if (outcome === 'created') return { text: t('profile.scheduler.runCreated'), error: false };
  if (outcome === 'busy') return { text: t('profile.scheduler.runBusy'), error: true };
  if (outcome === 'stopped') return { text: t('profile.scheduler.runStopped'), error: true };
  if (outcome === 'limited') return { text: t('profile.scheduler.runLimited'), error: true };
  if (outcome === 'error') return { text: t('scheduler.runFailedSeeLog'), error: true };
  return { text: t('profile.scheduler.triggered'), error: false };
}
