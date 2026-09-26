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
 *   v1.13.0 -- 2026-09-26 -- Every part is a library component that takes data: the cover and every page
 *     are the SettingsPage (the crumb's steps, the head's marks, the For-your-AI slab and the doors,
 *     the FigureStrip, the objectives and the search line in its strip slot, the rail as groups of
 *     items or the ContentsTree in its place); a table of spaces is the List (n-name-meta-latest-doors
 *     with its head, the Figure in the count column, the name as the door in, its tags, the latest
 *     item as a text action); the waiting publishes a List under their Group heading; the history the
 *     Folds of FoldRows; a page's description is the head's (it stood at the top of the page column).
 *     The page writes no class (page migration G2b).
 *   v1.12.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.11.0 -- 2026-09-25 -- The tables of spaces, the spaces with something new and the publishes waiting for a decision are the Listing (css/components/listing.css), a unification: the look most tabs use. A table's head row now sits in the same grid as its rows.
 *   v1.10.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.9.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.8.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.7.0 -- 2026-09-25 -- The headings over lists wear .poster-day-title, grey (--quiet) over a record (Jouni's decision "Group heading", a unification).
 *   v1.6.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.5.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.4.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-14 -- An opened space says what it is: a row space and a task space are named as such
 *     instead of "record type", and the count they never had is a dash rather than a 0.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v1.3.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.2.0 -- 2026-09-13 -- Compose existing top rules from poster.css.
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-08-29 — Initial. Replaces the tab block (21 tabs in three rows), the overview
 *     accordion and the README/map/toc stack that stood above every space.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import * as orgService from '/js/services/organisms.js';
import { relTime, fmtDate } from '/views/profile/organisms/helpers.js';
import { ReadmePanel } from '/views/profile/organisms/readme-panel.js';
import { StructureMindmap } from '/views/profile/organisms/mindmap.js';
import { StructureOverview } from '/views/profile/organisms/widgets.js';
import { WorkspaceApps } from '/views/profile/organisms/workspace-apps.js';
import { ParticipantsPanel } from '/views/profile/organisms/participants-panel.js';
import { SourcesPanel } from '/views/profile/organisms/sources-panel.js';
import { SkillsPanel } from '/views/profile/organisms/skills-panel.js';
import { PageSection } from '/components/PageSection.js';
import { FoldSection } from '/components/FoldSection.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { scrollToSection } from '/components/Rail.js';
import { ContentsTree } from '/components/ContentsTree.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Figure } from '/components/Figure.js';
import { Folds, FoldRow } from '/components/Folds.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Space } from '/components/Layout.js';
import { List, Row, Name, Num, Cell, Doors, Group, SearchLine } from '/components/List.js';
import { tr } from '/views/profile/organisms/poster-parts.js';
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
const newWords = (n) => (tr('organisms.ws.newChip', '{n} new for you')).replace('{n}', String(n));
const newChip = (n) => n > 0 ? html`<${Mark} tone="sun">${newWords(n)}<//>` : null;
const RAIL_TITLE = () => tr('organisms.ws.railTitle', 'In this workspace');

/* ── The rail (numbered contents + the panel doors) and its tree form, as data ─────────────── */
function panelDoors(ctx, current) {
  return [
    ...PANELS(ctx).map(([id, label, count]) => ({ key: id, mark: '·', label, count: count === '' ? '→' : count, on: current === id, onClick: () => ctx.pickTab(id) })),
    { key: 'settings', mark: '·', label: tr('organisms.settings', 'Settings'), count: '→', on: current === 'settings', onClick: () => ctx.guardWsDirty(() => ctx.setShowSettings(true)) },
  ];
}
function treeToggle(ctx) {
  return { key: 'tree', mark: ctx.railTree ? '↩' : '→', label: ctx.railTree ? tr('organisms.ws.showRail', 'Show the contents') : tr('organisms.ws.showTree', 'Show as a tree'), onClick: () => ctx.setRailTree(!ctx.railTree) };
}

/* The whole structure as one tree (ContentsTree): every group, every space with its count, and the
 * documents of a document space nested under it. */
function renderTree(ctx, current) {
  const { isDocSpace, mergedDocs, setActiveDoc, unseenOf } = ctx;
  const MAX = 8;
  const spaceLine = (ot) => {
    const id = 'space:' + ot.name;
    const docs = orgService.isMemorySpace(ot) && isDocSpace(ot) ? mergedDocs(ot) : null;
    return {
      key: ot.name, label: spaceLabel(ctx, ot), on: current === id, onClick: () => openSpace(ctx, ot), fresh: unseenOf(id),
      count: docs ? docs.length : (orgService.isMemorySpace(ot) ? new Set([...ctx.draftsFor(ot.name), ...ctx.objectsFor(ot.name)].map(d => d.id)).size : '·'),
      children: docs ? docs.slice(0, MAX).map(d => ({
        key: d.id, label: d.title || d.id, draft: !!d._draft, on: ctx.activeDoc?.type === ot.name && ctx.activeDoc.page?.id === d.id,
        onClick: () => { setActiveDoc({ type: ot.name, mode: 'view', page: { id: d.id } }); openSpace(ctx, ot); },
      })) : null,
      more: docs && docs.length > MAX ? { label: (tr('organisms.ws.more', '… {n} more')).replace('{n}', String(docs.length - MAX)), onClick: () => openSpace(ctx, ot) } : null,
    };
  };
  const groups = [
    ...stacked(ctx).map(g => ({ key: g.id, label: g.label, count: g.count ?? '', items: g.spaces.map(spaceLine) })),
    { key: 'related', label: tr('organisms.groupRelated', 'Workspace'), items: [
      { key: 'activity', label: tr('organisms.happened', 'What has happened'), count: ctx.wsEvents.length, on: current === 'activity', onClick: () => ctx.pickTab('activity') },
      ...panelDoors(ctx, current).map(({ key, label, count, on, onClick }) => ({ key, label, count, on, onClick })),
    ] },
  ];
  const toggle = treeToggle(ctx);
  return html`<${ContentsTree} title=${RAIL_TITLE()} groups=${groups} draftLabel=${tr('organisms.draft', 'draft')}
    foot=${{ mark: toggle.mark, label: toggle.label, onClick: toggle.onClick }} />`;
}

/* ── The crumb every view shares, as steps for the library's Crumb ─────────────────────────── */
function crumb(ctx, last) {
  const { onBack, onBackToList, org, wsName, ws, pickTab, guardWsDirty, setShowSettings } = ctx;
  const name = wsName || ws?.manifest?.name || '…';
  const home = () => guardWsDirty(() => { setShowSettings(false); pickTab('overview'); });
  return [
    { label: tr('organisms.title', 'Organisms'), onClick: onBackToList || onBack },
    { label: org.name || org.id || '', onClick: onBack },
    ...(last ? [{ label: name, onClick: home }, last] : [name]),
  ];
}

/* ── One table of spaces: the figure, the name with its unseen mark, the latest item, the door ── */
function spaceTable(ctx, spaces) {
  const { isDocSpace, unseenOf, instanceTitle } = ctx;
  return html`
    <${List} cols="n-name-meta-latest-doors" keepCols head=${['', tr('organisms.ws.colType', 'Type'), '', tr('organisms.ws.colLatest', 'Latest'), '']}>
      ${spaces.map(ot => {
        const memory = orgService.isMemorySpace(ot);
        const n = memory ? new Set([...ctx.draftsFor(ot.name), ...ctx.objectsFor(ot.name)].map(d => d.id)).size : null;
        const u = memory ? unseenOf('space:' + ot.name) : 0;
        const last = memory ? latestFor(ctx, ot) : null;
        return html`
          <${Row} key=${ot.name}>
            <${Num}><${Figure} small end n=${n ?? '·'} /><//>
            <${Name} onOpen=${() => openSpace(ctx, ot)} tag=${[newChip(u), !memory ? String(ot.backing) : null]}>${spaceLabel(ctx, ot)}<//>
            <${Cell} meta>${last ? tr('organisms.ws.latest', 'latest') : ''}<//>
            ${last ? html`<${Cell} meta clip><${Action} tone="text" onClick=${() => gotoEvent(ctx, last)}>${instanceTitle(last.type, last.instance)}<//><//>` : html`<${Cell} faint>·<//>`}
            <${Doors}>${n ? html`<${Action} small row onClick=${() => openSpace(ctx, ot)}>${tr('organisms.ws.open', 'Open')}<//>`
              : (memory && !ot.append ? html`<${Action} small row soft onClick=${() => ovAddNew(ctx, ot, isDocSpace(ot))}>${tr('organisms.ws.addFirst', '+ Add')}<//>`
                : html`<${Action} small row soft onClick=${() => openSpace(ctx, ot)}>${tr('organisms.ws.open', 'Open')}<//>`)}<//>
          <//>`;
      })}
    <//>`;
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
  const openAiFold = () => { setOpenAi(true); setTimeout(() => scrollToSection('ws-ai'), 30); };
  const eventRow = (e, i) => html`
    <${FoldRow} key=${i} onClick=${() => gotoEvent(ctx, e)} num=${relTime(e.at)}
      who=${html`${shortActor(e.actor)}${e.agent ? html` · ${e.agent}` : null}`}
      verb=${e.action === 'publish' ? tr('organisms.publishedVerb', 'published') : tr('organisms.editedVerb', 'edited')}
      name=${html`${(wsT('type.' + e.type) || e.type)} / ${instanceTitle(e.type, e.instance)}`} />`;

  let num = 0;
  const next = () => String(++num).padStart(2, '0');
  const rail = [];
  const sections = [];

  if (hasNew) {
    const n = next();
    rail.push(['ws-new', n, tr('organisms.ws.newForYou', 'New for you'), unseen + approvals.length]);
    sections.push(html`
      <${PageSection} key="ws-new" id="ws-new" num=${n} first=${true} title=${tr('organisms.ws.newForYou', 'New for you')} count=${unseen || null}
        doors=${approvals.length ? html`<${Action} small soft onClick=${() => pickTab('review')}>${tr('organisms.ws.reviewDoor', 'Review →')}<//>` : null}>
        ${newSpaces.length ? html`<${List} cols="name-tags-doors" keepCols>${newSpaces.map(({ ot, n: u }) => html`
          <${Row} key=${ot.name}><${Name}>${spaceLabel(ctx, ot)}<//><${Cell}>${newChip(u)}<//><${Doors}><${Action} small row onClick=${() => openSpace(ctx, ot)}>${tr('organisms.ws.open', 'Open')}<//><//><//>`)}<//>` : null}
        ${approvals.length ? html`
          <${Space} above="large">
            <${Group} title=${tr('organisms.ws.waiting', 'Waiting for your decision')} count=${approvals.length}>
              <${List} cols="name-state" keepCols>${approvals.map(a => html`
                <${Row} key=${a.id}><${Name}>${a.prompt || a.action}<//>
                  <${Doors}>
                    <${Action} small row disabled=${busy} onClick=${() => resolve(a.id, 'approve')}>${tr('organisms.approve', 'Approve')}<//>
                    <${Action} small row soft disabled=${busy} onClick=${() => resolve(a.id, 'reject')}>${tr('organisms.reject', 'Reject')}<//>
                  <//>
                <//>`)}
              <//>
            <//>
          <//>` : null}
      <//>`);
  }

  groups.forEach((g, gi) => {
    const n = next();
    const isDocs = g.id === 'group:documents';
    rail.push(['ws-' + g.id, n, isDocs ? tr('organisms.ws.docsTitle', 'Documents') : g.label, g.count ?? 0]);
    sections.push(html`
      <${PageSection} key=${g.id} id=${'ws-' + g.id} num=${n} first=${!hasNew && gi === 0} title=${isDocs ? tr('organisms.ws.docsTitle', 'Documents') : g.label} count=${g.count ?? 0}
        doors=${html`
          ${gi === 0 && !showSearch ? html`<${Action} small soft onClick=${() => setShowSearch(true)}>${tr('organisms.ws.searchDoor', 'Search this workspace')}<//>` : null}
          ${isDocs ? html`<${Action} small soft onClick=${() => guardWsDirty(() => { setShowSettings(false); setShowSpaces(s => !s); })}>${'+ '}${tr('organisms.addDocSpaceTitle', 'Add a document space')}<//>` : null}`}>
        ${isDocs && showSpaces ? renderSpacesAdd(ctx) : null}
        ${spaceTable(ctx, g.spaces)}
        ${g.desc ? html`<${Note}>${g.desc}<//>` : null}
      <//>`);
  });

  {
    const n = next();
    rail.push(['ws-history', n, tr('organisms.happened', 'What has happened'), wsEvents.length]);
    sections.push(html`
      <${PageSection} key="ws-history" id="ws-history" num=${n} title=${tr('organisms.happened', 'What has happened')} count=${wsEvents.length || null}
        doors=${html`<${Action} small soft onClick=${() => pickTab('activity')}>${(tr('organisms.ws.fullActivity', 'Full activity {n} →')).replace('{n}', String(wsEvents.length))}<//>`}>
        ${wsEvents.length ? html`<${Folds}>${wsEvents.slice(0, 5).map(eventRow)}<//>` : html`<${Note} kind="quiet">${tr('organisms.noneYet', 'none yet')}<//>`}
      <//>`);
  }

  const nReadme = next(), nMap = next(), nAi = next();
  rail.push(['ws-readme', nReadme, tr('organisms.readmeFold', 'README'), '→'], ['ws-map', nMap, tr('organisms.mapAndToc', 'Map and table of contents'), '→'], ['ws-ai', nAi, tr('organisms.forAi', 'For your AI'), '→']);

  // The contents: every link scrolls to its section; a fold (README, map, For your AI) opens first.
  const opens = { 'ws-readme': () => setOpenReadme(true), 'ws-map': () => setOpenMap(true), 'ws-ai': () => setOpenAi(true) };
  const sectionItems = rail.map(([id, n, label, count]) => ({ key: id, section: id, href: '#' + id, mark: n, label, count, open: opens[id] }));

  const strip = html`
    <${FigureStrip} items=${[
      { key: 'rec', n: records, label: tr('organisms.ws.figRecords', 'records'), sub: (tr('organisms.ws.figTypes', '{n} types')).replace('{n}', String(recordSpaces.length)) },
      { key: 'doc', n: docs, label: tr('organisms.ws.figDocs', 'documents'), sub: (tr('organisms.ws.figSpaces', '{n} spaces')).replace('{n}', String(docSpaces.length)) },
      { key: 'rev', n: approvals.length, label: tr('organisms.ws.figReview', 'to review'), sub: approvals.length ? tr('organisms.ws.figReviewSub', 'a publish waits for your decision') : undefined },
      { key: 'last', n: last ? relTime(last.at) : '·', tone: last ? 'coral' : undefined, label: tr('organisms.figLast', 'last change'),
        sub: last ? `${shortActor(last.actor)} ${last.action === 'publish' ? tr('organisms.publishedVerb', 'published') : tr('organisms.editedVerb', 'edited')} ${(wsT('type.' + last.type) || last.type)} / ${instanceTitle(last.type, last.instance)}` : undefined },
    ]} />
    ${wsObjectives.length ? renderObjectives(ctx) : null}
    ${showSearch || wsQuery ? html`
      <${Space} above="large">
        <${SearchLine} value=${wsQuery} onInput=${e => setWsQuery(e.target.value)} autofocus=${true}
          placeholder=${tr('search.wsPlaceholder', 'Search this workspace…')} label=${tr('search.wsPlaceholder', 'Search this workspace')}>
          <${Action} small soft onClick=${() => { setWsQuery(''); setWsHits(null); setShowSearch(false); }}>${tr('search.clear', 'Clear')}<//>
        <//>
      <//>` : null}`;

  const actions = html`
    <${Loud} onClick=${openAiFold}>${tr('organisms.forAi', 'For your AI')}<//>
    <${Actions}>
      <${Action} small onClick=${() => pickTab('share')}>${tr('organisms.share', 'Share')}<//>
      <${Action} small onClick=${() => guardWsDirty(() => setShowSettings(true))}>${tr('organisms.settings', 'Settings')}<//>
      <${Action} small soft onClick=${() => setShowArchived(s => !s)}>${showArchived ? tr('organisms.viewActive', 'Active') : tr('organisms.viewArchived', 'Archived')}<//>
    <//>`;

  return html`
    <${SettingsPage} crumb=${crumb(ctx, null)} title=${ws.manifest?.name || ctx.wsName || ctx.org.name}
      marks=${[
        { kind: 'status', tone: (ws.manifest?.status || 'active') === 'active' ? 'fine' : 'off', label: ws.manifest?.status || 'active' },
        unseen > 0 ? { tone: 'sun', label: newWords(unseen) } : null,
        ws.manifest?.kind ? { label: ws.manifest.kind } : null,
        ws.manifest?.updatedAt ? { label: `${tr('organisms.lastSaved', 'Last saved')} ${fmtDate(ws.manifest.updatedAt)}` } : null,
        showArchived ? { tone: 'sun', label: tr('organisms.archivedView', 'Archived view') } : null,
      ]}
      desc=${ws.manifest?.summary || null} actions=${actions} strip=${strip}
      side=${railTree ? renderTree(ctx, 'overview') : null}
      rail=${railTree ? null : { title: RAIL_TITLE(), groups: [
        { label: RAIL_TITLE(), items: sectionItems },
        { items: panelDoors(ctx, 'overview') },
        { items: [treeToggle(ctx)] },
      ] }}>
      ${wsHits !== null ? renderWsSearchResults(ctx) : html`
        ${sections}
        ${(ws.apps || []).length || wsCanEdit ? html`<${Space} above="large"><${WorkspaceApps} orgId=${orgId} wsId=${wsId} apps=${ws.apps || []} canEdit=${wsCanEdit} showToast=${showToast} onChanged=${load} /><//>` : null}
        <${FoldSection} id="ws-readme" num=${nReadme} title=${tr('organisms.readmeFold', 'README')} sub=${readmeTitle} open=${openReadme} onToggle=${() => setOpenReadme(o => !o)}>
          ${readme || wsCanEdit
            ? html`<${ReadmePanel} markdown=${readme} canEdit=${wsCanEdit} kind="workspace" name=${ws.manifest?.name || 'Workspace'} aiPromptSeed=${wsTocSeed} onSave=${saveWsReadme} />`
            : html`<${Note} kind="quiet">${tr('organisms.readmeEmpty', 'No README yet.')}<//>`}
        <//>
        <${FoldSection} id="ws-map" num=${nMap} title=${tr('organisms.mapAndToc', 'Map and table of contents')} open=${openMap} onToggle=${() => setOpenMap(o => !o)}>
          <${Note}>${tr('organisms.mapAndTocHint', 'The same structure two ways.')}<//>
          <${StructureMindmap} scope="workspace" graph=${wsGraph} onNavigate=${onWsMapNav} storageKey=${'ws.' + orgId + '.' + wsId} defaultOpen />
          <${StructureOverview} label=${tr('organisms.structureOverviewWs', 'Workspace structure — table of contents')} load=${() => orgService.getWorkspaceOverview(orgId, wsId)} defaultOpen />
        <//>
        <${FoldSection} id="ws-ai" num=${nAi} title=${tr('organisms.forAiTitle', 'Bring your AI here')} open=${openAi} onToggle=${() => setOpenAi(o => !o)}>
          <${Note} kind="lead">${tr('organisms.ws.forAiLead', 'One instruction that brings your AI into this workspace with its real ids and structure. Paste it into a chat, hand it to a coding agent, or make a contract agent from it.')}<//>
          <${Actions}>${agentMenuItems.filter(m => !m.divider).map((m, i) => html`<${Action} small soft=${i === 2} key=${i} onClick=${m.onClick}>${m.label}<//>`)}<//>
        <//>`}
    <//>`;
}

/* ── A page under the same crumb: a space, a panel, the settings ───────────────────────────── */
function renderPage(ctx, { id, last, title, sub, desc = null, doors = null, children }) {
  const { activeSpace, groups, railTree } = ctx;
  // A space page lists its siblings in the rail (the other spaces of the same group) so the reader
  // can move sideways without going back to the cover.
  const group = activeSpace ? groups.find(g => g.kind === 'stacked' && g.spaces.some(ot => ot.name === activeSpace.name)) : null;
  const siblings = group ? group.spaces.map(ot => {
    const u = ctx.unseenOf('space:' + ot.name);
    return { key: ot.name, mark: '·', label: spaceLabel(ctx, ot), count: u > 0 ? '+' + u : '', on: ot.name === activeSpace.name, onClick: () => openSpace(ctx, ot) };
  }) : null;
  const back = { key: 'back', back: true, label: tr('organisms.ws.backToWorkspace', 'Back to the workspace'), onClick: () => ctx.guardWsDirty(() => { ctx.setShowSettings(false); ctx.pickTab('overview'); }) };
  return html`
    <${SettingsPage} page crumb=${crumb(ctx, last)} title=${title} sub=${sub || null} desc=${desc}
      actions=${doors ? html`<${Actions}>${doors}<//>` : null}
      side=${railTree ? renderTree(ctx, id) : null}
      rail=${railTree ? null : { title: RAIL_TITLE(), groups: [
        { label: RAIL_TITLE(), items: [back] },
        siblings ? { items: siblings } : null,
        { items: panelDoors(ctx, id) },
        { items: [treeToggle(ctx)] },
      ] }}>
      ${children}
    <//>`;
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
    // What the space IS, in its own words. A space whose data lives elsewhere used to read "record
    // type · 0" here, which is two wrong things about a row space at once: it holds no records, and
    // the zero is this page not counting them rather than the space being empty.
    const kind = docMode ? tr('organisms.ws.kindDoc', 'document space')
      : memory ? tr('organisms.ws.kindRecord', 'record type')
      : ot.backing === 'rows' ? tr('organisms.ws.kindRows', 'row space')
      : ot.backing === 'tasks' ? tr('organisms.ws.kindTasks', 'task space')
      : String(ot.backing);
    const sub = html`<span>${kind}</span><span>${memory ? n : '·'}</span>${u > 0 ? newChip(u) : null}`;
    const doors = !memory ? null : docMode ? html`
        <${Action} small soft onClick=${() => addSection(ot.name, null)}>${'+ '}${tr('organisms.section', 'Section')}<//>
        <${Action} small onClick=${() => setActiveDoc({ type: ot.name, mode: 'edit', page: { id: '', title: '', markdown: '' } })}>${'+ '}${tr('organisms.newPage', 'New document')}<//>`
      : (ot.append ? null : html`<${Action} small onClick=${() => startAdd(ot)}>${'+ '}${tr('organisms.addDraft', 'Add draft')}<//>`);
    return renderPage(ctx, { id: activeTab, last: spaceLabel(ctx, ot), title: spaceLabel(ctx, ot), sub, doors, desc: ctx.spaceDesc(ot) || null,
      children: !memory ? renderSpaceNotice(ot) : (docMode ? renderDocSpace(ctx, ot) : renderRecordSpace(ctx, ot)) });
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
    return renderPage(ctx, { id, last: label, title: label, sub: id === 'review' && ctx.approvals.length ? html`<span>${ctx.approvals.length}</span>` : null,
      desc: ctx.REL_DESC[id] || null, children: body });
  }
  return renderCover(ctx);
}
