/**
 * @file src/utils/html-escape.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one HTML escaper for server code. The October 2026 audit found about 22
 *   hand-written escapers on the node: 13 left out `'` and 2 left out `>`. A copy that leaves out
 *   `'` is safe only until a caller puts its output in a single-quoted attribute, and nothing at the
 *   call site says which copy it holds. One function that escapes all five characters
 *   (& < > " ') makes its output safe in HTML text and in a single- or double-quoted attribute, and
 *   the single-entry gate (scripts/check-single-entry.ts, rule html-escape) refuses a new copy.
 *   The output is also valid XML: `&#39;` is a numeric character reference, which every XML parser
 *   reads.
 * @structure escapeHtml(value)
 * @usage
 *   import { escapeHtml } from '../utils/html-escape.js';
 *   `<p title="${escapeHtml(title)}">${escapeHtml(text)}</p>`
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, C8).
 */

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapes & < > " ' for HTML text and quoted attributes. `null` and `undefined` give an empty
 * string; any other value is converted with String() first.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ENTITIES[c]!);
}
