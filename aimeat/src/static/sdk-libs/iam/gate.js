/**
 * @file iam/gate.js
 * @description The client-side affordances: show or hide a control, and refuse an action before it
 *   is attempted. These are UX, never security. The extension is the gate; everything here can be
 *   defeated by anyone who opens devtools, and it exists so a user is not shown a button that will
 *   refuse them, not to decide whether they may press it.
 *
 *   `guard` is the one that matters: it asks the SERVER before running, so a stale local capability
 *   list cannot let an action through. `can` reads the cached list and is the fast, honest-only-if-
 *   fresh answer used for painting.
 * @structure makeGate(state, checkFn) → { can, gate, guard }
 * @usage import { makeGate } from './gate.js';
 * @version-history
 *   v1.0.0 — 2026-07-30 — Initial (TARGET-055 phase 1).
 */

/**
 * @param {{ me: () => { caps: string[], isOwner: boolean } | null }} store  Live view of the cached state.
 * @param {(input: { permission?: string, command?: string }) => Promise<{ allowed: boolean }>} serverCheck
 * @returns {{ can: (cap: string) => boolean, gate: (target: any, cap: string) => void, guard: (cap: string, fn: Function) => Promise<any> }}
 */
export function makeGate(store, serverCheck) {
  /**
   * Does the cached capability list contain `cap`? A hint for painting, and the library says so in
   * every place it is documented. `'*'` means all.
   * @param {string} cap
   * @returns {boolean}
   */
  function can(cap) {
    const me = store.me();
    if (!me) return false;
    const caps = me.caps || [];
    return caps.indexOf('*') !== -1 || caps.indexOf(cap) !== -1;
  }

  /**
   * Show or hide one element by capability. Uses `hidden` rather than a style, so a host page's own
   * CSS keeps control of how things look and nothing here has to know the app's design.
   * @param {string|Element} target  Selector or element.
   * @param {string} cap
   */
  function gate(target, cap) {
    const el = /** @type {HTMLElement|null} */ (typeof target === 'string' ? document.querySelector(target) : target);
    if (!el) return;
    el.hidden = !can(cap);
  }

  /**
   * Ask the server, then run. The check is not a formality: it is the same call the app should make
   * server-side anyway, and doing it here means a capability list that went stale (a revoke while
   * the page was open) refuses instead of proceeding.
   * @param {string} cap
   * @param {() => any} fn
   * @returns {Promise<any>}  fn's result, or undefined when refused.
   */
  async function guard(cap, fn) {
    const verdict = await serverCheck({ permission: cap });
    if (!verdict || !verdict.allowed) return undefined;
    return fn();
  }

  return { can, gate, guard };
}
