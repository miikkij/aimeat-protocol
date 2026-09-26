/**
 * @file public/views/profile/offers/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Offers cover and its pages share: the crumb, the page frame with its rail,
 *   the rail's page links, the vocabulary an offer is described in (cost, speed, trust, what you
 *   get) and the small rows the tables use. Lives apart from cover.js so the pages import one way.
 *   Made of the component kit: it passes data and never a class.
 * @structure c · hhmm · dayLabel · word · statusWord · statusTone · agentMark · getWord · costTime ·
 *   deliveryRows · rel · crumb · pageLinks · renderPage
 * @usage import { renderPage, c, deliveryRows } from './frame.js';
 * @version-history
 *   v2.0.0 -- 2026-09-26 -- Every part is a component call that gets data (page group G6): the frame
 *     of a page inside the Offers page is SettingsPage (page), its crumb and rail data (the rail's
 *     own groups: the way back, the page's own lists, the sibling pages), the deliveries the List
 *     (the time the poster Figure with the day under it, a delivery's state the Status with the
 *     Stars' row cut, the words cut to one line as before), an offer's agent the Tag with its
 *     presence (Mark presence/away).
 *   v1.12.0 -- 2026-09-26 -- A rated delivery's status cell draws the library's stars in their row cut (.op-stars--row: five, the ones not given as outlines) instead of plain ★ letters (Jouni's decision "offer-row-stars").
 *   v1.11.0 -- 2026-09-26 -- The deliveries table is the Listing (listing, listing-row and its head row, name, who, words and doors cells; listing--cols keeps the narrow-screen columns), a unification: the look most tabs use.
 *   v1.10.0 -- 2026-09-26 -- The line under a delivery's name is the Listing's typewriter line (.listing-meta), a unification: Jouni's decision "Meta line".
 *   v1.9.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.8.0 -- 2026-09-26 -- An offer's agent is the Tag (.poster-chip; the sun tone on its own page), a unification: Jouni's decision Tag.
 *   v1.7.0 -- 2026-09-26 -- Whether an offer's agent is online is the status dot (components/StatusDot.js: online, idle), a unification: the look most tabs use; the square op-dot goes.
 *   v1.6.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.5.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.4.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.3.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v1.2.0 -- 2026-09-13 -- Compose existing top rules from poster.css.
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { date as fmtDate } from '/js/format.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { List, Row, Name, Who, Desc, Cell, Doors } from '/components/List.js';
import { Action, Actions } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Figure } from '/components/Figure.js';
import { Stars } from '/components/Stars.js';

export const c = (key, vars) => t('profile.offers.cover.' + key, vars);
// The loc() helper here derived the FORMAT from the LANGUAGE. /js/format.js reads the
// reader's own, from their profile, falling back to their browser.
const two = (n) => String(n).padStart(2, '0');
export const hhmm = (d) => `${two(d.getHours())}:${two(d.getMinutes())}`;
export const dayLabel = (d) => fmtDate(d, { weekday: 'short', day: 'numeric', month: 'numeric' });

/** An offer's cost, speed, trust, data handling or format, in the reader's words. */
export const word = (kind, v) => (v ? (t('profile.offers.' + kind + '.' + v) || v) : '');
export const statusWord = (s) => (s ? (t('profile.offers.status.' + s) || s) : '');
/** A delivery's state as a Status tone: done is fine, failed or stalled is danger, the rest waits (off). */
export const statusTone = (s) => (s === 'done' ? 'fine' : (s === 'failed' || s === 'stalled') ? 'danger' : 'off');
/** An offer's agent as a Tag with its presence: the dot, and the coral "away" while it is not online. */
export const agentMark = (it, tone) => html`<${Mark} tone=${tone} presence=${it.online ? 'online' : 'idle'} away=${it.online ? null : c('away')}>${it.agent}<//>`;
export const getWord = (offer) => {
  const f = word('format', offer?.deliverable?.format);
  const space = offer?.deliverable?.location?.space;
  return f ? `${f}${space ? ` → ${space}` : ''}` : '';
};
export const costTime = (offer) => [word('latency', offer.latency), word('cost', offer.cost)].filter(Boolean).join(' · ');

/** The rows of a deliveries table: when, what came back, who, how it went, a door. */
export function deliveryRows(ctx, list, { head = false } = {}) {
  const open = (d) => () => ctx.pickView({ kind: 'deliverable', taskId: d.task_id });
  return html`<${List} cols="when-name-who-state-doors" keepCols
    head=${head ? [c('colWhen'), c('colDelivery'), c('colAgent'), c('colStatus'), ''] : null}
    rows=${list} render=${(d) => {
      const at = new Date(d.updated_at);
      return html`<${Row} key=${d.task_id}>
        <${Cell}><${Figure} small n=${hhmm(at)} sub=${dayLabel(at)} /><//>
        <${Name} clip onOpen=${open(d)} meta=${d.verification || null}>${d.title || d.task_id}<//>
        <${Who} clip>${d.agent}<//>
        <${Desc} clip><${Mark} kind="status" tone=${statusTone(d.status)}>${statusWord(d.status)}<//>${d.rating ? html`<${Stars} row value=${d.rating.stars || 0} />` : ''}<//>
        <${Doors}><${Action} small row onClick=${open(d)}>${c('open')}<//><//>
      <//>`;
    }} />`;
}

/** "2 h ago" while it is recent, the date in the reader's format once it is older than a month. */
export const rel = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Date.now() - d.getTime() > 30 * 864e5 ? dayLabel(d) : formatRelativeTime(iso);
};

/* ── The crumb and the page frame ──────────────────────────────────────────────────────────── */

/** The crumb's steps (components/Crumb.js): Offers leads home once a page is open; the last step is ink. */
export function crumb(ctx, parts) {
  const home = () => ctx.pickView({ kind: 'cover' });
  return [
    t('nav.profile'),
    parts.length ? { label: t('profile.tabs.offers'), onClick: home } : t('profile.tabs.offers'),
    ...parts.map((p, i) => (i === parts.length - 1 || !p.go) ? { label: p.label || p, here: true } : { label: p.label, onClick: p.go }),
  ];
}

const PAGES = [['inbox', 'inbox'], ['map', 'map'], ['sell', 'sell']];
/** The Offers pages in the rail: → the page, its count (or →), the one open marked on. */
export function pageLinks(ctx, current) {
  const m = ctx.model;
  const n = { inbox: m.latest.length, sell: m.selling.length };
  return PAGES.map(([id, key]) => ({ key: id, mark: '→', label: c(key), count: id in n ? n[id] : '→', on: current === id, onClick: () => ctx.pickView({ kind: 'page', id }) }));
}

/**
 * A page inside the Offers page. `marks` are its tags as data, `actions` its doors, `desc` its line
 * under the head, `rail` more groups of the rail ([{ label, items }]) after the way back.
 */
export function renderPage(ctx, { id, crumbs, title, marks = null, actions = null, desc = null, strip = null, rail = null, children }) {
  return html`
    <${SettingsPage} name="op" page crumb=${crumb(ctx, crumbs)} title=${title} marks=${marks}
      desc=${desc} actions=${actions ? html`<${Actions}>${actions}<//>` : null} strip=${strip}
      rail=${{
        title: c('railTitle'),
        groups: [
          { label: t('profile.tabs.offers'), items: [{ back: true, label: c('backTo'), onClick: () => ctx.pickView({ kind: 'cover' }) }] },
          ...(rail || []),
          { label: c('pages'), items: pageLinks(ctx, id) },
        ],
      }}>
      ${children}
    <//>`;
}
