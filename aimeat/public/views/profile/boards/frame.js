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
 *   v1.12.0 -- 2026-10-08 -- A notice's row hands its ai_provenance block to BoardNotice, which shows
 *     the AI label when one is owed (aiprov D10).
 *   v1.11.0 -- 2026-09-26 -- On the component kit (page group G7): the boards table is the List (the name's line cut to one line, the empty counts faint), the crumb and the sibling pages are data, and a board's or a notice's page is the SettingsPage in its page cut with the rail as data. The file writes no class.
 *   v1.10.0 -- 2026-09-26 -- A notice's row is the BoardNotice component (components/BoardNotice.js): the same markup and look, given as data.
 *   v1.9.0 -- 2026-09-26 -- The boards table is the Listing (listing, listing-row and its head row, name, words and doors cells; listing--cols keeps the narrow-screen columns), a unification: the look most tabs use.
 *   v1.8.0 -- 2026-09-26 -- The line under a board's name is the Listing's typewriter line (.listing-meta), a unification: Jouni's decision "Meta line".
 *   v1.7.0 -- 2026-09-25 -- A notice's category is the Tag (.poster-chip, plain), a unification: Jouni's decision "Tag".
 *   v1.6.0 -- 2026-09-25 -- The loading line's blinking mark is the library's Loading mark (css/components/loading-mark.css), moved unchanged out of five sheets (UI consolidation phase 5, a move).
 *   v1.5.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.4.0 -- 2026-09-25 -- Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v1.3.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.2.0 -- 2026-09-13 -- Compose existing top rules from poster.css.
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-08-30 — Initial (design canvas "AIMEAT Taulujen sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { BoardNotice } from '/components/BoardNotice.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { Actions } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { List, Row, Name, Desc, Doors } from '/components/List.js';
import { date as fmtDate } from '/js/format.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';

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

/** Rows of a boards table: name and its line, visibility, notices, latest, a door. */
export function boardRows(ctx, list, door, { head = false } = {}) {
  const row = (b) => {
    const id = bid(b);
    const page = ctx.pages[id];
    const n = page ? page.posts.length : null;
    const latest = page?.posts[0];
    const open = () => ctx.pickView({ kind: 'board', id });
    return html`
      <${Row} key=${id}>
        <${Name} onOpen=${open} meta=${boardSub(ctx, b)} clip>${b.name}<//>
        <${Desc}>${visWord(b.visibility)}<//>
        <${Desc} faint=${!n}>${n === null ? html`<${Note} kind="loading" inline>${t('common.loading')}<//>` : n ? html`<b>${n}${page.cursor ? '+' : ''}</b> ${c('noticesWord', { n })}` : c('noNotices')}<//>
        <${Desc} faint=${!latest}>${latest ? html`${rel(latest.created_at)}<br />${who(latest.author_gaii).label}` : '·'}<//>
        <${Doors}>${door(b)}<//>
      <//>`;
  };
  return html`<${List} cols="name-state-count-last-doors" keepCols head=${head ? rowsHead() : null}>${list.map(row)}<//>`;
}
const rowsHead = () => [c('colBoard'), c('colVisibility'), c('colNotices'), c('colLatest'), ''];

/** A notice as a row: category, title and text, who and their standing, when and how long left. */
export function noticeRow(ctx, boardId, p, authors, withBoard) {
  const w = who(p.author_gaii);
  const thanks = (p.reactions?.thanks || []).length;
  const board = withBoard ? ctx.boardById(boardId) : null;
  return html`<${BoardNotice} key=${p.id}
    kind=${p.category || (isAgentPost(p) ? c('byAgent') : null)}
    title=${p.title} onOpen=${() => ctx.pickView({ kind: 'notice', boardId, postId: p.id })}
    words=${`${String(p.body || '').slice(0, 220)}${String(p.body || '').length > 220 ? '…' : ''}`}
    who=${w.label} whoNote=${authors?.[p.author_gaii] ? standingWords(authors[p.author_gaii]) : ''}
    board=${board ? { name: board.name, onOpen: () => ctx.pickView({ kind: 'board', id: boardId }) } : null}
    time=${rel(p.created_at)} left=${leftWords(p.ttl_expires_at)}
    counts=${`${p.replies ? c('repliesN', { n: p.replies }) + ' · ' : ''}${c('thanksN', { n: thanks })}`}
    provenance=${p.ai_provenance} />`;
}

/* ── The crumb and the page frame ──────────────────────────────────────────────────────────── */
/**
 * The crumb's steps (components/Crumb.js): Settings / Boards, then the parts of a sub-page. A part is
 * words (ink, the page you are on) or a step back ({ label, onClick }).
 */
export function crumb(ctx, parts) {
  const home = () => ctx.pickView({ kind: 'cover' });
  return [
    t('nav.profile'),
    parts.length ? { label: t('profile.tabs.boards'), onClick: home } : t('profile.tabs.boards'),
    ...parts.map((p) => (typeof p === 'string' ? { label: p, here: true } : p)),
  ];
}

/** The sibling pages in the rail (components/Rail.js): each opens a Settings tab (→ … →). */
export const pageLinks = () => [
  { tab: 'messages', label: t('profile.tabs.inbox') },
  { tab: 'organisms', label: t('profile.tabs.organisms') },
  { tab: 'apps', label: t('profile.tabs.apps') },
];

/**
 * A page inside the Boards page (a board, a notice): the SettingsPage in its page cut. `back` is the
 * rail's way back (an item; default: back to the boards), `rail` the page's own rail groups after it.
 */
export function renderPage(ctx, { crumbs, label = null, title, marks = null, desc = null, doors = null, strip = null, rail = null, back = null, after = null, children }) {
  const railData = {
    title: c('railTitle'),
    groups: [
      { label: t('profile.tabs.boards'), items: [back || { back: true, label: c('backTo'), onClick: () => ctx.pickView({ kind: 'cover' }) }] },
      ...(rail || []),
      { label: c('pages'), items: pageLinks() },
    ],
  };
  return html`
    <${SettingsPage} name="bp" page crumb=${crumb(ctx, crumbs)} label=${label} title=${title} marks=${marks} desc=${desc}
      actions=${doors ? html`<${Actions}>${doors}<//>` : null} strip=${strip} rail=${railData} after=${after}>
      ${children}
    <//>`;
}
