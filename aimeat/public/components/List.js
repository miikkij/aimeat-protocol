/**
 * @file public/components/List.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Things in a list, as one component (C1 of the component plan: ListRow and List). One
 *   row is one thing: a mark (an avatar, a tick, a thumbnail), its name with the small line under it,
 *   what it is, who has it, its figures and dates, and the doors at the end with the ⋯ menu. A row
 *   can open a panel under it, be picked, be selected and be dragged. The List holds the rows under
 *   an optional heading row, says when it is loading or empty, and groups rows under headings that
 *   fold. Around a list: the filters with their counts, the search line, and "show more".
 *   A page passes data and named options; it never writes a class. The look is the Listing
 *   (css/components/listing.css, the class names the admin pages share) and css/components/list.css
 *   (what the Listing lacked: the kinds of mark, the pick row, the fold heading, the filters row).
 *
 *   The columns are the list's cut, named by what they hold: cols="name-desc-who-doors" draws
 *   .listing--name-desc-who-doors. Every cut is listed in listing.css; a new set of columns is a new
 *   cut there, never a grid in a page sheet. `keepCols` keeps the columns on a phone (the cut carries
 *   its narrow rules); without it the cells of a row stack.
 *
 *   The cells, in the order the cut names them:
 *   - Name: the row's name, bold. `meta` is the small grey typewriter line under it (Jouni's decision
 *     "Meta line"), `warn` turns that line coral; `desc` is a sentence (or several) under the name in
 *     the body's letters; `note` a short coral (or `noteTone="fine"`, green) typewriter line under
 *     that, for "why it fits" or what an answer did. `tag` (a word or a Mark, or a list of them) and
 *     `after` stand after the name, `dot` (a status: active, inactive…) before it, `end` at the far
 *     end of the cell (marks that line up down the list), `before` a control before the name (an
 *     eye that blurs it), `blurred` the name blurred for privacy. `onOpen` or `href`
 *     make the name the way into the thing. `asKey` sets a memory key (typewriter, breaks anywhere),
 *     `code` an identifier. `unread` puts the coral square before it; `attention` turns the name
 *     coral (a thing with a problem). `clip` cuts the meta line to one line (or `clip={2}`, two).
 *   - Desc: what the thing is or does, grey (`sub` a typewriter line under it, `clip` one line cut
 *     with …, `faint` for the dash that says there is nothing). Who: who or where, with `sub` under
 *     it (`clip`). Num: a figure at the right of its column (`dim`, `strong` for a total, `quiet` in
 *     the words' grey, `sign` for how soon, in coral typewriter; a numeral in the poster face is the
 *     Figure of components/Figure.js inside it, with its line under it and its tone). When: a time
 *     (`at` a second line, the clock; `clip`; `warn` in coral, a time that needs a look). Cell: any other cell (`meta` for a small grey
 *     typewriter cell, `sign` for a short coral sign that names the row, like T1, `dim`, `faint`,
 *     `clip`, `line` for marks that stand in one line, wrapping).
 *   - Lead (the one Avatar of components/Avatar.js with `text` or `seed`, `agent`, `size`, `label`,
 *     `picture`; or any other mark as children), Tick (`state` = done | failed | active | pending |
 *     off; `bare` for the glyph without its box; `glyph` to say it in another mark), Thumb (a page's
 *     thumbnail) and the pick box (drawn by Row itself): the mark at the row's start.
 *   - Found: the words a search found, marked on the sun inside a name or its line.
 *   - Stats: a cell of fixed small counts (each a Stat with its `icon` and `title`), the last one a
 *     date that keeps its track, so the columns stand still down the list.
 *   - Doors: the actions at the end; `menu` adds the ⋯ menu (items { label, icon, onClick, danger }).
 *   - Panel: what an opened row shows under it, in the raised Object box; `doors` is the row of
 *     actions at its foot, `text` a long text shown as it was written.
 *
 *   The Row: `open` draws it opened (and its `panel`, if given as a prop); `onToggle` makes the whole
 *   row open and close it (a click anywhere but inside the panel, and Enter on its name); `selected`
 *   marks the one the page is showing; `faded` a thing that is past (retired, archived, outdated);
 *   `fine` a condition that is met (its words turn green); `rail="warn"` a heavy line at its start
 *   for a draft or a request that waits; `colour` the colour a person gave the thing (red, orange,
 *   yellow, green, blue, purple, gray), the same heavy line in that colour; `picked` + `onPick` (and
 *   `pickLabel`) make it a pick row (the whole row is the check box's label); `draggable` + the drag
 *   handlers (onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd) reorder it, `dragOver` marks
 *   the row a drag is over; `below` is what always shows under the row, without a frame; `panel`
 *   (+ `panelDoors`) what it shows opened; `id` is the anchor a page scrolls to (the first cell
 *   carries it, since the row draws no box of its own).
 *
 *   The List: `cols`, `keepCols`, `head` (the column labels; an entry { label, num, title } puts a
 *   label over a figure column at the right), `empty` (the line when there is nothing), `loading`
 *   (true, or the words to say), `dense` (a list inside a panel or under a row: less air, smaller
 *   words), `under` (it belongs to the row above it: it stands indented), `small` (a checklist under a
 *   field: small grey words, no rules), `scroll` (a long pick list in a capped box that scrolls),
 *   `apart` (it stands a little apart from the label or line above it), `id`. `tone`, the old app
 *   catalogue's detail lists (list-tones.css): 'history' (the states a thing had, newest first: each
 *   row one line, its number in the poster face, its facts in typewriter, its doors coral typewriter
 *   words; the old .dtl-version-row), 'switches' (a setting per row: its name, what its state means,
 *   the door that changes it; the old .mk-row), 'counts' (a small table of counts: the head in coral
 *   capitals over the ink rule, plain words, the counts in typewriter at the right; the old
 *   .vis-table), 'entries' (named entries, each a paragraph under its name, the heavy rule over the
 *   first; the old .dtl-skill), 'log' (what was done, newest first, each entry one line that wraps:
 *   the date and who in grey typewriter, the act in coral typewriter capitals, the name bold; the old
 *   .mk-log), 'pages' (a page a thing ought to have per row: its name with its marks after it and why
 *   under it, the doors beside both, the editor opened under the row; the old .lg-row), 'releases'
 *   (the history's look for every version kept, facts a step smaller, doors plain typewriter words: the
 *   old versions dialog, .version-row), 'tree' (a tree of plain lines, each level under its parent's row
 *   16px further in, its state a small coloured word; `attention` on a Name marks the one the tree is
 *   about, in bold: the old fork lineage, .lineage-node), 'checkpoints' (the history's rows for the saves a working copy
 *   passed: the time bold, the note under it in the page's letters; the old checkpoint rows).
 *   Rows come as children, or as `rows` with `render(item, i)`.
 *
 *   Group: the group heading over the rows after it (`title`, `count`, `onFold` + `folded` +
 *   `foldLabel`, `wholeHead` to fold from a click anywhere on it, `doors`, `quiet`, and `onDragOver`
 *   + `onDrop` to drop a row on it). Filters holds
 *   Filter tabs (`on`, `count`, `onClick`, `attention`, `end`); SearchLine (`value`, `onInput`,
 *   `onEnter`, `onClear`, `placeholder`, `label`, `note`, `text` for a plain text field); More
 *   (`label` + `onMore`, `note`, other doors as children).
 * @structure List · Row · Name · Desc · Who · Num · When · Cell · Doors · Panel · Lead · Tick ·
 *   Thumb · Found · Stats · Stat · Group · Filters · Filter · SearchLine · More
 * @usage html`<${List} cols="name-desc-doors" head=${[t('x.name'), t('x.does'), '']} empty=${t('x.none')}>
 *          ${items.map((it) => html`<${Row} key=${it.id} open=${open === it.id} panel=${html`…`}>
 *            <${Name} meta=${it.sub} tag=${'v' + it.version}>${it.name}<//>
 *            <${Desc}>${it.description}<//>
 *            <${Doors}><${Action} small row onClick=${() => toggle(it.id)}>${t('x.open')}<//><//>
 *          <//>`)}
 *        <//>`
 * @version-history
 *   v1.16.0 — 2026-09-27 — List tone 'checkpoints': the old detail's working-copy history rows
 *     (.dtl-version-row with .wc-ckpt-when and .wc-ckpt-note), list-tones.css. Additive, appcat parity
 *     (sections-a).
 *   v1.15.0 — 2026-09-27 — List tone 'releases': the history's look in the old versions dialog (its
 *     facts .72rem, its doors plain coral typewriter words 6px apart; .version-row), and 'tree': the old
 *     fork lineage's plain indented lines (.lineage-node), list-tones.css. Additive, appcat parity
 *     (dialogs).
 *   v1.14.0 — 2026-09-27 — List tone 'log' (the old app catalogue's audit log and declarations,
 *     .mk-log) and 'pages' (its legal pages, .lg-row), list-tones.css. Additive, appcat parity
 *     (sections-c).
 *   v1.13.0 — 2026-09-27 — List `tone` = 'history' | 'switches' | 'counts' | 'entries': the old app
 *     catalogue's detail lists (versions, the visitor measurement rows, the visitor tables, the
 *     skills of an app), drawn by css/components/list-tones.css. Additive, appcat parity (sections-b).
 *   v1.12.0 — 2026-09-27 — List `index`: the numbered index of the app catalogue (the old page's
 *     .cat-row and .cat-row-panel): each row its own line on the page's ground, the pointer's row on
 *     the surface, the opened row on the sun over an ink rule, its panel a line of doors with the
 *     words about it at the right, the last row closing on the heavy rule, the rows coming in one
 *     after another; on a phone a row wraps (list.css .list--index). Row `order`: its place in the
 *     list, which times its coming in. SearchLine `big` (the page's one search: the heavy underline,
 *     bold words; the old catalogue's .cat-search, its order row as a child) and `id` (the field's id,
 *     for a key that brings the focus to it). The cut n-mark-name-desc-state-n-arrow is in
 *     listing.css. Additive, for appcat.
 *   v1.11.2 — 2026-09-27 — Name `onFollow`: with `href`, the link's own click (a page that opens the
 *     thing in place keeps the address for a new tab: the fleet's agent names); Row `hover` now also
 *     turns a linked name coral (list.css). Additive, admin page group G9.
 *   v1.11.1 — 2026-09-27 — SearchLine `find`: the magnifier before the field (main's admin Cortex and
 *     Knowledge searches). Additive, admin page group G7.
 *   v1.11.0 — 2026-09-27 — Row `quietDoors`: the row's doors show only while the pointer is on the
 *     row, the keyboard is in it, or it is open or selected; they stay in the tab order, and on a
 *     phone they show only on the opened or selected row (main's admin Owners list, .adm-own-acts:
 *     the doors belong to one row at a time). List `stackWide`: a list of many columns stacks
 *     already under 1180px, not 860px, its `labels` said from there (main's admin GHII list,
 *     measured at 64 rows). Additive, page group G4 (admin).
 *   v1.10.0 — 2026-09-27 — A head entry's `onSort` + `sorted`: the column's name is the button that
 *     sorts the list, coral while sorted (main's admin Applications heads); a Doors menu keeps its
 *     `{ divider: true }` lines (the Applications row menu); Row `rail="notice"`: the heavy coral line
 *     at the row's start, a thing past its limit (main's admin Work row past its deadline).
 *     Additive, page group G5 (admin).
 *   v1.9.0 — 2026-09-27 — List `labels`: when the rows stack on a phone, each cell after the first
 *     says its column's name (the head's words) before its value, as the operator pages' tables did
 *     (main's data-l / data-label on the admin Packages and MSM rows); Name `marks`: tags in a
 *     wrapping line under the name's words (main's .adm-pk-parts). Additive, page group G8 (admin).
 *   v1.8.1 — 2026-09-27 — The Name's way in draws .list-name-link (list.css, the values of
 *     .og-tbl-name) instead of the space table's .og-tbl-name (Jouni: components draw only their own
 *     class names, a move).
 *   v1.8.0 — 2026-09-26 — Group `wholeHead`: a click anywhere on the heading folds it (main's memory
 *     collection head); Row `hover`: the name turns coral under the pointer on a row that opens
 *     nothing (main's .pf .mem-item:hover, the Access connection and MCP server rows); SearchLine
 *     `beside`: lines side by side in a row (main's memory search and filter); List scroll="medium"
 *     (capped at 300px, main's agent usage lists); additive, fix pass.
 *   v1.7.0 — 2026-09-26 — Desc `pre`: words a person wrote, their line breaks kept (an app's roadmap
 *     entry, main's .ap-road-text); additive, page group G6.
 *   v1.6.0 — 2026-09-26 — Cell `meta` takes `head` (a bold word on its own line over the typewriter
 *     words, `headDim` grey) and `sub` (a grey line under them): Extensions' who-uses-it column, main's
 *     .ex-me; additive, page group G6.
 *   v1.5.0 — 2026-09-26 — Desc `lines` (a description kept to 2–4 lines in the row) and `marks` (tags
 *     in a line under the words), Who `warn` (its line in coral), More `wrap` (the foot wraps on a
 *     phone): the Packages rows as main drew them (.pk-desc, .pk-parts, .is-warn, .pk-more); additive,
 *     page group G7.
 *   v1.4.0 — 2026-09-26 — Cell `code` (+ `sub`, `subQuiet`): the name code calls a thing by, typewriter
 *     in ink, with a grey line under it (the Libraries shelves' in-the-app column, main's .lb-me);
 *     additive, page group G8.
 *   v1.3.0 — 2026-09-26 — A Row may both open (`onToggle`) and be picked (`onPick`): the pick box is
 *     then its own first cell and not the row's label, and a press on it or on what stands `below`
 *     the row does not open the row (memory's old key list; additive, page group G3).
 *   v1.2.0 — 2026-09-26 — When `warn` (a time that needs a look, in coral: a key unused for 30 days,
 *     main's .ac-kwhen.is-low), and a dim Cell dims its row label too (main's .ac-rk.is-dim); additive,
 *     page group G3.
 *   v1.1.0 — 2026-09-26 — Row `grip` (the words of the drag handle ⠿ that hangs in the gutter before
 *     the name and shows while the pointer is on the row) and `dragging` (the row being dragged,
 *     dimmed): the agents list's drag-to-reorder, as main drew it; `pickOff`: a pick row whose box
 *     cannot be changed now (dimmed, the pointer says not allowed: a crew's decision tool with no
 *     key) (additive, page group G1a). Panel `title` + `mark`: the opened record's title in the
 *     poster record face with its status at the right (an agent's task; G1a).
 *   v1.0.0 — 2026-09-26 — Initial: the Listing's rows, cells, opened panel and heading row as one
 *     component, with the other list kinds of Settings as its options (component plan C1).
 */
