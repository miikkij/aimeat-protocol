/**
 * @file public/components/MoveButtons.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two buttons that move a thing one place up or down in its list: two drawn
 *   chevrons, each named for a screen reader and in its tooltip; the first thing cannot go up and
 *   the last cannot go down, so that button is off. Stacked by default (at a row's start); `across`
 *   stands them side by side (at a row's end). A page passes what happens and the two names; it
 *   never writes a class. Its look is css/components/move-buttons.css (main's Portal .adm-pt-move).
 * @structure MoveButtons({ onUp, onDown, first, last, upLabel, downLabel, across })
 * @usage html`<${MoveButtons} first=${i === 0} last=${i === n - 1} onUp=${() => move(i, -1)} onDown=${() => move(i, 1)}
 *          upLabel=${x('moveUp')} downLabel=${x('moveDown')} />`
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial: the Portal page's part and menu arrows (main's .adm-pt-move and
 *     .adm-pt-move--menu) as a component (admin group G2).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** The arrows are drawn, not typed: an arrow glyph in a button is not an icon. */
const UP = html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>`;
const DOWN = html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>`;

/** @param {{ onUp: () => void, onDown: () => void, first?: boolean, last?: boolean, upLabel: string, downLabel: string, across?: boolean }} props */
export function MoveButtons({ onUp, onDown, first, last, upLabel, downLabel, across }) {
  return html`
    <span class=${across ? 'move-buttons move-buttons--across' : 'move-buttons'}>
      <button type="button" disabled=${!!first} onClick=${onUp} title=${upLabel} aria-label=${upLabel}>${UP}</button>
      <button type="button" disabled=${!!last} onClick=${onDown} title=${downLabel} aria-label=${downLabel}>${DOWN}</button>
    </span>`;
}

export default MoveButtons;
