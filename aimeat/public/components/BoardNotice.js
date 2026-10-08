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
 * @structure BoardNotice({ kind, title, onOpen, words, who, whoNote, board, time, left, counts, provenance }) ·
 *   BoardNoticeText({ children, provenance })
 * @usage html`<${BoardNotice} kind=${p.category} title=${p.title} onOpen=${open} words=${excerpt}
 *          who=${label} whoNote=${standing} board=${{ name, onOpen }} time=${rel(p.created_at)}
 *          left=${leftWords(p.ttl_expires_at)} counts=${'2 replies · 1 thanks'} provenance=${p.ai_provenance} />`
 * @version-history
 *   v1.2.0 — 2026-10-08 — `provenance` (the post's ai_provenance block from the board read): the row
 *     shows the AI label under the title and the notice's own page above its text, through AiLabel,
 *     which draws nothing when no label is owed (aiprov D10). Without it nothing drawn changes.
 *   v1.1.0 — 2026-09-27 — A title with no `onOpen` is words, not a button that does nothing (the
 *     admin Boards page, which has no notice page to open); every caller that gave a title gave
 *     onOpen too, so nothing drawn before changes. Additive, page group G5.
 *   v1.0.0 — 2026-09-26 — Initial: the Boards page's notice row (views/profile/boards/frame.js
 *     noticeRow) and the organism's board preview (views/profile/organisms/panels.js) as one
 *     component, with their markup and their look unchanged; the bp- class names became the
 *     component's own (board-notice*).
 */
import { h } from 'preact';
import htm from 'htm';
import { Mark } from '/components/Mark.js';
import { AiLabel } from '/components/ai-label.js';

const html = htm.bind(h);

export function BoardNotice({ kind, title, onOpen, words, who, whoNote, board, time, left, counts, provenance }) {
  return html`
    <div class="board-notice">
      <div class=${`board-notice-kind${kind ? '' : ' board-notice-kind--none'}`}>${kind ? html`<${Mark}>${kind}<//>` : '·'}</div>
      <div class="board-notice-body">
        ${title && onOpen ? html`<button type="button" class="board-notice-title" onClick=${onOpen}>${title}</button>`
          : title ? html`<b class="board-notice-title board-notice-title--still">${title}</b>` : null}
        ${provenance?.record ? html`<${AiLabel} record=${provenance.record} recordUrl=${provenance.record_url} />` : null}
        ${words ? html`<p>${words}</p>` : null}
        <div class="board-notice-by"><b>${who || '?'}</b>${whoNote ? ` · ${whoNote}` : ''}${board ? html` · <button type="button" class="board-notice-board" onClick=${board.onOpen}>${board.name}</button>` : null}</div>
      </div>
      <div class="board-notice-side">${time ? html`<b class="poster-time">${time}</b>` : null}${left || ''}${counts ? html`<br />${counts}` : null}</div>
    </div>`;
}

/** A notice's own text on its page, at a reading size, with its AI label above it when one is owed. */
export function BoardNoticeText({ children, provenance }) {
  return html`
    ${provenance?.record ? html`<${AiLabel} record=${provenance.record} recordUrl=${provenance.record_url} variant="block" />` : null}
    <p class="board-notice-text">${children}</p>`;
}

export default BoardNotice;
