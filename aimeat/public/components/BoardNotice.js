/**
 * @file public/components/BoardNotice.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A notice on a board, as one row (component plan C2, "Thread and Composer"; the
 *   replies under a notice are the Message component's board tone): its kind as a Tag on the left (a
 *   grey dot when it has none), the title as a button that opens it, the words, who posted it and on
 *   which board in typewriter, and on the right when it was posted, how long it has left and its
 *   replies and thanks. A notice's own page shows its text at a reading size (BoardNoticeText). On a
 *   phone the columns stack. The page passes the words and what a press does; it never writes a
 *   class. The look is css/components/board-notices.css.
 * @structure BoardNotice({ kind, title, onOpen, words, who, whoNote, board, time, left, counts }) ·
 *   BoardNoticeText({ children })
 * @usage html`<${BoardNotice} kind=${p.category} title=${p.title} onOpen=${open} words=${excerpt}
 *          who=${label} whoNote=${standing} board=${{ name, onOpen }} time=${rel(p.created_at)}
 *          left=${leftWords(p.ttl_expires_at)} counts=${'2 replies · 1 thanks'} />`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the Boards page's notice row (views/profile/boards/frame.js
 *     noticeRow) and the organism's board preview (views/profile/organisms/panels.js) as one
 *     component, with their markup and their look unchanged; the bp- class names became the
 *     component's own (board-notice*).
 */
import { h } from 'preact';
import htm from 'htm';
import { Mark } from '/components/Mark.js';

const html = htm.bind(h);

export function BoardNotice({ kind, title, onOpen, words, who, whoNote, board, time, left, counts }) {
  return html`
    <div class="board-notice">
      <div class=${`board-notice-kind${kind ? '' : ' board-notice-kind--none'}`}>${kind ? html`<${Mark}>${kind}<//>` : '·'}</div>
      <div class="board-notice-body">
        ${title ? html`<button type="button" class="board-notice-title" onClick=${onOpen}>${title}</button>` : null}
        ${words ? html`<p>${words}</p>` : null}
        <div class="board-notice-by"><b>${who || '?'}</b>${whoNote ? ` · ${whoNote}` : ''}${board ? html` · <button type="button" class="board-notice-board" onClick=${board.onOpen}>${board.name}</button>` : null}</div>
      </div>
      <div class="board-notice-side">${time ? html`<b class="poster-time">${time}</b>` : null}${left || ''}${counts ? html`<br />${counts}` : null}</div>
    </div>`;
}

/** A notice's own text on its page, at a reading size. */
export function BoardNoticeText({ children }) {
  return html`<p class="board-notice-text">${children}</p>`;
}

export default BoardNotice;
