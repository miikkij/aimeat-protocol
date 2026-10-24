/**
 * @file cortex-card.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The markup of the cortex bar's cards and the escaper for a single-quoted JS argument
 *   inside a double-quoted on* attribute. Pure string functions with no DOM access, so a unit test
 *   can run them in Node. Moved out of cortex.js, whose module graph reads `window` at import time.
 * @structure
 *   - cortexArg(str)      → escape for a single-quoted JS argument inside an on* attribute
 *   - cortexCardHtml(ext) → one card of the cortex bar for a cortex list entry
 * @usage import { cortexArg, cortexCardHtml } from './cortex-card.js'
 * @version-history
 *   v1.0.0 — 2026-10-24 — Moved from cortex.js (secaudit2026oct22). The card's onclick argument is
 *     JS-escaped with cortexArg as well as URI-encoded, so a name with an apostrophe stays one string.
 */
import { escapeHtml } from './util.js';

// Escape extension content for a single-quoted JS arg inside a double-quoted onclick, the same
// as jsArg but preserving newlines as a literal \n (cortexCopy restores them). Escaping '&'
// FIRST is the security-critical bit: without it a payload like &#39; survives into the
// attribute, the HTML parser decodes it to ' and breaks out of the JS string (entity smuggling).
export function cortexArg(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '\\n');
}

/**
 * One card of the cortex bar. `ext` is an entry of GET /v1/cortex: its name and short_name are
 * chosen by the cortex's installer, who can be any owner. encodeURIComponent leaves the apostrophe
 * and the parentheses unchanged, so the encoded name also goes through cortexArg before it lands
 * in the single-quoted argument; showCortexPopup still receives the URI-encoded name.
 */
export function cortexCardHtml(ext) {
  var types = ext.component_types || [];
  var libCount = types.filter(function(t) { return t === 'lib'; }).length;
  var schemaCount = types.filter(function(t) { return t === 'schema'; }).length;
  return '<div class="cortex-mini-card" onclick="showCortexPopup(\'' + cortexArg(encodeURIComponent(ext.name)) + '\')">'
    + '<div class="cortex-mini-name">&#x1F4E6; ' + escapeHtml(ext.short_name || ext.name) + '</div>'
    + '<div class="cortex-mini-meta">' + libCount + ' lib &middot; ' + schemaCount + ' schema</div>'
    + '</div>';
}
