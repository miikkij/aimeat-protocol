/**
 * @file atelier/mosaic-bind.js
 * @description Pure extraction from mosaic.js (the 800-line cap): the bound-data shaping — what
 *   `set()` takes for each component kind from a freshly resolved source, and the columns
 *   derived for a table whose source sent bare rows. Behaviour unchanged; mosaic.js imports
 *   these as before.
 * @structure patchFor(kind, data) · derivedColumns(rows)
 * @usage
 *   import { patchFor, derivedColumns } from './mosaic-bind.js';
 * @version-history
 *   v0.20.0 — 2026-08-28 — Extracted verbatim from mosaic.js when the harvest trio pushed it
 *     past the cap.
 */

/** What `set()` takes for one bound component kind, from a freshly resolved source. */
export function patchFor(kind, data) {
  if (kind === 'statRow') return { tiles: Array.isArray(data) ? data : [] };
  if (kind === 'table') return { rows: Array.isArray(data) ? data : (data && data.rows) || [] };
  if (kind === 'figure') return data && typeof data === 'object' ? data : { value: 0 };
  if (kind === 'chart' || kind === 'matrix' || kind === 'graph' || kind === 'waveform') {
    return { data: data && typeof data === 'object' && !Array.isArray(data) ? data : null };
  }
  return { items: Array.isArray(data) ? data : [] };
}

/** Columns for a table whose source sent bare rows: one column per key of the first row.
 *  The `id` key is the row's address, not a column a person reads — it stays out. */
export function derivedColumns(rows) {
  if (!rows.length) return [];
  return Object.keys(rows[0]).filter(function (key) { return key !== 'id'; }).map(function (key) {
    return { key: key, label: key, sortable: true };
  });
}
