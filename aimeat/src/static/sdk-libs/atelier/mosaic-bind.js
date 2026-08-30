/**
 * @file atelier/mosaic-bind.js
 * @description Pure extraction from mosaic.js (the 800-line cap): the bound-data shaping — what
 *   `set()` takes for each component kind from a freshly resolved source, and the columns
 *   derived for a table whose source sent bare rows. Behaviour unchanged; mosaic.js imports
 *   these as before. wireLive is the LIVE wiring: when the layout declares live sources and the
 *   app has loaded aimeat-live, a memory change on the declared key prefix re-resolves the
 *   source and the change paints with the components' own motion — with the library's firehose
 *   guards (keyPrefix REQUIRED, a floor under minIntervalMs) built in, so a layout cannot
 *   subscribe to everything by accident.
 * @structure patchFor(kind, data) · derivedColumns(rows) · wireLive(spec, refresh)
 * @usage
 *   import { patchFor, derivedColumns, wireLive } from './mosaic-bind.js';
 * @version-history
 *   v0.39.0 — 2026-08-30 — patchFor rides the crt's record whole (the broadcast family);
 *     countdown and crawl take the default items shape.
 *   v0.33.0 — 2026-08-29 — patchFor covers the ops family (health/queue as { data: { items } },
 *     gauge/console/atlas riding the record whole); wireLive arrives (TARGET-074 next level:
 *     live by declaration).
 *   v0.20.0 — 2026-08-28 — Extracted verbatim from mosaic.js when the harvest trio pushed it
 *     past the cap.
 */

/** What `set()` takes for one bound component kind, from a freshly resolved source. */
export function patchFor(kind, data) {
  if (kind === 'statRow') return { tiles: Array.isArray(data) ? data : [] };
  if (kind === 'table') return { rows: Array.isArray(data) ? data : (data && data.rows) || [] };
  if (kind === 'figure') return data && typeof data === 'object' ? data : { value: 0 };
  if (kind === 'chart' || kind === 'matrix' || kind === 'graph' || kind === 'waveform'
    || kind === 'gauge' || kind === 'console' || kind === 'atlas' || kind === 'map' || kind === 'scene3d'
    || kind === 'kanban' || kind === 'plan' || kind === 'schedule'
    || kind === 'steps' || kind === 'rating' || kind === 'crt') {
    return { data: data && typeof data === 'object' && !Array.isArray(data) ? data : null };
  }
  if (kind === 'health' || kind === 'queue') {
    return { data: { items: Array.isArray(data) ? data : (data && data.items) || [] } };
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

/** The floor under a live subscription's re-fire pace — below this is a poll in disguise. */
const LIVE_MIN_INTERVAL_MS = 4000;
const LIVE_DEFAULT_INTERVAL_MS = 8000;

/**
 * Wire the layout's declared live sources to the app-origin realtime library. Declaration:
 * `mosaic({ ..., live: { errands: { keyPrefix: 'errands.' } } })` — the name is the SOURCE the
 * blocks bind, the keyPrefix the memory keys whose change means that source moved. When the
 * page has no AIMEAT.live (the app never loaded it), this is a no-op — live is progressive,
 * never load-bearing. A memory subscription WITHOUT a keyPrefix is refused with words: that is
 * the firehose the library's guards exist to prevent. `domains` may name other change domains
 * (e.g. ['agent-tasks']), and those need no prefix.
 * @param {{ live?: Record<string, { keyPrefix?: string|string[], domains?: string[], minIntervalMs?: number }> }} spec
 * @param {(name: string) => any} refresh
 * @returns {() => void} stop
 */
export function wireLive(spec, refresh) {
  const live = spec.live;
  if (!live || typeof live !== 'object') return function () {};
  const ns = /** @type {any} */ (window).AIMEAT;
  if (!ns || !ns.live || typeof ns.live.subscribe !== 'function') return function () {};
  const offs = [];
  for (const name of Object.keys(live)) {
    const conf = live[name] || {};
    const domains = Array.isArray(conf.domains) && conf.domains.length ? conf.domains : ['memory'];
    const wantsMemory = domains.indexOf('memory') >= 0;
    if (wantsMemory && !conf.keyPrefix) {
      console.warn('aimeat-atelier: live source "' + name + '" subscribes to memory without a keyPrefix — refused (that would re-fetch on every write anyone makes).');
      continue;
    }
    const minIntervalMs = Math.max(Number(conf.minIntervalMs) || LIVE_DEFAULT_INTERVAL_MS, LIVE_MIN_INTERVAL_MS);
    offs.push(ns.live.subscribe(domains, function () { refresh(name); }, {
      keyPrefix: conf.keyPrefix, minIntervalMs: minIntervalMs,
    }));
  }
  return function () {
    for (const off of offs) { try { off(); } catch { /* already gone */ } }
  };
}
