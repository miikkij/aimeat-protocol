/**
 * @file ToggleSwitch.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Canonical on/off toggle switch (checkbox styled as a sliding pill).
 *   Relocated from profile/shared.js (where it was a mis-placed generic primitive)
 *   and de-`pf-`-prefixed. Renders the themed .toggle* classes so it flips with
 *   dark/light mode. profile/shared.js re-exports it for back-compat.
 * @structure ToggleSwitch({ checked, onChange, label? })
 * @usage import { ToggleSwitch } from '/components/ToggleSwitch.js';
 *   html`<${ToggleSwitch} checked=${on} onChange=${e => setOn(e.target.checked)} label=${t('x')} />`
 * @version-history
 *   v1.0.0 — 2026-06-02 — Component unification (#14): promote the toggle to /components,
 *     tokenize the off-state track (#D1D5DB → var(--border)) for dark mode.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);

/**
 * ToggleSwitch — accessible checkbox rendered as a sliding pill.
 * @param {{ checked: boolean, onChange: (e: Event) => void, label?: any }} props
 */
export function ToggleSwitch({ checked, onChange, label }) {
  return html`<label class="toggle">
    <input type="checkbox" checked=${checked} onChange=${onChange} class="toggle-input" />
    <span class="toggle-slider"></span>
    ${label && html`<span class="toggle-label">${label}</span>`}
  </label>`;
}
