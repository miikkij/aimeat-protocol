/**
 * @file public/views/profile/organisms/workspace/cover.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The workspace in the poster face (design canvas "AIMEAT Työtilan sivu", direction A,
 *   the organism page's sibling one step deeper). The COVER answers in order: what is new for me
 *   (a first section that appears only while something is unseen or waits for a decision), what is
 *   here (the record types and the document spaces as tables with counts, the unseen mark and the
 *   latest item), what has happened, and then the README, the map and the AI instruction as folds.
 *   A space, a panel (activity, people, share, sources, skills, review) and the settings are each a
 *   PAGE of their own under the same crumb, with a rail that leads back. The rail on the cover is a
 *   numbered contents list with the panels as doors; "Show as a tree" swaps it for the whole
 *   structure with the documents nested, a personal choice kept in home.prefs like the margin pattern.
 *   Pure render functions over the ctx bag the parent Workspace assembles.
 * @structure renderWorkspaceView (cover or page) · renderCover · renderPage · renderRail · renderTree
 * @usage import { renderWorkspaceView } from './workspace/cover.js';
 * @version-history
 *   v1.0.0 — 2026-08-29 — Initial. Replaces the tab block (21 tabs in three rows), the overview
 *     accordion and the README/map/toc stack that stood above every space.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import * as orgService from '/js/services/organisms.js';
import { SearchBar } from '/components/SearchBar.js';
import { relTime, fmtDate } from '/views/profile/organisms/helpers.js';
import { ReadmePanel } from '/views/profile/organisms/readme-panel.js';
import { StructureMindmap } from '/views/profile/organisms/mindmap.js';
import { StructureOverview } from '/views/profile/organisms/widgets.js';
import { WorkspaceApps } from '/views/profile/organisms/workspace-apps.js';
import { ParticipantsPanel } from '/views/profile/organisms/participants-panel.js';
import { SourcesPanel } from '/views/profile/organisms/sources-panel.js';
import { SkillsPanel } from '/views/profile/organisms/skills-panel.js';
import { Section, Fold, tr, scrollTo } from '/views/profile/organisms/poster-parts.js';
import { gotoEvent, ovAddNew, renderWsSearchResults, renderObjectives } from './overview.js';
import { renderSpacesAdd, renderSettingsPanel, renderShareTab, renderReviewTab, renderActivityTab } from './panels.js';
import { renderSpaceNotice, shortActor } from './helpers.js';
import { renderDocSpace } from './doc-space.js';
import { renderRecordSpace } from './record-space.js';

/* The panels that are pages of their own: id, label, and the count shown after the label. */
const PANELS = (ctx) => [
  ['people', tr('organisms.tabPeople', 'People'), ''],
  ['review', tr('organisms.tabReview', 'Review'), ctx.approvals.length || ''],
  ['sources', tr('organisms.sources', 'Sources'), ''],
  ['skills', tr('skills.wsTabLabel', 'Skills'), ''],
  ['share', tr('organisms.share', 'Share'), ''],
];

const stacked = (ctx) => ctx.groups.filter(g => g.kind === 'stacked');
const unseenTotal = (ctx) => ctx.allTypes.reduce((n, ot) => n + ctx.unseenOf('space:' + ot.name), 0);
// An event names its space by the manifest name in some workspaces and by the namespace in others.
const latestFor = (ctx, ot) => ctx.wsEvents.find(e => e.type === ot.name || e.type === ot.namespace) || null;
const spaceLabel = (ctx, ot) => ctx.wsT('type.' + ot.name) || ot.name;
const openSpace = (ctx, ot) => ctx.pickTab('space:' + ot.name);
const newChip = (n) => n > 0 ? html`<span class="og-chip og-chip--sun">${(tr('organisms.ws.newChip', '{n} new for you')).replace('{n}', String(n))}</span>` : null;

