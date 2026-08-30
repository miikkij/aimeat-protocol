/**
 * @file public/views/profile/boards/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Boards cover, a board's page and a notice's page share: the words (a
 *   visibility, who wrote a post, how long a notice has left, a poster's standing), which boards a
 *   person follows, the rows of a boards table, a notice as a row, the crumb and the page frame with
 *   its rail.
 * @structure c · words · who · leftWords · standingWords · followedOf · boardRows · noticeRow · crumb · renderPage
 * @usage import { renderPage, boardRows, noticeRow } from './frame.js';
 * @version-history
 *   v1.0.0 — 2026-08-30 — Initial (design canvas "AIMEAT Taulujen sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';

export const c = (key, vars) => t('profile.boards.cover.' + key, vars);
export const loc = () => (getLocale() === 'fi' ? 'fi-FI' : getLocale() === 'es' ? 'es-CO' : 'en-GB');
export const day = (iso) => (iso ? new Date(iso).toLocaleDateString(loc()) : '');
export const rel = (iso) => { if (!iso) return ''; const d = new Date(iso); return Date.now() - d.getTime() > 30 * 864e5 ? day(iso) : formatRelativeTime(iso); };

export const visWord = (v) => c('vis.' + (v || 'private')) || v;
export const bid = (b) => b?.board_id || b?.id;

/** "alice" out of "alice@node"; "scout · alice" out of "scout#alice@node". */
export function who(gaii) {
  const s = String(gaii || '');
  const hash = s.indexOf('#');
  const at = s.indexOf('@');
  if (hash >= 0 && at > hash) return { agent: s.slice(0, hash), owner: s.slice(hash + 1, at), label: `${s.slice(0, hash)} · ${s.slice(hash + 1, at)}` };
  const owner = at >= 0 ? s.slice(0, at) : s;
  return { agent: '', owner, label: owner };
}
export const ownerOf = (gaii) => who(gaii).owner;
export const isAgentPost = (p) => !!who(p?.author_gaii).agent;

/** "6 days left", "3 h left", or "expired". */
export function leftWords(iso) {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return c('expired');
  const h = ms / 3600e3;
  if (h < 48) return c('hoursLeft', { n: Math.max(1, Math.round(h)) });
  return c('daysLeft', { n: Math.round(h / 24) });
}

/** "14 notices · 11 thanks", or "first notice". */
export function standingWords(s) {
  if (!s) return '';
  if (!s.posts && !s.thanks) return c('firstNotice');
  return c('standing', { p: s.posts || 0, t: s.thanks || 0 });
}

/**
 * The boards a person follows: every non-public board they can see (they are on it), plus the public
 * ones they keep or subscribe to. The rest of the public ones are "others' public boards".
 */
export function followedOf(boards, subs, session) {
  const me = session?.owner || '';
  const subbed = new Set((subs || []).map(bid));
  const mine = (b) => !!b.owner_gaii && ownerOf(b.owner_gaii) === me;
  const followed = [], others = [];
  for (const b of boards) {
    const pub = b.visibility === 'public' || b.visibility === 'system';
    if (!pub || subbed.has(bid(b)) || mine(b)) followed.push(b); else others.push(b);
  }
  return { followed, others, isMine: mine, isSubscribed: (b) => subbed.has(bid(b)) };
}

/** One line under a board's name: an organism's discussion, own, or the keeper. */
export function boardSub(ctx, b) {
  const parts = [];
  if (String(bid(b)).startsWith('org-')) parts.push(c('organismBoard'));
  else if (ctx.isMine(b)) parts.push(c('ownBoard'));
  else if (b.owner_gaii) parts.push(c('keptBy', { name: ownerOf(b.owner_gaii) }));
  if (b.rules?.categories?.length) parts.push(b.rules.categories.join(', '));
  else if (b.description) parts.push(b.description);
  return parts.join(' · ');
}

