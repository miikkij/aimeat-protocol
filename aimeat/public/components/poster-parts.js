/**
 * @file public/components/poster-parts.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one component set every signed-in page is composed from: the page frame, the
 *   section, columns and stacks, the rail, list and key-value rows, the table, the toolbar, the field,
 *   the numeral band, the dialog, actions, the menu, the meter, surfaces and text.
 *
 *   A PAGE PASSES CONTENT, DATA AND NAMED VARIANTS, NEVER CSS. No component here takes a class or a
 *   style from its caller. The look lives in /css/poster.css (the shapes) and /css/parts.css (the
 *   parts and their spacing), both reading the tokens in /css/theme.css, so a theme or a part changes
 *   in one place and every page follows. An unknown variant value falls back to the canonical cut
 *   rather than to nothing.
 *
 *   ADDING TO THE SET. First ask which existing part a new thing is: the answer is nearly always a
 *   part plus a prop. A new part is added only when no existing one can carry it, it is named by its
 *   role (never by a page), and at least two pages use it. A new prop is a named variant with a
 *   bounded set of values, never a free-form style hook.
 * @structure Page · Masthead · Crumbs · Chip · Section · Fold · Thread · DayDivider · Message · Columns · Stack · Rail · ListRow · StatRow · CheckItem · Steps · KeyValue ·
 *   Table · Toolbar · Field · NumeralBand · Dialog · Action · CopyAction · Menu · Meter · Surface · Text
 * @usage import { Page, Section, ListRow } from '/components/poster-parts.js';
 * @version-history
 *   v2.2.0 -- 2026-09-22 -- For the admin pages: a conversation (Thread, DayDivider, Message); a
 *     table with sortable columns, toned rows and one-line cells; a help surface that starts open;
 *     a mono row name and heading for machine keys; toned meters, a coral filter, a muted band number;
 *     the workspace page (fills the window, the whole screen on a phone) with a filling surface; a
 *     one-line preview and hover-revealed actions on a row; a stage for a rendered page, a framed
 *     picture and a sticky surface; a field suffix and onFocus; a sticky toolbar; grouped and
 *     compact index rails; columns that fill a workspace, each pane scrolling on its own.
 *   v2.1.0 -- 2026-09-22 -- What the settings tabs needed, added once for every page: a danger tone
 *     and switch semantics on actions; coral and success chips; a table that stacks on a phone;
 *     scrolling surfaces; rail entries that run a click or scroll only the content area;
 *     autofocus, input mode and a narrow width on fields; kept line breaks and a small heading in
 *     text; muted rows and a name tooltip; actions on a fold's row; a mono page title; the
 *     extra-large dialog.
 *   v2.0.0 -- 2026-09-22 -- Taken to main from the stage-two branch (cc-jouni-codex-styles-0912,
 *     fee2e0f17) with three changes: Action no longer turns into a menu when given `items` (that is
 *     Menu, one component for the three menus the site had); the meter is its own component instead
 *     of a Surface kind; the parts' rules live in parts.css, not poster.css.
 *   v1.4.0 -- 2026-09-14 -- Text exposes the named small and large numeral cuts. (branch)
 *   v1.0.0 -- 2026-09-13 -- Stage two: page anatomy, layout and interaction slots in one set. (branch)
 */
