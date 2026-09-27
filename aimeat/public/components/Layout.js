/**
 * @file public/components/Layout.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How the parts of a page stand beside and under each other, so that a page writes no
 *   utility class (component plan C9, page parts): the row, the stack, the split (a part set off by
 *   a hairline) and the space. Every space is a named step of one scale; a page names a step and
 *   never a length. Its look is css/components/layout.css (and .og-split in page-section.css).
 *
 *   The steps: 'none' 0 · 'tight' .25rem (was .mt-xs) · 'small' .5rem (.mb-half, the gap of
 *   .flex-row) · 'medium' .75rem (the space of .flex-actions and the split) · 'large' 1rem (.mb-1,
 *   .mt-1) · 'section' 1.5rem (.mt-section) · 'part' 1.875rem, above or below only (the air between
 *   the parts of one section's readout: the old app catalogue's visitor parts).
 *
 *   - Row({ gap = 'small', wrap, align = 'center', justify, above, below }): parts side by side.
 *     align = 'center' | 'start' | 'end' | 'baseline' | 'stretch'; justify = 'between' | 'end'.
 *   - Stack({ gap = 'small', above, below, list, narrow }): parts under each other; `list` makes them
 *     the items of a list (ul/li, no bullets) that a screen reader hears as a list; `narrow` keeps a
 *     page of settings forms to 60rem.
 *   - Split({ above = 'medium', pad = 'medium', gap, below }): a part under a hairline (a panel's
 *     last actions, a group inside it); `gap` stacks its parts; `heavy`: the part starts a new
 *     thing, under the heavy rule of the poster face (.poster-row--thing) in place of the hairline
 *     (the parts of an opened ecosystem app). `side`: the hairline stands at the part's start and
 *     the part is indented: a quieter side door that belongs to what is above it (an outside
 *     service's "use your own app" on Access).
 *   - Space({ above, below, inset }): only space around what it holds (for a part that had .mb-half,
 *     .mb-1, .mt-1 or .mt-section on it); `inset` the same step at both sides.
 *   - Beside({ side, narrow, wide, start, align, rule, above, pad, below, id }): the main part with a
 *     side part beside it (one column on a phone); `start` puts the side part first (G3); `stick`
 *     keeps the side part in sight under the top bar while the main part scrolls, and on a narrower
 *     screen stands it over the main part (G2).
 *   - Touch({ id, tabs }): every control inside is a thumb's target, 44px at every width (G8);
 *     `tabs`: its tabs too (G1a).
 *   - Columns({ children }): parts of the same weight side by side, one column on a phone (G1).
 * @structure Row · Stack · Split · Space · Beside · Columns · Touch
 * @usage html`<${Row} wrap>…<//>` · html`<${Stack} gap="large">…<//>` · html`<${Split}><${Actions}>…<//><//>`
 * @version-history
 *   v1.11.0 — 2026-09-27 — The step 'part' (1.875rem) for `above` and `below`: the air between the
 *     parts of a readout (the old app catalogue's .vis-block); additive, appcat parity (sections-b).
 *   v1.10.0 — 2026-09-27 — Space `inset`: the same step at both sides (the old app catalogue's Active
 *     Extensions bar); additive, appcat parity.
 *   v1.9.0 — 2026-09-27 — Beside `stick`: the side part stays in sight under the top bar while the
 *     main part scrolls, and stands over the main part when they no longer fit side by side (the
 *     admin Portal page's preview beside the parts, main's .adm-pt-bench > .adm-pt-side); additive,
 *     admin group G2.
 *   v1.8.0 — 2026-09-27 — Beside `start`: the side part stands before the main part (the admin
 *     Database and Metrics pages' headline figure with its line beside it, .adm-db-top /
 *     .adm-mx-top); additive, admin page group G3.
 *   v1.7.0 — 2026-09-27 — Columns: parts of the same weight side by side, as many as fit at 340px (the
 *     admin's .adm-two); additive, admin group G1.
 *   v1.6.0 — 2026-09-26 — Stack `list`: the parts are a list's items (ul/li, no bullets), main's Living
 *     ledger; Stack `narrow`: kept to 60rem (main's message rules page, .inbox-org); additive, fix pass.
 *   v1.5.0 — 2026-09-26 — Touch `tabs`: the tabs inside are 44px targets too (an agent's AI settings,
 *     main's .pf-aai), additive (page group G1a).
 *   v1.4.0 — 2026-09-26 — Touch: a part whose every control is 44px at every width (main's decision
 *     card and rules screen, .pf-aitr / .pf-dr), additive (page group G8).
 *   v1.3.0 — 2026-09-26 — Beside: a main part and a side part (the Boards composer, its reply row and
 *     its app fold: .bp-composer, .bp-composer--reply, .bp-app), additive (page group G7).
 *   v1.2.0 — 2026-09-26 — Split's `side` option: the line at the part's start, indented (main's
 *     profile.css .access-cx-own; additive, page group G3).
 *   v1.1.0 — 2026-09-26 — Split's `heavy` option: the heavy rule of the poster face over a part
 *     (.pf-eco-section's poster-row--thing; additive, page group G5).
 *   v1.0.0 — 2026-09-26 — Initial: the layout utilities (.flex-row, .flex-row-wrap, .flex-col,
 *     .flex-between, .flex-actions, .mb-half, .mb-1, .mt-1, .mt-section, .mt-xs) as components
 *     (component plan C9).
 */
