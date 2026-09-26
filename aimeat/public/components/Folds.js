/**
 * @file public/components/Folds.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Rows that open in place, and rows that tell what happened (component plan C9, page
 *   parts): the coral mono number or time on the left, the name, a mono word at the right and the
 *   arrow that says whether the row is open. A page passes data and never writes a class. Its look
 *   is css/components/fold-row.css (.og-folds, .og-fold, shared with the admin).
 *
 *   Folds: the list the rows stand in (a hairline between them).
 *   FoldRow, one row, in one of three kinds:
 *   - 'event' (the default when it has onClick): a thing that happened or a record to open, the
 *     name in bold: num (the time), who (who did it), verb (what they did), name.
 *   - 'toggle': a row that opens a part of the page, larger (the step of a calibration, "Add by
 *     hand"): num, name, right, the arrow; `done` shows a finished step's number in green.
 *   - 'row' (the default without onClick): a line that only says something (a history line).
 *   With `open` (true or false) the row says aria-expanded and shows the arrow (↓ open, → shut).
 *   With `body`, the row keeps its own open state (`defaultOpen`) unless `open` is given, and draws
 *   the body under itself while open; `onToggle(next)` hears every change.
 *   `isKey` sets the name as a memory key (.key-name); children stand after the name (tags, a time);
 *   `right` is the mono word at the right. `doors`: the row's own actions (icon buttons), which stand
 *   after the row's button on its line and show while the pointer or the keyboard is on the row.
 * @structure Folds({ children }) · FoldRow({ kind, num, who, verb, name, isKey, right, open, done,
 *   body, defaultOpen, onToggle, onClick, title, doors, children })
 * @usage html`<${Folds}>${events.map((e) => html`<${FoldRow} key=${e.id} num=${rel(e.at)} who=${e.actor} verb=${x('edited')} name=${e.title} onClick=${() => go(e)} />`)}<//>`
 *        html`<${FoldRow} kind="toggle" name=${x('addManual')} right=${x('addManualSub')} open=${f.open} onClick=${() => setOpen(!f.open)} />`
 * @version-history
 *   v1.1.0 — 2026-09-26 — FoldRow `doors`: a row's own actions beside its button, shown on hover and
 *     focus, as main's memory key groups showed their search and delete (additive, page group G3).
 *   v1.0.0 — 2026-09-26 — Initial: the og-fold rows the pages wrote by hand, as data (component plan C9).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');
const shown = (v) => v !== null && v !== undefined && v !== '' && v !== false;

export function Folds({ children }) {
  return html`<div class="og-folds">${children}</div>`;
}

/**
 * @param {{ kind?: 'event'|'toggle'|'row', num?: any, who?: any, verb?: any, name?: any, isKey?: boolean,
 *   right?: any, open?: boolean, done?: boolean, body?: any, defaultOpen?: boolean,
 *   onToggle?: (next: boolean) => void, onClick?: (e: Event) => void, title?: string, doors?: any,
 *   children?: any }} props
 */
export function FoldRow({ kind, num, who, verb, name, isKey, right, open, done, body, defaultOpen, onToggle, onClick, title, doors, children }) {
  const [own, setOwn] = useState(!!defaultOpen);
  const keeps = body !== undefined && open === undefined;
  const isOpen = keeps ? own : open;
  const opens = isOpen !== undefined;
  const press = (e) => {
    if (keeps) { setOwn(!own); onToggle?.(!own); } else if (opens) onToggle?.(!isOpen);
    onClick?.(e);
  };
  const k = kind || (onClick || keeps || onToggle ? 'event' : 'row');
  const arrow = opens ? html`<span class="og-fold-arrow">${isOpen ? '↓' : '→'}</span>` : null;
  const parts = html`
    ${shown(num) ? html`<i>${num}</i>` : null}
    ${shown(who) ? html`<span class="og-fold-who">${who}</span>` : null}
    ${shown(verb) ? html`<span>${verb}</span>` : null}
    ${shown(name) ? (k === 'event' ? html`<b class=${isKey ? 'key-name' : undefined}>${name}</b>`
      : html`<span class=${isKey ? 'key-name' : undefined}>${name}</span>`) : null}
    ${children}
    ${shown(right) ? html`<span class="og-fold-r">${right}</span>` : null}
    ${arrow}`;
  const bare = k === 'row'
    ? html`<div class="og-fold" title=${title}>${parts}</div>`
    : html`<button type="button" class=${cx('og-fold', k === 'toggle' ? 'og-fold--toggle' : 'og-fold--event', done && 'og-fold--done')}
        title=${title} aria-expanded=${opens ? String(!!isOpen) : undefined} onClick=${press}>${parts}</button>`;
  // `doors`: actions of the row that stand beside its button (a button holds no button), shown while
  // the pointer or the keyboard is on the row (G3: memory's search-in and delete of a key group).
  const row = doors ? html`<div class="fold-row-line">${bare}<span class="fold-row-doors">${doors}</span></div>` : bare;
  return body !== undefined ? html`${row}${isOpen ? body : null}` : row;
}

export default FoldRow;