import { h } from 'preact';
import { useId, useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { Modal } from './Modal.js';
import { DataTable } from './DataTable.js';
import { KeyValueRow } from './KeyValueRow.js';
import { CopyButton } from './CopyButton.js';
const html = htm.bind(h);

// These are the complete variant vocabularies. Unknown values use the canonical cut.
const pick = (value, choices, fallback) => (choices.includes(value) ? value : fallback);
const densityOf = (value) => pick(value, ['compact', 'normal', 'roomy'], 'normal');
const collapseOf = (value) => pick(Number(value), [560, 600, 640, 900], 640);
const toneOf = (value) => pick(value, ['plain', 'muted', 'coral', 'sun', 'ink', 'success', 'danger'], 'plain');

/**
 * The page frame: width, masthead, and an optional rail that becomes a menu dialog on a phone.
 * `layout="workspace"` is a page that IS its work (a conversation, a thread): it fills the window
 * under the top bar, its rail and main column scroll on their own, and on a phone it takes the whole
 * screen above the keyboard. Put the part that scrolls in a `Surface height="fill"` and the composer
 * after it. A page whose top is lower (inside another frame) sets `--workspace-height`, and a phone
 * keyboard handler sets `--workspace-avail` (the visual viewport's height), both on the page root.
 */
export function Page({ title, titleKind, subtitle, crumb, crumbs, identity, mark, actions, masthead, rail, width = 'normal', children, id,
  railSide = 'trailing', railLabel, railOpen = false, onRailOpen, onRailClose, layout, pageRef }) {
  const leading = railSide === 'leading';
  const railNode = rail && html`<div class="poster-page-rail">${rail}</div>`;
  return html`<div class="poster-page" data-width=${pick(width, ['normal', 'wide', 'reading'], 'normal')} data-layout=${layout === 'workspace' ? 'workspace' : undefined} id=${id} ref=${pageRef}>
    ${masthead || ((title || crumb || crumbs || identity || actions) && html`<${Masthead}
      title=${title} titleKind=${titleKind} subtitle=${subtitle} crumb=${crumb} crumbs=${crumbs} identity=${identity} mark=${mark} actions=${actions} />`)}
    ${rail && railLabel && html`<div class="poster-page-menu"><${Action} onClick=${onRailOpen} expanded=${railOpen}>${railLabel}<//></div>`}
    <div class="poster-page-body" data-rail=${rail ? 'yes' : 'no'} data-rail-side=${leading ? 'leading' : 'trailing'} data-navigation=${railLabel ? 'yes' : 'no'}>
      ${leading && railNode}<div class="poster-page-main">${children}</div>${!leading && railNode}
    </div>
    ${rail && railLabel && html`<${Dialog} open=${railOpen} onClose=${onRailClose} title=${railLabel} guard=${false}>${rail}<//>`}
  </div>`;
}

/**
 * The page's opening: the trail, the title, the identity line, and the actions at the right.
 * `crumbs` is the trail to this page: [{ label, href } | { label, onClick } | { label }], the last
 * entry being where the person is. (`crumb` takes a ready node, for a page that has one.)
 * `titleKind="mono"` sets a title that is a machine value (a key, an address) as it is written.
 * `subtitle` is the short mono line after the title ("morsels and money").
 */
export function Masthead({ title, titleKind, subtitle, crumb, crumbs, identity, mark, actions, size = 'normal' }) {
  return html`<header class="poster-masthead" data-size=${pick(size, ['normal', 'large'], 'normal')}>
      ${mark && html`<span class="poster-masthead-mark">${mark}</span>`}
      <div class="poster-masthead-words">
        ${crumbs?.length ? html`<${Crumbs} items=${crumbs} />` : crumb && html`<div class="poster-crumb">${crumb}</div>`}
        ${title && html`<h1 class="poster-page-title" data-kind=${titleKind === 'mono' ? 'mono' : undefined}>${title}${subtitle && html`<small>${subtitle}</small>`}</h1>`}
        ${identity && html`<div class="poster-identity">${identity}</div>`}
      </div>
      ${actions && html`<div class="poster-masthead-actions">${actions}</div>`}
    </header>`;
}

/** The trail to a page: earlier steps are links, the last is where you are. */
export function Crumbs({ items = [] }) {
  const shown = items.filter(Boolean);
  return html`<nav class="poster-crumbs" aria-label="Breadcrumb"><ol>${shown.map((it, i) => {
    const last = i === shown.length - 1;
    return html`<li key=${i} aria-current=${last ? 'page' : undefined}>${!last && (it.href || it.onClick)
      ? html`<${Action} kind="text" href=${it.href} onClick=${it.onClick}>${it.label}<//>` : it.label}</li>`;
  })}</ol></nav>`;
}

/**
 * A small square mono chip for a fact about the thing: plain (framed), sun (the one to see), coral
 * (needs attention), success (fine, connected) or muted.
 */
export function Chip({ tone = 'plain', children, title }) {
  return html`<span class="poster-chip" data-tone=${pick(tone, ['plain', 'sun', 'coral', 'success', 'danger', 'muted'], 'plain')} title=${title}>${children}</span>`;
}

/**
 * A section: the B1 slab with an optional `count` after the title (a number, a short mono note),
 * the section's actions on the same row at the right, a description under it, and the body (on
 * the sun edge when it is the selected tab's).
 */
export function Section({ title, description, actions, children, selected = false, id, density, size = 'normal', count }) {
  const hasCount = count !== undefined && count !== null && count !== '';
  return html`<section class="poster-section poster-section-part" data-density=${densityOf(density)} data-size=${pick(size, ['small', 'normal', 'large'], 'normal')} id=${id}>
    ${(title || actions) && html`<div class="poster-section-head">
      ${title && html`<h2 class="poster-section-title">${title}${hasCount && html`<small>${count}</small>`}</h2>`}
      ${actions && html`<div class="poster-actions">${actions}</div>`}
    </div>`}
    ${description && html`<p class="poster-section-description">${description}</p>`}
    <div class=${selected ? 'poster-panel poster-section-body' : 'poster-section-body'}>${children}</div>
  </section>`;
}

/**
 * A folded row that opens in place: a coral number, the title, a quiet note at the right, the arrow.
 * `actions` sit on the row, outside the toggle, so pressing one does not open or close the fold.
 */
export function Fold({ id, number, title, sub, open = false, onToggle, actions, children, toggleTitle }) {
  return html`<section class="poster-fold" data-open=${open ? 'yes' : 'no'} id=${id}>
    <div class="poster-fold-row">
      <button type="button" class="poster-fold-toggle" aria-expanded=${open ? 'true' : 'false'} onClick=${onToggle} title=${toggleTitle}>
        ${number && html`<span class="poster-list-number">${number}</span>`}
        <span class="poster-fold-title">${title}</span>
        ${sub && html`<span class="poster-fold-sub">${sub}</span>`}
        <span class="poster-fold-arrow" aria-hidden="true">${open ? '↓' : '→'}</span>
      </button>
      ${actions && html`<div class="poster-actions">${actions}</div>`}
    </div>
    ${open && html`<div class="poster-fold-body">${children}</div>`}
  </section>`;
}

/**
 * Named column ratios, finite gaps and one of the four design breakpoints. `fill` (inside a workspace
 * page) takes the column's remaining height and lets each pane scroll on its own; a pane may end in a
 * `Surface height="fill"` and a composer after it.
 */
export function Columns({ layout = 'equal', density, collapse = 640, children, fill = false }) {
  return html`<div class="poster-columns-frame" data-fill=${fill ? 'yes' : undefined}><div class="poster-columns" data-layout=${pick(layout, ['equal', 'thirds', 'quarters', 'leading', 'trailing'], 'equal')}
    data-density=${densityOf(density)} data-collapse=${collapseOf(collapse)}>${children}</div></div>`;
}

/** Vertical content, horizontal controls or a wrapping group; the spacing belongs here. */
export function Stack({ direction = 'vertical', align = 'stretch', density, children, role, id, label }) {
  return html`<div class="poster-stack" data-direction=${pick(direction, ['vertical', 'horizontal', 'wrap'], 'vertical')}
    data-align=${pick(align, ['start', 'center', 'end', 'stretch', 'between'], 'stretch')}
    data-density=${densityOf(density)} role=${role} id=${id} aria-label=${label}>${children}</div>`;
}

/**
 * Bring an element to the top of the content area, and move nothing else. scrollIntoView() walks
 * every scrollable ancestor, and on this shell that includes the window, which slides the top bar out
 * of view (2026-08-29); scrolling the content region by hand touches one element.
 */
export function scrollToId(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const box = el.closest('.page-content') || el.closest('.pf-content') || null;
  if (!box) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  const top = box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top - 16;
  box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

/**
 * A sticky, numbered index. Entries carry content and a destination, never styling: { label, href,
 * count?, current?, onClick? }. An in-page href ("#id") scrolls only the content area; `onClick`
 * runs first (to open a fold, say) and the scroll follows. An entry's `group` (a short label) starts a
 * group: the label is shown once above the first entry that carries it. `density="compact"` is for a
 * long index (dozens of entries).
 */
export function Rail({ title, entries = [], children, label, kind = 'index', density }) {
  const go = (entry) => (e) => {
    const hash = typeof entry.href === 'string' && entry.href.startsWith('#') ? entry.href.slice(1) : '';
    if (!entry.onClick && !hash) return;
    e.preventDefault();
    entry.onClick?.();
    if (hash) setTimeout(() => scrollToId(hash), entry.onClick ? 50 : 0);
  };
  return html`<nav class="poster-rail" data-kind=${pick(kind, ['index', 'navigation'], 'index')} data-density=${density === 'compact' ? 'compact' : undefined} aria-label=${label || (typeof title === 'string' ? title : undefined)}>
    ${title && html`<p class="poster-rail-title">${title}</p>`}
    <ol>${entries.map((entry, index) => html`${entry.group && entry.group !== entries[index - 1]?.group && html`<li class="poster-rail-group" role="presentation" key=${'g' + index}>${entry.group}</li>`}<li key=${entry.id || entry.href || index}>
      <a href=${entry.href || '#'} onClick=${go(entry)} aria-current=${entry.current ? 'location' : undefined}>
        <span class="poster-rail-number" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>
        <span>${entry.label}</span>${entry.count != null && html`<small>${entry.count}</small>`}
      </a></li>`)}</ol>${children}
  </nav>`;
}

/**
 * The common roster row. Its actions stay separate from the link that opens its record.
 * A timeline row (a feed, a history, an activity log) passes `time` and a `marker` tone instead of
 * a mark: the time sits in a fixed mono column and the marker is a small square in that tone
 * (coral, sun, success, danger, info, muted); `live` makes the marker pulse.
 * An index row (a numbered list whose rows open) passes `number`, shown in coral mono, and `arrow`,
 * which points right, or down while the row is `selected` (open).
 * The second line (`detail`) is mono, for a machine value (an address, a key, a time); a sentence a
 * person reads passes `detailKind="text"`. A `preview` (a message, a note) is text and is clamped.
 * `muted` fades a row that is done, skipped or not chosen; `nameTitle` is a tooltip on the name;
 * `concealed` blurs the name and detail of a row the person chose to hide on screen. `open` marks a
 * row whose body is showing (arrow down, aria-expanded) without the sun fill of `selected`.
 * `nameKind="mono"` writes a name that is a machine key (a memory key, a room id) in mono.
 * `previewLines` (1 or 2, default 2) clamps a preview; a dense mail list takes 1.
 * `actionsReveal="hover"` shows the row's actions only while it is hovered or focused (always on a
 * touch screen), for a long list whose every row has the same quiet actions.
 */
export function ListRow({ mark, name, detail, value, actions, children, href, onOpen, selected = false, density, id, kind = 'normal', preview = false, external = false,
  time, timeTitle, marker, live = false, number, arrow = false, detailKind = 'mono', muted = false, nameTitle, concealed = false, open, nameKind, previewLines, actionsReveal }) {
  const lead = time != null || marker || number != null;
  const detailFace = preview ? 'text' : pick(detailKind, ['mono', 'text'], 'mono');
  return html`<article class="poster-list-row" data-kind=${pick(kind, ['normal', 'chronology'], 'normal')} data-density=${densityOf(density)} data-selected=${selected ? 'yes' : 'no'} data-preview=${preview ? 'yes' : undefined} data-detail=${detailFace} data-muted=${muted ? 'yes' : undefined} data-concealed=${concealed ? 'yes' : undefined} data-name=${nameKind === 'mono' ? 'mono' : undefined} data-preview-lines=${preview && Number(previewLines) === 1 ? '1' : undefined} data-actions=${actionsReveal === 'hover' ? 'hover' : undefined} id=${id}>
    ${lead ? html`<div class="poster-list-mark poster-list-lead">
      ${number != null && html`<span class="poster-list-number">${number}</span>`}
      ${time != null && html`<span class="poster-list-time" title=${timeTitle}>${time}</span>`}
      ${marker && html`<span class="poster-list-marker" data-tone=${pick(marker, ['coral', 'sun', 'success', 'danger', 'info', 'muted'], 'muted')} data-live=${live ? 'yes' : undefined} aria-hidden="true"></span>`}
    </div>` : mark && html`<div class="poster-list-mark">${mark}</div>`}
    <div class="poster-list-name" title=${nameTitle}>
      ${href || onOpen ? html`<${Action} href=${href} onClick=${onOpen} kind="text" target=${external ? '_blank' : undefined} nofollow=${external} expanded=${open === undefined ? undefined : !!open}>${name}<//>` : html`<strong>${name}</strong>`}
      ${detail && html`<small>${detail}</small>`}
    </div>
    ${value != null && html`<div class="poster-list-value">${value}</div>`}
    ${actions && html`<div class="poster-list-actions">${actions}</div>`}
    ${arrow && html`<span class="poster-list-arrow" aria-hidden="true">${(open ?? selected) ? '↓' : '→'}</span>`}
    ${children && html`<div class="poster-list-body">${children}</div>`}
  </article>`;
}

/**
 * A numeral row: one sentence with its number set big (put the number in <Text kind="number">), the
 * whole row a link, the ink rule above it. `light` puts a framed square before the sentence in a tone
 * (success, danger, sun, muted), a status you read at a glance; `tone="coral"` sets the number coral
 * when it asks for attention.
 */
export function StatRow({ href, onClick, light, tone = 'plain', children }) {
  const inner = html`${light && html`<span class="poster-stat-light" data-tone=${pick(light, ['success', 'danger', 'sun', 'muted'], 'muted')} aria-hidden="true"></span>`}<span class="poster-stat-text">${children}</span>`;
  const t = pick(tone, ['plain', 'coral'], 'plain');
  return href ? html`<a class="poster-stat" data-tone=${t} href=${href} onClick=${onClick}>${inner}</a>`
    : onClick ? html`<button type="button" class="poster-stat" data-tone=${t} onClick=${onClick}>${inner}</button>`
      : html`<div class="poster-stat" data-tone=${t}>${inner}</div>`;
}

/**
 * One item of a checklist: a square that is ticked on the sun when the thing is done and dashed
 * when it is not, and the words, quieter until done. A link or a button when it goes somewhere.
 */
export function CheckItem({ done = false, state, href, onClick, target, children }) {
  // `state` names more than done/not done: done (✓ on the sun), failed (✗ on the danger ground), warn
  // (a solid coral frame: needs a look) or pending (dashed). `done` is the short form of state="done".
  const st = pick(state, ['done', 'failed', 'warn', 'pending'], done ? 'done' : 'pending');
  const inner = html`<span class="poster-check-box" data-state=${st} aria-hidden="true">${st === 'done' ? '✓' : st === 'failed' ? '✗' : ''}</span><span>${children}</span>`;
  const d = st === 'done' ? 'yes' : 'no';
  return href ? html`<a class="poster-check" data-done=${d} href=${href} target=${target} rel=${target === '_blank' ? 'noopener noreferrer' : undefined} onClick=${onClick}>${inner}</a>`
    : onClick ? html`<button type="button" class="poster-check" data-done=${d} onClick=${onClick}>${inner}</button>`
      : html`<span class="poster-check" data-done=${d}>${inner}</span>`;
}

/** Numbered steps to follow in order: the number in coral mono, the step in body text. */
export function Steps({ items = [] }) {
  const shown = items.filter(Boolean);
  if (!shown.length) return null;
  return html`<ol class="poster-steps">${shown.map((step, i) => html`<li key=${i}>${step}</li>`)}</ol>`;
}

/**
 * A conversation: the column of messages in a thread (Messages, the chat). Children are Message and
 * DayDivider; the spacing belongs here.
 */
export function Thread({ children, label }) {
  return html`<div class="poster-thread" role="log" aria-label=${label}>${children}</div>`;
}

/** The date between the days of a thread: a quiet mono word in the middle. */
export function DayDivider({ label }) {
  return html`<div class="poster-day" role="separator">${label}</div>`;
}

/**
 * One message in a thread. `side` "mine" sits on the sun at the right, "theirs" in the ink frame at
 * the left. `who` is the sender's small label, `meta` the line under it (the time, read ticks,
 * "AI wrote this"), `quote` the message it answers, `actions` its words (reply, copy, a Menu).
 * `state` "draft" dashes the frame (not sent yet); "live" puts the coral edge on a reply an agent is
 * still writing. `id` lets a quote jump to it; `flash` marks the one just jumped to.
 */
export function Message({ side = 'theirs', who, meta, quote, actions, children, state, id, flash = false }) {
  return html`<article class="poster-message" data-side=${side === 'mine' ? 'mine' : 'theirs'}
    data-state=${pick(state, ['draft', 'live'], undefined)} data-flash=${flash ? 'yes' : undefined} id=${id}>
    <div class="poster-message-bubble">
      ${who && html`<span class="poster-message-who">${who}</span>`}
      ${quote && html`<div class="poster-message-quote">${quote}</div>`}
      <div class="poster-message-body">${children}</div>
      ${meta && html`<div class="poster-message-meta">${meta}</div>`}
    </div>
    ${actions && html`<div class="poster-message-actions">${actions}</div>`}
  </article>`;
}

/** A coral label on the left, the value on the right, a hairline under. */
export function KeyValue({ label, value, mono = false, children }) {
  return html`<div class="poster-key-value"><${KeyValueRow} label=${label} value=${value ?? children} mono=${mono} /></div>`;
}

/**
 * A table: the existing renderer keeps its escaping and cell semantics; this wrapper owns scrolling.
 * `collapse` (560, 600 or 640) stacks each row as label-value pairs when the table's own width is
 * below it, so a table stays readable on a phone instead of breaking words in narrow columns.
 * A header `{ label, sortKey }` sorts: pass `sort` ({ key, dir: 'asc' | 'desc' }) and `onSort(key)`.
 * `rowTones[i]`: 'muted' fades a row that is off (taken down, disabled); 'coral' marks one that needs a
 * look, 'danger' one that failed or is late. A cell
 * `{ text, clamp: true }` keeps to one line with the whole text as its tooltip.
 */
export function Table({ headers = [], rows = [], label, density, collapse, sort, onSort, rowTones }) {
  const c = collapse ? collapseOf(collapse) : undefined;
  return html`<div class="poster-table-frame"><div class="poster-table-wrap" data-density=${densityOf(density)} data-collapse=${c} role="region" aria-label=${label} tabindex="0">
    <${DataTable} headers=${headers} rows=${rows} className="poster-table" sort=${sort} onSort=${onSort} rowTones=${rowTones} />
  </div></div>`;
}

/**
 * Search, filters and a right-aligned count. A filter that warns (failing, under a threshold) takes
 * `tone: 'coral'`. `sticky` keeps the toolbar under the top of the scroller (a search and save row
 * over a long settings list).
 */
export function Toolbar({ search, filters = [], count, actions, children, label, sticky = false }) {
  return html`<div class="poster-toolbar" role="group" aria-label=${label} data-sticky=${sticky ? 'yes' : undefined}>
    ${search && html`<${Field} type="search" label=${search.label} ariaLabel=${search.ariaLabel} placeholder=${search.placeholder}
      value=${search.value ?? ''} onInput=${search.onInput} />`}
    ${filters.length > 0 && html`<div class="poster-filters">${filters.map((filter) => html`
      <${Action} key=${filter.id} kind="tab" selected=${!!filter.selected} disabled=${filter.disabled} tone=${filter.tone}
        onClick=${filter.onClick}>${filter.label}<//>`)}</div>`}
    ${children}${count != null && html`<span class="poster-toolbar-count">${count}</span>`}
    ${actions && html`<div class="poster-actions">${actions}</div>`}
  </div>`;
}

/**
 * A field owns its label, its control and its hint, which shows only while the field is in use.
 * `type="file"` draws an underlined word (`chooseLabel`) that opens the picker, with `accept` and
 * `multiple`; `value` is then the chosen file's name, shown beside it. Without `chooseLabel` the
 * label itself is the word that opens the picker. The native input stays in
 * the page, hidden, so the keyboard and the picker work as they always do.
 * `suffix` is a short mono text right after a one-line input (the domain after a subdomain name).
 * `mono` writes the value in the mono face: code, a manifest, a key someone pastes.
 */
export function Field({ label, hint, error, type = 'text', value, onInput, onChange, options = [], placeholder,
  id, name, disabled = false, readOnly = false, required = false, rows = 5, autoComplete, min, max, step,
  inputRef, maxLength, spellCheck, list, onKeyDown, onPaste, onBlur, onFocus, autoFocus = false, inputMode, width = 'fill', ariaLabel,
  accept, multiple = false, chooseLabel, passwordManager = true, suffix, mono = false }) {
  const generated = useId();
  const inputId = id || generated;
  // Preact does not focus an element it inserts after the page has loaded, so `autoFocus` does it here.
  const ownRef = useRef(null);
  const setRef = (el) => { ownRef.current = el; if (typeof inputRef === 'function') inputRef(el); else if (inputRef) inputRef.current = el; };
  useEffect(() => { if (autoFocus) ownRef.current?.focus(); }, [autoFocus]);
  const kind = pick(type, ['text', 'email', 'url', 'password', 'search', 'number', 'date', 'datetime-local', 'time', 'month', 'checkbox', 'textarea', 'select', 'file'], 'text');
  const hasValue = value !== undefined && value !== null && value !== '' && value !== false;
  const control = { id: inputId, name, disabled, readOnly, required, onInput, onChange, ref: setRef, maxLength, spellCheck, list, onKeyDown, onPaste, onBlur, onFocus,
    autoFocus, inputMode: pick(inputMode, ['text', 'decimal', 'numeric', 'email', 'url', 'search'], undefined),
    // A key or an address that a password manager must not fill or offer to save.
    'data-1p-ignore': passwordManager ? undefined : 'true', 'data-lpignore': passwordManager ? undefined : 'true',
    'aria-invalid': error ? 'true' : undefined,
    'aria-describedby': error || hint ? inputId + '-hint' : undefined };
  return html`<div class="poster-field" data-filled=${hasValue ? 'yes' : 'no'} data-kind=${kind} data-width=${width === 'narrow' ? 'narrow' : undefined} data-mono=${mono ? 'yes' : undefined}>
    ${label && !(kind === 'file' && !chooseLabel) ? html`<label for=${inputId} class="poster-label">${label}</label>`
      : ariaLabel && html`<label for=${inputId} class="visually-hidden">${ariaLabel}</label>`}
    ${kind === 'textarea' ? html`<textarea ...${control} value=${value ?? ''} rows=${rows} placeholder=${placeholder}></textarea>`
      : kind === 'select' ? html`<select ...${control} value=${value}>${options.map((option) => html`
        <option key=${option.value} value=${option.value} disabled=${option.disabled}>${option.label}</option>`)}</select>`
      : kind === 'checkbox' ? html`<input ...${control} type="checkbox" checked=${!!value} />`
      : kind === 'file' ? html`<div class="poster-field-file">
          <input ...${control} type="file" class="visually-hidden" accept=${accept} multiple=${multiple} />
          <label for=${inputId} class="poster-action">${chooseLabel || label || ariaLabel}</label>
          ${hasValue && html`<span class="poster-field-file-name">${value}</span>`}
        </div>`
      : suffix != null ? html`<div class="poster-field-suffixed"><input ...${control} type=${kind} value=${value ?? ''} placeholder=${placeholder}
          autocomplete=${autoComplete} min=${min} max=${max} step=${step} /><span class="poster-field-suffix">${suffix}</span></div>`
      : html`<input ...${control} type=${kind} value=${value ?? ''} placeholder=${placeholder}
          autocomplete=${autoComplete} min=${min} max=${max} step=${step} />`}
    ${(error || hint) && html`<small id=${inputId + '-hint'} class="poster-field-hint" role=${error ? 'alert' : undefined}>${error || hint}</small>`}
  </div>`;
}

/**
 * Big numbers with small-caps labels, and an optional lead and actions, in one band. An item is
 * { label, value, note?, href? | onClick?, tone? }: the note is a small mono line under the label
 * (it wraps; it is never cut), tone="coral" sets that one number coral and tone="muted" quiets a
 * number that is off or zero on purpose. `size="small"` uses the small numeral cut, for a
 * row of counts that sits inside a card rather than opening a page.
 */
export function NumeralBand({ items = [], lead, actions, tone = 'coral', cut = 'straight', contained = false, size = 'normal', children }) {
  const small = size === 'small';
  return html`<section class="poster-numeral-band" data-tone=${cut === 'diagonal' ? 'coral' : pick(tone, ['coral', 'sun', 'ink', 'plain'], 'coral')}
    data-cut=${pick(cut, ['straight', 'diagonal'], 'straight')} data-contained=${contained ? 'yes' : undefined} data-size=${small ? 'small' : undefined}>
    ${lead && html`<div class="poster-band-lead">${lead}</div>`}
    ${items.length > 0 && html`<dl>${items.map((item, index) => html`<div key=${item.id || index}>
      <dt>${item.label}${item.note != null && html`<small title=${typeof item.note === 'string' ? item.note : undefined}>${item.note}</small>`}</dt>
      <dd class=${'poster-stat-number' + (small ? ' poster-stat-number--small' : '')} data-tone=${item.tone === 'coral' || item.tone === 'muted' ? item.tone : undefined}>${item.href || item.onClick
        ? html`<${Action} kind="text" href=${item.href} onClick=${item.onClick} label=${item.label}>${item.value}<//>` : item.value}</dd>
    </div>`)}</dl>`}${children}${actions && html`<div class="poster-actions">${actions}</div>`}
  </section>`;
}

/** The site's one dialog (Modal keeps the native lifecycle, the dirty-form guard and focus return). */
export function Dialog({ open, onClose, title, children, actions, sideAction, size = 'normal', guard = true }) {
  const sizes = { small: 'sm', normal: 'md', large: 'lg', xl: 'xl' };
  return html`<${Modal} open=${open} onClose=${onClose} title=${title} footer=${actions} footerStart=${sideAction}
    size=${sizes[pick(size, Object.keys(sizes), 'normal')]} guard=${guard}
    className="poster-dialog">${children}<//>`;
}

/**
 * An action names what it does and picks one of five roles, never a CSS hook:
 * primary (the one loud slab), secondary (an underlined word), tab (a choice that can be on),
 * text (a link-like word inside a row), icon (a square with an SVG in it; `selected` makes it a
 * pressed toggle, such as a pin) and choice (a boxed answer: `title` in bold, the children as its
 * description, the chosen one on the sun).
 * `semantics` is for a group of choices: 'tab' or 'radio' gives the button that ARIA role; 'switch'
 * makes an on/off setting (aria-checked). `tone` "danger" or "success" colours an underlined word.
 */
export function Action({ children, href, onClick, kind = 'secondary', size = 'normal', tone, selected = false,
  disabled = false, type = 'button', label, title, expanded, controls, download, target, semantics, nofollow = false, form }) {
  const role = pick(kind, ['primary', 'secondary', 'tab', 'text', 'icon', 'choice'], 'secondary');
  const cls = role === 'primary' ? 'poster-slab' + (size === 'large' ? ' poster-slab--large' : '')
    : role === 'choice' ? 'poster-choice' + (selected ? ' on' : '')
    : role === 'tab' ? 'poster-tab' + (selected ? ' is-on' : '')
      : role === 'text' ? 'poster-text-action' : role === 'icon' ? 'poster-icon-action' : 'poster-action';
  // A primary may be danger; an underlined word or a text action may be danger (delete, disconnect)
  // or success (approve).
  const tones = role === 'primary' ? ['plain', 'danger'] : role === 'secondary' || role === 'text' ? ['plain', 'danger', 'success'] : role === 'tab' ? ['plain', 'coral'] : ['plain'];
  const common = { class: cls, onClick, 'data-tone': pick(tone, tones, 'plain'), 'aria-label': label, title,
    'aria-expanded': expanded, 'aria-controls': controls };
  return href && !disabled ? html`<a ...${common} href=${href} download=${download} target=${target}
    rel=${target === '_blank' ? 'noopener noreferrer' + (nofollow ? ' nofollow' : '') : undefined}>${children}</a>`
    : html`<button ...${common} type=${pick(type, ['button', 'submit', 'reset'], 'button')} disabled=${disabled} form=${form}
        role=${pick(semantics, ['radio', 'tab', 'switch'], undefined)}
        aria-checked=${semantics === 'radio' || semantics === 'switch' ? selected : undefined}
        aria-selected=${semantics === 'tab' ? selected : undefined}
        aria-pressed=${(role === 'tab' || role === 'icon' || role === 'choice') && !semantics ? selected : undefined}>${role === 'choice' && title ? html`<b>${title}</b>` : null}${children}</button>`;
}

/**
 * Copies `text` to the clipboard and says so for two seconds. It takes the same roles as Action
 * (primary, secondary, text), so a copy looks like every other action of its weight.
 */
export function CopyAction({ text, label, copiedLabel, kind = 'secondary', title, onCopied, disabled = false }) {
  const role = pick(kind, ['primary', 'secondary', 'text'], 'secondary');
  const cls = { primary: 'poster-slab', secondary: 'poster-action', text: 'poster-text-action' }[role];
  return html`<${CopyButton} text=${text} label=${label} copiedLabel=${copiedLabel} className=${cls}
    title=${title} ariaLabel=${label} onCopied=${onCopied} disabled=${disabled} />`;
}

const DOTS = html`<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" fill="currentColor">
  <circle cx="10" cy="4" r="1.8" /><circle cx="10" cy="10" r="1.8" /><circle cx="10" cy="16" r="1.8" /></svg>`;

/**
 * The actions of one thing, behind a button: items are { label, onClick, danger?, divider? } and a
 * falsy item is skipped. It closes on a choice, on Escape and on a click anywhere else. `trigger` is
 * the button's content; the default is three dots.
 */
export function Menu({ items, label, trigger }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', key); };
  }, [open]);
  const visible = (items || []).filter(Boolean);
  if (visible.length === 0) return null;
  return html`<div class="poster-menu" ref=${ref}>
    <button type="button" class=${trigger ? 'poster-action' : 'poster-icon-action poster-menu-dots'} aria-label=${label} title=${label}
      aria-haspopup="menu" aria-expanded=${open} onClick=${(e) => { e.stopPropagation(); setOpen((o) => !o); }}>${trigger || DOTS}</button>
    ${open && html`<div class="poster-menu-pop" role="menu" onClick=${(e) => e.stopPropagation()}>
      ${visible.map((item, i) => item.divider
        ? html`<div class="poster-menu-sep" role="separator" key=${'sep' + i}></div>`
        : html`<button type="button" class="poster-menu-item" data-tone=${item.danger ? 'danger' : 'plain'} role="menuitem"
            key=${item.id || item.label} disabled=${item.disabled}
            onClick=${() => { setOpen(false); item.onClick?.(); }}>${item.label}</button>`)}
    </div>`}
  </div>`;
}

