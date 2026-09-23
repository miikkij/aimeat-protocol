/**
 * @file public/components/NamedValue.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A named value on one line: what it is, the value in bold, and a quiet way to change
 *   it. Its look is css/components/named-value.css; the catalogue entry is `named-value`.
 * @structure NamedValue({ label, value, renameLabel, onRename })
 * @usage html`<${NamedValue} label=${t('…')} value=${name} renameLabel=${t('…')} onRename=${edit} />`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/step-agent.js with its markup unchanged (UI
 *     consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ label: any, value: any, renameLabel: any, onRename: () => void }} props */
export function NamedValue({ label, value, renameLabel, onRename }) {
  return html`
        <div class="poster-named">
          <span class="poster-named-label">${label}</span>
          <strong class="poster-named-value">${value}</strong>
          <button type="button" class="btn-ghost poster-named-rename" onClick=${onRename}>
            ${renameLabel}
          </button>
        </div>`;
}

export default NamedValue;
