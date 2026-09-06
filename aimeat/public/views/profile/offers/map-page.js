/**
 * @file public/views/profile/offers/map-page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The map page of the Offers cover: four views of the same offers, and a search field
 *   that narrows every one of them as a person types (design canvas "Tarjoaman kartta", 2026-09-06).
 *   The TREE is the Mermaid flowchart the page has had since June; a node click opens the offer in
 *   place. The three flat views answer the tree's one complaint, that forty leaves stacked on top of
 *   each other are taller than any screen: COLUMNS puts one column per need side by side, so the page
 *   is as tall as the largest need rather than the sum of them; GRID is a row per agent and a column
 *   per need, the "who does what" reading; TILES gives each need a block sized by how much it holds.
 *   In the three flat views every offer is a tile, and a tile is a link that opens the offer's page
 *   in a new tab through ?tab=offers&offer=<agent>/<id>, which offers-tab.js reads on a cold
 *   navigation. The chosen view is remembered in localStorage.
 * @structure MapPage · offerHref · tile · columnsView · gridView · tilesView · treeView
 * @usage import { MapPage } from './map-page.js';  html`<${MapPage} ctx=${ctx} />`
 * @version-history
 *   v1.0.0 — 2026-09-06 — Initial: tree, columns, grid and tiles, the search field, the new-tab link.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';
import { Mermaid } from '/components/Mermaid.js';
import { buildMermaid, filterOffers, NEED_DISPLAY_ORDER } from '/js/services/offers-grouping.js';
import { groupItems } from './model.js';
import { c, agentMark, renderPage } from './frame.js';

const MODES = ['tree', 'columns', 'grid', 'tiles'];
const MODE_KEY = 'aimeat.offers.map-view';
const needLabel = (k) => t('profile.offers.need.' + k) || k;
const needLabels = () => Object.fromEntries(NEED_DISPLAY_ORDER.map(k => [k, needLabel(k)]));

/** The address one offer's page has, which is what a tile opens in a new tab. */
export const offerHref = (it) => `/v1/profile?tab=offers&offer=${encodeURIComponent(it.agent)}/${encodeURIComponent(it.offer.id)}`;

const readMode = () => {
  try { const v = localStorage.getItem(MODE_KEY); return MODES.includes(v) ? v : 'columns'; }
  catch { return 'columns'; } // storage refused: the default view
};
const saveMode = (v) => { try { localStorage.setItem(MODE_KEY, v); } catch (err) { swallowed('map-page: mode', err); } };

/** The small "opens elsewhere" mark in a tile's corner; a fresh node each time, Preact keeps them apart. */
const outMark = () => html`<svg class="op-tile-out" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" aria-hidden="true"><path d="M14 4h6v6" /><path d="M20 4L10 14" /><path d="M18 14v6H4V6h6" /></svg>`;

/** One offer as a link that opens its page in a new tab. A line tile sits in a grid row that already names the agent. */
const tile = (it, { line = false, compact = false } = {}) => html`
  <a class=${`op-tile ${line ? 'op-tile--line' : ''} ${compact ? 'op-tile--compact' : ''}`} key=${it.key} href=${offerHref(it)} target="_blank" rel="noopener" title=${it.offer.title}>
    <span class="op-tile-t"><span>${it.offer.title}</span>${outMark()}</span>
    ${line ? null : agentMark(it)}
  </a>`;

const groupHead = (g) => html`<div class="op-col-h"><span>${needLabel(g.key)}</span><em>${g.items.length}</em></div>`;

/* ── Columns: one per need, side by side ───────────────────────────────────────────────────── */
const columnsView = (groups) => html`
  <div class="op-cols">
    ${groups.map(g => html`<div class="op-col" key=${g.key}>${groupHead(g)}${g.items.map(it => tile(it))}</div>`)}
  </div>`;

