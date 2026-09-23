/**
 * @file public/components/ModeTabs.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two or three ways of doing one thing, as a tab list of buttons; the chosen one in an
 *   outline with coral words, the others quiet. Its look is css/components/mode-tabs.css; the
 *   catalogue entry is `mode-tabs`.
 * @structure ModeTabs({ children }) · ModeTab({ on, onClick, children })
 * @usage html`<${ModeTabs}><${ModeTab} on=${mode === 'a'} onClick=${…}>…<//><//>`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/step-agent.js with its markup unchanged (UI
 *     consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

export function ModeTabs({ children }) {
  return html`
        <div class="poster-modes" role="tablist">
          ${children}
        </div>`;
}

/** @param {{ on: boolean, onClick: () => void, children?: any }} props */
export function ModeTab({ on, onClick, children }) {
  return html`
          <button type="button" role="tab" aria-selected=${on}
            class=${on ? 'btn-outline poster-mode--on' : 'btn-ghost'}
            onClick=${onClick}>
            ${children}
          </button>`;
}

export default ModeTabs;