import { h, createContext, Fragment } from 'preact';
import { useContext } from 'preact/hooks';
import htm from 'htm';
import { Actions } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { CardMenu } from '/components/CardMenu.js';
import { Tab } from '/components/Tabs.js';
import { Avatar } from '/components/Avatar.js';

const html = htm.bind(h);
/* No class at all rather than an empty one: the dense tone's words rule finds a plain cell by it. */
const cx = (...parts) => parts.filter(Boolean).join(' ') || undefined;
const RowContext = createContext({ toggles: false, open: false, draggable: false, anchor: null });
const given = (v) => v !== undefined && v !== null && v !== false && v !== '';
const COLOURS = new Set(['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray']);
const TICKS = { done: '✓', failed: '✗', active: '→', pending: '', off: '·', none: '' };
const LINES = new Set([2, 3, 4]);

/**
 * The props every cell passes to its element: the drag a row asks for, a tooltip, and the row's
 * anchor id, which the first cell takes (the row itself draws no box, so it cannot be scrolled to).
 */
function useCell(title, ownId) {
  const row = useContext(RowContext);
  const id = ownId || (row.anchor ? row.anchor.take() : undefined);
  // `labels` (added by page group G8): the column's name goes with the cell, said before its value
  // when the row stacks on a phone.
  const label = row.labels ? row.labels.take() : undefined;
  return { title, id, draggable: row.draggable ? 'true' : undefined, 'data-label': label || undefined };
}

