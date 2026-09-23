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
 *   v1.2.0 — 2026-09-22 — A cell object may carry `align: 'end'` (an amount, a count), and an empty
 *     `headers` list draws no header row.
 *   v1.1.0 — 2026-09-22 — Each cell carries its column's header text as data-label, so the shared
 *     Table can stack a row as label-value pairs on a phone (components/poster-parts.js Table collapse).
 *   v1.0.0 — 2026-06-02 — Component unification (#13): created canonical generic
 *     DataTable (same _html/mono cell protocol as admin's), backing the shared
 *     .data-table CSS. The admin shared.js DataTable now wraps this in .adm-card.
 */
export function DataTable({ headers, rows, scroll, className }) {
  const cls = `data-table${className ? ` ${className}` : ''}`;
  const table = html`<table class=${cls}>
    ${headers.length > 0 && html`<thead><tr>${headers.map(hd => html`<th>${hd}</th>`)}</tr></thead>`}
    <tbody>
      ${rows.map(row => html`<tr>
        ${row.map((cell, i) => {
          const label = typeof headers[i] === 'string' ? headers[i] : undefined;
          const align = cell && typeof cell === 'object' && cell.align === 'end' ? 'end' : undefined;
          if (align && !cell._html && !cell.mono) return html`<td data-label=${label} data-align="end" title=${cell.title || ''}>${cell.text}</td>`;
          if (cell && typeof cell === 'object' && cell._html) {
            return html`<td class=${cell.mono ? 'mono' : ''} title=${cell.title || ''} data-label=${label} data-align=${align}
              dangerouslySetInnerHTML=${{ __html: cell.text }}></td>`;
          }
          if (cell && typeof cell === 'object' && cell.mono) {
            return html`<td class="mono" title=${cell.title || ''} data-label=${label} data-align=${align}>${cell.text}</td>`;
          }
          return html`<td data-label=${label}>${cell}</td>`;
        })}
      </tr>`)}
    </tbody>
  </table>`;
  return scroll ? html`<div class="scrollable">${table}</div>` : table;
}
