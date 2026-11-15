/**
 * @file public/views/profile/work-delivered.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a delivered work item says, as the Work tab's sent list shows it. A delivery's
 *   output is a JSON object; the portal sends { text }, an agent may send any fields. Work delivered
 *   before 2026-11-15 may hold text, a number or an array, and it is shown as it was stored.
 * @structure deliveredText(output)
 * @usage const said = deliveredText(w.output); // null, or { text, empty }
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial.
 */

/**
 * The delivered output as one line of text, or null when nothing was delivered.
 * @param {unknown} output
 * @returns {{ text: string, empty: boolean } | null}
 */
export function deliveredText(output) {
  if (output === undefined || output === null) return null;
  const fields = /** @type {Record<string, unknown>} */ (typeof output === 'object' && !Array.isArray(output) ? output : {});
  let text;
  if (typeof output === 'string') text = output;
  else if (typeof fields.text === 'string') text = fields.text;
  else text = JSON.stringify(output);
  text = text.trim();
  return { text, empty: text === '' };
}
