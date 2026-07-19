/**
 * @file src/utils/app-mobile-lint.ts
 * @description Conservative, NON-BLOCKING static lint of a published app's HTML for the recurring
 *   "it overflows / looks tiny on a phone" class of bug. Returns human-readable hints (never blocks
 *   a publish) that the publish routes surface in the response, so the builder fixes them before
 *   users hit them. Deliberately high-confidence + low-noise — only patterns that are almost always
 *   a real mobile problem. The login-pill overflow class is prevented at the library level (the
 *   compact pill is default on app origins), so it is NOT re-checked here.
 * @structure lintAppHtmlForMobile(html) -> string[]
 * @usage import { lintAppHtmlForMobile } from '../utils/app-mobile-lint.js';
 * @version-history
 *   v1.0.0 — 2026-07-19 — initial: viewport-meta presence + width=device-width, and the CSS-grid
 *     1fr-blowout hint (appdev pitfall grid-track-blowout).
 */

/** High-confidence, non-blocking mobile hints for a published app's HTML. Empty = looks fine. */
export function lintAppHtmlForMobile(html: string): string[] {
  if (!html || typeof html !== 'string') return [];
  const hints: string[] = [];
  const lower = html.toLowerCase();
  const noWs = lower.replace(/\s+/g, '');

  // 1) Viewport meta — without it, phones render at desktop width and every font looks tiny.
  const viewport = lower.match(/<meta[^>]*name\s*=\s*["']viewport["'][^>]*>/);
  if (!viewport) {
    hints.push('No viewport meta tag — the app renders at desktop width on phones. Add: <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content">');
  } else if (!/width\s*=\s*device-width/.test(viewport[0])) {
    hints.push('The viewport meta is missing width=device-width — the app will not scale to the phone screen.');
  }

  // 2) CSS-grid 1fr blowout (appdev pitfall grid-track-blowout): a bare 1fr track with no
  //    minmax(0,…) or min-width:0 on children lets a wide non-wrapping child (table, <pre>, long
  //    code) inflate the track and overflow the whole page on mobile. Flag only when the safe
  //    idiom is entirely absent, to stay low-noise.
  if (noWs.includes('grid-template-columns') && noWs.includes('1fr')
      && !noWs.includes('minmax(0') && !noWs.includes('min-width:0')) {
    hints.push('CSS grid uses `1fr` tracks but no `minmax(0,1fr)` or `min-width:0` on children — a wide child (table, <pre>, long code) can inflate the track and overflow the page on mobile. See appdev pitfall grid-track-blowout.');
  }

  return hints;
}
