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
 * @structure DataTable({ headers, rows, scroll, className })
 *   - headers: array of column header cells (string or VNode)
 *   - rows: array of rows; each row is an array of cells. A cell may be:
 *       • a primitive/VNode → rendered as plain `<td>`
 *       • `{ text, mono?, title?, _html? }` → `<td class="mono"? title=...>`;
 *         when `_html: true`, `text` is rendered as raw HTML (see SECURITY).
 *   - scroll: when truthy, wraps the table in `<div class="scrollable">`
 *   - className: extra class(es) appended to `.data-table` (e.g. for column-width
 *     or per-view tweaks)
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
 *   v1.3.0 — 2026-09-22 — A header may be { label, sortKey }: with `sort` ({ key, dir }) and `onSort`
 *     it is a sort button and aria-sort, and its label still names the column when rows stack on a
 *     phone. `rowTones` mutes a row (taken down, disabled) or marks it coral or danger (late); a cell with `clamp: true` keeps to one
 *     line and shows its whole text as a tooltip. A plain { text } cell renders its text.
 *   v1.2.0 — 2026-09-22 — A cell object may carry `align: 'end'` (an amount, a count), and an empty
 *     `headers` list draws no header row.
 *   v1.1.0 — 2026-09-22 — Each cell carries its column's header text as data-label, so the shared
 *     Table can stack a row as label-value pairs on a phone (components/poster-parts.js Table collapse).
 *   v1.0.0 — 2026-06-02 — Component unification (#13): created canonical generic
 *     DataTable (same _html/mono cell protocol as admin's), backing the shared
 *     .data-table CSS. The admin shared.js DataTable now wraps this in .adm-card.
 */
/** A header given as { label, sortKey } is a column the person can sort by. */
const isSortHeader = (hd) => hd && typeof hd === 'object' && !('props' in hd) && 'label' in hd;
/** A cell object ({ text, ... }), as opposed to a primitive or a VNode. */
const isCellObject = (cell) => cell && typeof cell === 'object' && !('props' in cell) && 'text' in cell;

export function DataTable({ headers, rows, scroll, className, sort, onSort, rowTones }) {
  const cls = `data-table${className ? ` ${className}` : ''}`;
  const th = (hd) => {
    if (!isSortHeader(hd)) return html`<th>${hd}</th>`;
    if (!hd.sortKey || !onSort) return html`<th>${hd.label}</th>`;
    const on = sort && sort.key === hd.sortKey;
    const dir = on ? (sort.dir === 'desc' ? 'desc' : 'asc') : undefined;
    return html`<th aria-sort=${on ? (dir === 'desc' ? 'descending' : 'ascending') : 'none'}>
      <button type="button" class="data-table-sort" data-on=${on ? 'yes' : 'no'} onClick=${() => onSort(hd.sortKey)}>
        ${hd.label}<span aria-hidden="true">${on ? (dir === 'desc' ? ' ↓' : ' ↑') : ''}</span></button></th>`;
  };
  const table = html`<table class=${cls}>
    ${headers.length > 0 && html`<thead><tr>${headers.map(th)}</tr></thead>`}
    <tbody>
      ${rows.map((row, r) => html`<tr data-tone=${rowTones && ['muted', 'coral', 'danger'].includes(rowTones[r]) ? rowTones[r] : undefined}>
        ${row.map((cell, i) => {
          const hd = headers[i];
          const label = typeof hd === 'string' ? hd : isSortHeader(hd) && typeof hd.label === 'string' ? hd.label : undefined;
          if (!isCellObject(cell)) return html`<td data-label=${label}>${cell}</td>`;
          const align = cell.align === 'end' ? 'end' : undefined;
          // A clamped cell keeps to one line and shows the whole text as its tooltip.
          const clamp = cell.clamp ? 'yes' : undefined;
          const title = cell.title || (clamp && typeof cell.text === 'string' && !cell._html ? cell.text : '');
          if (cell._html) {
            return html`<td class=${cell.mono ? 'mono' : ''} title=${title} data-label=${label} data-align=${align} data-clamp=${clamp}
              dangerouslySetInnerHTML=${{ __html: cell.text }}></td>`;
          }
          return html`<td class=${cell.mono ? 'mono' : undefined} title=${title} data-label=${label} data-align=${align} data-clamp=${clamp}>${cell.text}</td>`;
        })}
      </tr>`)}
    </tbody>
  </table>`;
  return scroll ? html`<div class="scrollable">${table}</div>` : table;
}
