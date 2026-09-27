/**
 * @file public/components/PageHead.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The head of a Settings page under its crumb (component plan C9, page parts): the
 *   big title with a small mono line beside it, the tags under it, the grey sentence that says what
 *   the page is for, and at the right the column of what the page offers first (the loud action, a
 *   hint beside it, a row of action links); on a phone the column stands under the words. A page
 *   passes the words and the tags as data and never writes a class. Its look is
 *   css/components/page-head.css (.og-mast, shared with the admin) and poster.css
 *   (.poster-page-title, .poster-chips).
 *
 *   - label: a small label over the title (a page inside a page names its kind so).
 *   - sub: the small mono line beside the title (a count, a subtitle, a row of tags).
 *   - marks: the tags under the title, each a Mark vnode or data { label, tone, kind, title }
 *     (see Mark.js); empty entries are left out, and the row stands (empty) while a page is still
 *     loading its tags, so the head does not jump when they come.
 *   - actions: the column at the right; give it Loud, Note kind="hint" slab and Actions.
 *   - page: the head of a page inside a page (a record, a board): the title sits on the column's
 *     foot and the sentence a little lower (.og-mast--page, .og-desc--page).
 *   - asKey: the title is a memory key (a record's page): the typewriter face, as written, not in
 *     capitals (.og-title--key; formerly memory.css .mp-title--key).
 *   - edit: while the title is being renamed, the field that renames it stands in the title's place.
 *   - line (added for appcat): the page's own small typewriter line under the title (the app
 *     catalogue's "sandbox · 30 apps published on aimeat.io"); it keeps its height while empty, so
 *     the head does not move when the line comes.
 *   - low (added for appcat): the head stands on its foot, the app catalogue's masthead: the title
 *     (held to 12 letters' width) and the column at the right line up at their foot and stay side by
 *     side on a phone, where the column keeps only its loud action (the old page hid the quiet words
 *     there) and the title is smaller.
 *   - thing, picture (added for appcat): the head of one thing's own page, the app catalogue's app
 *     detail masthead: `picture` { glyph, src, alt } in a framed box at the start (the screenshot
 *     when `src` loads, the glyph when it does not), the title, the `line`, the description in ink,
 *     the tags, and the column at the right, all on their foot; stacked on a phone.
 * @structure PageHead({ label, title, sub, marks, desc, actions, page, asKey, line, low, thing, picture })
 * @usage html`<${PageHead} title=${t('skills.tabLabel')} sub=${x('titleSub')} marks=${[{ label: '3 own', tone: 'sun' }]}
 *          desc=${x('desc')} actions=${html`<${Loud} …/><${Actions}>…<//>`} />`
 * @version-history
 *   v1.4.0 — 2026-09-27 — `thing` and `picture`: the app catalogue's app detail masthead (appcat
 *     detail); additive.
 *   v1.3.0 — 2026-09-27 — `line` and `low`: the app catalogue's masthead (appcat); additive.
 *   v1.2.0 — 2026-09-26 — `edit`: a node that stands in the title's place while the title is renamed
 *     (a calibration's name field and its save and cancel; additive, G4).
 *   v1.1.0 — 2026-09-26 — `asKey`: a title that is a memory key (Memory's record page; additive, G3).
 *   v1.0.0 — 2026-09-26 — Initial: the og-mast every Settings page wrote by hand, as data
 *     (component plan C9).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { Mark } from '/components/Mark.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');

/** A tag given as data becomes a Mark; a vnode stands as it is. */
const markOf = (m, i) => (m && typeof m === 'object' && 'label' in m && !('type' in m && 'props' in m)
  ? html`<${Mark} key=${m.key ?? i} kind=${m.kind} tone=${m.tone} title=${m.title}>${m.label}<//>`
  : m);

/**
 * The thing's picture (added for appcat): its glyph in the framed box, or its picture when `src`
 * loads (a screenshot, wider than the box); a picture that fails to load goes and the glyph shows.
 * @param {{ glyph?: any, src?: string, alt?: string }} props
 */
function Picture({ glyph, src, alt = '' }) {
  const [failed, setFailed] = useState(false);
  const shot = !!src && !failed;
  return html`<div class=${cx('og-mast-picture', shot && 'og-mast-picture--shot')}>
    ${shot ? html`<img src=${src} alt=${alt} loading="lazy" onError=${() => setFailed(true)} />` : html`<span class="og-mast-glyph">${glyph}</span>`}
  </div>`;
}

/**
 * @param {{ label?: any, title: any, sub?: any, marks?: Array<any>, desc?: any, actions?: any, page?: boolean, asKey?: boolean,
 *   edit?: any, line?: any, low?: boolean, thing?: boolean, picture?: { glyph?: any, src?: string, alt?: string } }} props
 */
export function PageHead({ label, title, sub, marks, desc, actions, page, asKey, edit, line, low, thing, picture }) {
  const tags = (marks || []).filter((m) => m !== null && m !== undefined && m !== false && m !== '');
  // thing (added for appcat): the head of one thing's own page (an app's detail): the picture at the
  // start, the words beside it on their foot, the description in ink and a step larger.
  if (thing) {
    return html`
      <div class="og-mast og-mast--thing">
        <div class="og-mast-main">
          ${picture ? html`<${Picture} key=${picture.src || ''} ...${picture} />` : null}
          <div class="og-mast-words">
            <h1 class="og-title poster-page-title">${title}</h1>
            ${line !== undefined && line !== null && line !== '' ? html`<div class="og-mast-line">${line}</div>` : null}
            ${desc ? html`<p class="og-desc">${desc}</p>` : null}
            ${marks ? html`<div class="poster-chips">${tags.map(markOf)}</div>` : null}
          </div>
        </div>
        ${actions ? html`<div class="og-mast-actions">${actions}</div>` : null}
      </div>`;
  }
  return html`
    <div class=${cx('og-mast', page && 'og-mast--page', low && 'og-mast--low')}>
      <div class="og-mast-words">
        ${label ? html`<div class="poster-label">${label}</div>` : null}
        ${edit || html`<h1 class=${cx('og-title poster-page-title', asKey && 'og-title--key')}>${title}${sub !== null && sub !== undefined && sub !== '' ? html`<small>${sub}</small>` : null}</h1>`}
        ${line !== undefined ? html`<div class="og-mast-line">${line}</div>` : null}
        ${marks ? html`<div class="poster-chips">${tags.map(markOf)}</div>` : null}
        ${desc ? html`<p class=${cx('og-desc', page && 'og-desc--page')}>${desc}</p>` : null}
      </div>
      ${actions ? html`<div class="og-mast-actions">${actions}</div>` : null}
    </div>`;
}

export default PageHead;
