/**
 * @file public/components/WaitingNote.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A dashed note whose whole job is to say the next move is in another window: a
 *   pulsing coral dot, a bold line, and what happens next. Its look is
 *   css/components/waiting-note.css (the pulse is poster.css's); the catalogue entry is
 *   `waiting-note`.
 * @structure WaitingNote({ title, children })
 * @usage html`<${WaitingNote} title=${t('home.agent.waitTitle')}>${t('home.agent.waitBody')}<//>`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/step-agent.js with its markup unchanged (UI
 *     consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ title: any, children?: any }} props */
export function WaitingNote({ title, children }) {
  return html`
          <div class="poster-aside poster-aside--waiting poster-waiting" role="status">
            <div class="poster-waiting-dot" aria-hidden="true"></div>
            <div>
              <p class="poster-waiting-title">${title}</p>
              <p class="poster-waiting-body">
                ${children}
              </p>
            </div>
          </div>`;
}

export default WaitingNote;