/**
 * A filled bar for a ratio. A quota (how much of a limit is used) turns to the danger colour from 90 %;
 * `kind="progress"` never does, and takes a `tone` (sun, coral, ink, muted) when bars name levels.
 */
export function Meter({ value, max = 100, label, kind = 'quota', tone }) {
  const limit = Number.isFinite(max) && max > 0 ? max : 100;
  const amount = Number.isFinite(value) ? Math.max(0, Math.min(limit, value)) : 0;
  const percent = (amount / limit) * 100;
  // A quota warns from 90 %; progress (steps done, a job's share) only ever fills.
  const quota = kind !== 'progress';
  return html`<div class=${'poster-box poster-box--meter poster-meter' + (quota ? ' poster-box--quota' : '') + (quota && percent >= 90 ? ' is-full' : '')}
    data-tone=${quota ? undefined : pick(tone, ['sun', 'coral', 'ink', 'muted'], undefined)}
    role="meter" aria-label=${label} aria-valuenow=${amount} aria-valuemin="0" aria-valuemax=${limit}>
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true"><rect width=${percent} height="100" /></svg>
  </div>`;
}

/**
 * A content surface is a shape with its spacing: a box, an opened record, an aside, code, a panel.
 * `height="scroll"` caps a long body at 24rem and scrolls inside; `"tall"` caps code at 60vh;
 * `"fill"` takes the rest of a workspace page's column and scrolls inside (a thread, a conversation).
 * An aside with `tone="danger"` is the solid-framed one that explains an act that cannot be undone.
 * `kind="stage"` frames a rendered page or email (an iframe child) on a light ground in every theme,
 * 32rem tall (`height="scroll"` makes it 26rem, `width="phone"` shows it at a phone's 390px);
 * `kind="picture"` frames an image at full width.
 * `sticky` keeps the surface under the top of the scrolling area (a save row over a long form).
 */
