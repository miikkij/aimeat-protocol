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
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set (Section, Fold, ListRow, Stack,
 *     Field, Action, Chip, Text) inside the frame's Page: a reply is a list row, the reply composer a
 *     textarea field. Handlers, ids and i18n keys unchanged; the rail's arrows are → and ↩.
 *   v1.1.0 -- 2026-09-13 -- Compose the reply row's top rule from poster.css.
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, Fold, Stack, ListRow, Field, Action, Chip, Text } from '/components/poster-parts.js';
import { scrollTo } from '/views/profile/organisms/poster-parts.js';
import { c, rel, day, who, bid, leftWords, standingWords, lines, renderPage } from './frame.js';

export function renderNotice(ctx, b, postId) {
  const boardId = bid(b);
  const n = ctx.openNotice;
  const post = n?.post?.id === postId ? n.post : null;
  const toBoard = () => ctx.pickView({ kind: 'board', id: boardId });
  const back = html`<${Action} kind="text" onClick=${toBoard}>↩ ${c('backToBoard')}<//>`;
  if (!post) {
    return renderPage(ctx, { crumbs: [{ label: b.name, onClick: toBoard }, '…'], title: b.name, back, children: html`<${Text} tone="muted">${t('common.loading')}<//>` });
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

  const chips = html`<${Stack} direction="wrap" density="compact">
    <${Chip}>${w.label}<//>
    <${Chip} tone="muted">${rel(post.created_at)}<//>
    <${Chip} tone="sun">${leftWords(post.ttl_expires_at)}<//>
    <${Chip}>${c('repliesN', { n: replies.length })}<//>
    <${Chip} tone=${thanks ? 'sun' : 'muted'}>${c('thanksN', { n: thanks })}<//>
    ${(post.tags || []).slice(0, 4).map(tag => html`<${Chip} tone="muted" key=${tag}>${tag}<//>`)}
  <//>`;
  const doors = html`
    <${Action} kind="primary" disabled=${thanked || ctx.thanking} onClick=${() => ctx.handleThank(boardId, post.id)}>${thanked ? c('thanked') : c('thank')}<//>
    <${Action} onClick=${() => scrollTo('bp-reply')}>${c('reply')}<//>
    <${Action} onClick=${() => ctx.handleReport(post.id)}>${c('report')}<//>`;
  const rail = html`<${Stack} density="compact">
    <${Text} kind="label">${c('poster')}<//>
    <${Text}>→ ${w.label}<//>
    <${Text} kind="caption">${standingWords(standing)}${standing?.since ? html`<br />${c('since', { d: day(standing.since) })}` : null}<//>
    ${others.length ? html`<${Text} kind="label">${post.category ? c('sameTopic') : c('alsoOnBoard')}<//>
      ${others.map(p => html`<${Action} key=${p.id} kind="text" onClick=${() => ctx.pickView({ kind: 'notice', boardId, postId: p.id })}>→ ${p.title} · ${leftWords(p.ttl_expires_at)}<//>`)}` : null}
  <//>`;

  return renderPage(ctx, {
    crumbs: [{ label: b.name, onClick: toBoard }, post.title],
    label: `${post.category || (w.agent ? c('byAgent') : c('noticeWord'))} · ${b.name}`,
    title: post.title, chips, doors, rail, back,
    children: html`
      <${Text} kind="lead">${lines(post.body)}<//>
      <${Section} id="bp-replies" density="compact" title=${c('secReplies')} count=${replies.length}>
        <${Stack}>
          ${!replies.length ? html`<${Text} tone="muted">${c('noReplies')}<//>` : html`<div>${replies.map(r => replyBlock(ctx, r, authors))}</div>`}
          <${Stack} id="bp-reply" density="compact">
            <${Field} id="bp-reply-body" type="textarea" rows=${2} label=${c('reply')} value=${ctx.replyText} onInput=${e => ctx.setReplyText(e.target.value)} placeholder=${c('replyPlaceholder')} />
            <div><${Action} kind="primary" disabled=${ctx.replying || !ctx.replyText.trim()} onClick=${() => ctx.handleReply(boardId, post.id)}>${c('send')}<//></div>
          <//>
          <${Text} kind="caption" tone="muted">${c('replyHint')}<//>
        <//>
      <//>
      ${canManage ? html`<${Fold} id="bp-tools" number="02" title=${c('tools')} sub=${c('toolsSub')} open=${ctx.folds.tools} onToggle=${() => ctx.setFold('tools', !ctx.folds.tools)}>${toolsFold(ctx, boardId, post)}<//>` : null}
      <${ctx.ConfirmUI} />`,
  });
}

function replyBlock(ctx, r, authors) {
  const w = who(r.author_gaii);
  return html`<${ListRow} key=${r.id} density="compact" name=${w.label}
    detail=${`${authors?.[r.author_gaii] ? standingWords(authors[r.author_gaii]) + ' · ' : ''}${rel(r.created_at)}`}>
    <${Text}>${lines(r.body)}<//>
  <//>`;
}

function toolsFold(ctx, boardId, post) {
  return html`<${Stack}>
    <${Stack} direction="wrap" align="center">
      <${Action} kind="primary" disabled=${ctx.updating} onClick=${() => ctx.handleResolve(boardId, post.id)}>${c('resolve')}<//>
      <${Action} disabled=${ctx.updating} onClick=${() => ctx.handleExtend(boardId, post.id, 168)}>${c('extend7')}<//>
      <${Action} disabled=${ctx.updating} onClick=${() => ctx.handleExtend(boardId, post.id, 720)}>${c('extend30')}<//>
      <${Action} disabled=${ctx.updating} onClick=${() => ctx.handleDeletePost(boardId, post.id)}>${c('deleteNotice')}<//>
    <//>
    <${Text} kind="caption" tone="muted">${c('toolsHint')}<//>
  <//>`;
}
