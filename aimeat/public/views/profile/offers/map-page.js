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
 * @structure MapPage · offerHref
 * @usage import { MapPage } from './map-page.js';  html`<${MapPage} ctx=${ctx} />`
 * @version-history
 *   v2.0.0 — 2026-09-26 — The four views are the OfferMap component (components/OfferMap.js, a special
 *     view with its own sheet): the page passes the groups, the chart and what a press on the tree
 *     does. The views' choice is the fold Tabs, the search the SearchLine, the tags data, the notes
 *     Note. The page writes no class (page group G6). The grid's column cuts come back (main's
 *     op-matrix--n1…n6; the previous branch had lost them).
 *   v1.5.0 — 2026-09-25 — A search field over a list is the Search line (.search-line with the Text field); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.4.0 — 2026-09-25 — A framed box around one thing is the Object box (.poster-box; on a grey ground its copy tone), in the tone its look already was (Jouni's decision "Object box", a unification).
 *   v1.3.0 — 2026-09-25 — Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.2.0 — 2026-09-25 — Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.1.0 — 2026-09-25 — The headings over lists wear .poster-day-title, grey (--quiet) over a record (Jouni's decision "Group heading", a unification).
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   v1.0.0 — 2026-09-06 — Initial: tree, columns, grid and tiles, the search field, the new-tab link.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';
import { buildMermaid, filterOffers, NEED_DISPLAY_ORDER } from '/js/services/offers-grouping.js';
import { OfferMap } from '/components/OfferMap.js';
import { SearchLine } from '/components/List.js';
import { Tabs } from '/components/Tabs.js';
import { Note } from '/components/Note.js';
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

export function MapPage({ ctx }) {
  const [mode, setMode] = useState(readMode);
  const [q, setQ] = useState('');
  const m = ctx.model;
  const shown = filterOffers(m.items, q, needLabels());
  const groups = groupItems(shown, 'need');
  const pick = (v) => { setMode(v); saveMode(v); };
  // What the map draws: each need's label and its offers as tiles (title, address, agent's tag).
  const mapGroups = groups.map(g => ({
    key: g.key, label: needLabel(g.key),
    items: g.items.map(it => ({ key: it.key, title: it.offer.title, href: offerHref(it), agent: it.agent, online: it.online, mark: agentMark(it) })),
  }));
  const chart = mode === 'tree' ? buildMermaid(t('profile.tabs.offers'), groups.map(g => ({ label: needLabel(g.key), items: g.items }))) : null;
  const onPick = (gi, oi) => { const it = groups[gi]?.items?.[oi]; if (it) ctx.pickView({ kind: 'offer', key: it.key }); };
  return renderPage(ctx, {
    id: 'map', crumbs: [c('map')], title: t('profile.offers.mapTitle'),
    marks: [
      { label: c('chipOffers', { n: m.items.length }) },
      q.trim() ? { label: t('profile.offers.mapShown', { n: shown.length }), tone: 'sun' } : null,
    ],
    actions: html`<${Tabs} tone="fold" kind="view" value=${mode} onSelect=${pick} items=${MODES.map(id => ({ value: id, label: t('profile.offers.mapView.' + id) }))} />`,
    desc: t('profile.offers.mapDesc'),
    children: html`
      <${SearchLine} value=${q} placeholder=${t('profile.offers.mapSearch')} label=${t('profile.offers.mapSearch')} onInput=${(e) => setQ(e.target.value)} />
      ${!shown.length ? html`<${Note} kind="quiet">${t('profile.offers.noMatch')}<//>`
        : html`<${OfferMap} mode=${mode} groups=${mapGroups} chart=${chart} onPick=${onPick} agentLabel=${c('colAgent')} />`}
      <${Note}>${mode === 'tree' ? t('profile.offers.mapNote') : t('profile.offers.mapNoteTab')}<//>`,
  });
}
