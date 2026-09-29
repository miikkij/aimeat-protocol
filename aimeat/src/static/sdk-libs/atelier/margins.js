/**
 * @file atelier/margins.js
 * @description THE MARGINS switch: a quiet figure on the empty sides of a wide app frame, so the eye
 *   settles on the middle (wish reunakuvio, 2026-09-29). The figures are the node's own margin
 *   patterns, the ones a person picks for their home (home.prefs `marginPattern`), drawn by
 *   /lib/aimeat-atelier/margins.css on the kit's tokens. This module only puts a choice on the page:
 *   it fetches nothing, like the rest of the shell.
 *
 *   To wear the margins the person chose for their home, the app reads the record itself and hands
 *   it over: `AIMEAT.atelier.margins(AIMEAT.atelier.marginsOf(await AIMEAT.data.get('home.prefs')))`.
 *   `app({ margins: 'b' })` puts a fixed choice on at start.
 * @structure MARGINS · margins(choice) · marginsOf(prefs)
 * @usage  AIMEAT.atelier.margins('b');   // the hatch; '' or false turns them off
 * @version-history
 *   v0.1.0 — 2026-09-29 — Initial.
 */

/** The eight figures, as the node's home settings list them: pixel grid, hatch, registration
 *  marks, hearts, cubes, chevron, weave, lattice. */
export const MARGINS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

/** What a person gets on the node's own pages before they have chosen. */
const DEFAULT_MARGIN = 'a';

/**
 * Put a figure on the page's empty sides, or take it off ('' , false or anything unknown).
 * @param {string|boolean|null|undefined} choice
 * @returns {string} the figure now on, '' for none
 */
export function margins(choice) {
  const v = typeof choice === 'string' ? choice.toLowerCase() : '';
  const root = document.documentElement;
  if (MARGINS.indexOf(v) >= 0) { root.setAttribute('data-ak-margins', v); return v; }
  root.removeAttribute('data-ak-margins');
  return '';
}

/**
 * The figure a person's home.prefs record names: the default when they never chose, '' when they
 * turned the margins off. The same reading the node's own pages make.
 * @param {Record<string, any>|null|undefined} prefs
 * @returns {string}
 */
export function marginsOf(prefs) {
  const v = prefs && typeof prefs.marginPattern === 'string' ? prefs.marginPattern : undefined;
  return v === undefined ? DEFAULT_MARGIN : v;
}
