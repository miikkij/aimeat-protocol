/**
 * @file public/components/OwnAimeat.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A demo site's one prompt to buy: a record-face card with its small label, the
 *   headline, one paragraph and the loud way to the store, which opens beside. The operator adds
 *   it to a demo site's home; no built-in home has it. A page passes the words and the store's
 *   address; it never writes a class. Its look is css/components/own-aimeat.css and the record and
 *   slab shapes of css/poster.css.
 * @structure OwnAimeat({ label, title, text, cta, href })
 * @usage html`<${OwnAimeat} href=${store} label=${…} title=${…} text=${…} cta=${…} />`
 * @version-history
 *   v1.0.0 — 2026-09-27 — The markup views/surface/blocks-home.js OwnAimeatBlock wrote, moved here
 *     unchanged so the block passes data (page group G9, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** Nothing without an address: a stored layout can outlive the store it was made under. */
export function OwnAimeat({ label, title, text, cta, href }) {
  if (!href) return null;
  return html`
    <section class="poster-own-aimeat poster-record">
      <span class="poster-label">${label}</span>
      <h2 class="poster-record-title poster-record-title--small">
        ${title}
      </h2>
      <p class="poster-own-aimeat-text">
        ${text}
      </p>
      <a class="poster-own-aimeat-cta poster-slab" href=${href} target="_blank" rel="noopener">
        ${cta}
      </a>
    </section>`;
}

export default OwnAimeat;