import { h, toChildArray } from 'preact';
import htm from 'htm';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');
// 'part' (added by appcat sections-b, parity): 1.875rem, the air between the parts of one section's
// readout (the old visitors' .vis-block, 30px); layout.css draws it for above and below only.
const STEPS = new Set(['none', 'tight', 'small', 'medium', 'large', 'section', 'part']);
const step = (prefix, v) => (STEPS.has(v) ? `layout-${prefix}--${v}` : null);
const ALIGN = new Set(['start', 'end', 'baseline', 'stretch']);
const JUSTIFY = new Set(['between', 'end']);

export function Row({ gap = 'small', wrap, align, justify, above, below, children }) {
  return html`<div class=${cx('layout-row', wrap && 'layout-row--wrap', ALIGN.has(align) && `layout-row--${align}`,
    JUSTIFY.has(justify) && `layout-row--justify-${justify}`, step('gap', gap), step('above', above), step('below', below))}>${children}</div>`;
}

export function Stack({ gap = 'small', above, below, list, narrow, children }) {
  // narrow (added by the fix pass): a page of settings forms kept to 60rem, so its lines stay short on
  // a wide screen (main's message rules page, .inbox-org).
  const cls = cx('layout-stack', list && 'layout-list', narrow && 'layout-stack--narrow', step('gap', gap), step('above', above), step('below', below));
  // list (added by the fix pass): the parts are the items of a list, so a screen reader hears a
  // list of n items (main's Living ledger, ul.pf-ld-ledger); no bullets, the same look as a stack.
  if (list) return html`<ul class=${cls}>${toChildArray(children).map((c, i) => html`<li key=${c?.key ?? i}>${c}</li>`)}</ul>`;
  return html`<div class=${cls}>${children}</div>`;
}

export function Split({ above = 'medium', pad = 'medium', gap, below, heavy, side, children }) {
  return html`<div class=${cx(heavy ? 'poster-row--thing' : 'og-split', side && !heavy && 'og-split--side', gap && 'layout-stack', step('gap', gap), step('above', above), step('pad', pad), step('below', below))}>${children}</div>`;
}

export function Space({ above, below, inset, children }) {
  // inset (added for appcat parity): the same step at both sides (the old catalogue's Active
  // Extensions bar, 24px in from the column's edges).
  return html`<div class=${cx(step('above', above), step('below', below), step('inset', inset))}>${children}</div>`;
}

/**
 * Beside (added by page group G7): the main part and a side part beside it, one column on a phone
 * (under 900px). The side is as wide as it needs (a send button), or `narrow` (18rem: a form's
 * settings beside its words), or `wide` (two fifths: a second column of about the same weight).
 * `align` 'end' lines the two parts up at their foot (a reply field and its send button); `rule`
 * sets the heavy rule over it (a part that closes a section); `id` is the anchor a page scrolls to.
 */
export function Beside({ side, narrow, wide, start, stick, align, rule, above, pad, below, id, children }) {
  // start (added by admin page group G3): the side part stands at the start, before the main part
  // (a headline figure with its chart beside it: the admin Database and Metrics pages); on a phone
  // it stands over the main part.
  // stick (added by admin page group G2): the side part stays in sight while the main part scrolls
  // (the Portal page's preview beside its parts); when one column, the side part stands first.
  return html`<div id=${id} class=${cx('layout-beside', narrow && 'layout-beside--narrow', wide && 'layout-beside--wide',
    start && 'layout-beside--start', stick && 'layout-beside--stick', align === 'end' && 'layout-beside--end', rule && 'poster-row--thing', step('above', above), step('pad', pad), step('below', below))}>
    <div class="layout-beside-main">${children}</div>
    <div class="layout-beside-side">${side}</div>
  </div>`;
}

/**
 * Touch (added by page group G8): a part where every control is a thumb's target, 44px at every
 * width: its action links, loud actions, fields and drop-downs, and its check lines (the whole line
 * is the target, the box itself 20px). Main's decision-model card, its rules and providers screens
 * (.pf-aitr / .pf-dr), measured under the 40px floor on a phone before it.
 */
/**
 * Columns (added by admin group G1): parts of the same weight side by side, as many as fit at 340px
 * each, one column when the page is narrower (the admin pages' two sections or two lists of readings
 * side by side, main's .adm-two).
 */
export function Columns({ children }) {
  return html`<div class="layout-columns">${children}</div>`;
}

export function Touch({ id, tabs, children }) {
  // tabs (added by page group G1a): the tabs inside are thumb targets too (an agent's AI gate, as
  // main's .pf-aai drew it).
  return html`<div class=${cx('layout-touch', tabs && 'layout-touch--tabs')} id=${id}>${children}</div>`;
}

export default Row;
