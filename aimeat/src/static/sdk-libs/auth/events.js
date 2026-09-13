/**
 * @file auth/events.js
 * @description aimeat-auth event bus (SDK-libs migration Phase 3). The shared listener registry +
 *   emit/on/off that the session layer, pill, modal and boot all use to broadcast
 *   'login'/'logout'/'refreshed'/'expired'/'session-updated'/'scopes-stale'/'popup-blocked' events.
 *   `listeners` is only ever mutated in place (never reassigned), so importing it across modules is
 *   safe. Extracted from auth-lib-part2.ts.
 * @structure listeners · emit(event, data, meta) · on(event, fn) · off(event, fn).
 * @usage import { emit, on, off } from './events.js';
 * @version-history
 *   v1.1.0 — 2026-09-13 — emit takes an optional third argument that reaches every listener as its
 *     second. 'login' uses it for { restored }, so a page, and the login pill's onLogin, can tell a
 *     session restored on page load from one somebody just signed in with. A listener that takes
 *     one argument is unaffected.
 *   v1.0.0 — 2026-07-19 — Extracted from src/routes/libs/auth-lib-part2.ts (SDK-libs migration Phase 3).
 */

/** @type {Record<string, Array<(data: any, meta?: any) => void>>} */
export const listeners = {};

export function emit(event, data, meta) { (listeners[event] || []).forEach(fn => fn(data, meta)); }

export function on(event, fn) {
  if (!listeners[event]) listeners[event] = [];
  listeners[event].push(fn);
}

export function off(event, fn) {
  if (!listeners[event]) return;
  listeners[event] = listeners[event].filter(f => f !== fn);
}
