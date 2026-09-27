/**
 * @file public/components/Stops.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where a piece of work stands, as the stops it passes: one row per stop under the heavy
 *   rule, its name in the coral label, where it stands now in the poster figures (on the sun when it
 *   is the stop that holds the work now), and one line of what that means for who can see it. The
 *   rows are as wide as the widest of them, not the column. Under the rows, a picture of the thing
 *   (cut from its top, in the heavy frame, at most 260×160, gone when it does not load); then `lead`,
 *   the sentence of what to do next, set in under the figures; then the children (the doors, at the
 *   column's start); then `foot`, a small typewriter line set in under the figures (a size). A page
 *   passes the stops and the words; it never writes a class. Its look is css/components/stops.css.
 * @structure Stops({ items, picture, lead, foot, children })
 * @usage html`<${Stops} items=${[{ key: 'wc', label: x('wc.title'), value: x('wc.savedEarlier'), note: x('wc.privateNote'), on: true },
 *          { key: 'pub', label: x('wc.published'), value: 'v4', note: x('wc.visibleToOthers') }]}
 *          picture=${{ src: shot }} lead=${x('wc.explainSaved')} foot=${'Size: 2 KB'}><${Actions}>…<//><//>`
 * @version-history
 *   v1.1.0 — 2026-09-27 — appcat parity: `lead` and `foot` drawn by the component in the old band's
 *     values (.wc-explain, .wc-size); the children are the doors at the column's start, as the old
 *     band's button row stood; the rows as wide as the widest stop; the figures at normal leading.
 *     Only appcat draws Stops.
 *   v1.0.0 — 2026-09-27 — Initial: the old app catalogue's "Where your work is" band (detail.js
 *     statusHtml, .wc-row/.wc-band/.wc-stop/.wc-explain/.wc-size in app-catalog-poster.css), for appcat.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);

/** The picture; it goes away when it does not load. */
function Picture({ src, alt = '' }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return html`<img class="stops-picture" src=${src} alt=${alt} loading="lazy" onError=${() => setFailed(true)} />`;
}

/**
 * @param {{ items: Array<{ key?: any, label: any, value: any, note?: any, on?: boolean }|null|false>,
 *   picture?: { src?: string, alt?: string }, lead?: any, foot?: any, children?: any }} props
 */
export function Stops({ items = [], picture, lead, foot, children }) {
  const list = /** @type {Array<{ key?: any, label: any, value: any, note?: any, on?: boolean }>} */ ((items || []).filter(Boolean));
  return html`
    <div class="stops">
      <div class="stops-rows">
        ${list.map((it, i) => html`<div key=${it.key ?? i} class=${'stops-row' + (it.on ? ' stops-row--on' : '')}>
          <span class="stops-label">${it.label}</span>
          <span class="stops-value">${it.value}</span>
          ${it.note ? html`<span class="stops-note">${it.note}</span>` : null}
        </div>`)}
      </div>
      ${picture && picture.src ? html`<${Picture} key=${picture.src} src=${picture.src} alt=${picture.alt} />` : null}
      ${lead ? html`<p class="stops-lead">${lead}</p>` : null}
      ${children || null}
      ${foot ? html`<p class="stops-foot">${foot}</p>` : null}
    </div>`;
}

export default Stops;
