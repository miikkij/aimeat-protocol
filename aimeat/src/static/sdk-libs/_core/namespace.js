/**
 * @file namespace.js
 * @description Shared SDK-libs core — the idempotent `window.AIMEAT` attach that ~21 libs each
 *   re-implemented as `if (!global.AIMEAT) global.AIMEAT = {}; global.AIMEAT.x = x;`. `namespace()`
 *   returns the (lazily created) global object; `attach(key, value)` mounts one library surface
 *   onto it. Serving each bundle as a self-contained IIFE means load order between libs never
 *   matters — whichever runs first creates `window.AIMEAT`, the rest extend it.
 * @structure namespace() · attach(key, value)
 * @usage import { attach } from '../_core/namespace.js';  attach('speech', speech);
 * @version-history
 *   v1.0.0 — 2026-07-19 — Initial: extracted from the per-lib inline global attach (SDK-libs migration Phase 0).
 */

/**
 * The global `window.AIMEAT` object, created on first use.
 * @returns {Record<string, any>}
 */
export function namespace() {
  if (!window.AIMEAT) window.AIMEAT = {};
  return window.AIMEAT;
}

/**
 * Mount one library surface onto `window.AIMEAT` (idempotent — last writer wins, as before).
 * @param {string} key    The namespace key (e.g. `'speech'`, `'data'`).
 * @param {any} value     The library object to expose.
 * @returns {Record<string, any>}  The `window.AIMEAT` object.
 */
export function attach(key, value) {
  const ns = namespace();
  ns[key] = value;
  return ns;
}
