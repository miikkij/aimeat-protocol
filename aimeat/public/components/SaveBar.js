/**
 * @file public/components/SaveBar.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The row that keeps work that is not saved yet, and the one button that saves it, in
 *   sight wherever the page is scrolled: it stays pinned under the top bar, on the surface ground with
 *   the coral edge at its left, its parts in one wrapping line. A page passes what stands in it (the
 *   loud save, how many changes wait, the ways to see or undo them, a hint); it never writes a class.
 *   Its look is css/components/save-bar.css (main's Portal pinned row, .adm-pt-pin).
 * @structure SaveBar({ label, children })
 * @usage html`<${SaveBar}><${Loud} control onClick=${save}>${x('save')}<//><${Tinted} strong tone="notice">${x('unsaved', { n })}<//>…<//>`
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial: the Portal page's pinned save row as a component (admin group G2).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ label?: string, children?: any }} props */
export function SaveBar({ label, children }) {
  return html`<div class="save-bar" role="region" aria-label=${label}>${children}</div>`;
}

export default SaveBar;
