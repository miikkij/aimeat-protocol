/**
 * @file public/components/QuietNote.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A quiet line, inside a row, where the row has nothing to show yet. Its look is
 *   css/components/quiet-note.css; the catalogue entry is `quiet-note`.
 * @structure QuietNote({ children })
 * @usage html`<${QuietNote}>${t('home.apps.noneOpened')}<//>`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/status-parts.js with its markup unchanged (UI
 *     consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

export function QuietNote({ children }) {
  return html`<span class="poster-quiet">${children}</span>`;
}

export default QuietNote;
