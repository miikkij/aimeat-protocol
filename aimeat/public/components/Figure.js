/**
 * @file public/components/Figure.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A figure, read only, as one component (C4 "Facts" of the component plan): one number in
 *   the poster face with the words under it, the sun sticker that carries the one fact to see first,
 *   the meter that fills to a share, and a word or number set in a state colour inside other words.
 *   A page passes the figure and named options; it never writes a class. The look is the library's
 *   numeral and meter shapes in css/poster.css (.poster-stat-number and its cuts, .poster-sticker,
 *   .poster-box--meter, .poster-box--quota, .poster-meter-figure) and css/components/figure.css.
 *
 *   - Figure({ n, sub, small, large, step, band, tone, end, title }): the numeral. `small` is the cut a
 *     row of a list uses (an amount, a time, a score, a count); `large` the hero cut; `step` a step's
 *     number in coral; `band` the figure on the coral band. `sub`: the small typewriter line under it
 *     ("morsels", "Tue"). tone = 'fine' | 'notice' | 'dim' (the figure says a state: came in or fine,
 *     went out or needs a look, not there yet). `end`: the figure stands at the end of its cell, on
 *     one line.
 *   - Sticker({ figure, children }): the sun sticker: a short figure and one action under it.
 *   - Meter({ pct, quota, figure, beside, fill, thin }): the bar that fills to `pct` (0 to 100). `quota`
 *     is a meter of a limit (coral, red from 90 %); `figure` the words written on it; `beside` a meter
 *     in a line of words (15rem, the whole width on a phone); `fill` a meter that takes the rest of its
 *     line beside a field; `thin` the thin cut of a progress through steps. `early` (with `quota`):
 *     it warns before it is full, in the warn colour from 60 % (the AI daily budget bar on main).
 *   - Tinted({ tone, strong, children }): words or a number in a state colour inside other words:
 *     tone = 'fine' | 'notice' | 'warn' | 'danger' | 'dim' | 'faint' (a word that says nothing is
 *     there, in the rule's grey: "never"); `strong` sets them in bold; `whole` keeps them on one line,
 *     never broken inside (one label of a host name, which broken at its hyphen reads as two).
 * @structure Figure(props) · Sticker({ figure, children }) · Meter(props) · Tinted({ tone, strong, whole, children })
 * @usage html`<${Figure} small end tone="fine" n=${signed(amount)} sub=${x('unitMany')} />`
 *        html`<${Meter} quota pct=${pct} figure=${`${money(spent)} / ${money(budget)} · ${pct} %`} />`
 *        html`<${Tinted} strong tone="notice">${x('visWebOff')}<//>`
 * @version-history
 *   v1.3.0 — 2026-09-26 — Tinted's `whole` option: words kept on one line (the Access page's secret
 *     host labels, main's .ac-shost-h); additive, page group G3.
 *   v1.2.0 — 2026-09-26 — Meter's `early` option: a quota meter that warns from 60 % (main's .warn step
 *     of the AI daily budget bar, which the previous branch lost); additive, page group G4.
 *   v1.1.0 — 2026-09-26 — Tinted's faint tone: a word that says nothing is there (the Scheduler's
 *     "never", main's .og-tbl-dot), in the rule's grey (additive, page group G5).
 *   v1.0.0 — 2026-09-26 — Initial: the numeral, the sticker and the meter the Settings pages drew by
 *     hand (poster-stat-number with a page class for its place, poster-sticker, poster-box--meter with
 *     a page class for its size), and the state colour a page gave a word (.is-good, .is-low, .is-on,
 *     .is-off), as one component (component plan C4).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');
const has = (x) => x !== undefined && x !== null && x !== false;
const FIGURE_TONES = new Set(['fine', 'notice', 'dim']);
const TINTS = new Set(['fine', 'notice', 'warn', 'danger', 'dim', 'faint']);

export function Figure({ n, sub, small, large, step, band, tone, end, title }) {
  const cls = cx('poster-stat-number', small && 'poster-stat-number--small', large && 'poster-stat-number--large',
    step && 'poster-stat-number--step', band && 'poster-stat-number--band', 'figure', end && 'figure--end',
    FIGURE_TONES.has(tone) && `figure--${tone}`);
  return html`<span class=${cls} title=${title}>${n}${has(sub) ? html`<small>${sub}</small>` : null}</span>`;
}

export function Sticker({ figure, children }) {
  return html`<div class="poster-sticker"><b class="poster-stat-number poster-stat-number--small">${figure}</b>${children}</div>`;
}

export function Meter({ pct, quota, early, figure, beside, fill, thin }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const cls = cx('poster-box', 'poster-box--meter', quota && 'poster-box--quota', quota && p >= 90 && 'is-full',
    quota && early && p >= 60 && p < 90 && 'is-warn', 'meter',
    has(figure) && 'meter--figure', beside && 'meter--beside', fill && 'meter--fill', thin && 'meter--thin');
  return html`<div class=${cls}><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><rect width=${p} height="100" /></svg>${has(figure) ? html`<span class="poster-meter-figure">${figure}</span>` : null}</div>`;
}

export function Tinted({ tone, strong, whole, children }) {
  const cls = cx(TINTS.has(tone) && `tinted tinted--${tone}`, whole && 'tinted--whole') || undefined;
  return strong ? html`<b class=${cls}>${children}</b>` : html`<span class=${cls}>${children}</span>`;
}

export default Figure;
