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
 *   per need, the "who does what" reading; TILES gives each need a block of its own.
 *   In the three flat views every offer is a tile, and a tile is a link that opens the offer's page
 *   in a new tab through ?tab=offers&offer=<agent>/<id>, which offers-tab.js reads on a cold
 *   navigation. The chosen view is remembered in localStorage.
 * @structure MapPage · offerHref · tile · columnsView · gridView · tilesView · treeView
 * @usage import { MapPage } from './map-page.js';  html`<${MapPage} ctx=${ctx} />`
 * @version-history
 *   2026-09-22 -- Composed from the shared component set: the columns are Columns, the grid is a
 *     Table, a tile is a link Action with its agent under it, the tree sits on a plain Surface.
 *     No own CSS. TILES no longer widens a block by its count (the set has no weighted column),
 *     so it is a grid of equal blocks; see the lead's report.
 *   v1.0.0 — 2026-09-06 — Initial: tree, columns, grid and tiles, the search field, the new-tab link.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';
import { Mermaid } from '/components/Mermaid.js';
import { Columns, Stack, Table, Field, Action, Text, Surface } from '/components/poster-parts.js';
import { buildMermaid, filterOffers, NEED_DISPLAY_ORDER } from '/js/services/offers-grouping.js';
import { groupItems } from './model.js';
import { c, agentMark, chipRow, renderPage } from './frame.js';

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

/** One offer as a link that opens its page in a new tab. A line tile sits in a grid row that already names the agent. */
const tile = (it, { line = false } = {}) => html`<${Stack} key=${it.key} density="compact">
  <${Action} kind="text" href=${offerHref(it)} target="_blank" title=${it.offer.title}>${it.offer.title} →<//>
  ${line ? null : html`<${Text} kind="caption" tone="muted">${agentMark(it)}<//>`}
<//>`;

const groupHead = (g) => html`<${Text} kind="label">${needLabel(g.key)} ${g.items.length}<//>`;

/* ── Columns: one per need, side by side ───────────────────────────────────────────────────── */
const columnsView = (groups) => html`<${Columns} layout="quarters" collapse="640">
  ${groups.map(g => html`<${Stack} key=${g.key}>${groupHead(g)}${g.items.map(it => tile(it))}<//>`)}
<//>`;

/* ── Grid: a row per agent, a column per need ──────────────────────────────────────────────── */
function gridView(groups, items) {
  const order = new Map(groups.map((g, i) => [g.key, i]));
  const byAgent = new Map();
  for (const it of items) { if (!byAgent.has(it.agent)) byAgent.set(it.agent, []); byAgent.get(it.agent).push(it); }
  const first = (list) => Math.min(...list.map(it => order.get(it.need) ?? 99));
  const rows = [...byAgent.entries()].sort(([a, ai], [b, bi]) => first(ai) - first(bi) || a.localeCompare(b));
  return html`<${Table} density="compact" label=${t('profile.offers.mapView.grid')}
    headers=${[c('colAgent'), ...groups.map(g => `${needLabel(g.key)} ${g.items.length}`)]}
    rows=${rows.map(([, list]) => [agentMark(list[0]), ...groups.map(g => html`<${Stack} density="compact">${list.filter(it => it.need === g.key).map(it => tile(it, { line: true }))}<//>`)])} />`;
}

/* ── Tiles: a block per need ───────────────────────────────────────────────────────────────── */
const tilesView = (groups) => html`<${Columns} layout="thirds" collapse="640">
  ${groups.map(g => html`<${Surface} key=${g.key} kind="box" density="compact"><${Stack} density="compact">
    ${groupHead(g)}
    <${Stack} direction="wrap">${g.items.map(it => tile(it, { line: true }))}<//>
  <//><//>`)}
<//>`;

/* ── Tree: the Mermaid flowchart, a click opens the offer in place ─────────────────────────── */
function treeView(ctx, groups) {
  const src = buildMermaid(t('profile.tabs.offers'), groups.map(g => ({ label: needLabel(g.key), items: g.items })));
  const onMapClick = (e) => {
    const id = e.target?.closest?.('.node')?.id || '';
    const leaf = /g(\d+)o(\d+)/.exec(id);
    const it = leaf ? groups[+leaf[1]]?.items?.[+leaf[2]] : null;
    if (it) ctx.pickView({ kind: 'offer', key: it.key });
  };
  return html`<${Surface} kind="plain" density="flush" onClick=${onMapClick}><${Mermaid} chart=${src} /><//>`;
}

export function MapPage({ ctx }) {
  const [mode, setMode] = useState(readMode);
  const [q, setQ] = useState('');
  const m = ctx.model;
  const shown = filterOffers(m.items, q, needLabels());
  const groups = groupItems(shown, 'need');
  const pick = (v) => { setMode(v); saveMode(v); };
  const doors = MODES.map(id => html`<${Action} key=${id} kind="tab" selected=${mode === id} onClick=${() => pick(id)}>${t('profile.offers.mapView.' + id)}<//>`);
  const chips = chipRow([[c('chipOffers', { n: m.items.length })], q.trim() && [t('profile.offers.mapShown', { n: shown.length }), 'sun']]);
  const body = !shown.length ? html`<${Text} tone="muted">${t('profile.offers.noMatch')}<//>`
    : mode === 'tree' ? treeView(ctx, groups)
    : mode === 'grid' ? gridView(groups, shown)
    : mode === 'tiles' ? tilesView(groups)
    : columnsView(groups);
  return renderPage(ctx, {
    id: 'map', crumbs: [c('map')], title: t('profile.offers.mapTitle'), chips, doors,
    children: html`
      <${Text} kind="lead">${t('profile.offers.mapDesc')}<//>
      <${Field} type="search" label=${t('profile.offers.mapSearch')} value=${q} placeholder=${t('profile.offers.mapSearch')} onInput=${(e) => setQ(e.target.value)} />
      ${body}
      <${Text} kind="caption" tone="muted">${mode === 'tree' ? t('profile.offers.mapNote') : t('profile.offers.mapNoteTab')}<//>`,
  });
}
