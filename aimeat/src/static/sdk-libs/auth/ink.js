/**
 * @file auth/ink.js
 * @description The two colours every served auth surface (the pill, its control cluster, the
 *   sign-in dialog) is drawn with: --aimeat-ink for words and frames, --aimeat-paper for the
 *   ground behind them. Each reads the page's own token first (--text / --bg), then a fallback
 *   THAT FOLLOWS THE THEME: ink on paper in the light, paper-dark and light words in the dark.
 *   The fallback used to be light whatever the theme, and an app that set --text for its dark
 *   theme but never named --bg got a pale slab with pale words on it (the KOTILO case, 2026-08-29).
 *   Dark is read from <html data-theme="dark"> first, then from the system preference when the
 *   page has not said either way.
 * @structure inkVarsCss(roots) — the rules that define both variables on the given root selectors.
 * @usage import { inkVarsCss } from './ink.js';  st.textContent = inkVarsCss(['.aimeat-auth-wrap']) + …
 * @version-history
 *   v1.0.0 — 2026-08-29 — Initial.
 */

var LIGHT = '--aimeat-ink:var(--aimeat-pill-fg,var(--text,#1A1A2E));--aimeat-paper:var(--aimeat-pill-bg,var(--bg,#FAFAF8))';
var DARK = '--aimeat-ink:var(--aimeat-pill-fg,var(--text,#EDEEF2));--aimeat-paper:var(--aimeat-pill-bg,var(--bg,#14151A))';

/**
 * @param {string[]} roots CSS selectors of the elements the variables are defined on.
 * @returns {string} CSS text.
 */
export function inkVarsCss(roots) {
  var light = roots.join(',');
  var dark = roots.map(function (r) { return 'html[data-theme="dark"] ' + r; }).join(',');
  var system = roots.map(function (r) { return 'html:not([data-theme="light"]) ' + r; }).join(',');
  return light + '{' + LIGHT + '}'
    + dark + '{' + DARK + '}'
    + '@media (prefers-color-scheme:dark){' + system + '{' + DARK + '}}';
}
