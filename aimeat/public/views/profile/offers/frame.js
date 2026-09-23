/**
 * @file public/views/profile/offers/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Offers cover and its pages share: the crumb, the page frame with its rail,
 *   the rail's page links, the vocabulary an offer is described in (cost, speed, trust, what you
 *   get) and the delivery rows the lists use. Lives apart from cover.js so the pages import one way.
 * @structure c · hhmm · dayLabel · word · agentMark · statusWord · statusTone · deliveryRows · rel · crumb · chipRow · pageLinks · renderPage
 * @usage import { renderPage, c, deliveryRows } from './frame.js';
 * @version-history
 *   2026-09-22 -- Composed from the shared component set (Page, Rail, ListRow, Chip); no own CSS.
 *     The delivery table is a timeline of list rows, a status is a marker tone rather than a class,
 *     an agent's presence is said in words, and a rating reads "n/5" instead of star glyphs.
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
import { Page, Rail, Stack, ListRow, Action, Chip, Text } from '/components/poster-parts.js';

export const c = (key, vars) => t('profile.offers.cover.' + key, vars);
// The loc() helper here derived the FORMAT from the LANGUAGE. /js/format.js reads the
// reader's own, from their profile, falling back to their browser.
const two = (n) => String(n).padStart(2, '0');
export const hhmm = (d) => `${two(d.getHours())}:${two(d.getMinutes())}`;
export const dayLabel = (d) => fmtDate(d, { weekday: 'short', day: 'numeric', month: 'numeric' });

/** An offer's cost, speed, trust, data handling or format, in the reader's words. */
export const word = (kind, v) => (v ? (t('profile.offers.' + kind + '.' + v) || v) : '');
export const statusWord = (s) => (s ? (t('profile.offers.status.' + s) || s) : '');
/** A delivery status as a tone: done, failed or waiting. */
export const statusTone = (s) => (s === 'done' ? 'success' : (s === 'failed' || s === 'stalled') ? 'danger' : 'sun');
/** The agent's name, and "away" when it is not present. */
export const agentMark = (it) => (it.online ? it.agent : `${it.agent} · ${c('away')}`);
export const getWord = (offer) => {
  const f = word('format', offer?.deliverable?.format);
  const space = offer?.deliverable?.location?.space;
  return f ? `${f}${space ? ` → ${space}` : ''}` : '';
};
export const costTime = (offer) => [word('latency', offer.latency), word('cost', offer.cost)].filter(Boolean).join(' · ');

/** The rows of a deliveries list: when, what came back, who, how it went, a door. */
export function deliveryRows(ctx, list) {
  return list.map(d => {
    const at = new Date(d.updated_at);
    const open = () => ctx.pickView({ kind: 'deliverable', taskId: d.task_id });
    return html`<${ListRow} key=${d.task_id} density="compact" time=${`${hhmm(at)} ${dayLabel(at)}`} marker=${statusTone(d.status)}
      name=${d.title || d.task_id} onOpen=${open} detail=${d.verification || undefined} detailKind="text"
      value=${`${d.agent} · ${statusWord(d.status)}${d.rating ? ` · ${d.rating.stars || 0}/5` : ''}`}
      actions=${html`<${Action} onClick=${open}>${c('open')}<//>`} />`;
  });
}
/** "2 h ago" while it is recent, the date in the reader's format once it is older than a month. */
export const rel = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Date.now() - d.getTime() > 30 * 864e5 ? dayLabel(d) : formatRelativeTime(iso);
};

/* ── The crumb and the page frame ──────────────────────────────────────────────────────────── */
/** The trail: Settings & Controls, Automation, Offers, then the page's own parts ({ label, go } or a string). */
export function crumb(ctx, parts) {
  return [
    { label: t('nav.profile') },
    { label: t('profile.landing.menuAutomation') },
    { label: t('profile.tabs.offers'), onClick: parts.length ? () => ctx.pickView({ kind: 'cover' }) : undefined },
    ...parts.map((p, i) => (typeof p === 'string' ? { label: p } : { label: p.label, onClick: i < parts.length - 1 ? p.go : undefined })),
  ];
}

/** A row of chips: [text, tone] pairs, a falsy entry skipped. */
export const chipRow = (chips) => html`<${Stack} direction="wrap" density="compact">
  ${chips.filter(Boolean).map(([text, tone], i) => html`<${Chip} key=${i} tone=${tone}>${text}<//>`)}<//>`;

const PAGES = [['inbox', 'inbox'], ['map', 'map'], ['sell', 'sell']];
export function pageLinks(ctx, current) {
  const m = ctx.model;
  const n = { inbox: m.latest.length, sell: m.selling.length };
  return html`<${Stack} density="compact">
    <${Text} kind="label">${c('pages')}<//>
    ${PAGES.map(([id, key]) => html`<${Action} key=${id} kind=${current === id ? "tab" : "text"} selected=${current === id}
      onClick=${() => ctx.pickView({ kind: 'page', id })}>${c(key)} ${id in n ? n[id] : '→'}<//>`)}
  <//>`;
}

/** A page under the Offers crumb: back to the cover, the page's own rail lists, then the pages. */
export function renderPage(ctx, { id, crumbs, title, chips = null, doors = null, strip = null, rail = null, children }) {
  return html`<${Page} width="wide" title=${title} crumbs=${crumb(ctx, crumbs)} identity=${chips} actions=${doors}
    rail=${html`<${Rail} kind="index" title=${t('profile.tabs.offers')} label=${c('railTitle')}><${Stack}>
      <${Action} onClick=${() => ctx.pickView({ kind: 'cover' })}>← ${c('backTo')}<//>
      ${rail}
      ${pageLinks(ctx, id)}
    <//><//>`}>
    <${Stack}>${strip}${children}<//>
  <//>`;
}

/** A short list for the rail: a label and one action per entry. */
export const railList = (label, entries) => html`<${Stack} density="compact">
  <${Text} kind="label">${label}<//>
  ${entries.map(e => (e.onClick ? html`<${Action} key=${e.key} kind="text" onClick=${e.onClick}>${e.label}<//>`
    : html`<${Text} key=${e.key} kind="mono">${e.label}<//>`))}
<//>`;
