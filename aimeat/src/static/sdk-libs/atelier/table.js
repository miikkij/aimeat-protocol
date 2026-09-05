/**
 * @file atelier/table.js
 * @description The data table and the search bar. The table scrolls INSIDE ITS OWN BOX — it
 *   never widens the page (the finish gate measures horizontal overflow at 390px, and a wide
 *   table is the classic way to fail it). Real table semantics, sortable headers as buttons
 *   with aria-sort, figures in tabular numerals.
 *
 *   The search bar answers as you type (debounced), clears with one press, and reports rather
 *   than filters — what the query means is the host's business.
 * @structure table(spec) → { el, set, destroy } · searchBar(spec) → { el, set, destroy }
 * @usage  AIMEAT.atelier.table({ target: host,
 *           columns: [{ key: 'name', label: 'Name', sortable: true }, { key: 'n', label: 'Count', align: 'right' }],
 *           rows });
 * @parts table root · table · head · headcell · sort · body · row · cell · caption
 * @slots table cell(value, row, column) · head(column) · row(row)
 * @variants table dense · plain · lined
 * @tokens table --ak-table-cell-pad-y · --ak-table-cell-pad-x
 * @fork table Copy .ak-table* out of content.css; you keep the tokens and the tabular numerals, and you give up the keyed body, so a sort stops being seen as a move.
 * @parts searchBar root · input · clear
 * @slots searchBar aside()
 * @variants searchBar dense · plain
 * @fork searchBar Two elements and a debounce; copy them if the shape is wrong.
 * @version-history
 *   v0.51.0 — 2026-09-05 — THE CELL AND THE HEADING TAKE WHAT THE APP GIVES THEM: `parts.cell`
 *     (value, row, column) and `parts.head` (column) accept a node where `format` only ever
 *     accepted a string, `parts.row` replaces a whole row, every element carries `data-ak-part`
 *     plus `data-ak-key`, and three variants (dense, plain, lined) ride two padding tokens.
 *   v0.50.0 — 2026-09-05 — THE ROWS ARE KEPT, so the table MOVES instead of blinking. The body is
 *     reconciled by row identity (`key`, else the row's own id, else the first column's value)
 *     through the kit's keyed reconciler: a row that arrived rises in, a row that left fades out
 *     where it stood, and a SORT carries every row from where it was standing to where it now is
 *     — the change a rebuilt tbody could never show, because every row was a new element.
 *   v0.3.0 — 2026-08-27 — Initial (TARGET-074 phase 1, slice 3).
 */
import { el, clear, resolve } from './dom.js';
import { keyedRows } from './arrive.js';
import { t } from './i18n.js';
import { emptyState } from './state.js';
import { slotInto, applyVariant, partValue, fillPart } from './parts-model.js';

const TABLE_VARIANTS = ['dense', 'plain', 'lined'];

/** Which record a kept row is showing right now. A row survives a sort, so the handler made when
 *  it was built must not close over the record it had then. */
const RECORD = new WeakMap();

/**
 * @typedef {object} TableColumn
 * @property {string} key
 * @property {string} label
 * @property {'left'|'right'} [align]
 * @property {boolean} [sortable]
 * @property {(value: any, row: any) => string} [format]
 */

/**
 * The data table.
 * @param {{
 *   target?: string|Element, columns: TableColumn[], rows: Array<Record<string, any>>,
 *   caption?: string, onPick?: (row: any) => void, key?: (row: any, index: number) => string,
 *   empty?: { title?: string, hint?: string },
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { rows?: any[] }) => void, destroy: () => void }}
 */
