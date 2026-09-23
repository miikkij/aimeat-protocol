/**
 * @file public/views/profile/boards/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Boards cover, a board's page and a notice's page share: the words (a
 *   visibility, who wrote a post, how long a notice has left, a poster's standing), which boards a
 *   person follows, a boards table, a notice as a row, the crumb and the page frame with its rail,
 *   all composed from the shared set (components/poster-parts.js).
 * @structure c · words · who · leftWords · standingWords · followedOf · choice · boardRows · noticeRow · crumb · pageLinks · renderPage
 * @usage import { renderPage, boardRows, noticeRow } from './frame.js';
 * @version-history
 *   v2.1.0 -- 2026-09-22 -- The lines() <br> helper is gone: the set's Text keeps typed line breaks.
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set: a board is a ListRow, a
 *     notice is a ListRow with its text as the preview, the crumb is the Masthead trail and the page
 *     frame is Page with an index Rail, so Boards has no sheet of its own. Rail arrows are → and ↩.
 *   v1.2.0 -- 2026-09-13 -- Compose existing top rules from poster.css.
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-08-30 — Initial (design canvas "AIMEAT Taulujen sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { date as fmtDate } from '/js/format.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';
import { Page, Rail, Stack, ListRow, Action, Text } from '/components/poster-parts.js';

export const c = (key, vars) => t('profile.boards.cover.' + key, vars);
// The loc() helper here derived the FORMAT from the LANGUAGE. /js/format.js reads the
// reader's own, from their profile, falling back to their browser.
export const day = (iso) => (iso ? fmtDate(iso) : '');
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

/** A choice among options, as a row of tabs with the chosen one on the sun. */
export function choice(value, options, onPick, disabled = false) {
  return html`<${Stack} direction="wrap" density="compact" role="radiogroup">${options.map(([v, label]) => html`
    <${Action} key=${v} kind="tab" semantics="radio" selected=${value === v} disabled=${disabled} onClick=${() => onPick(v)}>${label}<//>`)}<//>`;
}

/**
 * Rows of boards: name and its line, the notices at the right, a door; visibility and the latest
 * notice on the mono line under. (A Table crushed the name column on a phone; see the report.)
 */
export function boardRows(ctx, list, door) {
  return html`<div>${list.map(b => { const id = bid(b); const page = ctx.pages[id]; const n = page ? page.posts.length : null; const latest = page?.posts[0]; return html`
    <${ListRow} key=${id} density="compact" detailKind="text" name=${b.name} onOpen=${() => ctx.pickView({ kind: 'board', id })}
      detail=${boardSub(ctx, b) || undefined}
      value=${n === null ? t('common.loading') : n ? `${n}${page.cursor ? '+' : ''} ${c('noticesWord', { n })}` : c('noNotices')}
      actions=${door(b)}>
      <${Text} kind="mono" tone="muted">${visWord(b.visibility)}${latest ? ` · ${rel(latest.created_at)} · ${who(latest.author_gaii).label}` : ''}<//>
    <//>`; })}</div>`;
}

/** A notice as a row: category, title and text, who and their standing, when and how long left. */
export function noticeRow(ctx, boardId, p, authors, withBoard) {
  const w = who(p.author_gaii);
  const thanks = (p.reactions?.thanks || []).length;
  const board = withBoard ? ctx.boardById(boardId) : null;
  return html`<${ListRow} key=${p.id} preview=${true} name=${p.title} onOpen=${() => ctx.pickView({ kind: 'notice', boardId, postId: p.id })}
    detail=${`${String(p.body || '').slice(0, 220)}${String(p.body || '').length > 220 ? '…' : ''}`}
    value=${html`<${Stack} density="compact"><strong>${rel(p.created_at)}</strong><span>${leftWords(p.ttl_expires_at)}</span>
      <span>${p.replies ? c('repliesN', { n: p.replies }) + ' · ' : ''}${c('thanksN', { n: thanks })}</span><//>`}>
    <${Stack} direction="wrap" align="center" density="compact">
      <${Text} kind="label" tone=${p.category ? 'coral' : 'muted'}>${p.category || (isAgentPost(p) ? c('byAgent') : '·')}<//>
      <${Text} kind="mono" tone="muted">${w.label}${authors?.[p.author_gaii] ? ` · ${standingWords(authors[p.author_gaii])}` : ''}<//>
      ${board ? html`<${Action} kind="text" onClick=${() => ctx.pickView({ kind: 'board', id: boardId })}>${board.name}<//>` : null}
    <//>
  <//>`;
}

/* ── The crumb and the page frame ──────────────────────────────────────────────────────────── */
/**
 * The trail as Masthead crumbs: Settings & Controls, Boards, then the parts. A part is a string
 * (where the person is) or { label, onClick } (a step back).
 */
export function crumb(ctx, parts) {
  return [
    { label: t('nav.profile') },
    { label: t('profile.tabs.boards'), onClick: parts.length ? () => ctx.pickView({ kind: 'cover' }) : undefined },
    ...parts.map(p => (typeof p === 'string' ? { label: p } : p)),
  ];
}

const openTab = (tabId) => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));
export function pageLinks() {
  return html`<${Stack} density="compact">
    <${Text} kind="label">${c('pages')}<//>
    <${Action} onClick=${() => openTab('messages')}>${t('profile.tabs.inbox')} →<//>
    <${Action} onClick=${() => openTab('organisms')}>${t('profile.tabs.organisms')} →<//>
    <${Action} onClick=${() => openTab('apps')}>${t('profile.tabs.apps')} →<//>
  <//>`;
}

/** A board's or a notice's page: the Page frame, its rail with the door back, and the pages. */
export function renderPage(ctx, { crumbs, label = null, title, chips = null, doors = null, strip = null, rail = null, back = null, children }) {
  return html`<${Page} title=${title} crumbs=${crumb(ctx, crumbs)} actions=${doors}
    identity=${label || chips ? html`<${Stack} density="compact">${label ? html`<${Text} kind="label">${label}<//>` : null}${chips}<//>` : null}
    rail=${html`<${Rail} kind="index" title=${t('profile.tabs.boards')} label=${c('railTitle')}><${Stack}>
      ${back || html`<${Action} kind="text" onClick=${() => ctx.pickView({ kind: 'cover' })}>↩ ${c('backTo')}<//>`}
      ${rail}${pageLinks()}
    <//><//>`}>
    ${strip}<${Stack}>${children}<//>
  <//>`;
}
