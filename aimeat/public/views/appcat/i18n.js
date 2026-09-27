/**
 * @file public/views/appcat/i18n.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The words of appcat. Every key is the old catalogue's own key (src/static/app-catalog/
 *   js/i18n-data.js) under the `appcat.` prefix in locales/{en,fi,es}.json, so the same words show.
 *   x(key, vars) reads one; dateLocale() is the locale dates and counts use (fi-FI on a Finnish page,
 *   es-ES on a Spanish one, the browser's own on an English page), as the old page did.
 * @structure x(key, vars) · dateLocale() · lang()
 * @usage import { x } from '/views/appcat/i18n.js'; x('header.title')
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial (appcat).
 */
import { t, getLocale } from '/js/i18n.js';

/** One word of appcat: the old catalogue's key under `appcat.`. */
export function x(key, vars) {
  return t('appcat.' + key, vars);
}

/** The page language: 'en' | 'fi' | 'es'. */
export function lang() {
  const l = getLocale();
  return l === 'fi' || l === 'es' ? l : 'en';
}

/** The locale for dates and counts. */
export function dateLocale() {
  const l = lang();
  if (l === 'fi') return 'fi-FI';
  if (l === 'es') return 'es-ES';
  return undefined;
}
