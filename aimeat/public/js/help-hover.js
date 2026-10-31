/**
 * @file public/js/help-hover.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether the help on a word opens while the pointer rests on it: the person's choice
 *   in their home.prefs record (`helpOnHover`, on unless they turned it off), written onto
 *   <html data-help-hover="off"> when off. The shell applies it from the record it already reads for
 *   the margin pattern (js/margin-pattern.js), so a page load makes no second request; the home
 *   settings dialog applies it the moment the switch moves. components/HelpTip.js asks
 *   helpHoverOn() each time a word's tooltip would open, so the switch takes effect without a
 *   re-render. Clicking the word opens the explanation either way.
 * @structure helpHoverOf(prefs) · applyHelpHover(on) · helpHoverOn()
 * @usage
 *   import { helpHoverOf, applyHelpHover, helpHoverOn } from '/js/help-hover.js';
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (wish-ohje-sanan-p-ll-kysymysmerkkikursori-viiveell-tooltip-ja-kli).
 */

/**
 * The choice a prefs record carries: on unless the person turned it off.
 * @param {Record<string, unknown>|null|undefined} prefs
 */
export function helpHoverOf(prefs) {
  return !(prefs && prefs.helpOnHover === false);
}

/** Put the choice on the page. @param {boolean} on */
export function applyHelpHover(on) {
  if (on) delete document.documentElement.dataset.helpHover;
  else document.documentElement.dataset.helpHover = 'off';
}

/** Whether a word's tooltip may open now. */
export function helpHoverOn() {
  return document.documentElement.dataset.helpHover !== 'off';
}