/** Rows of a boards table: name and its line, visibility, notices, latest, a door. */
export function boardRows(ctx, list, door) {
  return html`<div class="bp-rows">
    ${list.map(b => { const id = bid(b); const page = ctx.pages[id]; const n = page ? page.posts.length : null; const latest = page?.posts[0]; return html`
      <div class="bp-nm" key=${'n' + id}><button type="button" class="og-tbl-name" onClick=${() => ctx.pickView({ kind: 'board', id })}>${b.name}</button><small>${boardSub(ctx, b)}</small></div>
      <div class="bp-m" key=${'v' + id}>${visWord(b.visibility)}</div>
      <div class=${`bp-m ${n ? '' : 'bp-m--q'}`} key=${'c' + id}>${n === null ? html`<span class="bp-loading">${t('common.loading')}</span>` : n ? html`<b>${n}${page.cursor ? '+' : ''}</b> ${c('noticesWord', { n })}` : c('noNotices')}</div>
      <div class=${`bp-m ${latest ? '' : 'bp-m--q'}`} key=${'l' + id}>${latest ? html`${rel(latest.created_at)}<br />${who(latest.author_gaii).label}` : '·'}</div>
      <div class="og-tbl-door" key=${'d' + id}>${door(b)}</div>`; })}
  </div>`;
}
export const rowsHead = () => html`<div class="bp-rows bp-rows--head"><div>${c('colBoard')}</div><div>${c('colVisibility')}</div><div>${c('colNotices')}</div><div>${c('colLatest')}</div><div></div></div>`;

/** A notice as a row: category, title and text, who and their standing, when and how long left. */
export function noticeRow(ctx, boardId, p, authors, withBoard) {
  const w = who(p.author_gaii);
  const thanks = (p.reactions?.thanks || []).length;
  const board = withBoard ? ctx.boardById(boardId) : null;
  return html`
    <div class="bp-notice" key=${p.id}>
      <div class=${`bp-cat ${p.category ? '' : 'bp-cat--q'}`}>${p.category || (isAgentPost(p) ? c('byAgent') : '·')}</div>
      <div class="bp-notice-body">
        <button type="button" class="bp-notice-title" onClick=${() => ctx.pickView({ kind: 'notice', boardId, postId: p.id })}>${p.title}</button>
        <p>${String(p.body || '').slice(0, 220)}${String(p.body || '').length > 220 ? '…' : ''}</p>
        <div class="bp-who"><b>${w.label}</b>${authors?.[p.author_gaii] ? ` · ${standingWords(authors[p.author_gaii])}` : ''}${board ? html` · <button type="button" class="bp-who-board" onClick=${() => ctx.pickView({ kind: 'board', id: boardId })}>${board.name}</button>` : null}</div>
      </div>
      <div class="bp-r"><b>${rel(p.created_at)}</b>${leftWords(p.ttl_expires_at)}<br />${p.replies ? c('repliesN', { n: p.replies }) + ' · ' : ''}${c('thanksN', { n: thanks })}</div>
    </div>`;
}

/* ── The crumb and the page frame ──────────────────────────────────────────────────────────── */
export function crumb(ctx, parts) {
  return html`
    <div class="og-crumb">
      <span>${t('nav.profile')}</span><span>/</span>
      ${parts.length ? html`<button type="button" class="og-crumb-link" onClick=${() => ctx.pickView({ kind: 'cover' })}>${t('profile.tabs.boards')}</button>` : html`<span class="og-crumb-here">${t('profile.tabs.boards')}</span>`}
      ${parts.map((p, i) => html`<span key=${i}>/</span>${typeof p === 'string' ? html`<span class="og-crumb-here">${p}</span>` : p}`)}
    </div>`;
}

const openTab = (tabId) => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));
export function pageLinks() {
  return html`
    <button type="button" class="og-rail-link" onClick=${() => openTab('messages')}><i>→</i>${t('profile.tabs.inbox')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('organisms')}><i>→</i>${t('profile.tabs.organisms')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('apps')}><i>→</i>${t('profile.tabs.apps')}<em>→</em></button>`;
}

export function renderPage(ctx, { crumbs, label = null, title, chips = null, doors = null, strip = null, rail = null, back = null, children }) {
  return html`
    <div class="og og-bp og-page">
      ${crumb(ctx, crumbs)}
      <div class="og-mast og-mast--page">
        <div class="og-mast-words">
          ${label ? html`<div class="og-label">${label}</div>` : null}
          <h1 class="og-title bp-title--page">${title}</h1>
          ${chips ? html`<div class="og-chips">${chips}</div>` : null}
        </div>
        ${doors ? html`<div class="og-mast-actions"><div class="og-doors">${doors}</div></div>` : null}
      </div>
      ${strip}
      <div class="og-grid">
        <div class="og-main">${children}</div>
        <nav class="og-rail" aria-label=${c('railTitle')}>
          <span class="og-rail-label">${t('profile.tabs.boards')}</span>
          ${back || html`<button type="button" class="og-rail-link" onClick=${() => ctx.pickView({ kind: 'cover' })}><i>←</i>${c('backTo')}</button>`}
          ${rail}
          <hr />
          <span class="og-rail-label">${c('pages')}</span>
          ${pageLinks()}
        </nav>
      </div>
    </div>`;
}
