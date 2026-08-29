/**
 * @file atelier/mosaic-motion.js
 * @description The mosaic's two View-Transition moves, extracted whole from mosaic.js (pure
 *   extraction under the 800-line rule — the lines are mosaic's own, unchanged): `transition`
 *   swaps visible units through a View Transition when the browser has one, and `morph` is the
 *   shared-element move — the element that exists on both sides of the change carries one
 *   view-transition-name for the duration, so a tile grows into the full screen instead of
 *   crossfading. Both fall back to the plain swap without View Transitions or under reduced
 *   motion.
 * @structure transition(run) · morph(moving, run)
 * @usage  import { transition, morph } from './mosaic-motion.js';
 * @version-history
 *   v0.32.0 — 2026-08-29 — Extracted from mosaic.js when the scene3d case pushed it past the
 *     800-line rule. No behaviour change.
 */
import { reducedMotion } from './dom.js';

/** Swap visible units through a View Transition when the browser has one. */
export function transition(run) {
  if (typeof document.startViewTransition === 'function' && !reducedMotion()) {
    document.startViewTransition(run);
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
  const vt = document.startViewTransition(run);
  vt.finished.finally(function () { moving.style.viewTransitionName = ''; });
}