export function Surface({ kind = 'box', tone, density, children, id, role, summary, onClick, surfaceRef, height = 'auto', open, sticky = false, width }) {
  const shapes = { box: 'poster-box', record: 'poster-record', aside: 'poster-aside', code: 'poster-box poster-code', editor: 'poster-box poster-editor', plain: '', panel: 'poster-panel', preview: 'poster-box poster-preview', stage: 'poster-box poster-stage', picture: 'poster-box poster-picture' };
  const tag = summary ? 'details' : 'div';
  return html`<${tag} class=${kind === 'panel' ? 'poster-panel' : 'poster-surface ' + shapes[pick(kind, Object.keys(shapes), 'box')]}
    data-density=${density === 'flush' ? 'flush' : densityOf(density)} data-tone=${toneOf(tone)} data-height=${pick(height, ['auto', 'scroll', 'tall', 'fill'], 'auto')} data-sticky=${sticky ? 'yes' : undefined} data-width=${kind === 'stage' && width === 'phone' ? 'phone' : undefined} id=${id} open=${summary ? open : undefined} role=${role} ref=${surfaceRef} onClick=${onClick}>
    ${summary && html`<summary>${summary}</summary>`}${children}<//>`;
}

/**
 * The small typography vocabulary for literal copy and data inside parts. `lines` keeps the line
 * breaks a person typed; a heading or a number takes `size="small"`. A heading that is a machine key
 * (a memory key as a record's title) takes `face="mono"`: written as it is, not in capitals.
 */
export function Text({ children, kind = 'body', tone, title, id, size = 'normal', lines = false, face }) {
  const roles = { body: 'p', lead: 'p', label: 'span', mono: 'span', caption: 'small', heading: 'h3', number: 'span' };
  const selected = pick(kind, Object.keys(roles), 'body');
  const shape = { heading: 'poster-record-title', number: 'poster-stat-number', label: 'poster-label' }[selected];
  const numberSize = pick(size, ['small', 'normal', 'large'], 'normal');
  const modifier = selected === 'number' && numberSize !== 'normal' ? ' poster-stat-number--' + numberSize
    : selected === 'heading' && numberSize === 'small' ? ' poster-record-title--small' : '';
  return h(roles[selected], { class: 'poster-copy ' + (shape || 'poster-text') + modifier, 'data-kind': selected, 'data-lines': lines ? 'yes' : undefined, 'data-face': face === 'mono' ? 'mono' : undefined,
    'data-tone': pick(tone, ['plain', 'muted', 'coral', 'sun', 'info', 'success', 'danger'], 'plain'), title, id }, children);
}
