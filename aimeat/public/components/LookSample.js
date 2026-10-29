/**
 * @file public/components/LookSample.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One Atelier look, drawn by the kit itself: a small framed page (/look-sample.html)
 *   that loads the kit's stylesheet and sets the look, so the sample is the look's own colours,
 *   faces, corners and shadows and never a copy of them. The app structure page draws one for every
 *   look the node serves (views/appcat/structure-pick.js); a look added to the kit is drawn with no
 *   change here.
 *
 *   The frame is lazy, so a page of twenty looks loads the ones in view, and it takes no pointer, so
 *   a press lands on the answer around it. The page's theme travels along, so a dark page shows each
 *   look's dark side. `title` is the words the sample shows, the person's own app name when known.
 * @structure LookSample({ look, title, theme, label })
 * @usage html`<${LookSample} look="editorial" title="Talkoolista" theme="dark" label="editorial" />`
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (wish-sovelluksen-rakenne-ja-tila-sivu-luonnoksesta-asti-josta-voi).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

export function LookSample({ look, title = '', theme = 'light', label }) {
  const hash = new URLSearchParams({ look: String(look || ''), theme: theme === 'dark' ? 'dark' : 'light', title: String(title).slice(0, 40) });
  return html`<iframe class="look-sample" src=${`/look-sample.html#${hash.toString()}`} loading="lazy" tabindex="-1"
    title=${label || look} aria-hidden="true"></iframe>`;
}

export default LookSample;
