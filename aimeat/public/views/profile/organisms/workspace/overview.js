/**
 * @file public/views/profile/organisms/workspace/overview.js
 * @description The organism-workspace Overview landing (the whole workspace on one vertical scroll —
 *   a "what happened here" strip, then every manifest space as its own stacked section), the
 *   measurability Objectives card, the in-workspace search results, and the jump handlers that route
 *   an event/hit/row to its space tab. Pure render functions driven by a ctx bag assembled by the
 *   parent Workspace. Extracted from workspace.js to satisfy max-file-lines with no behaviour change.
 * @structure gotoEvent, openOvRec, gotoHit, renderWsSearchResults, openOvDoc, ovAddNew,
 *   renderOvDocInline, renderOvSection, renderObjectives, renderOverview
 * @usage import { renderOverview, renderOvSection } from '/views/profile/organisms/workspace/overview.js';
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from workspace.js (max-file-lines)
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Spinner } from '/views/profile/shared.js';
import { EmptyState } from '/components/EmptyState.js';
import * as orgService from '/js/services/organisms.js';
import { relTime } from '/views/profile/organisms/helpers.js';
import { DocumentView, DocumentEditor } from '/views/profile/organisms/document.js';
import { WorkspaceApps } from '/views/profile/organisms/workspace-apps.js';
import { cap, isMobileView, groupDocs, firstLine, shortActor, kpiMeets, kpiTargetText, PRIMARY_FIELD } from './helpers.js';

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
// A document opens in its space tab on desktop; on mobile it expands INLINE right here —
// view and edit both — so no window juggling is ever needed on a phone.
export function openOvDoc(ctx, ot, d) {
  const { setOvDoc, setActiveDoc, pickTab } = ctx;
  if (isMobileView()) setOvDoc(v => (v && v.type === ot.name && v.id === d.id) ? null : { type: ot.name, id: d.id, mode: 'view' });
  else { setActiveDoc({ type: ot.name, mode: 'view', page: { id: d.id } }); pickTab('space:' + ot.name); }
}
export function ovAddNew(ctx, ot, docMode) {
  const { setActiveDoc, startAdd, pickTab } = ctx;
  if (docMode) setActiveDoc({ type: ot.name, mode: 'edit', page: { id: '', title: '', markdown: '' } });
  else startAdd(ot);
  pickTab('space:' + ot.name);
}

export function renderOvDocInline(ctx, ot, d) {
  const { ovDoc, orgId, busy, savePage, setOvDoc, publish, mergedDocs } = ctx;
  return ovDoc.mode === 'edit'
    ? html`<div class="pj-ov-doc-inline"><${DocumentEditor} key=${'oved-' + d.id} orgId=${orgId} page=${d} busy=${busy}
        onSave=${(p) => { savePage(ot, p); setOvDoc({ type: ot.name, id: d.id, mode: 'view' }); }}
        onCancel=${() => setOvDoc({ type: ot.name, id: d.id, mode: 'view' })} /></div>`
    : html`<div class="pj-ov-doc-inline"><${DocumentView} key=${'ovv-' + d.id} page=${d} busy=${busy}
        onEdit=${() => setOvDoc({ type: ot.name, id: d.id, mode: 'edit' })}
        onPublish=${() => publish(ot, d.id)}
        onWikiLink=${(content) => {
          const title = String(content).split('#')[0].trim();
          const targetDoc = title && mergedDocs(ot).find(x => (x.title || '').toLowerCase() === title.toLowerCase());
          if (targetDoc) setOvDoc({ type: ot.name, id: targetDoc.id, mode: 'view' });
        }} /></div>`;
}

export function renderOvSection(ctx, ot) {
  const { isDocSpace, mergedDocs, mergedRecords, wsT, pickTab, ovOpen, setOvOpen, spaceDesc, ovDoc } = ctx;
  const memory = orgService.isMemorySpace(ot);
  const docMode = memory && isDocSpace(ot);
  const items = memory ? (docMode ? mergedDocs(ot) : mergedRecords(ot)) : [];
  const label = cap(wsT('type.' + ot.name) || ot.name);
  // A space the manifest declares but memory doesn't back → one notice row, never hidden.
  if (!memory) return html`
    <div class="pj-ov-row" key=${ot.name}>
      <button class="pj-ov-name pj-ov-name-link" onClick=${() => pickTab('space:' + ot.name)}>${label}</button>
      <span class="badge badge-warn">${String(ot.backing)}</span>
    </div>`;
  // Empty space → a single compact row (name + none + add), not an empty box.
  if (items.length === 0) return html`
    <div class="pj-ov-row" key=${ot.name}>
      <span class="pj-ov-name">${label}</span>
      <span class="pj-muted">${t('organisms.noneYet') || 'none yet'}</span>
      <button class="btn-ghost btn-sm" onClick=${() => ovAddNew(ctx, ot, docMode)}>${'+ '}${docMode ? (t('organisms.newPage') || 'New document') : (t('organisms.addDraft') || 'Add draft')}</button>
    </div>`;
  const open = ovOpen[ot.name] ?? !isMobileView();
  // Multi-part documents collapse into one series row here too (see groupDocs); records pass through.
  const display = docMode ? groupDocs(items) : items.map(d => ({ single: d }));
  const shown = display.slice(0, 5);
  return html`
    <div class="pj-ov-sec" key=${ot.name}>
      <div class="pj-ov-sec-head" onClick=${() => setOvOpen(s => ({ ...s, [ot.name]: !open }))}>
        <span class="pj-ov-chevron">${open ? '▾' : '▸'}</span>
        <span class="pj-ov-name">${label}</span>
        <span class="pj-org-tab-count">${items.length}</span>
        ${docMode ? html`<span class="pj-doc-tag">${t('organisms.docs') || 'docs'}</span>` : null}
        <span class="pj-ov-spacer"></span>
        <button class="btn-ghost btn-sm" onClick=${(ev) => { ev.stopPropagation(); ovAddNew(ctx, ot, docMode); }}>${'+ '}${docMode ? (t('organisms.newPage') || 'New document') : (t('organisms.addDraft') || 'Add draft')}</button>
      </div>
      ${open ? html`
        ${spaceDesc(ot) ? html`<div class="section-desc pj-ov-desc">${spaceDesc(ot)}</div>` : null}
        <div class="pj-ov-items">
          ${shown.map((g) => {
            // A collapsed multi-part series (docMode only) → one row; clicking opens the first part
            // in the space tab, where the full series index lives.
            if (g.parts) return html`
              <div class="pj-ov-doc" key=${'ser-' + g.base}>
                <button class="pj-ov-item" onClick=${() => openOvDoc(ctx, ot, g.parts[0])}>
                  ${g.parts.some(p => p._draft) ? html`<span class="badge badge-warn pj-mini">${t('organisms.draft') || 'draft'}</span>` : null}
                  <span class="pj-ov-item-title">${g.base}</span>
                  <span class="pj-org-tab-count">${g.parts.length}</span>
                  <span class="pj-ov-preview">${firstLine(g.parts[0].markdown)}</span>
                </button>
              </div>`;
            const d = g.single;
            return docMode ? html`
              <div class="pj-ov-doc" key=${d.id}>
                <button class="pj-ov-item" onClick=${() => openOvDoc(ctx, ot, d)}>
                  ${d._draft ? html`<span class="badge badge-warn pj-mini">${t('organisms.draft') || 'draft'}</span>` : null}
                  <span class="pj-ov-item-title">${d.title || d.id}</span>
                  <span class="pj-ov-preview">${firstLine(d.markdown)}</span>
                </button>
                ${ovDoc && ovDoc.type === ot.name && ovDoc.id === d.id ? renderOvDocInline(ctx, ot, d) : null}
              </div>` : html`
              <button class="pj-ov-item" key=${d.id} onClick=${() => openOvRec(ctx, ot, d)}>
                ${d._draft ? html`<span class="badge badge-warn pj-mini">${t('organisms.draft') || 'draft'}</span>` : null}
                <span class="pj-ov-item-title">${String(d[PRIMARY_FIELD[ot.name] || 'title'] || d.summary || d.id || '')}</span>
                ${d.status ? html`<span class="badge badge-info">${String(d.status)}</span>` : null}
              </button>`;
          })}
          ${display.length > 5 ? html`
            <button class="pj-ov-more" onClick=${() => pickTab('space:' + ot.name)}>${(t('organisms.ovShowAll') || 'Show all {n} →').replace('{n}', String(items.length))}</button>` : null}
        </div>` : null}
    </div>`;
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

export function renderOverview(ctx) {
  const { wsEvents, wsT, instanceTitle, orgId, wsId, ws, wsCanEdit, showToast, load, allTypes } = ctx;
  const recent = wsEvents.slice(0, 8);
  return html`
    <div class="pj-ov">
      ${recent.length > 0 ? html`
        <div class="pj-ov-strip">
          <div class="pj-ov-strip-title">${t('organisms.ovRecent') || 'What happened here'}</div>
          ${recent.map((e, i) => html`
            <button class="pj-ov-event" key=${i} onClick=${() => gotoEvent(ctx, e)}>
              <span class="pj-act-dot ${e.action}"></span>
              <span class="pj-ov-event-who">${shortActor(e.actor)}${e.agent ? html` <span class="pj-act-agent" title=${t('organisms.viaAgent') || 'via this agent'}>🤖 ${e.agent}</span>` : null}</span>
              <span class="pj-ov-event-act">${e.action === 'publish' ? (t('organisms.publishedVerb') || 'published') : (t('organisms.editedVerb') || 'edited')}</span>
              <span class="pj-ov-event-what">${e.mode === 'document' ? '📄' : '🗂'} ${(wsT('type.' + e.type) || e.type)}${' / '}${instanceTitle(e.type, e.instance)}</span>
              <span class="pj-ov-event-time">${relTime(e.at)}</span>
            </button>`)}
        </div>` : null}
      <${WorkspaceApps} orgId=${orgId} wsId=${wsId} apps=${ws.apps || []} canEdit=${wsCanEdit}
        showToast=${showToast} onChanged=${load} />
      ${allTypes.map(ot => renderOvSection(ctx, ot))}
      ${allTypes.length === 0 ? html`<${EmptyState} text=${t('organisms.noneYet') || 'none yet'} />` : null}
    </div>`;
}