function anchorOf(id) {
  let left = id;
  return { take: () => { const v = left; left = undefined; return v; } };
}

/* The column names of a List with `labels`, handed to its cells in the order they draw (G8). */
const ListContext = createContext(null);

function labelsOf(names) {
  let i = 0;
  return { take: () => names[i++] };
}

function headWord(entry) {
  const isEntry = entry && typeof entry === 'object' && !('type' in entry) && ('label' in entry);
  const label = isEntry ? entry.label : entry;
  return typeof label === 'string' || typeof label === 'number' ? String(label) : '';
}

/* ── The list ─────────────────────────────────────────────────────────────────────────────────── */

function headCell(entry, i) {
  const isEntry = entry && typeof entry === 'object' && !('type' in entry) && ('label' in entry);
  const label = isEntry ? entry.label : entry;
  // onSort + sorted (added by page group G5, admin): the column's name is the button that sorts the
  // list by it, coral while the list is sorted so (main's admin Applications table heads).
  const words = isEntry && typeof entry.onSort === 'function'
    ? html`<button type="button" class=${cx('list-sort', entry.sorted && 'is-sorted')} aria-pressed=${entry.sorted ? 'true' : 'false'} onClick=${entry.onSort}>${label ?? ''}</button>`
    : label ?? '';
  return html`<div key=${i} class=${cx('poster-label', isEntry && entry.num && 'listing-n')} title=${isEntry ? entry.title : undefined}>${words}</div>`;
}

