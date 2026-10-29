/**
 * @file public/components/LayoutSketch.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A small wireframe of a screen: rows of framed blocks, each block as wide as its share
 *   of the row and named in small typewriter words, so a person sees the shape of a layout before
 *   anything is built. The app structure page draws one for every layout preset and every navigation
 *   mode the node offers (views/appcat/structure-pick.js), and the preset's own blocks decide the
 *   rows, so a preset added to the node is drawn with no change here.
 *
 *   `rows`: [{ height, cells: [{ w, label, tone }] }]. `height` is 's' (a thin strip), 'm' (a band)
 *   or 'l' (the rest of the sketch). `w` is 'full', 'main' (two shares), 'side' (one share), 'half'
 *   or 'tiny' (a fixed narrow strip). `tone` is 'ink' (the bar or the band at the top) or 'sun' (the
 *   part the shape is about).
 * @structure LayoutSketch({ rows, label })
 * @usage html`<${LayoutSketch} label="Dashboard" rows=${[{ height: 'm', cells: [{ w: 'full', label: 'numbers' }] }]} />`
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (wish-sovelluksen-rakenne-ja-tila-sivu-luonnoksesta-asti-josta-voi).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);
const HEIGHTS = new Set(['s', 'm', 'l']);
const WIDTHS = new Set(['full', 'main', 'side', 'half', 'tiny']);
const TONES = new Set(['ink', 'sun']);

export function LayoutSketch({ rows = [], label }) {
  return html`<span class="layout-sketch" role="img" aria-label=${label}>
    ${rows.map((r, i) => html`<span key=${i} class=${`layout-sketch-row layout-sketch-row--${HEIGHTS.has(r.height) ? r.height : 'm'}`}>
      ${(r.cells || []).map((c, j) => html`<span key=${j}
        class=${['layout-sketch-cell', `layout-sketch-cell--${WIDTHS.has(c.w) ? c.w : 'full'}`, TONES.has(c.tone) ? `layout-sketch-cell--${c.tone}` : ''].join(' ').trim()}>${c.label || ''}</span>`)}
    </span>`)}
  </span>`;
}

export default LayoutSketch;
