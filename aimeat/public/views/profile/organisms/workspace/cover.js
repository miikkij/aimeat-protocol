/**
 * @file public/views/profile/organisms/workspace/cover.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The workspace in the poster face (the shared place's page one step deeper). The
 *   COVER answers in order: what is here to read (the documents by title, always open), what else it
 *   holds (one row per records, row and task space), and the workspace's own parts as rows that say
 *   their state (cover-sections.js). What waits for this person (a publish to decide, what is new
 *   since the last visit) is a line in the band under the figures. A space, a panel (activity,
 *   people, share, sources, skills, review) and the settings are each a PAGE of their own under the
 *   same crumb, with a rail that leads back. The rail on the cover is a numbered contents list;
 *   "Show as a tree" swaps it for the whole structure with the documents nested, a personal choice
 *   kept in home.prefs like the margin pattern. Pure render functions over the ctx bag the parent
 *   Workspace assembles.
 * @structure renderWorkspaceView (cover or page) · renderCover · renderPage · renderRail · renderTree
 * @usage import { renderWorkspaceView } from './workspace/cover.js';
 * @version-history
 *   v2.0.0 -- 2026-11-27 -- The cover leads with the documents: every document space with its
 *     documents by title, newest first, eight per space then "all N"; a document opens in one press
 *     and has "Open in Pages". The records, row and task spaces follow as one row each (a row space
 *     with its count from the workspace read's row_spaces). README, What has happened, People,
 *     Review, Suggestions, Apps, Sources, Skills, Share, the map and Bring your AI here are rows
 *     under "Workspace" that say their state and open in place (cover-sections.js). "New for you"
 *     and the publishes waiting for a decision are lines in the band (red for the decision). The
 *     head's raw marks (`active`, the manifest kind) are gone; a status other than active stays as a
 *     state. The head's description falls back to the README's first paragraph. The cover's rail
 *     lists the three sections and Settings; the panels stay pages on the space and panel pages' rail.
 *   v1.14.2 -- 2026-11-14 -- A team workspace's title and its team in the crumb are in the reader's language, and the summary under the title is the manifest's `i18n.summary` for the reader when it has one (team setup T24).
 *   v1.14.1 -- 2026-10-18 -- The figure strip's "{n} types" and "{n} spaces" in the language's plural form (i18n.js tn): "1 space".
 *   v1.14.0 -- 2026-10-16 -- A document space's head offers "+ HTML page" beside "+ New document".
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
import { relTime, fmtDate, orgName, wsDisplayName } from '/views/profile/organisms/helpers.js';
import { ParticipantsPanel } from '/views/profile/organisms/participants-panel.js';
import { SourcesPanel } from '/views/profile/organisms/sources-panel.js';
import { SkillsPanel } from '/views/profile/organisms/skills-panel.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { scrollToSection } from '/components/Rail.js';
import { ContentsTree } from '/components/ContentsTree.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Space } from '/components/Layout.js';
import { SearchLine } from '/components/List.js';
import { tr } from '/views/profile/organisms/poster-parts.js';
import { tn, tOr } from '/js/i18n.js';
import { renderWsSearchResults, renderObjectives } from './overview.js';
import { renderSettingsPanel, renderShareTab, renderReviewTab, renderActivityTab } from './panels.js';
import { renderSpaceNotice, shortActor } from './helpers.js';
import { renderDocSpace } from './doc-space.js';
import { renderRecordSpace } from './record-space.js';
import { docsSection, recordsSection, workspaceSection, readmeLead } from './cover-sections.js';

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
    { label: orgName(org), onClick: onBack },
    ...(last ? [{ label: name, onClick: home }, last] : [name]),
  ];
}

/* ── The cover ─────────────────────────────────────────────────────────────────────────────── */
function renderCover(ctx) {
  const {
    ws, allTypes, isDocSpace, approvals, wsEvents, wsT, instanceTitle, unseenOf, wsObjectives,
    wsQuery, setWsQuery, wsHits, setWsHits, showSearch, setShowSearch,
    showArchived, setShowArchived, pickTab, guardWsDirty, setShowSettings, railTree,
  } = ctx;
  const memDocs = (ot) => orgService.isMemorySpace(ot) && isDocSpace(ot);
  const docSpaces = allTypes.filter(memDocs);
  const recordSpaces = allTypes.filter(ot => orgService.isMemorySpace(ot) && !isDocSpace(ot));
  const docs = docSpaces.reduce((n, ot) => n + ctx.mergedDocs(ot).length, 0);
  const records = recordSpaces.reduce((n, ot) => n + ctx.mergedRecords(ot).length, 0);
  const unseen = unseenTotal(ctx);
  const newSpaces = allTypes.filter(ot => unseenOf('space:' + ot.name) > 0).map(ot => spaceLabel(ctx, ot));
  const last = wsEvents[0] || null;
  const openAiRow = () => { ctx.openWsRow('ai'); setTimeout(() => scrollToSection('ws-ai'), 30); };

  // The sections in the order a person comes for them: the documents, the records, the workspace's
  // own parts (cover-sections.js). Each is numbered as it is drawn.
  const parts = [
    { id: 'ws-docs', label: tr('organisms.ws.docsTitle', 'Documents'), count: docs, draw: (n) => docsSection(ctx, n) },
    allTypes.some(ot => !memDocs(ot)) ? { id: 'ws-records', label: tr('organisms.groupRecords', 'Records'), count: records, draw: (n) => recordsSection(ctx, n) } : null,
    { id: 'ws-workspace', label: tr('organisms.groupRelated', 'Workspace'), count: '→', draw: (n) => workspaceSection(ctx, n) },
  ].filter(Boolean).map((s, i) => ({ ...s, num: String(i + 1).padStart(2, '0') }));
  const sectionItems = parts.map(({ id, num, label, count }) => ({ key: id, section: id, href: '#' + id, mark: num, label, count }));

  // What waits for this person is said in the band under the figures: a publish waiting for a
  // decision in red, what is new since the last visit in grey.
  const band = html`
    ${approvals.length ? html`<${Note} kind="state" tone="danger">${tn('organisms.ws.bandReview', approvals.length)} <${Action} tone="inline" small onClick=${() => pickTab('review')}>${tr('organisms.ws.bandReviewGo', 'Review')}<//><//>` : null}
    ${unseen > 0 ? html`<${Note} kind="state">${tn('organisms.ws.bandNew', unseen, { spaces: newSpaces.join(', ') })}<//>` : null}`;
  const strip = html`
    <${FigureStrip} hideZeros items=${[
      { key: 'doc', n: docs, label: tr('organisms.ws.figDocs', 'documents'), sub: tn('organisms.ws.figSpaces', docSpaces.length) },
      { key: 'rec', n: records, label: tr('organisms.ws.figRecords', 'records'), sub: tn('organisms.ws.figTypes', recordSpaces.length) },
      { key: 'last', n: last ? relTime(last.at) : '·', tone: last ? 'coral' : undefined, label: tr('organisms.figLast', 'last change'),
        sub: last ? `${shortActor(last.actor)} ${last.action === 'publish' ? tr('organisms.publishedVerb', 'published') : tr('organisms.editedVerb', 'edited')} ${instanceTitle(last.type, last.instance)}` : undefined },
    ]} />
    ${band}
    ${wsObjectives.length ? renderObjectives(ctx) : null}
    ${showSearch || wsQuery ? html`
      <${Space} above="large">
        <${SearchLine} value=${wsQuery} onInput=${e => setWsQuery(e.target.value)} autofocus=${true}
          placeholder=${tr('search.wsPlaceholder', 'Search this workspace…')} label=${tr('search.wsPlaceholder', 'Search this workspace')}>
          <${Action} small soft onClick=${() => { setWsQuery(''); setWsHits(null); setShowSearch(false); }}>${tr('search.clear', 'Clear')}<//>
        <//>
      <//>` : null}`;

  const actions = html`
    <${Loud} onClick=${openAiRow}>${tr('organisms.forAi', 'For your AI')}<//>
    <${Actions}>
      <${Action} small onClick=${() => pickTab('share')}>${tr('organisms.share', 'Share')}<//>
      <${Action} small onClick=${() => guardWsDirty(() => setShowSettings(true))}>${tr('organisms.settings', 'Settings')}<//>
      <${Action} small soft onClick=${() => setShowArchived(s => !s)}>${showArchived ? tr('organisms.viewActive', 'Active') : tr('organisms.viewArchived', 'Archived')}<//>
    <//>`;

  // The head says what the workspace is for: the manifest's summary, else the README's first paragraph.
  const status = ws.manifest?.status || 'active';
  return html`
    <${SettingsPage} crumb=${crumb(ctx, null)} title=${wsDisplayName(ctx.org, ctx.wsId, ws.manifest?.name) || ctx.wsName || orgName(ctx.org)}
      marks=${[
        status !== 'active' ? { kind: 'status', tone: 'off', label: tOr(`organisms.ws.status.${status}`, status) } : null,
        ws.manifest?.updatedAt ? { label: `${tr('organisms.lastSaved', 'Last saved')} ${fmtDate(ws.manifest.updatedAt)}` } : null,
        showArchived ? { tone: 'sun', label: tr('organisms.archivedView', 'Archived view') } : null,
      ]}
      desc=${wsT?.('summary') || ws.manifest?.summary || readmeLead(ws.readme) || null} actions=${actions} strip=${strip}
      side=${railTree ? renderTree(ctx, 'overview') : null}
      rail=${railTree ? null : { title: RAIL_TITLE(), groups: [
        { label: RAIL_TITLE(), items: sectionItems },
        { items: [{ key: 'settings', mark: '·', label: tr('organisms.settings', 'Settings'), count: '→', onClick: () => guardWsDirty(() => setShowSettings(true)) }] },
        { items: [treeToggle(ctx)] },
      ] }}>
      ${wsHits !== null ? renderWsSearchResults(ctx) : parts.map(s => s.draw(s.num))}
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
        <${Action} small onClick=${() => setActiveDoc({ type: ot.name, mode: 'edit', page: { id: '', title: '', markdown: '' } })}>${'+ '}${tr('organisms.newPage', 'New document')}<//>
        <${Action} small onClick=${() => setActiveDoc({ type: ot.name, mode: 'edit', page: { id: '', title: '', html: '' } })}>${'+ '}${tr('htmlPage.newPage', 'HTML page')}<//>`
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