/* ── The rail (numbered contents + the panel doors) and its tree form ───────────────────────── */
function panelDoors(ctx, current) {
  return PANELS(ctx).map(([id, label, count]) => html`
    <button type="button" class=${`og-rail-link ${current === id ? 'on' : ''}`} key=${id} onClick=${() => ctx.pickTab(id)}><i>·</i>${label}<em>${count === '' ? '→' : count}</em></button>`);
}
function settingsDoor(ctx, current) {
  return html`<button type="button" class=${`og-rail-link ${current === 'settings' ? 'on' : ''}`} onClick=${() => ctx.guardWsDirty(() => ctx.setShowSettings(true))}><i>·</i>${tr('organisms.settings', 'Settings')}<em>→</em></button>`;
}
function treeToggle(ctx) {
  return html`<button type="button" class="og-rail-link og-rail-toggle" onClick=${() => ctx.setRailTree(!ctx.railTree)}><i>${ctx.railTree ? '↩' : '→'}</i>${ctx.railTree ? tr('organisms.ws.showRail', 'Show the contents') : tr('organisms.ws.showTree', 'Show as a tree')}</button>`;
}

function renderRail(ctx, items, current) {
  return html`
    <nav class="og-rail" aria-label=${tr('organisms.ws.railTitle', 'In this workspace')}>
      <span class="og-rail-label">${tr('organisms.ws.railTitle', 'In this workspace')}</span>
      ${items}
      <hr />
      ${panelDoors(ctx, current)}
      ${settingsDoor(ctx, current)}
      <hr />
      ${treeToggle(ctx)}
    </nav>`;
}

/* The whole structure as one tree: every group, every space with its count, and the documents of a
 * document space nested under it. */
function renderTree(ctx, current) {
  const { isDocSpace, mergedDocs, setActiveDoc, unseenOf } = ctx;
  const MAX = 8;
  return html`
    <nav class="og-tree" aria-label=${tr('organisms.ws.railTitle', 'In this workspace')}>
      ${stacked(ctx).map(g => html`
        <div class="og-tree-group" key=${g.id}>
          <span class="og-tree-label">${g.label}<em>${g.count ?? ''}</em></span>
          ${g.spaces.map(ot => {
            const id = 'space:' + ot.name;
            const u = unseenOf(id);
            const docs = orgService.isMemorySpace(ot) && isDocSpace(ot) ? mergedDocs(ot) : null;
            return html`
              <div class="og-tree-space" key=${ot.name}>
                <button type="button" class=${`og-tree-link ${current === id ? 'on' : ''}`} onClick=${() => openSpace(ctx, ot)}>
                  <span>${spaceLabel(ctx, ot)}</span><em>${docs ? docs.length : (orgService.isMemorySpace(ot) ? new Set([...ctx.draftsFor(ot.name), ...ctx.objectsFor(ot.name)].map(d => d.id)).size : '·')}${u > 0 ? html` <b>+${u}</b>` : null}</em>
                </button>
                ${docs ? docs.slice(0, MAX).map(d => html`
                  <button type="button" class=${`og-tree-doc ${ctx.activeDoc?.type === ot.name && ctx.activeDoc.page?.id === d.id ? 'on' : ''}`} key=${d.id}
                    onClick=${() => { setActiveDoc({ type: ot.name, mode: 'view', page: { id: d.id } }); openSpace(ctx, ot); }}>
                    ${d._draft ? html`<span class="og-chip og-chip--sun og-chip--xs">${tr('organisms.draft', 'draft')}</span>` : null}${d.title || d.id}
                  </button>`) : null}
                ${docs && docs.length > MAX ? html`<button type="button" class="og-tree-doc og-tree-more" onClick=${() => openSpace(ctx, ot)}>${(tr('organisms.ws.more', '… {n} more')).replace('{n}', String(docs.length - MAX))}</button>` : null}
              </div>`;
          })}
        </div>`)}
      <div class="og-tree-group">
        <span class="og-tree-label">${tr('organisms.groupRelated', 'Workspace')}</span>
        <button type="button" class=${`og-tree-link ${current === 'activity' ? 'on' : ''}`} onClick=${() => ctx.pickTab('activity')}><span>${tr('organisms.happened', 'What has happened')}</span><em>${ctx.wsEvents.length}</em></button>
        ${PANELS(ctx).map(([id, label, count]) => html`<button type="button" class=${`og-tree-link ${current === id ? 'on' : ''}`} key=${id} onClick=${() => ctx.pickTab(id)}><span>${label}</span><em>${count === '' ? '→' : count}</em></button>`)}
        <button type="button" class=${`og-tree-link ${current === 'settings' ? 'on' : ''}`} onClick=${() => ctx.guardWsDirty(() => ctx.setShowSettings(true))}><span>${tr('organisms.settings', 'Settings')}</span><em>→</em></button>
      </div>
      <hr />
      ${treeToggle(ctx)}
    </nav>`;
}

