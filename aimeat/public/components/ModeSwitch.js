/**
 * @file public/components/ModeSwitch.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A small group of fold buttons (components/FoldButton.js) that chooses what a row
 *   shows, beside the row's content. Its look is css/components/mode-switch.css; the catalogue
 *   entry is `mode-switch`.
 * @structure ModeSwitch({ label, children })
 * @usage html`<${ModeSwitch} label=${t('home.apps.modeLabel')}><${FoldButton} on …/>…<//>`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/status-parts.js with its markup unchanged (UI
 *     consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ label: string, children?: any }} props */
export function ModeSwitch({ label, children }) {
  return html`<span class="poster-mode-switch" role="group" aria-label=${label}>${children}</span>`;
}

export default ModeSwitch;
