/**
 * @file public/js/theme-choice.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A signed-in person's look (a theme and one of its styles), kept on their account so it
 *   follows them to every device (Jouni, 2026-09-24). The pill applies a choice at once and the
 *   shell's look script keeps it in the browser, as it always has; this file saves it to the account
 *   (PUT /v1/themes/choice) when the person makes it, and on every sign-in reads the account's
 *   choice and puts it on the page when it differs: at sign-in the account's choice wins.
 *
 *   It changes nothing when the operator decides the look for everybody, or when the account's
 *   choice is a theme the node no longer offers: then the node's own rule stands.
 * @structure loadThemeChoice() · watchThemeChoice()
 * @usage import { loadThemeChoice, watchThemeChoice } from '/js/theme-choice.js';
 *   watchThemeChoice(); loadThemeChoice(); window.addEventListener('aimeat-auth-change', loadThemeChoice);
 * @version-history
 *   v2.0.0 — 2026-09-24 — The choice is { theme, style } (07: a theme holds styles), read and worn
 *     through the shell's look script (window.__aimeatLook).
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4, Themes & Styles).
 */
import { apiGet, apiPut } from '/js/api.js';
import { getSession } from '/js/services/auth.js';
import { swallowed } from '/js/swallowed.js';

/** True while this file itself applies the account's choice, so that is not saved straight back. */
let applying = false;

/** The shell's look (spa.html), or null on a page without it. */
const look = () => (typeof window !== 'undefined' && /** @type {any} */ (window).__aimeatLook) || null;

/** Read the account's choice and put it on the page when the node offers it and it differs. */
export async function loadThemeChoice() {
  const L = look();
  const s = L?.state();
  if (!getSession() || !s || !s.personalChoice) return;
  try {
    const r = await apiGet('/v1/themes/choice');
    const theme = r?.data?.theme;
    const style = r?.data?.style;
    const offered = s.themes.find((t) => t.id === theme);
    if (!offered || !offered.styles.some((x) => x.id === style)) return;
    // Compare with the stored choice, not with what this page wears: a public page wears a built-in style.
    let storedTheme = null;
    let storedStyle = null;
    try { storedTheme = localStorage.getItem('aimeat-look-theme'); storedStyle = localStorage.getItem('aimeat-palette'); } catch (e) { swallowed('theme-choice: storage', e); }
    if (theme === storedTheme && style === storedStyle) return;
    applying = true;
    try { L.choose(theme, style); } finally { applying = false; }
  } catch (e) {
    swallowed('theme-choice: read', e);
  }
}

/** Save a choice the person makes in the pill to their account. Installed once. */
export function watchThemeChoice() {
  window.addEventListener('aimeat-palette-change', (ev) => {
    const detail = /** @type {CustomEvent} */ (ev)?.detail || {};
    const s = look()?.state();
    if (applying || !detail.theme || !detail.palette || !getSession() || !s?.personalChoice) return;
    apiPut('/v1/themes/choice', { theme: detail.theme, style: detail.palette }).catch((e) => swallowed('theme-choice: save', e));
  });
}
