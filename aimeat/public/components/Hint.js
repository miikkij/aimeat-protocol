/**
 * @file public/components/Hint.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A quiet line of help under a control or a choice. Its look is
 *   css/components/hint.css; the catalogue entry is `hint`.
 * @structure Hint({ children })
 * @usage html`<${Hint}>${t('…')}<//>`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/home with its markup unchanged (UI consolidation
 *     phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

export function Hint({ children }) {
  return html`<p class="poster-hint">${children}</p>`;
}

export default Hint;