/* List `tone` (added in the appcat parity pass, sections-b): the old app catalogue's detail lists.
   'log' and 'pages' added by sections-c (the old .mk-log and .lg-row). */
const LIST_TONES = new Set(['history', 'switches', 'counts', 'entries', 'log', 'pages', 'tree']);

export function List({ cols, keepCols, head, empty, loading, dense, under, small, scroll, apart, labels, stackWide, index, tone, id, rows, render, children }) {
  if (loading) return html`<div class="list-empty"><${Note} kind="loading">${typeof loading === 'string' ? loading : null}<//></div>`;
  const items = rows ? rows.map((r, i) => (render ? render(r, i) : r)) : children;
  const none = rows ? rows.length === 0 : (Array.isArray(children) ? children.flat(Infinity).filter(Boolean).length === 0 : !children);
  if (none && empty !== undefined && empty !== null) return html`<div class="list-empty">${typeof empty === 'string' ? html`<${Note} kind="quiet">${empty}<//>` : empty}</div>`;
  // index (added for appcat): the app catalogue's numbered index (list.css .list--index).
  const cls = cx('listing', cols && `listing--${cols}`, keepCols && 'listing--cols', dense && 'list--dense',
    under && 'list--under', small && 'list--small', scroll && 'list--scroll', scroll === 'medium' && 'list--scroll-medium',
    apart && 'list--apart', labels && head && 'list--labels', stackWide && !keepCols && 'list--stack-wide', index && 'list--index',
    LIST_TONES.has(tone) && `list--${tone}`, tone === 'releases' && 'list--history list--releases',
    tone === 'checkpoints' && 'list--history list--checkpoints');
  // tone 'checkpoints' (added by appcat sections-a, parity): the history's rows for the saves a
  // working copy passed, its time bold and its note under it in the page's own letters, its loud
  // door underlined typewriter on the slab (the old detail's checkpoint rows, list-tones.css).
  // tone 'releases' (added by appcat's dialogs, parity): the history's look for every version kept,
  // its facts a step smaller and its doors plain typewriter words (the old versions dialog, list-tones.css).
  // stackWide (added by page group G4, admin): a list of many columns stacks under 1180px (list.css).
  // scroll="medium" (added by the fix pass): capped at 300px rather than 17rem (main's
  // .pf-agd-event-log-scroll, an agent's usage lists).
  // labels (added by page group G8): when the rows stack on a phone, each cell after the first says
  // its column's name (the head's words) before its value, as the operator pages' tables did. Every
  // List provides the names (or none), so a list inside a row's panel never takes its outer list's.
  return html`<${ListContext.Provider} value=${labels && head ? head.map(headWord) : null}><div class=${cls} id=${id}>
    ${head ? html`<div class="listing-row listing-row--head">${head.map(headCell)}</div>` : null}
    ${items}
  </div><//>`;
}

