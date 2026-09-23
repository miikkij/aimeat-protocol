/**
 * @file public/components/SettingsStack.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The inside of a settings dialog: its sections in one column. Its look is
 *   css/components/settings-stack.css (which also spaces the start-page setting a dialog holds);
 *   the catalogue entry is `settings-stack`.
 * @structure SettingsStack({ children })
 * @usage html`<${Modal} …><${SettingsStack}><section class="poster-section">…</section><//><//>`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/settings-dialog.js with its markup unchanged (UI
 *     consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

export function SettingsStack({ children }) {
  return html`<div class="poster-settings">${children}</div>`;
}

export default SettingsStack;
