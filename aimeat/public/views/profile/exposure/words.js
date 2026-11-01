/**
 * @file public/views/profile/exposure/words.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The exposure report's own sentences in the page's language: how to close an item
 *   (`close`), a title the node words itself (`title_parts`) and the notes (`note_codes`), each said from
 *   the locale keys `exposure.close.*`, `exposure.titles.*` and `exposure.notes.*` with the identifiers the
 *   answer carries. The report keeps its English `how_to_close`, `title` and `notes` for an AI; a code
 *   this page has no words for falls back to them, so an older or newer node never shows an empty line.
 * @structure closeText · titleOf · noteTexts
 * @usage import { closeText, titleOf, noteTexts } from './exposure/words.js';
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (WP9c: a Finnish page shows no English sentence of the report).
 */
import { t } from '/js/i18n.js';

/** The words of `exposure.<key>`, or null when this page has none for it. */
function words(key, vars) {
  const full = `exposure.${key}`;
  const out = t(full, vars);
  return out && out !== full ? out : null;
}

/** How to close the item, in the page's language; the node's sentence when the code is unknown here. */
export function closeText(item) {
  const c = item?.close;
  return (c?.code && words(`close.${c.code}`, c.values || {})) || item?.how_to_close || '';
}

/** What the item is called: a title the node worded, in the page's language, else the title as it is. */
export function titleOf(item) {
  const p = item?.title_parts;
  return (p?.code && words(`titles.${p.code}`, p.values || {})) || item?.title || '';
}

/** The report's notes in the page's language, in the node's order; its own sentence for an unknown code. */
export function noteTexts(report) {
  const codes = Array.isArray(report?.note_codes) ? report.note_codes : [];
  const notes = Array.isArray(report?.notes) ? report.notes : [];
  if (!codes.length) return notes;
  return codes.map((code, i) => words(`notes.${code}`, { n: report.item_cap ?? '' }) || notes[i] || '');
}
