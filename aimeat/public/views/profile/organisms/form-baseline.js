/**
 * @file public/views/profile/organisms/form-baseline.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How a settings form takes fresher data from the server while the person edits it:
 *   each field the person has not touched follows the new value, and a touched field keeps what the
 *   person typed. The organism settings page (home-settings.js) replaced the whole form or nothing,
 *   so with one field touched, a setting changed elsewhere meanwhile kept its old value in the form,
 *   differed from the new value, and the next save sent the old value back. The setting where that
 *   matters is agent_access: an agent may narrow it to "listed" while the page is open, and the save
 *   put "all" back in the person's name (2026-11-10).
 * @structure refreshUntouched(form, prev, next) → the form to show
 * @usage setForm(refreshUntouched(form, prevBaselineRef.current, baseline));
 * @version-history
 *   v1.0.0 — 2026-11-10 — Initial, extracted from home-settings.js.
 */

const same = (a, b) => (Array.isArray(a) && Array.isArray(b) ? a.join('\u0000') === b.join('\u0000') : a === b);

/**
 * The form after the server's values moved from `prev` to `next`. A field whose form value still
 * equals `prev` was not touched and takes `next`; any other field keeps the form's value.
 * @param {Record<string, unknown>} form
 * @param {Record<string, unknown>} prev
 * @param {Record<string, unknown>} next
 * @returns {Record<string, unknown>}
 */
export function refreshUntouched(form, prev, next) {
  const out = { ...form };
  for (const k of Object.keys(next)) if (same(form[k], prev[k])) out[k] = next[k];
  return out;
}
