/**
 * @file public/components/Stars.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Five rating stars, to give or to read (Jouni's decision "Rating stars"): the given
 *   ones dark, the others as outlines. To give, each star is a button and the pointer on a star shows
 *   the rating it would give; to read, the stars are one picture with the rating as its words for a
 *   screen reader. A page passes the rating and what happens; it never writes a class. The look is
 *   css/components/rating-stars.css (.stars, .stars-star: the component's own names).
 *
 *   - `value`: the rating, 0 to 5 (rounded and clamped).
 *   - `onPick(n)`: the stars are buttons that give n; without it the stars are only read.
 *   - `row`: the read stars small enough to stand beside a status in a narrow column.
 *   - `disabled`: the buttons do nothing now (a rating being sent).
 *   - `label`: the group's name for a screen reader (the stars to give); the read stars say "n/5".
 * @structure Stars({ value, onPick, row, disabled, label })
 * @usage html`<${Stars} value=${task.rating.stars} />` ·
 *        html`<${Stars} value=${stars} onPick=${setStars} label=${t('x.rate')} />`
 * @version-history
 *   v1.2.0 — 2026-09-27 — The stars draw their own class names (.op-stars → .stars, .op-star →
 *     .stars-star, .op-stars--shown → .stars--shown, .op-stars--row → .stars--row); every rule keeps its
 *     value (Jouni: components draw only their own class names, a move).
 *   v1.1.0 — 2026-09-26 — A star to give says its number as a tooltip too (title), as the Offers
 *     page's rating row did on main (page group G6, additive).
 *   v1.0.0 — 2026-09-26 — Initial: the stars every rating wrote by hand (the agent task's rating, the
 *     rate dialog), as one component on the existing sheet (page group G1a).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');
const FIVE = [1, 2, 3, 4, 5];

export function Stars({ value, onPick, row, disabled, label }) {
  const n = Math.max(0, Math.min(5, Math.round(Number(value) || 0)));
  if (typeof onPick === 'function') {
    return html`<span class="stars" role="radiogroup" aria-label=${label}>
      ${FIVE.map((i) => html`<button type="button" key=${i} class=${cx('stars-star', i <= n && 'on')} disabled=${disabled}
        aria-label=${String(i)} title=${String(i)} aria-pressed=${i <= n ? 'true' : 'false'} onClick=${() => onPick(i)}>★</button>`)}
    </span>`;
  }
  return html`<span class=${cx('stars', 'stars--shown', row && 'stars--row')} role="img" aria-label=${`${n}/5`}>
    ${FIVE.map((i) => html`<span key=${i} class=${cx('stars-star', i <= n && 'on')} aria-hidden="true">★</span>`)}
  </span>`;
}

export default Stars;
