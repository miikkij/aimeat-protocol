/**
 * @file escape.js
 * @description Shared SDK-libs core: the one HTML escape, for text and for a quoted attribute.
 *   Published to apps as `AIMEAT.escapeHtml(value)` by every served library (namespace.js), so an
 *   app that builds markup as a string has a correct escape and does not write its own.
 *
 *   WHY ALL FIVE CHARACTERS. The escape apps wrote most often is the DOM form
 *   (`div.textContent = s; return div.innerHTML`). It escapes `&`, `<` and `>` and leaves `"` and
 *   `'` as they are, which is enough for text and wrong for an attribute: a value put in
 *   `href="…"`, `data-id="…"` or `value="…"` ends the attribute and can add an event handler, which
 *   is script injection with every scope the app holds. This one escapes `&`, `<`, `>`, `"` and `'`.
 * @structure escapeHtml(value)
 * @usage import { escapeHtml } from '../_core/escape.js';
 *   host.innerHTML = '<a href="' + escapeHtml(url) + '">' + escapeHtml(title) + '</a>';
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial: one escape for the libraries and, as AIMEAT.escapeHtml, for apps.
 */

/**
 * Escape a value for HTML text and for a quoted attribute. `null` and `undefined` are ''; any other
 * value is turned into a string first.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