/* ── Grid: a row per agent, a column per need ──────────────────────────────────────────────── */
function gridView(groups, items) {
  const order = new Map(groups.map((g, i) => [g.key, i]));
  const byAgent = new Map();
  for (const it of items) { if (!byAgent.has(it.agent)) byAgent.set(it.agent, []); byAgent.get(it.agent).push(it); }
  const first = (list) => Math.min(...list.map(it => order.get(it.need) ?? 99));
  const rows = [...byAgent.entries()].sort(([a, ai], [b, bi]) => first(ai) - first(bi) || a.localeCompare(b));
  return html`
    <div class=${`op-matrix op-matrix--n${groups.length}`}>
      <div class="op-mx-head op-mx-head--agent">${c('colAgent')}</div>
      ${groups.map(g => html`<div class="op-mx-head" key=${'h' + g.key}><span>${needLabel(g.key)}</span><em>${g.items.length}</em></div>`)}
      ${rows.map(([agent, list]) => html`
        <div class=${`op-mx-agent ${list[0].online ? '' : 'op-mx-agent--off'}`} key=${'a' + agent}>${agentMark(list[0])}</div>
        ${groups.map(g => html`<div class="op-mx-cell" key=${agent + '/' + g.key}>${list.filter(it => it.need === g.key).map(it => tile(it, { line: true }))}</div>`)}`)}
    </div>`;
}

/* ── Tiles: a block per need, wider the more it holds ──────────────────────────────────────── */
const tilesView = (groups) => html`
  <div class="op-blocks">
    ${groups.map(g => html`<div class="op-block" key=${g.key} style=${`--op-n:${g.items.length}`}>
      ${groupHead(g)}
      <div class="op-block-tiles">${g.items.map(it => tile(it, { compact: true }))}</div>
    </div>`)}
  </div>`;

/* ── Tree: the Mermaid flowchart, a click opens the offer in place ─────────────────────────── */
function treeView(ctx, groups) {
  const src = buildMermaid(t('profile.tabs.offers'), groups.map(g => ({ label: needLabel(g.key), items: g.items })));
  const onMapClick = (e) => {
    const id = e.target?.closest?.('.node')?.id || '';
    const leaf = /g(\d+)o(\d+)/.exec(id);
    const it = leaf ? groups[+leaf[1]]?.items?.[+leaf[2]] : null;
    if (it) ctx.pickView({ kind: 'offer', key: it.key });
  };
  return html`<div class="op-map" onClick=${onMapClick}><${Mermaid} chart=${src} /></div>`;
}

export function MapPage({ ctx }) {
  const [mode, setMode] = useState(readMode);
  const [q, setQ] = useState('');
  const m = ctx.model;
  const shown = filterOffers(m.items, q, needLabels());
  const groups = groupItems(shown, 'need');
  const pick = (v) => { setMode(v); saveMode(v); };
  const doors = MODES.map(id => html`<button type="button" class=${`og-door og-door--quiet ${mode === id ? 'on' : ''}`} key=${id} onClick=${() => pick(id)}>${t('profile.offers.mapView.' + id)}</button>`);
  const chips = html`
    <span class="og-chip">${c('chipOffers', { n: m.items.length })}</span>
    ${q.trim() ? html`<span class="og-chip og-chip--sun">${t('profile.offers.mapShown', { n: shown.length })}</span>` : null}`;
  const body = !shown.length ? html`<p class="og-empty">${t('profile.offers.noMatch')}</p>`
    : mode === 'tree' ? treeView(ctx, groups)
    : mode === 'grid' ? html`<div class="op-map">${gridView(groups, shown)}</div>`
    : mode === 'tiles' ? tilesView(groups)
    : columnsView(groups);
  return renderPage(ctx, {
    id: 'map', crumbs: [c('map')], title: t('profile.offers.mapTitle'), chips, doors,
    children: html`
      <p class="og-desc og-desc--page">${t('profile.offers.mapDesc')}</p>
      <div class="op-search op-map-search">
        <input type="search" value=${q} placeholder=${t('profile.offers.mapSearch')} aria-label=${t('profile.offers.mapSearch')} onInput=${(e) => setQ(e.target.value)} />
      </div>
      ${body}
      <p class="op-hint">${mode === 'tree' ? t('profile.offers.mapNote') : t('profile.offers.mapNoteTab')}</p>`,
  });
}
