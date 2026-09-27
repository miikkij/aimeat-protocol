/**
 * @file public/components/Shots.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Pictures of pages side by side, each with its caption: a page's screenshot in the
 *   Object box's frame, cut to its top, with a bold caption and a typewriter line under it; where a
 *   page has no picture, a grey place that says so in the picture's stead. Two to a row, one on a
 *   narrow screen. The fastest way to tell a copy from a coincidence is to look at the two pages
 *   (the admin Applications page's copy scan: the original beside the suspected copy). A page passes
 *   the pictures as data; it never writes a class. The look is css/components/shots.css.
 *
 *   Shots({ items }): items = [{ key, src, alt, none, caption, sub }]; a falsy item is left out.
 *   - src: the picture's address (loaded lazily); without it the place shows `none`, the words
 *     that say there is no picture.
 *   - caption: the words under the picture (what it is: "the original"); sub: the typewriter line
 *     under them (whose page it is).
 * @structure Shots({ items })
 * @usage html`<${Shots} items=${[{ key: 'a', src: a.screenshot_url, none: x('noShot'), caption: x('original'), sub: 'app · alice' }]} />`
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial: the admin Applications page's picture pair (apps-tab.scan.js Shot,
 *     admin-apps.css .adm-ap-pair, .adm-ap-shot*) as a component with its own sheet (page group G5).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ items: Array<{ key?: any, src?: string, alt?: string, none?: any, caption?: any, sub?: any }|null|false> }} props */
export function Shots({ items = [] }) {
  const list = /** @type {Array<{ key?: any, src?: string, alt?: string, none?: any, caption?: any, sub?: any }>} */ ((items || []).filter(Boolean));
  return html`<div class="shots">
    ${list.map((s, i) => html`
      <span class="shot" key=${s.key ?? i}>
        ${s.src
          ? html`<img class="shot-picture" src=${s.src} alt=${s.alt || ''} loading="lazy" />`
          : html`<span class="shot-none">${s.none}</span>`}
        <span class="shot-caption">
          ${s.caption}
          ${s.sub !== undefined && s.sub !== null && s.sub !== '' ? html`<span class="shot-sub">${s.sub}</span>` : null}
        </span>
      </span>`)}
  </div>`;
}

export default Shots;
