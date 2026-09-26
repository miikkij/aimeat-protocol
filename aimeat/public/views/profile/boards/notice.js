/**
 * @file public/views/profile/boards/notice.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One notice as its own page under its board: the category and board as a label, the
 *   title, the poster, the time, how long it has left, replies and thanks as chips; thanks, reply
 *   and report as doors; the text; the replies as a thread with a reply composer; and the poster's
 *   tools as a fold (take it down as handled, give it more time, delete), for the author, the
 *   board's keeper or an operator. The rail carries the poster's standing and the board.
 * @structure renderNotice · replyBlock · toolsFold
 * @usage import { renderNotice } from './notice.js';
 * @version-history
 *   v1.10.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.9.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.8.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.7.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.6.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.5.0 -- 2026-09-25 -- A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.4.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.3.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   v1.2.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.1.0 -- 2026-09-13 -- Compose the reply row's top rule from poster.css.
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { PageSection } from '/components/PageSection.js';
import { FoldSection } from '/components/FoldSection.js';
import { scrollTo } from '/views/profile/organisms/poster-parts.js';
import { c, rel, day, who, bid, leftWords, standingWords, renderPage } from './frame.js';
import { Hint } from '/components/Hint.js';

export function renderNotice(ctx, b, postId) {
  const boardId = bid(b);
  const n = ctx.openNotice;
  const post = n?.post?.id === postId ? n.post : null;
  const back = html`<button type="button" class="og-rail-link" onClick=${() => ctx.pickView({ kind: 'board', id: boardId })}><i>←</i>${c('backToBoard')}</button>`;
  if (!post) {
    return renderPage(ctx, { crumbs: [html`<button type="button" class="og-crumb-link" onClick=${() => ctx.pickView({ kind: 'board', id: boardId })}>${b.name}</button>`, '…'], title: b.name, back, children: html`<p class="poster-quiet bp-loading loading-mark">${t('common.loading')}</p>` });
  }
  const w = who(post.author_gaii);
  const me = ctx.session?.owner || '';
  const thanked = (post.reactions?.thanks || []).some(g => who(g).owner === me);
  const thanks = (post.reactions?.thanks || []).length;
  const replies = n.replies || [];
  const authors = n.authors || {};
  const canManage = w.owner === me || ctx.isMine(b);
  const standing = post.author || authors[post.author_gaii];
  const others = (ctx.pages[boardId]?.posts || []).filter(p => p.id !== post.id && (post.category ? p.category === post.category : true)).slice(0, 4);

  const chips = html`
    <span class="poster-chip">${w.label}</span>
    <span class="poster-chip">${rel(post.created_at)}</span>
    <span class="poster-chip poster-chip--sun">${leftWords(post.ttl_expires_at)}</span>
    <span class="poster-chip">${c('repliesN', { n: replies.length })}</span>
    <span class=${`poster-chip ${thanks ? 'poster-chip--coral' : ''}`}>${c('thanksN', { n: thanks })}</span>
    ${(post.tags || []).slice(0, 4).map(tag => html`<span class="poster-chip" key=${tag}>${tag}</span>`)}`;
  const doors = html`
    <button type="button" class="poster-slab poster-slab--control" disabled=${thanked || ctx.thanking} onClick=${() => ctx.handleThank(boardId, post.id)}>${thanked ? c('thanked') : c('thank')}</button>
    <button type="button" class="poster-action poster-action--small" onClick=${() => scrollTo('bp-reply')}>${c('reply')}</button>
    <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.handleReport(post.id)}>${c('report')}</button>`;
  const rail = html`
    <hr />
    <span class="og-rail-label">${c('poster')}</span>
    <span class="og-rail-link bp-rail-static on"><i>→</i>${w.label}</span>
    <div class="bp-rail-note">${standingWords(standing)}${standing?.since ? html`<br />${c('since', { d: day(standing.since) })}` : null}</div>
    ${others.length ? html`<hr /><span class="og-rail-label">${post.category ? c('sameTopic') : c('alsoOnBoard')}</span>${others.map(p => html`<button type="button" key=${p.id} class="og-rail-link" onClick=${() => ctx.pickView({ kind: 'notice', boardId, postId: p.id })}><i>→</i>${p.title}<em>${leftWords(p.ttl_expires_at)}</em></button>`)}` : null}`;

  return renderPage(ctx, {
    crumbs: [html`<button type="button" class="og-crumb-link" onClick=${() => ctx.pickView({ kind: 'board', id: boardId })}>${b.name}</button>`, post.title],
    label: `${post.category || (w.agent ? c('byAgent') : c('noticeWord'))} · ${b.name}`,
    title: post.title, chips, doors, rail, back,
    children: html`
      <p class="bp-notice-text">${post.body}</p>
      <${PageSection} id="bp-replies" num="01" title=${c('secReplies')} count=${replies.length}>
        ${!replies.length ? html`<p class="poster-quiet">${c('noReplies')}</p>` : replies.map(r => replyBlock(ctx, r, authors))}
        <div class="bp-composer bp-composer--reply poster-row--thing" id="bp-reply">
          <div class="og-field bp-composer-main"><label class="poster-label" for="bp-reply-body">${c('reply')}</label><textarea id="bp-reply-body" class="og-textarea" rows="2" value=${ctx.replyText} onInput=${e => ctx.setReplyText(e.target.value)} placeholder=${c('replyPlaceholder')}></textarea></div>
          <div class="og-doors"><button type="button" class="poster-slab poster-slab--control" disabled=${ctx.replying || !ctx.replyText.trim()} onClick=${() => ctx.handleReply(boardId, post.id)}>${c('send')}</button></div>
        </div>
        <${Hint}>${c('replyHint')}<//>
      <//>
      ${canManage ? html`<${FoldSection} id="bp-tools" num="02" title=${c('tools')} sub=${c('toolsSub')} open=${ctx.folds.tools} onToggle=${() => ctx.setFold('tools', !ctx.folds.tools)}>${toolsFold(ctx, boardId, post)}<//>` : null}
      <${ctx.ConfirmUI} />`,
  });
}

function replyBlock(ctx, r, authors) {
  const w = who(r.author_gaii);
  return html`
    <div class="bp-reply" key=${r.id}>
      <div class="bp-who"><b>${w.label}</b>${authors?.[r.author_gaii] ? ` · ${standingWords(authors[r.author_gaii])}` : ''} · ${rel(r.created_at)}</div>
      <p>${r.body}</p>
    </div>`;
}

function toolsFold(ctx, boardId, post) {
  return html`
    <div class="og-doors bp-tools">
      <button type="button" class="poster-slab poster-slab--control" disabled=${ctx.updating} onClick=${() => ctx.handleResolve(boardId, post.id)}>${c('resolve')}</button>
      <button type="button" class="poster-action poster-action--small" disabled=${ctx.updating} onClick=${() => ctx.handleExtend(boardId, post.id, 168)}>${c('extend7')}</button>
      <button type="button" class="poster-action poster-action--small" disabled=${ctx.updating} onClick=${() => ctx.handleExtend(boardId, post.id, 720)}>${c('extend30')}</button>
      <button type="button" class="poster-action poster-action--small poster-action--danger" disabled=${ctx.updating} onClick=${() => ctx.handleDeletePost(boardId, post.id)}>${c('deleteNotice')}</button>
    </div>
    <${Hint}>${c('toolsHint')}<//>`;
}
