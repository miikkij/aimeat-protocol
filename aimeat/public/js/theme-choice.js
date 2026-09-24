/**
 * @file public/js/theme-choice.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A signed-in person's theme choice, kept on their account so it follows them to every
 *   device (Jouni, 2026-09-24). The pill applies a choice at once and keeps it in the browser, as it
 *   always has; this file saves it to the account (PUT /v1/themes/choice) when the person makes it,
 *   and on every sign-in reads the account's choice and puts it on the page when it differs.
 *
 *   It changes nothing when the operator shows one theme to everybody, or when the account's choice
 *   is a theme the node no longer offers: then the node's own rule stands.
 * @structure loadThemeChoice() · watchThemeChoice()
 * @usage import { loadThemeChoice, watchThemeChoice } from '/js/theme-choice.js';
 *   watchThemeChoice(); loadThemeChoice(); window.addEventListener('aimeat-auth-change', loadThemeChoice);
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4, Themes & Styles).
 */
import { apiGet, apiPut } from '/js/api.js';
import { getSession, getPalette, setPalette } from '/js/services/auth.js';
import { swallowed } from '/js/swallowed.js';

/** True while this file itself applies the account's choice, so that is not saved straight back. */
let applying = false;

/** The node's themes as the shell received them before the first paint (portal-spa.ts). */
const nodeThemes = () => (typeof window !== 'undefined' && /** @type {any} */ (window).__AIMEAT_THEMES) || null;

/** Read the account's choice and put it on the page when the node offers it and it differs. */
export async function loadThemeChoice() {
  const T = nodeThemes();
  if (!getSession() || !T || !T.policy || !T.policy.personalChoice) return;
  try {
    const r = await apiGet('/v1/themes/choice');
    const chosen = r?.data?.theme;
    const offered = (T.themes || []).map((t) => t.id);
    const current = getPalette();
    if (!chosen || !offered.includes(chosen) || chosen === current) return;
    applying = true;
    try { setPalette(chosen); } finally { applying = false; }
  } catch (e) {
    swallowed('theme-choice: read', e);
  }
}

/** Save a choice the person makes in the pill to their account. Installed once. */
export function watchThemeChoice() {
  window.addEventListener('aimeat-palette-change', (ev) => {
    const T = nodeThemes();
    const id = /** @type {CustomEvent} */ (ev)?.detail?.palette;
    if (applying || !id || !getSession() || !T?.policy?.personalChoice) return;
    apiPut('/v1/themes/choice', { theme: id }).catch((e) => swallowed('theme-choice: save', e));
  });
}
