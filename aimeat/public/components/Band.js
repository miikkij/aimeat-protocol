/**
 * @file public/components/Band.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A section of a page: the headline on an ink slab (poster.css
 *   .poster-section-title--large) and the rows under it, with the space between bands doing the
 *   grouping. `tight` is the layout engine's cut (1.3rem between rows where the home's own bands
 *   have 1.5rem). BandNote is the one quiet line that closes a band. Its look is
 *   css/components/band.css; the catalogue entry is `band`.
 * @structure Band({ title, tight, children }) · BandNote({ children })
 * @usage html`<${Band} title=${t('home.things.title')}><${NamedRow} …/><//>`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/status-parts.js and views/surface/renderer.js
 *     with its markup unchanged (UI consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ title?: any, tight?: boolean, children?: any }} props */
export function Band({ title, tight = false, children }) {
  return html`
    <section class=${tight ? 'poster-band poster-band--tight' : 'poster-band'}>
      ${title ? html`<h2 class="poster-section-title poster-section-title--large">${title}</h2>` : ''}
      ${children}
    </section>`;
}

/** The one quiet line that closes a band. */
export function BandNote({ children }) {
  return html`<p class="poster-band-note">${children}</p>`;
}

export default Band;
