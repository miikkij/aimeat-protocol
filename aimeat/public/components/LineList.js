/**
 * @file public/components/LineList.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A list of one-line pointers: who first, then what they said, cut to one line on a
 *   desktop so five rows stay a summary; and an optional line under the list saying how many more
 *   there are. Its look is css/components/line-list.css; the catalogue entry is `line-list`.
 * @structure LineList({ rows, more })
 * @usage html`<${LineList} rows=${[{ id, name, text, href }]} more=${hidden > 0 ? sentence : null} />`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/status-parts.js (waiting for your answer) with its
 *     markup unchanged (UI consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/**
 * @param {{ rows: Array<{ id: string, name: any, text: any, href: string }>, more?: any }} props
 */
export function LineList({ rows, more }) {
  return html`
    <ul class="poster-line-list">
      ${rows.map((r) => html`
        <li class="poster-line-row" key=${r.id}>
          <a class="poster-line-link" href=${r.href}>
            <span class="poster-line-name">${r.name}</span>
            <span class="poster-line-text">${r.text}</span>
          </a>
        </li>`)}
    </ul>
    ${more ? html`
      <p class="poster-line-more">
        ${more}
      </p>` : ''}`;
}

export default LineList;