/* ── One row ──────────────────────────────────────────────────────────────────────────────────── */

export function Row({ open, onToggle, selected, faded, fine, rail, colour, picked, onPick, pickLabel, draggable, dragOver,
  onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd, grip, dragging, pickOff, hover, quietDoors, below, panel, panelDoors, id, order, children }) {
  const toggles = typeof onToggle === 'function';
  // order (added for appcat): the row's place in the list, which times its coming in (list.css .list--index).
  const place = typeof order === 'number' ? `--list-order: ${order}` : undefined;
  // quietDoors (added by page group G4, admin): the doors show on the row under the pointer, the row
  // the keyboard is in, and the opened or selected row only (list.css .list-row--quiet-doors).
  const pick = typeof onPick === 'function';
  const hue = COLOURS.has(colour) ? colour : null;
  // hover (added by the fix pass): the name turns coral while the pointer is on the row, as main's
  // .pf .mem-item:hover drew the Access rows (connections, MCP servers) that open nothing.
  const cls = cx('listing-row', open && 'is-open', toggles && 'list-row--toggle', hover && !toggles && 'list-row--hover', selected && 'is-selected',
    faded && 'is-faded', fine && 'is-fine', rail === 'warn' && 'list-row--warn', rail === 'notice' && 'list-row--notice', hue && `list-row--colour list-colour--${hue}`,
    pick && !toggles && 'list-row--pick', draggable && 'list-row--drag', dragOver && 'is-drag-over',
    draggable && grip && 'list-row--grip', dragging && 'is-dragging', pick && pickOff && 'list-row--pick-off',
    quietDoors && 'list-row--quiet-doors');
  // A row that opens AND is picked (G3, memory's key list): its pick box and what stands below it
  // are their own controls, so a press on them does not open the row.
  const onClick = toggles ? (e) => { if (e.target.closest?.('.listing-open, .list-below, .list-pick')) return; onToggle(e); } : undefined;
  const anchor = id ? anchorOf(id) : null;
  const names = useContext(ListContext);
  const ctx = { toggles, open: !!open, draggable: !!draggable, anchor, grip: draggable ? grip : null, labels: names ? labelsOf(names) : null };
  const drag = draggable ? { onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd } : {};
  const Tag = pick && !toggles ? 'label' : 'div';
  return html`<${RowContext.Provider} value=${ctx}>
    <${Tag} class=${cls} style=${place} onClick=${onClick} ...${drag}>
      ${pick ? html`<div class="list-pick" id=${anchor ? anchor.take() : undefined}><input type="checkbox" checked=${!!picked} aria-label=${pickLabel} disabled=${pickOff} onChange=${onPick} /></div>` : null}
      ${children}
      ${below ? html`<div class="list-below">${below}</div>` : null}
      ${open && panel ? html`<${Panel} doors=${panelDoors}>${panel}<//>` : null}
    <//>
  <//>`;
}

/* ── The cells ────────────────────────────────────────────────────────────────────────────────── */

function tagsOf(tag) {
  if (tag === undefined || tag === null || tag === false || tag === '') return null;
  return (Array.isArray(tag) ? tag : [tag]).filter((x) => x !== undefined && x !== null && x !== false && x !== '')
    .map((x, i) => (typeof x === 'string' || typeof x === 'number' ? html`<${Mark} key=${i}>${x}<//>` : x));
}

/** `marks` of a Name (added by page group G8): tags in a wrapping line under its words (the parts a
 *  package carries, on the operator's Packages page). */
function nameMarks(marks) {
  const tags = tagsOf(marks);
  return tags && tags.length ? html`<span class="list-marks">${tags}</span>` : null;
}

