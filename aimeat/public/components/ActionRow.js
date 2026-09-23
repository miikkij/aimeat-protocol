/**
 * @file public/components/ActionRow.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A row of actions that becomes one per line on a phone. Its look is
 *   css/components/action-row.css; the catalogue entry is `action-row`.
 * @structure ActionRow({ children })
 * @usage html`<${ActionRow}><button …/><//>`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/home with its markup unchanged (UI consolidation
 *     phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

export function ActionRow({ children }) {
  return html`<div class="poster-actions">${children}</div>`;
}

export default ActionRow;
