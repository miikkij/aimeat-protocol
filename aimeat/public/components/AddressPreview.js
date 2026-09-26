/**
 * @file public/components/AddressPreview.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The address preview: one grey typewriter line under a name field that shows the
 *   address the name will get as it is typed, the address in coral, and whether it is free; a taken
 *   address says why in the danger colour; while the node checks, an ellipsis. A page passes the
 *   words; it never writes a class. Its look is css/components/address-preview.css
 *   (.address-preview).
 * @structure AddressPreview({ label, address, state, free, taken })
 * @usage html`<${AddressPreview} label=${c('addressPreview')} address=${avail?.address || slug}
 *   state=${!avail ? 'checking' : avail.available ? 'free' : 'taken'} free=${c('free')} taken=${reasonWords} />`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the Companies page's address preview as a component, same markup
 *     (page group G8).
 *   v1.1.0 — 2026-09-27 — Draws its own name: .co-preview is .address-preview (a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** `state`: 'checking' (…) | 'free' (the `free` words) | 'taken' (the `taken` words, in the danger colour). */
export function AddressPreview({ label, address, state, free, taken }) {
  const said = state === 'free' ? free : state === 'taken' ? html`<span class="taken">${taken}</span>` : '…';
  return html`<p class="address-preview">${label}: <b>${address}</b> · ${said}</p>`;
}

export default AddressPreview;
