/**
 * @file public/components/DataMap.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app's data map (spec aimeat.datamap/2) read in full: what the app is and what it is
 *   used for, how its data is arranged and in which places, one row per thing it holds (the key, what
 *   it holds, where, the facts, and why it is there), what it leans on, what leaves the house, what is
 *   unresolved or not ours, and what is still missing from the map. The rows come in the order a
 *   reader needs them (the only copy of something first, then anything about a person, the rows
 *   nobody explained above the explained ones), and a row nobody explained carries the coral bar. A
 *   map that contradicts itself opens with the contradiction. The vocabulary is
 *   components/data-map/model.js: a word the map carries that this build does not know is printed as
 *   written, never dropped.
 *
 *   A page passes the map and a word reader and never a class; the look is
 *   css/components/data-map.css (the old app catalogue's .dtl-dm-* in app-catalog-poster.css).
 *
 *   DataMap({ map, findings, say, loading })
 *   - map: the `data_map` of GET /v1/datamap/apps/{owner}/{file}, or null.
 *   - findings: [{ code, message }], the owner's "still missing from this map".
 *   - say(key): the words for a `dataMap.*` key (a page passes its own reader, so its words come from
 *     its own table; the node's `t` by default).
 *   - loading: the map has not answered yet.
 * @structure DataMap(props) · dataMapState(map)
 * @usage html`<${DataMap} map=${m} findings=${f} say=${(k) => x(k)} />`
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial: the old app catalogue's data map (js/data-map.js panelHtml) as a
 *     Preact component over the shared vocabulary (appcat detail builder B).
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { labelKeyFor, orderRows, contradictionOf, placesOf, stateOf, DATA_MAP_SPEC } from '/components/data-map/model.js';

const html = htm.bind(h);

/** The four states a map can be in: missing, unfinished, stated, contradicted. */
export function dataMapState(map) { return stateOf(map); }

/** An axis value in the reader's words, or the raw word when this build does not know it. */
function labelOf(say, axis, value) {
  const key = labelKeyFor(axis, value);
  return key ? say(key) : String(value || '');
}

function HeldRow({ row, say }) {
  const why = String(row.why || '').trim();
  const facts = [labelOf(say, 'kind', row.kind), labelOf(say, 'use', row.usedFor), labelOf(say, 'readers', row.readers),
    labelOf(say, 'loss', row.lossRisk), labelOf(say, 'kept', row.keptFor)].join(' · ');
  return html`<div class=${why ? 'data-map-row' : 'data-map-row data-map-row--unexplained'}>
    <div class="data-map-head">
      <span class="data-map-key">${row.what}</span>
      <span class="data-map-holds">${row.holds || ''}</span>
      <span class="data-map-where">${labelOf(say, 'where', row.where)}${row.whereExactly ? html` <span class="data-map-exact">${row.whereExactly}</span>` : null}</span>
    </div>
    <div class="data-map-facts">${facts}${row.personalData === 'yes' ? html` · <span class="data-map-personal">${say('dataMap.personal.yes')}</span>` : null}</div>
    <div class=${why ? 'data-map-why' : 'data-map-why data-map-why--missing'}>${why || say('dataMap.row.noWhy')}</div>
  </div>`;
}

function ElsewhereRow({ row, say }) {
  return html`<div class="data-map-row">
    <div class="data-map-head">
      <span class="data-map-key">${row.what}</span>
      <span class="data-map-holds">${say('dataMap.elsewhere.' + row.status)}</span>
    </div>
    <div class="data-map-facts">${say('dataMap.elsewhere.whereLabel')} ${row.where} · ${say('dataMap.elsewhere.controlledByLabel')} ${row.controlledBy}</div>
    <div class="data-map-why">${row.deletion || ''}</div>
  </div>`;
}

const Part = ({ children }) => html`<h4 class="data-map-part">${children}</h4>`;

/**
 * @param {{ map?: any, findings?: Array<{ message: string }>, say?: (key: string) => string, loading?: boolean }} props
 */
export function DataMap({ map, findings = [], say = t, loading }) {
  if (loading) return html`<div class="data-map"><p class="data-map-text">${say('common.loading')}</p></div>`;
  const found = (findings || []).length
    ? html`<${Part}>${say('dataMap.findingsLabel')}<//><ul class="data-map-bullets">${findings.map((f, i) => html`<li key=${i}>${f.message}</li>`)}</ul>`
    : null;
  if (!map || map.spec !== DATA_MAP_SPEC || map.source === 'none') {
    return html`<div class="data-map" data-state="missing"><p class="data-map-text">${say('dataMap.panel.missing')}</p>${found}</div>`;
  }
  const contradiction = contradictionOf(map);
  const places = placesOf(map);
  const rows = orderRows(map.held || []);
  return html`<div class="data-map" data-state=${stateOf(map)}>
    ${contradiction ? html`<p class="data-map-contradiction">${say(contradiction)}</p>` : null}
    <p class="data-map-what">${map.what || say('dataMap.panel.noWhat')}</p>
    <p class="data-map-fact"><b>${say('dataMap.usedForLabel')}</b> ${map.usedFor || say('dataMap.panel.noUsedFor')}</p>
    <p class="data-map-fact"><b>${say('dataMap.formLabel')}</b> ${labelOf(say, 'form', map.form)}</p>
    <${Part}>${say('dataMap.arrangementLabel')}<//>
    <p class="data-map-text">${map.arrangement || say('dataMap.panel.noArrangement')}</p>
    ${places.length ? html`<ul class="data-map-places">${places.map((p) => html`<li key=${p.where}>${labelOf(say, 'where', p.where)} · ${p.n}</li>`)}</ul>` : null}
    ${rows.length ? html`<${Part}>${say('dataMap.rowsLabel')}<//>${rows.map((r, i) => html`<${HeldRow} key=${r.what || i} row=${r} say=${say} />`)}` : null}
    ${(map.machinery || []).length ? html`<${Part}>${say('dataMap.machineryLabel')}<//><p class="data-map-text">${map.machinery.join(' · ')}</p>` : null}
    ${(map.leaves || []).length ? html`<${Part}>${say('dataMap.leavesLabel')}<//><ul class="data-map-bullets">${map.leaves.map((l, i) => html`<li key=${i}>${l.what} → ${l.to}${l.recallable ? null : html` <span class="data-map-norecall">${say('dataMap.leaves.noRecall')}</span>`}</li>`)}</ul>` : null}
    ${(map.elsewhere || []).length ? html`<${Part}>${say('dataMap.elsewhereLabel')}<//>${map.elsewhere.map((r, i) => html`<${ElsewhereRow} key=${i} row=${r} say=${say} />`)}` : null}
    ${found}
  </div>`;
}

export default DataMap;