export function Name({ onOpen, href, newTab, openLabel, meta, warn, clip, desc, note, noteTone, tag, after, dot, dotTitle,
  asKey, code, unread, attention, end, before, blurred, marks, title, id, nameRef, onFollow, children }) {
  const row = useContext(RowContext);
  const cell = useCell(title, id);
  // onFollow (added by admin page group G9): with `href`, the link's own click before the browser
  // follows it; the page may open the thing in place and call preventDefault, while the address
  // stays for a new tab (the fleet's agent names inside Settings & Controls).
  const text = code ? html`<code class="code-inline">${children}</code>` : children;
  const words = blurred ? html`<span class="list-blur">${text}</span>` : text;
  const nameCls = cx('list-name-link', asKey && 'key-name');
  let name;
  if (href) name = html`<a class=${nameCls} href=${href} target=${newTab ? '_blank' : undefined} rel=${newTab ? 'noopener' : undefined} aria-label=${openLabel} onClick=${onFollow}>${words}</a>`;
  else if (onOpen) name = html`<button type="button" class=${nameCls} aria-label=${openLabel} onClick=${onOpen}>${words}</button>`;
  else if (row.toggles) name = html`<button type="button" class=${nameCls} aria-expanded=${row.open ? 'true' : 'false'}>${words}</button>`;
  else name = asKey ? html`<span class="key-name">${words}</span>` : words;
  const descs = desc === undefined || desc === null || desc === '' ? [] : (Array.isArray(desc) ? desc : [desc]).filter((d) => d !== undefined && d !== null && d !== false && d !== '');
  return html`<div class=${cx('listing-name list-name', unread && 'is-unread', attention && 'is-attention', clip && (clip === 2 ? 'list-clip2' : 'list-clip'))} ref=${nameRef} ...${cell}>
    ${row.grip ? html`<span class="list-grip" title=${row.grip} aria-hidden="true">⠿</span>` : null}${dot ? html`<i class=${`status-dot status-dot--${dot}`} title=${dotTitle} aria-hidden=${dotTitle ? undefined : 'true'}></i>` : null}${given(end) ? html`<span class="list-end">${end}</span>` : null}${given(before) ? html`<span class="list-before">${before}</span>` : null}${name}${tagsOf(tag)}${after}
    ${meta !== undefined && meta !== null && meta !== '' ? html`<small class=${warn ? 'is-warn' : undefined}>${meta}</small>` : null}
    ${descs.map((d, i) => html`<p class="list-desc" key=${'d' + i}>${d}</p>`)}
    ${note ? html`<span class=${cx('list-note', noteTone === 'fine' && 'list-note--fine')}>${note}</span>` : null}
    ${nameMarks(marks)}
  </div>`;
}

/**
 * `lines` (2, 3 or 4, added by page group G7, Packages): a description that runs to a paragraph keeps
 * that many lines in the row, the opened panel shows the rest. `marks`: tags in a wrapping line under
 * the words (the kinds of part a package carries); a word or a Mark, or a list of them.
 */
export function Desc({ sub, clip, faint, lines, marks, pre, title, children }) {
  const words = LINES.has(lines) ? html`<span class=${`list-lines list-lines--${lines}`}>${children}</span>` : children;
  const tags = tagsOf(marks);
  // `pre` (added by page group G6): words a person wrote, kept with their own line breaks and broken
  // anywhere (an app's roadmap entry, main's .ap-road-text).
  return html`<div class=${cx('listing-desc list-words', clip && 'list-clip-cell', faint && 'list-faint', pre && 'list-pre')} ...${useCell(title)}>${words}${tags && tags.length ? html`<span class="list-marks">${tags}</span>` : null}${given(sub) ? html`<small>${sub}</small>` : null}</div>`;
}

/** `warn` (added by page group G7, Packages): the line under it in coral (a part the owner has edited). */
export function Who({ sub, clip, warn, title, children }) {
  return html`<div class=${cx('listing-who list-who', clip && 'list-clip-cell')} ...${useCell(title)}>${children}${given(sub) ? html`<small class=${warn ? 'is-warn' : undefined}>${sub}</small>` : null}</div>`;
}

/** A figure at the right of its column. A numeral in the poster face is the Figure (components/Figure.js) inside it. */
export function Num({ dim, strong, quiet, sign, title, children }) {
  return html`<div class=${cx(strong ? 'listing-name listing-n' : quiet ? 'listing-desc listing-n' : 'listing-n', dim && 'list-dim',
    sign && 'list-code list-code--soon')} ...${useCell(title)}>${children}</div>`;
}

export function When({ at, clip, warn, title, children }) {
  return html`<div class=${cx('list-when poster-time', clip && 'list-clip-cell', warn && 'list-when--warn')} ...${useCell(title)}>${at ? html`<b>${children}</b>${at}` : children}</div>`;
}

