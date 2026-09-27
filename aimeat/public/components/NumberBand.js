/**
 * @file public/components/NumberBand.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The numbers of an account on the diagonal coral band with the sun stripe (the same
 *   band as the home's chat door): each number is a door to the page it counts, its word under it,
 *   the number turning sun under the pointer. With no numbers there is no band. A page passes the
 *   numbers and where each one leads; it never writes a class. Its look is
 *   css/components/number-band.css, under the component's own class names.
 *
 *   `fitted` (added for appcat): the app catalogue's band (the old page's .cat-band): the stripe is as
 *   tall as its numbers, so a second row of numbers (the detail's five) still stands on the coral, the
 *   sun stripe runs near its foot, and on a phone the band is a solid coral block in two columns with
 *   the sun flat along its foot. In it a number without `onOpen` only says its figure (no door).
 * @structure NumberBand({ items: [{ key, icon, n, label, onOpen, fine }], fitted })
 * @usage html`<${NumberBand} items=${[{ key: 'memory', icon: '🧠', n: 12, label: t('profile.stats.memories'), onOpen: () => go('memory') }]} />`
 *        html`<${NumberBand} fitted items=${[{ key: 'apps', n: 30, label: x('band.apps') }]} />`
 * @version-history
 *   v1.2.0 — 2026-09-27 — `fitted`: the app catalogue's band, whose numbers are figures, not doors
 *     (appcat); additive, number-band.css .number-band--fitted.
 *   v1.1.0 — 2026-09-27 — Its own class names (number-band-*), no longer the overview's old
 *     .pf-lp-stat* names; the words and numbers read the band's own ink, so a theme whose ground and
 *     accent are close (Pebble) still shows them.
 *   v1.0.0 — 2026-09-26 — Initial: the Settings overview's band (ProfileCard's stats in
 *     views/profile/landing-page.cards.js) as a component, same markup (page group G8).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** `fine` marks a number that counts something earned (morsels); `icon` is said to nobody. */
export function NumberBand({ items = [], fitted }) {
  const shown = (items || []).filter(Boolean);
  if (!shown.length) return null;
  const inner = (it) => html`
      <span class="number-band-icon" aria-hidden="true">${it.icon}</span>
      <span class=${'number-band-value poster-stat-number' + (it.fine ? ' number-band-value--fine' : '')}>${it.n}</span>
      <span class="number-band-label">${it.label}</span>`;
  // fitted (added for appcat): a number with no door is a figure, not a button.
  return html`<div class=${'number-band' + (fitted ? ' number-band--fitted' : '')}><div class="number-band-row">${shown.map((it) => (fitted && !it.onOpen
    ? html`<div key=${it.key} class="number-band-item number-band-item--figure">${inner(it)}</div>`
    : html`<button type="button" key=${it.key} class="number-band-item" onClick=${it.onOpen}>${inner(it)}</button>`))}</div></div>`;
}

export default NumberBand;
