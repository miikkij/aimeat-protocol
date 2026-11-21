/**
 * @file atelier/mosaic-motion.js
 * @description The mosaic's two View-Transition moves, extracted whole from mosaic.js (pure
 *   extraction under the 800-line rule — the lines are mosaic's own, unchanged): `transition`
 *   swaps visible units through a View Transition when the browser has one, and `morph` is the
 *   shared-element move — the element that exists on both sides of the change carries one
 *   view-transition-name for the duration, so a tile grows into the full screen instead of
 *   crossfading. Both fall back to the plain swap without View Transitions or under reduced
 *   motion.
 * @structure startTransition(run) · transition(run) · morph(moving, run)
 * @usage  import { transition, morph } from './mosaic-motion.js';
 * @version-history
 *   v0.70.0 — 2026-11-21 — startTransition(): every View Transition the kit starts catches its
 *     ready, finished and updateCallbackDone promises, so a transition the browser skips is no
 *     "Uncaught (in promise) AbortError" in the app's console. morph() ends with then(done, done).
 *   v0.32.0 — 2026-08-29 — Extracted from mosaic.js when the scene3d case pushed it past the
 *     800-line rule. No behaviour change.
 */
import { reducedMotion } from './dom.js';

/** A promise's rejection is handled, so a skipped transition is no unhandled rejection. */
const quiet = function () { /* a skipped or overtaken transition: the swap still happened */ };

/**
 * Start a View Transition whose three promises are all caught. A transition the browser skips (a
 * hidden tab, a second change on top of this one, the same name on two elements) rejects `ready`
 * with an AbortError, and an uncaught `ready` is an "Uncaught (in promise)" error in the app's
 * console that no app code started. `finished` and `updateCallbackDone` reject when `run` throws;
 * the throw itself is still the app's to see, through the returned handle.
 * @param {() => unknown} run
 * @returns {any} the ViewTransition
 */
export function startTransition(run) {
  const vt = /** @type {any} */ (document).startViewTransition(run);
  for (const p of [vt && vt.ready, vt && vt.finished, vt && vt.updateCallbackDone]) {
    if (p && typeof p.catch === 'function') p.catch(quiet);
  }
  return vt;
}

/** Swap visible units through a View Transition when the browser has one. */
export function transition(run) {
  if (typeof document.startViewTransition === 'function' && !reducedMotion()) {
    startTransition(run);
  } else {
    run();
  }
}

/**
 * The SHARED-ELEMENT morph: the element that exists on both sides of the change carries one
 * view-transition-name for the duration, so the browser animates it from where it WAS to where
 * it IS — a tile grows into the full screen instead of crossfading. Falls back to the plain
 * swap when the browser has no View Transitions or the person asked for reduced motion.
 * @param {HTMLElement} moving @param {() => void} run
 */
export function morph(moving, run) {
  if (typeof document.startViewTransition !== 'function' || reducedMotion()) { run(); return; }
  moving.style.viewTransitionName = 'ak-morph';
  const vt = startTransition(run);
  // then(done, done), not finally(): finally() hands the rejection of a skipped move on to a new
  // promise nobody catches.
  const done = function () { moving.style.viewTransitionName = ''; };
  vt.finished.then(done, done);
}
