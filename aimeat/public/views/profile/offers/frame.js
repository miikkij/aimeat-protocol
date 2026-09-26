/**
 * @file public/views/profile/offers/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Offers cover and its pages share: the crumb, the page frame with its rail,
 *   the rail's page links, the vocabulary an offer is described in (cost, speed, trust, what you
 *   get) and the small rows the tables use. Lives apart from cover.js so the pages import one way.
 * @structure c · loc · when · word · agentMark · statusWord · deliveryRows · crumb · pageLinks · renderPage
 * @usage import { renderPage, c, deliveryRows } from './frame.js';
 * @version-history
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
import { StatusDot } from '/components/StatusDot.js';

export const c = (key, vars) => t('profile.offers.cover.' + key, vars);
// The loc() helper here derived the FORMAT from the LANGUAGE. /js/format.js reads the
// reader's own, from their profile, falling back to their browser.
const two = (n) => String(n).padStart(2, '0');
export const hhmm = (d) => `${two(d.getHours())}:${two(d.getMinutes())}`;
export const dayLabel = (d) => fmtDate(d, { weekday: 'short', day: 'numeric', month: 'numeric' });
/** "01:18" over "la 29.8." for a table's first column. */
export const when = (iso) => { const d = new Date(iso); return html`${hhmm(d)}<small>${dayLabel(d)}</small>`; };

/** An offer's cost, speed, trust, data handling or format, in the reader's words. */
export const word = (kind, v) => (v ? (t('profile.offers.' + kind + '.' + v) || v) : '');
export const statusWord = (s) => (s ? (t('profile.offers.status.' + s) || s) : '');
/** A delivery's state as a Status: done is fine, failed or stalled is danger, the rest waits (off). */
export const statusClass = (s) => `poster-status ${s === 'done' ? 'poster-status--fine' : (s === 'failed' || s === 'stalled') ? 'poster-status--danger' : 'poster-status--off'}`;
export const agentMark = (it, tone = '') => html`<span class=${`poster-chip op-agent ${tone}`}>${it.agent}<${StatusDot} status=${it.online ? 'online' : 'idle'} />${it.online ? '' : html` <em>${c('away')}</em>`}</span>`;
export const getWord = (offer) => {
  const f = word('format', offer?.deliverable?.format);
  const space = offer?.deliverable?.location?.space;
  return f ? `${f}${space ? ` → ${space}` : ''}` : '';
};
export const costTime = (offer) => [word('latency', offer.latency), word('cost', offer.cost)].filter(Boolean).join(' · ');

/** The rows of a deliveries table: when, what came back, who, how it went, a door. */
export function deliveryRows(ctx, list, { head = false } = {}) {
  return html`<div class="listing listing--cols listing--when-name-who-state-doors op-back">
    ${head ? deliveryHead() : null}
    ${list.map(d => html`
      <div class="listing-row" key=${d.task_id}>
        <div class="op-at poster-stat-number poster-stat-number--small">${when(d.updated_at)}</div>
        <div class="listing-name"><button type="button" class="og-tbl-name" onClick=${() => ctx.pickView({ kind: 'deliverable', taskId: d.task_id })}>${d.title || d.task_id}</button>${d.verification ? html`<small class="listing-meta">${d.verification}</small>` : null}</div>
        <div class="listing-who op-who">${d.agent}</div>
        <div class="listing-desc op-st"><span class=${statusClass(d.status)}>${statusWord(d.status)}</span>${d.rating ? html`<span class="op-stars op-stars--shown op-stars--row" role="img" aria-label=${`${d.rating.stars || 0}/5`}>${[1, 2, 3, 4, 5].map(n => html`<span key=${n} class=${`op-star ${n <= (d.rating.stars || 0) ? 'on' : ''}`} aria-hidden="true">★</span>`)}</span>` : ''}</div>
        <div class="listing-doors"><button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.pickView({ kind: 'deliverable', taskId: d.task_id })}>${c('open')}</button></div>
      </div>`)}
  </div>`;
}
const deliveryHead = () => html`<div class="listing-row listing-row--head"><div class="poster-label">${c('colWhen')}</div><div class="poster-label">${c('colDelivery')}</div><div class="poster-label">${c('colAgent')}</div><div class="poster-label">${c('colStatus')}</div><div class="poster-label"></div></div>`;
/** "2 h ago" while it is recent, the date in the reader's format once it is older than a month. */
export const rel = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Date.now() - d.getTime() > 30 * 864e5 ? dayLabel(d) : formatRelativeTime(iso);
};

/* ── The crumb and the page frame ──────────────────────────────────────────────────────────── */
export function crumb(ctx, parts) {
  const home = () => ctx.pickView({ kind: 'cover' });
  return html`
    <div class="og-crumb">
      <span>${t('nav.profile')}</span><span>/</span>
      ${parts.length ? html`<button type="button" class="og-crumb-link" onClick=${home}>${t('profile.tabs.offers')}</button>` : html`<span class="og-crumb-here">${t('profile.tabs.offers')}</span>`}
      ${parts.map((p, i) => html`<span key=${i}>/</span>${i === parts.length - 1 || !p.go ? html`<span class="og-crumb-here">${p.label || p}</span>` : html`<button type="button" class="og-crumb-link" onClick=${p.go}>${p.label}</button>`}`)}
    </div>`;
}

const PAGES = [['inbox', 'inbox'], ['map', 'map'], ['sell', 'sell']];
export function pageLinks(ctx, current) {
  const m = ctx.model;
  const n = { inbox: m.latest.length, sell: m.selling.length };
  return PAGES.map(([id, key]) => html`
    <button type="button" class=${`og-rail-link ${current === id ? 'on' : ''}`} key=${id} onClick=${() => ctx.pickView({ kind: 'page', id })}>
      <i>→</i>${c(key)}<em>${id in n ? n[id] : '→'}</em>
    </button>`);
}

export function renderPage(ctx, { id, crumbs, title, chips = null, doors = null, strip = null, rail = null, children }) {
  return html`
    <div class="og og-op og-page">
      ${crumb(ctx, crumbs)}
      <div class="og-mast og-mast--page">
        <div class="og-mast-words">
          <h1 class="og-title poster-page-title op-title--page">${title}</h1>
          ${chips ? html`<div class="poster-chips">${chips}</div>` : null}
        </div>
        ${doors ? html`<div class="og-mast-actions"><div class="og-doors">${doors}</div></div>` : null}
      </div>
      ${strip}
      <div class="og-grid">
        <div class="og-main poster-row--thing">${children}</div>
        <div class="op-side">
          <nav class="og-rail" aria-label=${c('railTitle')}>
            <span class="og-rail-label">${t('profile.tabs.offers')}</span>
            <button type="button" class="og-rail-link" onClick=${() => ctx.pickView({ kind: 'cover' })}><i>←</i>${c('backTo')}</button>
            ${rail}
            <hr />
            <span class="og-rail-label">${c('pages')}</span>
            ${pageLinks(ctx, id)}
          </nav>
        </div>
      </div>
    </div>`;
}
