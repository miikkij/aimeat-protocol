/**
 * @file public/components/SettingsAccount.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The account actions in a settings dialog: a section (poster.css .poster-section)
 *   whose headline slab runs the full width, then the actions one per line, each at least 44px
 *   high, wrapping on a phone. Its look is css/components/settings-account.css; the catalogue
 *   entry is `settings-account`.
 * @structure SettingsAccount({ title, children })
 * @usage html`<${SettingsAccount} title=${t('homeJourney.account')}><button class="poster-action" …/><//>`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/settings-dialog.js with its markup unchanged (UI
 *     consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ title: any, children?: any }} props */
export function SettingsAccount({ title, children }) {
  return html`
    <section class="poster-section poster-settings-account">
      <h3 class="poster-section-title">${title}</h3>
      ${children}
    </section>`;
}

export default SettingsAccount;
