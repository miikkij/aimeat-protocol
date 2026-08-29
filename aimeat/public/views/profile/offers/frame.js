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
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';

export const c = (key, vars) => t('profile.offers.cover.' + key, vars);
export const loc = () => (getLocale() === 'fi' ? 'fi-FI' : getLocale() === 'es' ? 'es-CO' : 'en-GB');
const two = (n) => String(n).padStart(2, '0');
export const hhmm = (d) => `${two(d.getHours())}:${two(d.getMinutes())}`;
export const dayLabel = (d) => d.toLocaleDateString(loc(), { weekday: 'short', day: 'numeric', month: 'numeric' });
/** "01:18" over "la 29.8." for a table's first column. */
export const when = (iso) => { const d = new Date(iso); return html`${hhmm(d)}<small>${dayLabel(d)}</small>`; };

/** An offer's cost, speed, trust, data handling or format, in the reader's words. */
export const word = (kind, v) => (v ? (t('profile.offers.' + kind + '.' + v) || v) : '');
export const statusWord = (s) => (s ? (t('profile.offers.status.' + s) || s) : '');
export const statusClass = (s) => (s === 'done' ? 'op-st--done' : (s === 'failed' || s === 'stalled') ? 'op-st--err' : 'op-st--wait');
export const agentMark = (it) => html`<span class="op-agent">${it.agent}<i class=${`op-dot ${it.online ? '' : 'op-dot--off'}`}></i>${it.online ? '' : html` <em>${c('away')}</em>`}</span>`;
export const getWord = (offer) => {
  const f = word('format', offer?.deliverable?.format);
  const space = offer?.deliverable?.location?.space;
  return f ? `${f}${space ? ` → ${space}` : ''}` : '';
};
export const costTime = (offer) => [word('latency', offer.latency), word('cost', offer.cost)].filter(Boolean).join(' · ');

/** The rows of a deliveries table: when, what came back, who, how it went, a door. */
export function deliveryRows(ctx, list) {
  return html`<div class="op-back">
    ${list.map(d => html`
      <div class="op-at" key=${'a' + d.task_id}>${when(d.updated_at)}</div>
      <div class="op-nm" key=${'n' + d.task_id}><button type="button" class="og-tbl-name" onClick=${() => ctx.pickView({ kind: 'deliverable', taskId: d.task_id })}>${d.title || d.task_id}</button>${d.verification ? html`<small>${d.verification}</small>` : null}</div>
      <div class="op-who" key=${'w' + d.task_id}>${d.agent}</div>
      <div class=${`op-st ${statusClass(d.status)}`} key=${'s' + d.task_id}>${statusWord(d.status)}${d.rating ? html` · ${'★'.repeat(d.rating.stars || 0)}` : ''}</div>
      <div class="og-tbl-door" key=${'d' + d.task_id}><button type="button" class="og-door" onClick=${() => ctx.pickView({ kind: 'deliverable', taskId: d.task_id })}>${c('open')}</button></div>`)}
  </div>`;
}
export const deliveryHead = () => html`<div class="op-back op-back--head"><div>${c('colWhen')}</div><div>${c('colDelivery')}</div><div>${c('colAgent')}</div><div>${c('colStatus')}</div><div></div></div>`;
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
          <h1 class="og-title op-title--page">${title}</h1>
          ${chips ? html`<div class="og-chips">${chips}</div>` : null}
        </div>
        ${doors ? html`<div class="og-mast-actions"><div class="og-doors">${doors}</div></div>` : null}
      </div>
      ${strip}
      <div class="og-grid">
        <div class="og-main">${children}</div>
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
