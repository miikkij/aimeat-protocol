/**
 * @file public/components/IndexFrame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A page with its own index beside it: the index column at the start (250px: the
 *   views, the states and the tags a person filters by, a SideMenu), and the main column beside it,
 *   kept to a reading width (1180px) with the poster page's air. Under 900px the page is one column
 *   and the index stands on top of the main part. A foot on ink (InkFoot) as the main column's last
 *   part bleeds to the column's edges. A page passes the two parts and never writes a class. Its
 *   look is css/components/index-frame.css.
 *
 *   `dense`: the catalogue's reading, which the whole frame inherits: the browser's own line height
 *   (the site's body reads 1.6) and the dim words in the lightest grey of the theme (--text-muted),
 *   which is what the old catalogue's own --text-dim was.
 * @structure IndexFrame({ index, label, dense, children })
 * @usage html`<${IndexFrame} index=${html`<${SideMenu} index …>…<//>`}>…the page…<//>`
 * @version-history
 *   v1.1.0 — 2026-09-27 — `dense`: the old catalogue's reading on the frame's root (appcat parity).
 *   v1.0.0 — 2026-09-27 — Initial: the app catalogue's frame (the old /app-catalog.html .cat-body,
 *     .cat-rail and .cat-main) as a component, for appcat.
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/**
 * @param {{ index?: any, label?: string, dense?: boolean, children?: any }} props
 *   index: the index column's content; label: its name for a screen reader; dense: the catalogue's
 *   reading (see the file's description).
 */
export function IndexFrame({ index, label, dense, children }) {
  return html`
    <div class=${`index-frame${dense ? ' index-frame--dense' : ''}`}>
      ${index ? html`<aside class="index-frame-index" aria-label=${label}>${index}</aside>` : null}
      <div class="index-frame-main">${children}</div>
    </div>`;
}

export default IndexFrame;