export function Cell({ meta, sign, dim, faint, clip, line, code, sub, subQuiet, head, headDim, title, children }) {
  // `meta` with `head` (+ `headDim`) and `sub` (added by page group G6): the typewriter cell with a
  // bold word on its own line over its words (ink, or grey with headDim: "nothing uses it") and a
  // grey line under them (Extensions' who-uses-it column, main's .ex-me).
  const cell = useCell(title);
  if (meta && (given(head) || given(sub))) {
    return html`<div class=${cx('list-meta-cell', dim && 'list-dim', clip && 'list-clip-cell')} ...${cell}>${given(head) ? html`<b class=${cx('list-meta-head', headDim && 'list-meta-head--dim')}>${head}</b>` : null}${children}${given(sub) ? html`<small class="list-meta-sub">${sub}</small>` : null}</div>`;
  }
  // `code` (added by page group G8): the name code calls a thing by, in the typewriter face in ink,
  // with an optional grey `sub` line under it (`subQuiet`: that line in italics, "nothing yet").
  if (code) {
    return html`<div ...${cell}><span class="list-code-words">${children}${given(sub) ? html`<small class=${subQuiet ? 'list-code-words--quiet' : undefined}>${sub}</small>` : null}</span></div>`;
  }
  return html`<div class=${cx(meta && 'list-meta-cell', sign && 'list-code', dim && 'list-dim', faint && 'list-faint', clip && 'list-clip-cell', line && 'list-line')} ...${cell}>${children}</div>`;
}

/** The ⋯ menu of a row: the library's CardMenu in the line of the doors. */
function RowMenu({ items, label }) {
  // A { divider: true } item stays a divider (added by page group G5, admin: the Applications row
  // menu's line between its groups); no caller passed one before, so nothing existing changes.
  const actions = (items || []).filter(Boolean).map((it) => (it.divider ? { divider: true } : {
    label: it.icon ? `${it.icon} ${it.label}` : it.label, run: it.onClick || it.run, danger: it.danger,
  }));
  if (!actions.some((a) => !a.divider)) return null;
  return html`<${CardMenu} inline="end" actions=${actions} label=${label} />`;
}

export function Doors({ menu, menuLabel, title, children }) {
  return html`<div class="listing-doors" ...${useCell(title)}>${children}${menu ? html`<${RowMenu} items=${menu} label=${menuLabel} />` : null}</div>`;
}

export function Panel({ doors, text, id, title, mark, children }) {
  // title + mark (added by page group G1a): the opened record's own title in the poster record face,
  // with its status mark at the right (an agent's task).
  return html`<div class="listing-open poster-box poster-box--raised" id=${id}>
    ${title ? html`<div class="list-panel-head"><h3 class="poster-record-title poster-record-title--small list-panel-title">${title}</h3>${mark}</div>` : null}
    ${text ? html`<p class="list-text">${text}</p>` : null}
    ${children}
    ${doors ? html`<${Actions} under>${doors}<//>` : null}
  </div>`;
}

/* ── The marks at a row's start ───────────────────────────────────────────────────────────────── */

/**
 * The cell of the mark at a row's start. With `text` or `seed` it draws the one Avatar
 * (components/Avatar.js: `agent`, `size`, `label` pass through); a picture as `picture` goes into the
 * Avatar too; any other mark (a colour picker, a dot) comes as children.
 */
export function Lead({ text, seed, agent, size, label, picture, title, children }) {
  const avatar = given(text) || given(seed) || given(picture);
  return html`<div ...${useCell(title)}>${avatar ? html`<${Avatar} text=${text} seed=${seed} agent=${agent} size=${size} label=${label}>${picture}<//>` : children}</div>`;
}

export function Tick({ state = 'none', bare, glyph, title }) {
  const mark = glyph ?? TICKS[state] ?? '';
  return html`<div ...${useCell(title)}><span class=${cx(bare ? 'list-glyph' : 'list-tick', `list-tick--${state}`)} aria-hidden="true">${mark}</span></div>`;
}

export function Thumb({ title }) {
  return html`<div ...${useCell(title)}><div class="list-thumb" aria-hidden="true"><i></i><i class="poster-chip--sun"></i></div></div>`;
}

/** A search's words found in a name or its line (Discover), on the sun ground of poster.css. */
export function Found({ children }) {
  return html`<mark class="poster-chip--sun list-found">${children}</mark>`;
}

/* ── Fixed small counts ───────────────────────────────────────────────────────────────────────── */

export function Stats({ title, children }) {
  return html`<div ...${useCell(title)}><div class="list-stats">${children}</div></div>`;
}

/** One count in Stats: its `icon` before the number; `date` keeps the last track; empty holds its place. */
export function Stat({ icon, date, title, children }) {
  return html`<span class=${cx('list-stat', date && 'list-stat--date poster-time')} title=${title}>${icon ? html`${icon} ` : null}${children}</span>`;
}

/* ── A heading over some rows ─────────────────────────────────────────────────────────────────── */

/**
 * The group heading (Jouni's decision "Group heading") over the rows that follow it, with the tally
 * count at its end. `onFold` gives it the arrow that folds the group (`folded`, `foldLabel`);
 * `doors` stand after the count; `quiet` is the grey heading over a record; `onDragOver` + `onDrop`
 * make the heading a place to drop a row.
 */
export function Group({ title, count, folded, onFold, foldLabel, doors, quiet, wholeHead, onDragOver, onDrop, children }) {
  const foldable = typeof onFold === 'function';
  // wholeHead (added by the fix pass): a click anywhere on the heading folds it, as main's memory
  // collection head (.mem-cart-head, cursor:pointer) did; a press on the ↓ or on a door does not
  // fold twice. The ↓ stays the keyboard's way in.
  const headFolds = foldable && wholeHead;
  const stop = headFolds ? (e) => e.stopPropagation() : undefined;
  return html`<${Fragment}>
    <div class=${cx('poster-day-title list-group-head', quiet && 'poster-day-title--quiet', headFolds && 'list-group-head--folds')}
      onClick=${headFolds ? onFold : undefined} onDragOver=${onDragOver} onDrop=${onDrop}>
      ${foldable ? html`<button type="button" class="poster-icon poster-icon--small" title=${foldLabel} aria-label=${foldLabel}
        aria-expanded=${folded ? 'false' : 'true'} onClick=${headFolds ? (e) => { e.stopPropagation(); onFold(e); } : onFold}>${folded ? '→' : '↓'}</button>` : null}
      <span class="list-group-title">${title}</span>
      ${count !== undefined && count !== null ? html`<${Mark} kind="count" tone="tally">${count}<//>` : null}
      ${doors ? html`<span class="list-group-doors" onClick=${stop}>${doors}</span>` : null}
    </div>
    ${foldable && folded ? null : children}
  <//>`;
}