/* ── The crumb every view shares ───────────────────────────────────────────────────────────── */
function crumb(ctx, last) {
  const { onBack, onBackToList, org, wsName, ws, pickTab, guardWsDirty, setShowSettings } = ctx;
  const name = wsName || ws?.manifest?.name || '…';
  const home = () => guardWsDirty(() => { setShowSettings(false); pickTab('overview'); });
  return html`
    <div class="og-crumb">
      <button type="button" class="og-crumb-link" onClick=${onBackToList || onBack}>${tr('organisms.title', 'Organisms')}</button>
      <span>/</span>
      <button type="button" class="og-crumb-link" onClick=${onBack}>${org.name || org.id || ''}</button>
      <span>/</span>
      ${last ? html`<button type="button" class="og-crumb-link" onClick=${home}>${name}</button><span>/</span><span class="og-crumb-here">${last}</span>`
        : html`<span class="og-crumb-here">${name}</span>`}
    </div>`;
}

/* ── One table of spaces: the figure, the name with its unseen mark, the latest item, the door ── */
function spaceTable(ctx, spaces) {
  const { isDocSpace, unseenOf, instanceTitle } = ctx;
  return html`
    <div class="og-tbl og-tbl--head"><div></div><div>${tr('organisms.ws.colType', 'Type')}</div><div></div><div>${tr('organisms.ws.colLatest', 'Latest')}</div><div></div></div>
    <div class="og-tbl">
      ${spaces.map(ot => {
        const memory = orgService.isMemorySpace(ot);
        const n = memory ? new Set([...ctx.draftsFor(ot.name), ...ctx.objectsFor(ot.name)].map(d => d.id)).size : null;
        const u = memory ? unseenOf('space:' + ot.name) : 0;
        const last = memory ? latestFor(ctx, ot) : null;
        return html`
          <div class="og-tbl-n" key=${'n' + ot.name}>${n ?? '·'}</div>
          <div class="og-tbl-nm" key=${'m' + ot.name}><button type="button" class="og-tbl-name" onClick=${() => openSpace(ctx, ot)}>${spaceLabel(ctx, ot)}</button>${newChip(u)}${!memory ? html`<span class="og-chip og-chip--dim">${String(ot.backing)}</span>` : null}</div>
          <div class="og-tbl-last" key=${'w' + ot.name}>${last ? tr('organisms.ws.latest', 'latest') : ''}</div>
          <div class="og-tbl-last" key=${'l' + ot.name}>${last ? html`<button type="button" class="og-tbl-go" onClick=${() => gotoEvent(ctx, last)}>${instanceTitle(last.type, last.instance)}</button>` : html`<span class="og-tbl-dot">·</span>`}</div>
          <div class="og-tbl-door" key=${'d' + ot.name}>${n ? html`<button type="button" class="og-door" onClick=${() => openSpace(ctx, ot)}>${tr('organisms.ws.open', 'Open')}</button>`
            : (memory && !ot.append ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ovAddNew(ctx, ot, isDocSpace(ot))}>${tr('organisms.ws.addFirst', '+ Add')}</button>`
              : html`<button type="button" class="og-door og-door--quiet" onClick=${() => openSpace(ctx, ot)}>${tr('organisms.ws.open', 'Open')}</button>`)}</div>`;
      })}
    </div>`;
}

/* ── The cover ─────────────────────────────────────────────────────────────────────────────── */
function renderCover(ctx) {
  const {
    ws, allTypes, isDocSpace, approvals, wsEvents, wsT, instanceTitle, resolve, busy, unseenOf,
    openReadme, setOpenReadme, openMap, setOpenMap, openAi, setOpenAi, agentMenuItems, wsObjectives,
    orgId, wsId, wsCanEdit, showToast, load, wsGraph, wsTocSeed, saveWsReadme, onWsMapNav,
    wsQuery, setWsQuery, wsHits, setWsHits, showSearch, setShowSearch, showSpaces, setShowSpaces,
    showArchived, setShowArchived, pickTab, guardWsDirty, setShowSettings, railTree,
  } = ctx;
  const groups = stacked(ctx);
  const countOf = (spaces) => spaces.reduce((n, ot) => n + (orgService.isMemorySpace(ot) ? new Set([...ctx.draftsFor(ot.name), ...ctx.objectsFor(ot.name)].map(d => d.id)).size : 0), 0);
  const recordSpaces = allTypes.filter(ot => !isDocSpace(ot));
  const docSpaces = allTypes.filter(ot => isDocSpace(ot));
  const records = countOf(recordSpaces);
  const docs = countOf(docSpaces);
  const unseen = unseenTotal(ctx);
  const newSpaces = allTypes.map(ot => ({ ot, n: unseenOf('space:' + ot.name) })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
  const hasNew = newSpaces.length > 0 || approvals.length > 0;
  const last = wsEvents[0] || null;
  const readme = ws.readme || '';
  const readmeTitle = (readme.match(/^#\s+(.+)$/m) || [])[1] || '';
  const openAiFold = () => { setOpenAi(true); setTimeout(() => scrollTo('ws-ai'), 30); };
  const eventRow = (e, i) => html`
    <button type="button" class="og-fold og-fold--event" key=${i} onClick=${() => gotoEvent(ctx, e)}>
      <i>${relTime(e.at)}</i>
      <span class="og-fold-who">${shortActor(e.actor)}${e.agent ? html` · ${e.agent}` : null}</span>
      <span>${e.action === 'publish' ? tr('organisms.publishedVerb', 'published') : tr('organisms.editedVerb', 'edited')}</span>
      <b>${(wsT('type.' + e.type) || e.type)} / ${instanceTitle(e.type, e.instance)}</b>
    </button>`;

  let num = 0;
  const next = () => String(++num).padStart(2, '0');
  const rail = [];
  const sections = [];

  if (hasNew) {
    const n = next();
    rail.push(['ws-new', n, tr('organisms.ws.newForYou', 'New for you'), unseen + approvals.length]);
    sections.push(html`
      <${Section} key="ws-new" id="ws-new" num=${n} first=${true} title=${tr('organisms.ws.newForYou', 'New for you')} count=${unseen || null}
        doors=${approvals.length ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => pickTab('review')}>${tr('organisms.ws.reviewDoor', 'Review →')}</button>` : null}>
        ${newSpaces.length ? html`<div class="og-folds">${newSpaces.map(({ ot, n: u }) => html`
          <div class="og-fold" key=${ot.name}><span class="og-fold-name">${spaceLabel(ctx, ot)}</span><span class="og-fold-r">${newChip(u)}</span><button type="button" class="og-door og-fold-door" onClick=${() => openSpace(ctx, ot)}>${tr('organisms.ws.open', 'Open')}</button></div>`)}</div>` : null}
        ${approvals.length ? html`
          <p class="og-hint og-hint--label">${tr('organisms.ws.waiting', 'Waiting for your decision')} <small>${approvals.length}</small></p>
          <div class="og-folds">${approvals.map(a => html`
            <div class="og-fold" key=${a.id}><span class="og-fold-name">${a.prompt || a.action}</span>
              <button type="button" class="og-door og-fold-door" disabled=${busy} onClick=${() => resolve(a.id, 'approve')}>${tr('organisms.approve', 'Approve')}</button>
              <button type="button" class="og-door og-door--quiet og-fold-door" disabled=${busy} onClick=${() => resolve(a.id, 'reject')}>${tr('organisms.reject', 'Reject')}</button></div>`)}</div>` : null}
      <//>`);
  }

  groups.forEach((g, gi) => {
    const n = next();
    const isDocs = g.id === 'group:documents';
    rail.push(['ws-' + g.id, n, isDocs ? tr('organisms.ws.docsTitle', 'Documents') : g.label, g.count ?? 0]);
    sections.push(html`
      <${Section} key=${g.id} id=${'ws-' + g.id} num=${n} first=${!hasNew && gi === 0} title=${isDocs ? tr('organisms.ws.docsTitle', 'Documents') : g.label} count=${g.count ?? 0}
        doors=${html`
          ${gi === 0 && !showSearch ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => setShowSearch(true)}>${tr('organisms.ws.searchDoor', 'Search this workspace')}</button>` : null}
          ${isDocs ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => guardWsDirty(() => { setShowSettings(false); setShowSpaces(s => !s); })}>${'+ '}${tr('organisms.addDocSpaceTitle', 'Add a document space')}</button>` : null}`}>
        ${isDocs && showSpaces ? renderSpacesAdd(ctx) : null}
        ${spaceTable(ctx, g.spaces)}
        ${g.desc ? html`<p class="og-hint">${g.desc}</p>` : null}
      <//>`);
  });

  {
    const n = next();
    rail.push(['ws-history', n, tr('organisms.happened', 'What has happened'), wsEvents.length]);
    sections.push(html`
      <${Section} key="ws-history" id="ws-history" num=${n} title=${tr('organisms.happened', 'What has happened')} count=${wsEvents.length || null}
        doors=${html`<button type="button" class="og-door og-door--quiet" onClick=${() => pickTab('activity')}>${(tr('organisms.ws.fullActivity', 'Full activity {n} →')).replace('{n}', String(wsEvents.length))}</button>`}>
        ${wsEvents.length ? html`<div class="og-folds">${wsEvents.slice(0, 5).map(eventRow)}</div>` : html`<p class="og-hint">${tr('organisms.noneYet', 'none yet')}</p>`}
      <//>`);
  }

  const nReadme = next(), nMap = next(), nAi = next();
  rail.push(['ws-readme', nReadme, tr('organisms.readmeFold', 'README'), '→'], ['ws-map', nMap, tr('organisms.mapAndToc', 'Map and table of contents'), '→'], ['ws-ai', nAi, tr('organisms.forAi', 'For your AI'), '→']);

  const railItems = rail.map(([id, n, label, count]) => html`
    <a class="og-rail-link" key=${id} href=${'#' + id} onClick=${(e) => { e.preventDefault(); if (id === 'ws-readme') setOpenReadme(true); if (id === 'ws-map') setOpenMap(true); if (id === 'ws-ai') setOpenAi(true); setTimeout(() => scrollTo(id), 30); }}>
      <i>${n}</i>${label}<em>${count}</em>
    </a>`);

  return html`
    <div class="og og-ws">
      ${crumb(ctx, null)}
      <div class="og-mast">
        <div class="og-mast-words">
          <h1 class="og-title">${ws.manifest?.name || ctx.wsName || ctx.org.name}</h1>
          <div class="og-chips">
            <span class="og-chip">${ws.manifest?.status || 'active'}</span>
            ${newChip(unseen)}
            ${ws.manifest?.kind ? html`<span class="og-chip og-chip--dim">${ws.manifest.kind}</span>` : null}
            ${ws.manifest?.updatedAt ? html`<span class="og-chip og-chip--dim">${tr('organisms.lastSaved', 'Last saved')} ${fmtDate(ws.manifest.updatedAt)}</span>` : null}
            ${showArchived ? html`<span class="og-chip og-chip--sun">${tr('organisms.archivedView', 'Archived view')}</span>` : null}
          </div>
          ${ws.manifest?.summary ? html`<p class="og-desc">${ws.manifest.summary}</p>` : null}
        </div>
        <div class="og-mast-actions">
          <button type="button" class="og-slab" onClick=${openAiFold}>${tr('organisms.forAi', 'For your AI')}</button>
          <div class="og-doors">
            <button type="button" class="og-door" onClick=${() => pickTab('share')}>${tr('organisms.share', 'Share')}</button>
            <button type="button" class="og-door" onClick=${() => guardWsDirty(() => setShowSettings(true))}>${tr('organisms.settings', 'Settings')}</button>
            <button type="button" class="og-door og-door--quiet" onClick=${() => setShowArchived(s => !s)}>${showArchived ? tr('organisms.viewActive', 'Active') : tr('organisms.viewArchived', 'Archived')}</button>
          </div>
        </div>
      </div>

      <div class="og-strip">
        <div><b>${records}</b><span>${tr('organisms.ws.figRecords', 'records')}</span><small>${(tr('organisms.ws.figTypes', '{n} types')).replace('{n}', String(recordSpaces.length))}</small></div>
        <div><b>${docs}</b><span>${tr('organisms.ws.figDocs', 'documents')}</span><small>${(tr('organisms.ws.figSpaces', '{n} spaces')).replace('{n}', String(docSpaces.length))}</small></div>
        <div><b>${approvals.length}</b><span>${tr('organisms.ws.figReview', 'to review')}</span>${approvals.length ? html`<small>${tr('organisms.ws.figReviewSub', 'a publish waits for your decision')}</small>` : null}</div>
        <div><b class=${last ? 'og-strip-coral' : ''}>${last ? relTime(last.at) : '·'}</b><span>${tr('organisms.figLast', 'last change')}</span>${last ? html`<small>${shortActor(last.actor)} ${last.action === 'publish' ? tr('organisms.publishedVerb', 'published') : tr('organisms.editedVerb', 'edited')} ${(wsT('type.' + last.type) || last.type)} / ${instanceTitle(last.type, last.instance)}</small>` : null}</div>
      </div>

      ${wsObjectives.length ? renderObjectives(ctx) : null}

      ${showSearch || wsQuery ? html`
        <div class="og-search">
          <${SearchBar} value=${wsQuery} onInput=${e => setWsQuery(e.target.value)} autofocus=${true}
            placeholder=${tr('search.wsPlaceholder', 'Search this workspace…')} ariaLabel=${tr('search.wsPlaceholder', 'Search this workspace')} />
          <button type="button" class="og-door og-door--quiet" onClick=${() => { setWsQuery(''); setWsHits(null); setShowSearch(false); }}>${tr('search.clear', 'Clear')}</button>
        </div>` : null}

      <div class="og-grid">
        <div class="og-main">
          ${wsHits !== null ? renderWsSearchResults(ctx) : html`
            ${sections}
            ${(ws.apps || []).length || wsCanEdit ? html`<div class="og-apps"><${WorkspaceApps} orgId=${orgId} wsId=${wsId} apps=${ws.apps || []} canEdit=${wsCanEdit} showToast=${showToast} onChanged=${load} /></div>` : null}
            <${Fold} id="ws-readme" num=${nReadme} title=${tr('organisms.readmeFold', 'README')} sub=${readmeTitle} open=${openReadme} onToggle=${() => setOpenReadme(o => !o)}>
              ${readme || wsCanEdit
                ? html`<${ReadmePanel} markdown=${readme} canEdit=${wsCanEdit} kind="workspace" name=${ws.manifest?.name || 'Workspace'} aiPromptSeed=${wsTocSeed} onSave=${saveWsReadme} />`
                : html`<p class="og-hint">${tr('organisms.readmeEmpty', 'No README yet.')}</p>`}
            <//>
            <${Fold} id="ws-map" num=${nMap} title=${tr('organisms.mapAndToc', 'Map and table of contents')} open=${openMap} onToggle=${() => setOpenMap(o => !o)}>
              <p class="og-hint">${tr('organisms.mapAndTocHint', 'The same structure two ways.')}</p>
              <${StructureMindmap} scope="workspace" graph=${wsGraph} onNavigate=${onWsMapNav} storageKey=${'ws.' + orgId + '.' + wsId} defaultOpen />
              <${StructureOverview} label=${tr('organisms.structureOverviewWs', 'Workspace structure — table of contents')} load=${() => orgService.getWorkspaceOverview(orgId, wsId)} defaultOpen />
            <//>
            <${Fold} id="ws-ai" num=${nAi} title=${tr('organisms.forAiTitle', 'Bring your AI here')} open=${openAi} onToggle=${() => setOpenAi(o => !o)}>
              <p class="og-lead">${tr('organisms.ws.forAiLead', 'One instruction that brings your AI into this workspace with its real ids and structure. Paste it into a chat, hand it to a coding agent, or make a contract agent from it.')}</p>
              <div class="og-doors">${agentMenuItems.filter(m => !m.divider).map((m, i) => html`<button type="button" class=${`og-door ${i === 2 ? 'og-door--quiet' : ''}`} key=${i} onClick=${m.onClick}>${m.label}</button>`)}</div>
            <//>`}
        </div>
        ${railTree ? renderTree(ctx, 'overview') : renderRail(ctx, railItems, 'overview')}
      </div>
    </div>`;
}

/* ── A page under the same crumb: a space, a panel, the settings ───────────────────────────── */
function renderPage(ctx, { id, last, title, sub, doors = null, children }) {
  const { activeSpace, groups, railTree } = ctx;
  // A space page lists its siblings in the rail (the other spaces of the same group) so the reader
  // can move sideways without going back to the cover.
  const group = activeSpace ? groups.find(g => g.kind === 'stacked' && g.spaces.some(ot => ot.name === activeSpace.name)) : null;
  const siblings = group ? group.spaces.map(ot => html`
    <button type="button" class=${`og-rail-link ${ot.name === activeSpace.name ? 'on' : ''}`} key=${ot.name} onClick=${() => openSpace(ctx, ot)}><i>·</i>${spaceLabel(ctx, ot)}<em>${ctx.unseenOf('space:' + ot.name) > 0 ? '+' + ctx.unseenOf('space:' + ot.name) : ''}</em></button>`) : null;
  const back = html`<button type="button" class="og-rail-link" onClick=${() => ctx.guardWsDirty(() => { ctx.setShowSettings(false); ctx.pickTab('overview'); })}><i>←</i>${tr('organisms.ws.backToWorkspace', 'Back to the workspace')}</button>`;
  return html`
    <div class="og og-ws og-page">
      ${crumb(ctx, last)}
      <div class="og-mast og-mast--page">
        <div class="og-mast-words">
          <h1 class="og-title">${title}${sub ? html`<small>${sub}</small>` : null}</h1>
        </div>
        ${doors ? html`<div class="og-mast-actions"><div class="og-doors">${doors}</div></div>` : null}
      </div>
      <div class="og-grid">
        <div class="og-main">${children}</div>
        ${railTree ? renderTree(ctx, id) : html`
          <nav class="og-rail" aria-label=${tr('organisms.ws.railTitle', 'In this workspace')}>
            <span class="og-rail-label">${tr('organisms.ws.railTitle', 'In this workspace')}</span>
            ${back}
            ${siblings ? html`<hr />${siblings}` : null}
            <hr />
            ${panelDoors(ctx, id)}
            ${settingsDoor(ctx, id)}
            <hr />
            ${treeToggle(ctx)}
          </nav>`}
      </div>
    </div>`;
}

export function renderWorkspaceView(ctx) {
  const { ws, showSettings, activeTab, activeSpace, isDocSpace, unseenOf, setActiveDoc, addSection, startAdd } = ctx;
  if (showSettings) {
    return renderPage(ctx, { id: 'settings', last: tr('organisms.settings', 'Settings'), title: tr('organisms.settings', 'Settings'),
      sub: html`<span>${tr('organisms.template', 'Template')} ${(ws.manifest?.kind || '-')}</span>`, children: renderSettingsPanel(ctx) });
  }
  if (activeSpace) {
    const ot = activeSpace;
    const memory = orgService.isMemorySpace(ot);
    const docMode = memory && isDocSpace(ot);
    const n = memory ? new Set([...ctx.draftsFor(ot.name), ...ctx.objectsFor(ot.name)].map(d => d.id)).size : 0;
    const u = unseenOf('space:' + ot.name);
    const sub = html`<span>${docMode ? tr('organisms.ws.kindDoc', 'document space') : tr('organisms.ws.kindRecord', 'record type')}</span><span>${n}</span>${u > 0 ? newChip(u) : null}`;
    const doors = !memory ? null : docMode ? html`
        <button type="button" class="og-door og-door--quiet" onClick=${() => addSection(ot.name, null)}>${'+ '}${tr('organisms.section', 'Section')}</button>
        <button type="button" class="og-door" onClick=${() => setActiveDoc({ type: ot.name, mode: 'edit', page: { id: '', title: '', markdown: '' } })}>${'+ '}${tr('organisms.newPage', 'New document')}</button>`
      : (ot.append ? null : html`<button type="button" class="og-door" onClick=${() => startAdd(ot)}>${'+ '}${tr('organisms.addDraft', 'Add draft')}</button>`);
    return renderPage(ctx, { id: activeTab, last: spaceLabel(ctx, ot), title: spaceLabel(ctx, ot), sub, doors,
      children: html`${ctx.spaceDesc(ot) ? html`<p class="og-desc og-desc--page">${ctx.spaceDesc(ot)}</p>` : null}
        ${!memory ? renderSpaceNotice(ot) : (docMode ? renderDocSpace(ctx, ot) : renderRecordSpace(ctx, ot))}` });
  }
  const panel = PANELS(ctx).find(([id]) => id === activeTab);
  if (activeTab === 'activity') {
    return renderPage(ctx, { id: 'activity', last: tr('organisms.activity', 'Activity'), title: tr('organisms.happened', 'What has happened'), sub: html`<span>${ctx.wsEvents.length}</span>`, children: renderActivityTab(ctx) });
  }
  if (panel) {
    const [id, label] = panel;
    const body = id === 'people' ? html`<${ParticipantsPanel} orgId=${ctx.orgId} wsId=${ctx.wsId} showToast=${ctx.showToast} />`
      : id === 'sources' ? html`<${SourcesPanel} orgId=${ctx.orgId} wsId=${ctx.wsId} showToast=${ctx.showToast} />`
        : id === 'skills' ? html`<${SkillsPanel} orgId=${ctx.orgId} wsId=${ctx.wsId} showToast=${ctx.showToast} />`
          : id === 'share' ? renderShareTab(ctx) : renderReviewTab(ctx);
    const desc = ctx.REL_DESC[id];
    return renderPage(ctx, { id, last: label, title: label, sub: id === 'review' && ctx.approvals.length ? html`<span>${ctx.approvals.length}</span>` : null,
      children: html`${desc ? html`<p class="og-desc og-desc--page">${desc}</p>` : null}${body}` });
  }
  return renderCover(ctx);
}
