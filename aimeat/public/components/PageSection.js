/**
 * @file public/components/PageSection.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A section of a Settings & Controls tab page: the section title (poster.css
 *   .poster-section-title) with a small mono count or number beside it, the doors on the right, and
 *   the body. Its look is css/components/page-section.css; the catalogue entry is `page-section`.
 * @structure PageSection({ id, num, title, count, doors, first, plain, children })
 * @usage html`<${PageSection} id="sec-files" num="02" title="Files" count=${12} doors=${html`<button class="og-door">Upload</button>`}>…<//>`
 *        html`<${PageSection} plain first=${!canEdit}>…<//>` (a section with no headline: the rule on top and the body)
 * @version-history
 *   2026-09-27 — `foot` and `spaced` (list only): the grey line under a list and 6px under its
 *     headline, the old app catalogue's own list; additive, appcat parity.
 *   2026-09-27 — `part`: a part of a dialog's body (section.poster-section with its slab title, which
 *     dialog.css sizes and spaces): the old app catalogue's Settings and Help, for appcat; additive.
 *   2026-09-27 — `list` (+ `onFold`, `folded`, `foldLabel`): the headline over a list of things with
 *     its count on the slab, and a list that folds from its headline: the app catalogue's list heads,
 *     for appcat (the shell); additive.
 *   2026-09-27 — `chapter`: a chapter of a long page of one thing ("03 / 19" over the slab, the doors
 *     on the slab, 112px of air above): the app catalogue's detail sections, for appcat; additive.
 *   2026-09-27 — `group`: a section that holds a group of sections, its headline a smaller band
 *     across the column (main's admin Config domains: "AI and agents", "Money"); additive.
 *   2026-09-27 — `band`: the headline's band spans the column (the classic pages' look on main).
 *   v1.1.0 — 2026-09-26 — `plain`: a section without a headline, only the rule on top (or none with
 *     `first`) and the body, as the organism settings draw a member's "Leave" box (page group G2a; additive).
 *   v1.0.0 — 2026-09-25 — Moved out of views/profile/organisms/poster-parts.js (Section) with its markup
 *     unchanged (UI consolidation phase 5, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/**
 * `count` wins over `num` beside the title; `first` drops the rule on top.
 * @param {{ id?: string, num?: any, title: any, count?: any, doors?: any, first?: boolean, plain?: boolean,
 *   band?: boolean, group?: boolean, chapter?: any, list?: boolean, onFold?: (e: Event) => void, folded?: boolean,
 *   foldLabel?: string, foot?: any, spaced?: boolean, part?: boolean, children?: any }} props
 */
export function PageSection({ id, num, title, count, doors, first, plain, band, group, chapter, list, onFold, folded, foldLabel, foot, spaced, part, children }) {
  // part (added by appcat's dialogs, parity): a part of a dialog's body, the old app catalogue's
  // section.poster-section with its slab title, which the dialog's own sheet sizes and spaces
  // (dialog.css: the slab a size smaller, 1rem under it, 2rem between parts).
  if (part) return html`<section class="poster-section" id=${id}><h3 class="poster-section-title">${title}</h3>${children}</section>`;
  // foot and spaced (added for appcat parity, list only): `foot` is the small grey line under the
  // list (the old catalogue's .cat-list-foot); `spaced` leaves 6px between the headline and the
  // list (its own list's head, #local-apps-header).
  const footLine = list && foot !== undefined && foot !== null && foot !== '' ? html`<p class="og-sec-foot">${foot}</p>` : null;
  // list + plain (added by appcat, the shell): the place of a list whose headline is not shown yet
  // (the catalogue's own list before the first app, its waiting and empty blocks): the list's air,
  // no rule.
  if (list && plain) return html`<section class=${`og-sec og-sec--list${first ? ' og-sec--first' : ''}`} id=${id}>${children}${footLine}</section>`;
  // plain (added by page group G2a): no headline; page-section.css draws the rule on top of a section without one.
  if (plain) return html`<section class=${`og-sec ${first ? 'og-sec--first' : ''}`} id=${id}>${children}</section>`;
  // chapter (added by appcat): a chapter of a long page of one thing, the app catalogue's detail
  // sections. Its number over the slab in coral typewriter ("03 / 19"), the slab across the column
  // with the doors on it in the slab's own colour, and far more air above it than under it, so the
  // gap reads as "the previous one ended". `first` is the chapter right after the page's head.
  if (chapter !== undefined && chapter !== null && chapter !== false) {
    return html`
      <section class=${`og-sec og-sec--chapter${first ? ' og-sec--first' : ''}`} id=${id}>
        <span class="og-sec-chapter" aria-hidden="true">${chapter}</span>
        <div class="og-sec-h og-sec-h--band">
          <h2 class="poster-section-title"><span>${title}</span>${doors ? html`<span class="og-sec-doors">${doors}</span>` : null}</h2>
        </div>
        ${children}
      </section>`;
  }
  // list (added by appcat, the shell): the headline over a list of things, the app catalogue's
  // "Your apps · 12": the slab across the column with the count in the slab's own letters, 48px of
  // air above it. `onFold` makes the headline fold the list (a press anywhere on it, or on the arrow
  // at its end, which says aria-expanded; `folded`, `foldLabel`), the old community list's head.
  if (list) {
    const folds = typeof onFold === 'function';
    return html`
      <section class=${`og-sec og-sec--list${first ? ' og-sec--first' : ''}`} id=${id}>
        <div class=${`og-sec-h og-sec-h--band${folds ? ' og-sec-h--folds' : ''}${spaced ? ' og-sec-h--spaced' : ''}`} onClick=${folds ? onFold : undefined}>
          <h2 class="poster-section-title"><span>${title}</span>${count !== null && count !== undefined && count !== '' ? html`<small>${count}</small>` : null}</h2>
          ${folds ? html`<button type="button" class=${`og-sec-fold${folded ? ' og-sec-fold--shut' : ''}`} aria-expanded=${folded ? 'false' : 'true'}
            aria-label=${foldLabel} title=${foldLabel} onClick=${(e) => { e.stopPropagation(); onFold(e); }}>▼</button>` : null}
        </div>
        ${folds && folded ? null : children}${footLine}
      </section>`;
  }
  // band: the headline's dark band spans the whole column, as the classic pages drew it on main
  // (P&L, Nodes, Organisms, Notebook, Living documents, Federation, Chat sessions).
  return html`
    <section class=${`og-sec${first ? ' og-sec--first' : ''}${group ? ' og-sec--group' : ''}`} id=${id}>
      <div class=${band || group ? 'og-sec-h og-sec-h--band' : 'og-sec-h'}>
        <h2 class="poster-section-title">${title}${count !== null && count !== undefined ? html`<small>${count}</small>` : html`<small>${num}</small>`}</h2>
        ${doors ? html`<div class="og-doors">${doors}</div>` : null}
      </div>
      ${children}
    </section>`;
}

export default PageSection;
