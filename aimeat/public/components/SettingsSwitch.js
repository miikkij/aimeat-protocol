/**
 * @file public/components/SettingsSwitch.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A setting that is on or off: a checkbox and its words, on one line. Its look is
 *   css/components/settings-switch.css; the catalogue entry is `settings-switch`.
 * @structure SettingsSwitch({ checked, onChange, children })
 * @usage html`<${SettingsSwitch} checked=${on} onChange=${flip}>${t('home.settings.showAch')}<//>`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/settings-dialog.js with its markup unchanged (UI
 *     consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ checked: boolean, onChange: () => void, children?: any }} props */
export function SettingsSwitch({ checked, onChange, children }) {
  return html`
    <label class="poster-settings-switch">
      <input type="checkbox" checked=${checked} onChange=${onChange} />
      ${children}
    </label>`;
}

export default SettingsSwitch;
