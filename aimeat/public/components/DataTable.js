import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);

/**
 * @file DataTable.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Canonical generic table primitive — renders a plain
 *   `<table class="data-table ${className}">` (optionally inside a `.scrollable`
 *   wrapper) backed by the shared `.data-table` block in theme.css, so the table
 *   look (header row, cell padding, borders, hover) is one tokenized source of
 *   truth that flips correctly in dark mode. Unlike the admin `DataTable` (which
 *   wraps this in an `.adm-card`), this component renders NO card/container — the
 *   caller supplies its own wrapper (`.card`, `.adm-card`, etc.).
 * @structure DataTable({ headers, rows, scroll, className, compact, stack, form })
 *   - headers: array of column header cells (string or VNode)
 *   - rows: array of rows; each row is an array of cells. A cell may be:
 *       • a primitive/VNode → rendered as plain `<td>`
 *       • `{ text, mono?, title?, _html? }` → `<td class="mono"? title=...>`;
 *         when `_html: true`, `text` is rendered as raw HTML (see SECURITY).
 *   - scroll: when truthy, wraps the table in `<div class="scrollable">`
 *   - className: extra class(es) appended to `.data-table` (e.g. for column-width
 *     or per-view tweaks)
 *   - compact: a table to choose from inside a dialog: ink words at .85rem, 6px 8px cells, small
 *     controls, no hover (the app catalogue's backup import)
 *   - stack: on a phone (560px and narrower) each row becomes one block and each cell is labelled with
 *     its column head (a string head; a cell under a head that is not a string has no label). A table
 *     of controls, one row per item, edited on a phone too (the data product wizard's columns).
 *   - form: the cells hold controls (a check, a text field, a select): a control fills its cell, the
 *     cells sit on one middle line, and a row does not change colour under the pointer.
 *   - grow: the index of the column that takes the room the others leave (a description field).
 *   - nowrap: every cell keeps one line; with `scroll`, a wide preview scrolls sideways.
 * @usage
 *   import { DataTable } from '/components/index.js';
 *   html`<div class="card"><${DataTable} headers=${['Key','Value']} rows=${rows} /></div>`
 *
 * SECURITY: When a cell object has `_html: true`, `cell.text` is rendered as raw
 * HTML via dangerouslySetInnerHTML. Callers MUST ensure `cell.text` is sanitized
 * (use escHtml() for any user-generated content). Only use `_html` for trusted,
 * server-generated markup like badges.
 *
 * @version-history
 *   v1.3.0 — 2026-11-01 — `grow` (one column takes the free room) and `nowrap` (cells keep one line);
 *     additive, data-table.css .data-table-grow, .data-table--nowrap (the wizard's steps 2 and 3, WP10e).
 *   v1.2.0 — 2026-11-01 — `stack` (one block per row on a phone, each cell labelled with its head) and
 *     `form` (cells that hold controls); additive, data-table.css .data-table--stack, .data-table--form
 *     (the data product wizard's step 2, WP9c).
 *   2026-09-28 — The table sits in .data-table-wrap, which scrolls sideways when the columns are wider than the
 *     page; at 390 px the admin sharing-groups table lost its last column to the page's overflow.
 *   v1.1.0 — 2026-09-27 — `compact`: the old app catalogue's backup import table (.backup-table), for
 *     appcat parity; additive, data-table.css .data-table--compact.
 *   v1.0.0 — 2026-06-02 — Component unification (#13): created canonical generic
 *     DataTable (same _html/mono cell protocol as admin's), backing the shared
 *     .data-table CSS. The admin shared.js DataTable now wraps this in .adm-card.
 */
export function DataTable({ headers, rows, scroll, className, compact, stack, form, grow, nowrap }) {
  // compact (added by appcat's dialogs, parity): a table to choose from inside a dialog, its words in
  // ink at .85rem in close cells, its controls small (the old catalogue's backup import, .backup-table).
  // stack and form (added by the data product wizard, WP9c): a table of controls that stacks on a phone.
  // grow and nowrap (added by the data product wizard, WP10e): the column that takes the room the others
  // leave (a description field), and cells that keep one line (a preview of rows, in its scroll box).
  const cls = `data-table${compact ? ' data-table--compact' : ''}${stack ? ' data-table--stack' : ''}${form ? ' data-table--form' : ''}${nowrap ? ' data-table--nowrap' : ''}${className ? ` ${className}` : ''}`;
  // Each cell's label on a stacked phone row: its column head, when the head is words.
  const labelOf = (i) => (stack && typeof headers[i] === 'string' ? headers[i] : undefined);
  const growOf = (i, base = '') => [base, grow === i ? 'data-table-grow' : ''].filter(Boolean).join(' ') || undefined;
  const table = html`<table class=${cls}>
    <thead><tr>${headers.map((hd, i) => html`<th class=${growOf(i)}>${hd}</th>`)}</tr></thead>
    <tbody>
      ${rows.map(row => html`<tr>
        ${row.map((cell, i) => {
          if (cell && typeof cell === 'object' && cell._html) {
            return html`<td class=${growOf(i, cell.mono ? 'mono' : '')} title=${cell.title || ''} data-label=${labelOf(i)}
              dangerouslySetInnerHTML=${{ __html: cell.text }}></td>`;
          }
          if (cell && typeof cell === 'object' && cell.mono) {
            return html`<td class=${growOf(i, 'mono')} title=${cell.title || ''} data-label=${labelOf(i)}>${cell.text}</td>`;
          }
          return html`<td class=${growOf(i)} data-label=${labelOf(i)}>${cell}</td>`;
        })}
      </tr>`)}
    </tbody>
  </table>`;
  // The wrapper scrolls sideways when the columns are wider than the page (a phone): without it the
  // page's overflow cut the last columns off where nobody could reach them. When the table fits,
  // nothing about it changes.
  const wrapped = html`<div class="data-table-wrap">${table}</div>`;
  return scroll ? html`<div class="scrollable">${wrapped}</div>` : wrapped;
}
