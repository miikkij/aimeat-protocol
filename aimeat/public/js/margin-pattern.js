/**
 * @file public/js/margin-pattern.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The margin pattern's one switch: reads the person's choice from their home.prefs
 *   record and writes it onto <html data-margin-pattern="a".."h">, which css/margin-pattern.css
 *   turns into the strips on the home, the chat and the settings pages. No attribute, no strips.
 *   The shell calls load() once the session is known and again on every sign-in change; the home
 *   settings dialog calls apply() the moment a choice is made, so the page answers before the
 *   record is even saved.
 * @structure MARGIN_PATTERNS · applyMarginPattern(choice) · loadMarginPattern()
 * @usage
 *   import { loadMarginPattern, applyMarginPattern, MARGIN_PATTERNS } from '/js/margin-pattern.js';
 * @version-history
 *   v1.1.0 — 2026-09-15 — A visitor with no session gets the default pattern, for the front page's margins.
 *   v1.0.0 — 2026-08-29 — Initial.
 */
import { apiGet } from '/js/api.js';
import { getSession } from '/js/services/auth.js';
import { swallowed } from '/js/swallowed.js';

/** The eight patterns, in the order the settings dialog lists them. The name key is a locale key. */
export const MARGIN_PATTERNS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

/** What a new account gets before it has chosen: the pixel grid, on. */
export const DEFAULT_MARGIN_PATTERN = 'a';

/**
 * Put a choice on the page. '' or anything unknown means off.
 * @param {string|undefined|null} choice
 */
export function applyMarginPattern(choice) {
  const v = typeof choice === 'string' ? choice.toLowerCase() : '';
  if (MARGIN_PATTERNS.includes(v)) document.documentElement.dataset.marginPattern = v;
  else delete document.documentElement.dataset.marginPattern;
}

/**
 * The choice a prefs record carries: undefined means the person has never chosen (the default
 * applies), '' means they turned it off.
 * @param {Record<string, unknown>|null|undefined} prefs
 */
export function marginPatternOf(prefs) {
  const v = prefs && typeof prefs.marginPattern === 'string' ? prefs.marginPattern : undefined;
  return v === undefined ? DEFAULT_MARGIN_PATTERN : v;
}

/**
 * Read the record and apply it. Signed out, there is no record: the default pattern goes on, and
 * only the pages that declare strip widths (the front page) show it, so a visitor sees the front
 * page wearing the same margins as the home and every other public page looks as before.
 */
export async function loadMarginPattern() {
  if (!getSession()) { applyMarginPattern(DEFAULT_MARGIN_PATTERN); return; }
  try {
    const r = await apiGet('/v1/memory/home.prefs?soft=1');
    const prefs = r?.data?.exists === false ? {} : (r?.data?.value ?? {});
    applyMarginPattern(marginPatternOf(prefs));
  } catch (e) {
    swallowed('margin-pattern: prefs', e);
    applyMarginPattern(DEFAULT_MARGIN_PATTERN);
  }
}
