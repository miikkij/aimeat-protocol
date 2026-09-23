/**
 * @file public/views/profile/organisms/workspace/overview.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The workspace's jump handlers (an event, a search hit or a row to its space page),
 *   the measurability Objectives card and the in-workspace search results. Pure render functions
 *   driven by a ctx bag assembled by the parent Workspace. The Overview landing that used to live
 *   here (the accordion of every space) became the cover's tables in cover.js.
 * @structure gotoEvent, openOvRec, gotoHit, renderWsSearchResults, openOvDoc, ovAddNew, renderObjectives
 * @usage import { gotoEvent, renderObjectives } from '/views/profile/organisms/workspace/overview.js';
 * @version-history
 *   v2.0.0 — 2026-08-29 — renderOverview, renderOvSection and the mobile inline document removed with
 *     the tab block; a document opens on its space page on every screen size.
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 3: the AI-transparency chip on every record and document
 *     row here, from the shared /components/ai-label.js. This landing view — not the per-space tab —
 *     is where a reader first meets a record, so a label only on the tab would be one most people
 *     never see.
 *   v1.0.0 — 2026-07-13 — Extracted from workspace.js (max-file-lines)
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Spinner } from '/views/profile/shared.js';
import { EmptyState } from '/components/EmptyState.js';
import * as orgService from '/js/services/organisms.js';
import { cap, kpiMeets, kpiTargetText } from './helpers.js';

// Strip event → jump straight to the changed item in its space tab.
export function gotoEvent(ctx, e) {
  const { allTypes, isDocSpace, setActiveDoc, setExpandedRec, pickTab } = ctx;
  const target = allTypes.find(o => o.name === e.type);
  if (!target || !orgService.isMemorySpace(target)) { pickTab('activity'); return; }
  if (isDocSpace(target)) setActiveDoc({ type: target.name, mode: 'view', page: { id: e.instance } });
  else setExpandedRec(s => ({ ...s, [target.name + ':' + e.instance]: true }));
  pickTab('space:' + target.name);
}
export function openOvRec(ctx, ot, r) {
  const { setExpandedRec, pickTab } = ctx;
  setExpandedRec(s => ({ ...s, [ot.name + ':' + r.id]: true })); pickTab('space:' + ot.name);
}
// Jump from a search hit to its record/document in the right space, then close the search.
export function gotoHit(ctx, hit) {
  const { allTypes, isDocSpace, setActiveDoc, setExpandedRec, pickTab, setWsQuery, setWsHits } = ctx;
  const target = allTypes.find(o => o.name === hit.space || o.namespace === hit.namespace);
  if (!target) return;
  if (isDocSpace(target)) setActiveDoc({ type: target.name, mode: 'view', page: { id: hit.id } });
  else setExpandedRec(s => ({ ...s, [target.name + ':' + hit.id]: true }));
  pickTab('space:' + target.name);
  setWsQuery(''); setWsHits(null);
}
export function renderWsSearchResults(ctx) {
  const { wsSearching, wsHits, wsT } = ctx;
  if (wsSearching && !wsHits) return html`<${Spinner} text=${t('organisms.loading') || 'Loading...'} />`;
  if (!wsHits || !wsHits.length) return html`<${EmptyState} text=${t('search.noMatches') || 'No matches'} />`;
  const bySpace = {};
  for (const h of wsHits) (bySpace[h.space] = bySpace[h.space] || []).push(h);
  return html`<div class="pj-search-results">
    ${Object.entries(bySpace).map(([space, hits]) => html`
      <div class="pj-search-group" key=${space}>
        <div class="pj-search-group-head">${cap(wsT('type.' + space) || space)}<span class="pj-org-tab-count">${hits.length}</span></div>
        ${hits.map(h => html`
          <button class="pj-search-hit" key=${h.id} onClick=${() => gotoHit(ctx, h)}>
            <span class="pj-search-hit-title">${h.title}</span>
            <span class="pj-search-hit-snippet">${h.snippet}</span>
          </button>`)}
      </div>`)}
  </div>`;
}
// A document opens on its space page.
export function openOvDoc(ctx, ot, d) {
  const { setActiveDoc, pickTab } = ctx;
  setActiveDoc({ type: ot.name, mode: 'view', page: { id: d.id } }); pickTab('space:' + ot.name);
}
export function ovAddNew(ctx, ot, docMode) {
  const { setActiveDoc, startAdd, pickTab } = ctx;
  if (docMode) setActiveDoc({ type: ot.name, mode: 'edit', page: { id: '', title: '', markdown: '' } });
  else startAdd(ot);
  pickTab('space:' + ot.name);
}

export function renderObjectives(ctx) {
  const { wsObjectives } = ctx;
  return html`
    <div class="pj-obj">
      <div class="pj-obj-title">${t('organisms.objectivesTitle') || 'Objectives'}</div>
      ${wsObjectives.map((o, oi) => html`
        <div class="pj-obj-card" key=${o.id || oi}>
          <div class="pj-obj-statement">
            ${(o.statement || o.id)}
            ${o.status === 'met' ? html`<span class="badge badge-success pj-obj-status">${t('organisms.objStatusMet') || 'met'}</span>` : null}
            ${o.status === 'abandoned' ? html`<span class="badge pj-obj-status">${t('organisms.objStatusAbandoned') || 'abandoned'}</span>` : null}
          </div>
          ${o.why ? html`<div class="pj-obj-why">${(o.why)}</div>` : null}
          ${(o.kpis && o.kpis.length) ? html`
            <div class="pj-obj-kpis">
              ${o.kpis.map((k, ki) => {
                const ok = kpiMeets(k.current, k.target);
                const tgt = kpiTargetText(k.target);
                const unit = k.unit ? ` ${k.unit}` : '';
                const val = (k.current === null || k.current === undefined) ? '—' : String(k.current);
                return html`
                  <div class="pj-obj-kpi ${ok === true ? 'met' : ok === false ? 'off' : ''}" key=${k.name || ki}>
                    <span class="pj-obj-kpi-name">${k.name}</span>
                    <span class="pj-obj-kpi-val">${val}${unit}${ok === true ? ' ✅' : ok === false ? ' ⚠️' : ''}</span>
                    ${tgt ? html`<span class="pj-obj-kpi-target">${(t('organisms.kpiTarget') || 'target {t}').replace('{t}', tgt)}</span>` : null}
                    ${k.computed === false ? html`<span class="pj-obj-kpi-declared" title=${t('organisms.kpiDeclaredHint') || 'Self-reported — not computed from records'}>${t('organisms.kpiDeclared') || 'self-reported'}</span>` : null}
                  </div>`;
              })}
            </div>` : null}
        </div>`)}
    </div>`;
}
