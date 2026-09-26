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
 *   v2.6.0 — 2026-09-26 — A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v2.5.0 — 2026-09-26 — Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v2.4.0 — 2026-09-25 — An objective's measures are the Facts (css/components/facts.css), a unification: the look most tabs use. The tiles and their met/off edge go; the ✅ or ⚠️ after the value still says it, the target and "self-reported" are the grey line.
 *   v2.3.0 — 2026-09-25 — Every small number is the Count (.poster-count waiting or tally), a unification: Jouni's decision Count.
 *   v2.2.0 — 2026-09-25 — Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v2.1.0 — 2026-09-25 — The headings over lists wear .poster-day-title, grey (--quiet) over a record (Jouni's decision "Group heading", a unification).
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
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
import { LoadingLine } from '/views/profile/shared.js';
import { QuietNote } from '/components/QuietNote.js';
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
  if (wsSearching && !wsHits) return html`<${LoadingLine} text=${t('organisms.loading') || 'Loading...'} />`;
  if (!wsHits || !wsHits.length) return html`<${QuietNote}>${t('search.noMatches') || 'No matches'}<//>`;
  const bySpace = {};
  for (const h of wsHits) (bySpace[h.space] = bySpace[h.space] || []).push(h);
  return html`<div class="pj-search-results">
    ${Object.entries(bySpace).map(([space, hits]) => html`
      <div class="pj-search-group" key=${space}>
        <div class="pj-search-group-head poster-day-title">${cap(wsT('type.' + space) || space)}<span class="poster-count poster-count--tally">${hits.length}</span></div>
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
      <div class="pj-obj-title poster-day-title">${t('organisms.objectivesTitle') || 'Objectives'}</div>
      ${wsObjectives.map((o, oi) => html`
        <div class="pj-obj-card poster-box" key=${o.id || oi}>
          <div class="pj-obj-statement">
            ${(o.statement || o.id)}
            ${o.status === 'met' ? html`<span class="poster-status poster-status--fine">${t('organisms.objStatusMet') || 'met'}</span>` : null}
            ${o.status === 'abandoned' ? html`<span class="poster-status poster-status--off">${t('organisms.objStatusAbandoned') || 'abandoned'}</span>` : null}
          </div>
          ${o.why ? html`<div class="pj-obj-why">${(o.why)}</div>` : null}
          ${(o.kpis && o.kpis.length) ? html`
            <div class="facts">
              ${o.kpis.map((k, ki) => {
                const ok = kpiMeets(k.current, k.target);
                const tgt = kpiTargetText(k.target);
                const unit = k.unit ? ` ${k.unit}` : '';
                const val = (k.current === null || k.current === undefined) ? '—' : String(k.current);
                return html`
                  <span class="facts-k poster-label" key=${'k:' + (k.name || ki)}>${k.name}</span>
                  <span class="facts-v" key=${k.name || ki}>${val}${unit}${ok === true ? ' ✅' : ok === false ? ' ⚠️' : ''}${tgt || k.computed === false ? html`<small>
                    ${tgt ? html`<span>${(t('organisms.kpiTarget') || 'target {t}').replace('{t}', tgt)}</span>` : null}${tgt && k.computed === false ? ' · ' : null}${k.computed === false ? html`<span title=${t('organisms.kpiDeclaredHint') || 'Self-reported — not computed from records'}>${t('organisms.kpiDeclared') || 'self-reported'}</span>` : null}
                  </small>` : null}</span>`;
              })}
            </div>` : null}
        </div>`)}
    </div>`;
}