/* ── Around a list: filters, search, more ─────────────────────────────────────────────────────── */

/**
 * The row of filters over a list, where each filter is its own on-or-off (a facet row): the filter
 * row of the Tabs component (components/Tabs.js, css/components/tab-row.css). A row where exactly
 * one of the choices is on is `<Tabs tone="filter">` itself.
 */
export function Filters({ label, children }) {
  return html`<div class="tab-row tab-row--filter" role="group" aria-label=${label}>${children}</div>`;
}

/**
 * One filter: the Tab in its filter tone (Jouni's decision "Tabs and filters"), the chosen one on the
 * sun, its count the tally Count. `attention` for a filter that points at something to look at,
 * `end` for the one that stands apart at the row's end.
 */
export function Filter({ on, count, onClick, attention, end, disabled, title, children }) {
  const tab = html`<${Tab} tone="filter" on=${!!on} pressed=${!!on} count=${count} attention=${attention} disabled=${disabled} title=${title} onClick=${onClick}>${children}<//>`;
  return end ? html`<span class="list-filter--end">${tab}</span>` : tab;
}

/**
 * The search line over a list: the field, and `note` (what the search looks in, or how many it
 * shows) or other doors after it. `onEnter` runs on Enter; `onClear` adds the ✕ while there is text.
 */
export function SearchLine({ value, onInput, onEnter, onClear, placeholder, label, note, text, autofocus, clearLabel, beside, find, big, id, children }) {
  // beside (added by the fix pass): one of several lines side by side in a Row, each growing up to
  // 500px, under each other on a phone (main's memory list: search and filter in one .action-bar).
  // find (added by admin page group G7): the magnifier before the field, as the operator pages'
  // searches drew it (main's admin Cortex and Knowledge searches).
  // big + id (added for appcat): the page's one search (the old catalogue's .cat-search: the heavy
  // underline, bold words, no autocomplete, no spellcheck), the field's id for a key that focuses it.
  return html`<div class=${cx('search-line', beside && 'search-line--beside', big && 'search-line--big')}>
    ${find ? html`<svg class="search-line-glass" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4.3-4.3" /></svg>` : null}
    <input class="og-input" id=${id} type=${text ? 'text' : 'search'} value=${value} placeholder=${placeholder} aria-label=${label || placeholder}
      autocomplete=${big ? 'off' : undefined} spellcheck=${big ? false : undefined}
      autofocus=${autofocus} onInput=${onInput} onKeyDown=${onEnter ? (e) => { if (e.key === 'Enter') onEnter(e); } : undefined} />
    ${onClear && value ? html`<button type="button" class="poster-icon poster-icon--small" title=${clearLabel} aria-label=${clearLabel} onClick=${onClear}>✕</button>` : null}
    ${children}
    ${note !== undefined && note !== null && note !== '' ? html`<small>${note}</small>` : null}
  </div>`;
}

/**
 * The line under a list: "show N more" (`label`, shown while `onMore` is given), "shown of total"
 * (`note`), and any other doors of the list's foot as children.
 */
export function More({ label, onMore, disabled, note, wrap, children }) {
  // wrap (added by page group G7, Packages): a foot with more doors than one line holds on a phone wraps.
  return html`<div class=${cx('more-line', wrap && 'list-more--wrap')}>
    ${onMore ? html`<button type="button" class="poster-action poster-action--more" disabled=${disabled} onClick=${onMore}>${label}</button>` : null}
    ${note !== undefined && note !== null && note !== '' ? html`<small>${note}</small>` : null}
    ${children}
  </div>`;
}

export default List;
