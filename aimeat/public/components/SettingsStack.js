/**
 * @file public/components/SettingsStack.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The inside of a settings dialog: its sections in one column. Its look is
 *   css/components/settings-stack.css (which also spaces the start-page setting a dialog holds);
 *   the catalogue entry is `settings-stack`.
 * @structure SettingsStack({ children }) · SettingsSection({ title, children })
 * @usage html`<${Modal} …><${SettingsStack}><${SettingsSection} title=${…}>…<//><//><//>`
 * @version-history
 *   v1.1.0 — 2026-09-27 — SettingsSection: a section of the dialog under its slab, so the page writes
 *     no section markup (additive, page group G9).
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/settings-dialog.js with its markup unchanged (UI
 *     consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

export function SettingsStack({ children }) {
  return html`<div class="poster-settings">${children}</div>`;
}

/**
 * One section of a settings dialog (added by page group G9): its headline slab (poster.css
 * .poster-section, .poster-section-title), then what it holds. The markup the home settings dialog
 * wrote for its appearance section, unchanged.
 */
export function SettingsSection({ title, children }) {
  return html`
    <section class="poster-section">
      <h3 class="poster-section-title">${title}</h3>
      ${children}
    </section>`;
}

export default SettingsStack;