export function table(spec) {
  const columns = spec.columns || [];
  let rows = spec.rows || [];
  /** What makes a row the same row across a change: what the host says, else the row's own id,
   *  else the first column's value. Without one, every re-render is a rebuild and no row can be
   *  seen to travel — which is what the table did until 0.50.0. */
  const keyOf = spec.key || function (row, i) {
    if (row && row.id != null) return String(row.id);
    const first = columns[0] && row ? row[columns[0].key] : null;
    return first == null ? 'row-' + i : String(first);
  };
  /** @type {{ key: string, dir: 1|-1 }|null} */
  let sort = null;

  const thead = el('thead', { 'data-ak-part': 'head' });
  const tbody = el('tbody', { 'data-ak-part': 'body' });
  const tableEl = el('table', { class: 'ak-table__table', 'data-ak-part': 'table' }, [
    spec.caption ? el('caption', { class: 'ak-sr-only', 'data-ak-part': 'caption', text: spec.caption }) : null,
    thead, tbody,
  ]);
  const root = el('div', { class: 'ak-root ak-table', 'data-ak-part': 'root' }, tableEl);
  applyVariant(root, spec, TABLE_VARIANTS);
  if (spec.target) resolve(spec.target).appendChild(root);
  let emptyCard = null;

  function renderHead() {
    clear(thead);
    const tr = el('tr');
    for (const col of columns) {
      const sorted = sort && sort.key === col.key ? (sort.dir === 1 ? 'ascending' : 'descending') : null;
      const th = el('th', {
        scope: 'col',
        class: col.align === 'right' ? 'ak-table__num' : null,
        'data-ak-part': 'headcell',
        'data-ak-key': col.key,
        'aria-sort': sorted,
      });
      // The heading the app wrote for this column, when it wrote one; the column's own label
      // otherwise. A node is welcome — a unit under the name, a mark beside it.
      const given = partValue(spec, 'head', col);
      const heading = given === undefined ? col.label : given;
      if (col.sortable) {
        const btn = el('button', {
          type: 'button', class: 'ak-table__sort', 'data-ak-part': 'sort', 'data-ak-noguard': true,
          on: {
            click: function () {
              sort = sort && sort.key === col.key
                ? { key: col.key, dir: sort.dir === 1 ? -1 : 1 }
                : { key: col.key, dir: 1 };
              renderHead();
              renderBody();
            },
          },
        });
        if (!fillPart(btn, heading)) btn.textContent = col.label;
        if (sorted) btn.appendChild(document.createTextNode(sorted === 'ascending' ? ' ↑' : ' ↓'));
        th.appendChild(btn);
      } else if (!fillPart(th, heading)) {
        th.textContent = col.label;
      }
      tr.appendChild(th);
    }
    thead.appendChild(tr);
  }

  function sortedRows() {
    if (!sort) return rows;
    const key = sort.key;
    const dir = sort.dir;
    return rows.slice().sort(function (a, b) {
      const av = a[key];
      const bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }

  /** One row's cells, shared by build and update so the two can never drift.
   *  `parts.row` replaces the whole row, `parts.cell` one cell at a time; the column's own
   *  `format` stays what it was, so nothing that already works has to move to the new door. */
  function fillRow(tr, row) {
    clear(tr);
    const wholeRow = partValue(spec, 'row', row);
    if (wholeRow !== undefined) { fillPart(tr, wholeRow); return; }
    for (const col of columns) {
      const raw = row[col.key];
      const given = partValue(spec, 'cell', raw, row, col);
      const own = col.format ? col.format(raw, row) : raw == null ? '' : String(raw);
      const td = el('td', {
        class: col.align === 'right' ? 'ak-table__num' : null,
        'data-ak-part': 'cell', 'data-ak-key': col.key,
      });
      fillPart(td, given === undefined ? own : given);
      tr.appendChild(td);
    }
  }

  function renderBody() {
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    tableEl.hidden = !rows.length;
    if (!rows.length) {
      clear(tbody);
      const e = spec.empty || {};
      emptyCard = emptyState({
        target: root, tone: 'quiet',
        title: e.title || t('empty'), hint: e.hint || t('emptyHint'),
      });
      return;
    }
    const pickable = typeof spec.onPick === 'function';
    keyedRows(tbody, sortedRows(), {
      key: keyOf,
      build: function (row) {
        // The record travels with the element, so a pick after a sort reports the row that is
        // under the finger rather than the one that stood there when the handler was made.
        const tr = el('tr', {
          class: pickable ? 'ak-table__row--pick' : null,
          'data-ak-part': 'row',
          tabindex: pickable ? '0' : null,
          on: pickable ? {
            click: function () { if (spec.onPick) spec.onPick(RECORD.get(tr)); },
            keydown: function (ev) {
              if (ev.key === 'Enter' && spec.onPick) spec.onPick(RECORD.get(tr));
            },
          } : null,
        });
        RECORD.set(tr, row);
        fillRow(tr, row);
        return tr;
      },
      update: function (tr, row) { RECORD.set(tr, row); fillRow(tr, row); },
    });
  }

  renderHead();
  renderBody();

  return {
    el: root,
    /** @param {{ rows?: any[] }} patch */
    set(patch) {
      if (!patch) return;
      if (patch.rows) { rows = patch.rows; renderBody(); }
    },
    destroy() {
      if (emptyCard) emptyCard.destroy();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}

/** How long typing may pause before the search reports (short enough to feel live). */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * The search bar.
 * @param {{
 *   target?: string|Element, value?: string, placeholder?: string, label?: string,
 *   onChange?: (query: string) => void, onSubmit?: (query: string) => void,
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { value?: string }) => void, destroy: () => void }}
 */
export function searchBar(spec) {
  let timer = null;
  const input = el('input', {
    type: 'search', class: 'ak-input ak-search__input', 'data-ak-part': 'input',
    placeholder: spec.placeholder || t('search'),
    'aria-label': spec.label || t('search'),
    on: {
      input: function () {
        if (!spec.onChange) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () { timer = null; if (spec.onChange) spec.onChange(inputEl.value); }, SEARCH_DEBOUNCE_MS);
      },
      keydown: function (ev) {
        if (ev.key === 'Enter' && spec.onSubmit) { ev.preventDefault(); spec.onSubmit(inputEl.value); }
      },
    },
  });
  const inputEl = /** @type {HTMLInputElement} */ (input);
  if (spec.value != null) inputEl.value = spec.value;

  const clearBtn = el('button', {
    type: 'button', class: 'ak-search__clear', 'data-ak-part': 'clear',
    'aria-label': t('close'), 'data-ak-noguard': true,
    on: {
      click: function () {
        inputEl.value = '';
        inputEl.focus();
        if (spec.onChange) spec.onChange('');
      },
    },
  }, '×');

  const root = el('div', { class: 'ak-root ak-search', role: 'search', 'data-ak-part': 'root' }, [input, clearBtn]);
  applyVariant(root, spec, ['dense', 'plain']);
  slotInto(root, spec, 'aside', null, { cls: 'ak-search__aside' });
  if (spec.target) resolve(spec.target).appendChild(root);

  return {
    el: root,
    /** @param {{ value?: string }} patch */
    set(patch) {
      if (patch && patch.value != null) inputEl.value = patch.value;
    },
    destroy() {
      if (timer) clearTimeout(timer);
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
