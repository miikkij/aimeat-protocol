/**
 * @file public/views/admin/config-json-list.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Config tab's text form of a setting that is a list of JSON objects (the admin
 *   view marks such a row `json: true`: agents.operator_services, site.contacts). The tab shows the
 *   list as pretty-printed JSON in a monospace text area and sends the parsed list back, never the
 *   text: a list of objects edited as "one item per line" turned every entry into "[object Object]".
 *   Pure functions, so test/unit/config-json-list.test.ts holds the round trip.
 * @structure jsonListText(value) · jsonListFromText(text) · errorPlace(text, message)
 * @usage
 *   const text = jsonListText(entry.value);
 *   const r = jsonListFromText(text); // { ok: true, value: [...] } or { ok: false, error: 'not-json' | 'not-a-list', at: { line, column } | null }
 * @version-history
 *   v1.1.0 — 2026-11-26 — A parse error answers its line and column (errorPlace), never the engine's sentence.
 *   v1.0.0 — 2026-11-26 — Initial (operator services: the Config row agents.operator_services).
 */

/** The list as the text area shows it: two-space JSON, `[]` for no value. */
export function jsonListText(value) {
  return JSON.stringify(Array.isArray(value) ? value : [], null, 2);
}

/**
 * The text area's text as the list the node takes. An empty text is the empty list. Anything that
 * is not JSON, or is JSON but not a list, is answered as an error and nothing is sent.
 */
export function jsonListFromText(text) {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (raw === '') return { ok: true, value: [] };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // Where the error is, never the engine's own English sentence.
    return { ok: false, error: 'not-json', at: errorPlace(raw, String(err && err.message ? err.message : err)) };
  }
  if (!Array.isArray(parsed)) return { ok: false, error: 'not-a-list', at: null };
  return { ok: true, value: parsed };
}

/**
 * The line and column (from 1) of a JSON.parse error, read from the engine's message: "line N column M"
 * where the engine names them (Firefox, newer V8), or "position N" turned into a line and column of
 * `text`. Null when the message names neither.
 */
export function errorPlace(text, message) {
  const lc = /line (\d+) column (\d+)/i.exec(message);
  if (lc) return { line: Number(lc[1]), column: Number(lc[2]) };
  const pos = /position (\d+)/i.exec(message);
  if (!pos) return null;
  const before = text.slice(0, Number(pos[1]));
  const lines = before.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}
