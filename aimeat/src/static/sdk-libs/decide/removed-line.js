/**
 * @file decide/removed-line.js
 * @description What a decide answer says about the personal data the node took out before the
 *   text left, as one sentence, and a probability or a confidence as a person reads it. Pure: no
 *   DOM, no fetch, no words of its own. The caller hands in how to count one kind and how to say
 *   one key, so each library keeps its own dictionary and its own languages.
 *
 *   WHY IT IS A MODULE OF ITS OWN. Two libraries draw a decide answer: the living document's decide
 *   row (living/render-decide.js) and the Atelier kit's decision block (atelier/decision.js). The
 *   order of the kinds, the singular and plural keys and the "nothing was found" case were written
 *   once in the living row; the kit imports them from here instead of writing them a second time.
 *   The decide library's own bundle (decide/index.js) does not import this file, so it adds nothing
 *   to aimeat-decide.js; esbuild copies these few lines into each bundle that imports them.
 *
 *   THE KEYS a say() function answers: removedLead, removedTail, removedNone, and
 *   kind.<kind>.1 / kind.<kind>.n for each of SCRUB_KINDS.
 * @structure SCRUB_KINDS · removedLine(countOf, say) · twoDecimals(v)
 * @usage
 *   import { removedLine, twoDecimals } from '../decide/removed-line.js';
 *   line.textContent = removedLine((kind) => r.scrub.removed[kind], (key) => words(key));
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial: moved out of living/render-decide.js (living 0.8.1) unchanged,
 *     so the Atelier kit's decision block says the same sentence.
 */

/** The kinds of personal data the node takes out, in the order the sentence names them. */
export const SCRUB_KINDS = ['person', 'email', 'phone', 'hetu', 'iban', 'address'];

/**
 * The sentence: "Taken out of the text before sending: 1 name, 2 e-mail addresses. …", or the
 * sentence that says nothing was found.
 * @param {(kind: string) => any} countOf  how many of one kind were taken out
 * @param {(key: string) => string} say    one key in the caller's language
 * @returns {string}
 */
export function removedLine(countOf, say) {
  const parts = [];
  for (const kind of SCRUB_KINDS) {
    const n = Number(countOf(kind)) || 0;
    if (n > 0) parts.push(n + ' ' + say('kind.' + kind + (n === 1 ? '.1' : '.n')));
  }
  return parts.length
    ? say('removedLead') + parts.join(', ') + say('removedTail')
    : say('removedNone');
}

/**
 * A probability or a confidence as a person reads it: two decimals, or '' for anything that is
 * not a finite number.
 * @param {any} v
 * @returns {string}
 */
export function twoDecimals(v) { return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : ''; }
