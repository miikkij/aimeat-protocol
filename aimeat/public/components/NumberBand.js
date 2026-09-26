/**
 * @file public/components/NumberBand.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The numbers of an account on the diagonal coral band with the sun stripe (the same
 *   band as the home's chat door): each number is a door to the page it counts, its word under it,
 *   the number turning sun under the pointer. With no numbers there is no band. A page passes the
 *   numbers and where each one leads; it never writes a class. Its look is
 *   css/components/number-band.css, under the component's own class names.
 * @structure NumberBand({ items: [{ key, icon, n, label, onOpen, fine }] })
 * @usage html`<${NumberBand} items=${[{ key: 'memory', icon: '🧠', n: 12, label: t('profile.stats.memories'), onOpen: () => go('memory') }]} />`
 * @version-history
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
export function NumberBand({ items = [] }) {
  const shown = (items || []).filter(Boolean);
  if (!shown.length) return null;
  return html`<div class="number-band"><div class="number-band-row">${shown.map((it) => html`
    <button type="button" key=${it.key} class="number-band-item" onClick=${it.onOpen}>
      <span class="number-band-icon" aria-hidden="true">${it.icon}</span>
      <span class=${'number-band-value poster-stat-number' + (it.fine ? ' number-band-value--fine' : '')}>${it.n}</span>
      <span class="number-band-label">${it.label}</span>
    </button>`)}</div></div>`;
}

export default NumberBand;
