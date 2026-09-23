/**
 * @file public/views/profile/organisms/workspace/cover.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The workspace in the poster face (design canvas "AIMEAT Työtilan sivu", direction A,
 *   the organism page's sibling one step deeper). The COVER answers in order: what is new for me
 *   (a first section that appears only while something is unseen or waits for a decision), what is
 *   here (the record types and the document spaces as rows with counts, the unseen mark and the
 *   latest item), what has happened, and then the README, the map and the AI instruction as folds.
 *   A space, a panel (activity, people, share, sources, skills, review) and the settings are each a
 *   PAGE of their own under the same crumb, with a rail that leads back. The rail on the cover is a
 *   numbered contents list with the panels as doors; "Show as a tree" swaps it for the whole
 *   structure with the documents listed under their space, a personal choice kept in home.prefs.
 *   Pure render functions over the ctx bag the parent Workspace assembles.
 * @structure renderWorkspaceView (cover or page) · renderCover · renderPage · renderRail · renderTree
 * @usage import { renderWorkspaceView } from './workspace/cover.js';
 * @version-history
 *   2026-09-22 -- The rail's fold entries open their fold through the set's onClick, not the hash;
 *     Approve and Reject carry the success and danger tones; the scroll comes from the set; the
 *     settings page's identity line carries the last-saved chip, and the template chip once.
 *   2026-09-22 -- Composed from the shared set: Page with an index Rail (the tree is the same rail
 *     with the structure as its body), Sections, ListRows for the spaces and the events, a plain
 *     NumeralBand for the figures, a search Field; no class of its own. A rail entry that names a
 *     fold opens it through the hash (useRailOpens in workspace.js).
 *   2026-09-14 -- An opened space says what it is: a row space and a task space are named as such
 *     instead of "record type", and the count they never had is a dash rather than a 0.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v1.2.0 -- 2026-09-13 -- Compose existing top rules from poster.css.
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-08-29 — Initial. Replaces the tab block (21 tabs in three rows), the overview
 *     accordion and the README/map/toc stack that stood above every space.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import * as orgService from '/js/services/organisms.js';
import { relTime, fmtDate } from '/views/profile/organisms/helpers.js';
import { ReadmePanel } from '/views/profile/organisms/readme-panel.js';
import { StructureMindmap } from '/views/profile/organisms/mindmap.js';
import { StructureOverview } from '/views/profile/organisms/widgets.js';
import { WorkspaceApps } from '/views/profile/organisms/workspace-apps.js';
import { ParticipantsPanel } from '/views/profile/organisms/participants-panel.js';
import { SourcesPanel } from '/views/profile/organisms/sources-panel.js';
import { SkillsPanel } from '/views/profile/organisms/skills-panel.js';
import { tr } from '/views/profile/organisms/poster-parts.js';
import { Page, Rail, Section, Fold, Stack, ListRow, Chip, Action, Field, Text, NumeralBand, scrollToId as scrollTo } from '/components/poster-parts.js';
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
const newChip = (n) => n > 0 ? html`<${Chip} tone="sun">${(tr('organisms.ws.newChip', '{n} new for you')).replace('{n}', String(n))}<//>` : null;
const countIn = (ctx, ot) => new Set([...ctx.draftsFor(ot.name), ...ctx.objectsFor(ot.name)].map(d => d.id)).size;
/** The name field takes the focus once, when it opens (the old search's autofocus). */
const focusOnce = (el) => { if (el && !el.dataset.focused) { el.dataset.focused = 'yes'; el.focus(); } };

/* ── The rail (numbered contents + the panel doors) and its tree form ───────────────────────── */
/** A door in the rail is a word; the one for the page you are on is the tab that is on. */
const railKind = (on) => (on ? 'tab' : 'text');
function railDoors(ctx, current) {
  return html`<${Stack} density="compact">
    ${PANELS(ctx).map(([id, label, count]) => html`
      <${Action} kind=${railKind(current === id)} key=${id} selected=${current === id} onClick=${() => ctx.pickTab(id)}>${label} ${count === '' ? '→' : count}<//>`)}
    <${Action} kind=${railKind(current === 'settings')} selected=${current === 'settings'} onClick=${() => ctx.guardWsDirty(() => ctx.setShowSettings(true))}>${tr('organisms.settings', 'Settings')} →<//>
    ${treeToggle(ctx)}
  <//>`;
}
function treeToggle(ctx) {
  return html`<${Action} kind="text" onClick=${() => ctx.setRailTree(!ctx.railTree)}>${ctx.railTree ? '↩' : '→'} ${ctx.railTree ? tr('organisms.ws.showRail', 'Show the contents') : tr('organisms.ws.showTree', 'Show as a tree')}<//>`;
}

function renderRail(ctx, entries, current, lead = null) {
  return html`<${Rail} kind="index" title=${tr('organisms.ws.railTitle', 'In this workspace')} entries=${entries}>
    <${Stack}>${lead}${railDoors(ctx, current)}<//>
  <//>`;
}

/* The whole structure as one tree: every group, every space with its count, and the documents of a
 * document space listed under it. */
function renderTree(ctx, current) {
  const { isDocSpace, mergedDocs, setActiveDoc, unseenOf } = ctx;
  const MAX = 8;
  return html`<${Rail} kind="index" title=${tr('organisms.ws.railTitle', 'In this workspace')}>
    <${Stack}>
      ${stacked(ctx).map(g => html`
        <${Stack} key=${g.id} density="compact">
          <${Text} kind="label">${g.label} ${g.count ?? ''}<//>
          ${g.spaces.map(ot => {
            const id = 'space:' + ot.name;
            const u = unseenOf(id);
            const docs = orgService.isMemorySpace(ot) && isDocSpace(ot) ? mergedDocs(ot) : null;
            return html`
              <${Stack} key=${ot.name} density="compact">
                <${Action} kind=${railKind(current === id)} selected=${current === id} onClick=${() => openSpace(ctx, ot)}>
                  ${spaceLabel(ctx, ot)} ${docs ? docs.length : (orgService.isMemorySpace(ot) ? countIn(ctx, ot) : '·')}${u > 0 ? ` +${u}` : ''}<//>
                ${docs ? docs.slice(0, MAX).map(d => html`
                  <${Action} kind="text" key=${d.id} selected=${ctx.activeDoc?.type === ot.name && ctx.activeDoc.page?.id === d.id}
                    onClick=${() => { setActiveDoc({ type: ot.name, mode: 'view', page: { id: d.id } }); openSpace(ctx, ot); }}>
                    ${d._draft ? `${tr('organisms.draft', 'draft')} · ` : ''}${d.title || d.id}<//>`) : null}
                ${docs && docs.length > MAX ? html`<${Action} kind="text" onClick=${() => openSpace(ctx, ot)}>${(tr('organisms.ws.more', '… {n} more')).replace('{n}', String(docs.length - MAX))}<//>` : null}
              <//>`;
          })}
        <//>`)}
      <${Stack} density="compact">
        <${Text} kind="label">${tr('organisms.groupRelated', 'Workspace')}<//>
        <${Action} kind=${railKind(current === 'activity')} selected=${current === 'activity'} onClick=${() => ctx.pickTab('activity')}>${tr('organisms.happened', 'What has happened')} ${ctx.wsEvents.length}<//>
      <//>
      ${railDoors(ctx, current)}
    <//>
  <//>`;
}

/* ── The crumb every view shares ───────────────────────────────────────────────────────────── */
function crumbs(ctx, last) {
  const { onBack, onBackToList, org, wsName, ws, pickTab, guardWsDirty, setShowSettings } = ctx;
  const name = wsName || ws?.manifest?.name || '…';
  const home = () => guardWsDirty(() => { setShowSettings(false); pickTab('overview'); });
  return [
    { label: t('nav.profile') },
    { label: t('profile.landing.menuInformation') },
    { label: tr('organisms.title', 'Organisms'), onClick: onBackToList || onBack },
    { label: org.name || org.id || '', onClick: onBack },
    last ? { label: name, onClick: home } : { label: name },
    last ? { label: last } : null,
  ].filter(Boolean);
}

/* ── One list of spaces: the figure, the name with its unseen mark, the latest item, the door ── */
function spaceRows(ctx, spaces) {
  const { isDocSpace, unseenOf, instanceTitle } = ctx;
  return html`<${Stack} density="compact">
    ${spaces.map(ot => {
      const memory = orgService.isMemorySpace(ot);
      const n = memory ? countIn(ctx, ot) : null;
      const u = memory ? unseenOf('space:' + ot.name) : 0;
      const last = memory ? latestFor(ctx, ot) : null;
      return html`
        <${ListRow} key=${ot.name} density="compact"
          mark=${html`<${Text} kind="number" size="small">${n ?? '·'}<//>`}
          name=${spaceLabel(ctx, ot)} onOpen=${() => openSpace(ctx, ot)}
          detail=${last ? html`${tr('organisms.ws.latest', 'latest')} <${Action} kind="text" onClick=${() => gotoEvent(ctx, last)}>${instanceTitle(last.type, last.instance)}<//>` : undefined}
          actions=${html`${newChip(u)}${!memory ? html`<${Chip} tone="muted">${String(ot.backing)}<//>` : null}
            ${n ? html`<${Action} onClick=${() => openSpace(ctx, ot)}>${tr('organisms.ws.open', 'Open')}<//>`
              : (memory && !ot.append ? html`<${Action} onClick=${() => ovAddNew(ctx, ot, isDocSpace(ot))}>${tr('organisms.ws.addFirst', '+ Add')}<//>`
                : html`<${Action} onClick=${() => openSpace(ctx, ot)}>${tr('organisms.ws.open', 'Open')}<//>`)}`} />`;
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
  const countOf = (spaces) => spaces.reduce((n, ot) => n + (orgService.isMemorySpace(ot) ? countIn(ctx, ot) : 0), 0);
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
  const verb = (e) => (e.action === 'publish' ? tr('organisms.publishedVerb', 'published') : tr('organisms.editedVerb', 'edited'));
  const eventRow = (e, i) => html`
    <${ListRow} key=${i} density="compact" kind="chronology" time=${relTime(e.at)} marker=${e.action === 'publish' ? 'coral' : 'muted'}
      name=${`${(wsT('type.' + e.type) || e.type)} / ${instanceTitle(e.type, e.instance)}`} onOpen=${() => gotoEvent(ctx, e)}
      detail=${`${shortActor(e.actor)}${e.agent ? ` · ${e.agent}` : ''} · ${verb(e)}`} />`;

  const entries = [];
  const sections = [];

  if (hasNew) {
    entries.push({ id: 'ws-new', href: '#ws-new', label: tr('organisms.ws.newForYou', 'New for you'), count: unseen + approvals.length });
    sections.push(html`
      <${Section} key="ws-new" id="ws-new" title=${tr('organisms.ws.newForYou', 'New for you')} count=${unseen || null} selected=${true} density="compact"
        actions=${approvals.length ? html`<${Action} onClick=${() => pickTab('review')}>${tr('organisms.ws.reviewDoor', 'Review →')}<//>` : null}>
        <${Stack}>
          ${newSpaces.length ? html`<${Stack} density="compact">${newSpaces.map(({ ot, n: u }) => html`
            <${ListRow} key=${ot.name} density="compact" name=${spaceLabel(ctx, ot)}
              actions=${html`${newChip(u)}<${Action} onClick=${() => openSpace(ctx, ot)}>${tr('organisms.ws.open', 'Open')}<//>`} />`)}<//>` : null}
          ${approvals.length ? html`
            <${Text} kind="label">${tr('organisms.ws.waiting', 'Waiting for your decision')} ${approvals.length}<//>
            <${Stack} density="compact">${approvals.map(a => html`
              <${ListRow} key=${a.id} density="compact" name=${a.prompt || a.action}
                actions=${html`<${Action} tone="success" disabled=${busy} onClick=${() => resolve(a.id, 'approve')}>${tr('organisms.approve', 'Approve')}<//>
                  <${Action} kind="text" tone="danger" disabled=${busy} onClick=${() => resolve(a.id, 'reject')}>${tr('organisms.reject', 'Reject')}<//>`} />`)}<//>` : null}
        <//>
      <//>`);
  }

  groups.forEach((g, gi) => {
    const isDocs = g.id === 'group:documents';
    entries.push({ id: 'ws-' + g.id, href: '#ws-' + g.id, label: isDocs ? tr('organisms.ws.docsTitle', 'Documents') : g.label, count: g.count ?? 0 });
    sections.push(html`
      <${Section} key=${g.id} id=${'ws-' + g.id} title=${isDocs ? tr('organisms.ws.docsTitle', 'Documents') : g.label} count=${g.count ?? 0} density="compact"
        actions=${gi === 0 && !showSearch || isDocs ? html`
          ${gi === 0 && !showSearch ? html`<${Action} onClick=${() => setShowSearch(true)}>${tr('organisms.ws.searchDoor', 'Search this workspace')}<//>` : null}
          ${isDocs ? html`<${Action} kind="tab" selected=${showSpaces} onClick=${() => guardWsDirty(() => { setShowSettings(false); setShowSpaces(s => !s); })}>${tr('organisms.addDocSpaceTitle', 'Add a document space')}<//>` : null}` : null}>
        <${Stack}>
          ${isDocs && showSpaces ? renderSpacesAdd(ctx) : null}
          ${spaceRows(ctx, g.spaces)}
          ${g.desc ? html`<${Text} kind="caption" tone="muted">${g.desc}<//>` : null}
        <//>
      <//>`);
  });

  entries.push({ id: 'ws-history', href: '#ws-history', label: tr('organisms.happened', 'What has happened'), count: wsEvents.length });
  sections.push(html`
    <${Section} key="ws-history" id="ws-history" title=${tr('organisms.happened', 'What has happened')} count=${wsEvents.length || null} density="compact"
      actions=${html`<${Action} onClick=${() => pickTab('activity')}>${(tr('organisms.ws.fullActivity', 'Full activity {n} →')).replace('{n}', String(wsEvents.length))}<//>`}>
      ${wsEvents.length ? html`<${Stack} density="compact">${wsEvents.slice(0, 5).map(eventRow)}<//>` : html`<${Text} kind="caption" tone="muted">${tr('organisms.noneYet', 'none yet')}<//>`}
    <//>`);

  const nReadme = String(entries.length + 1).padStart(2, '0'), nMap = String(entries.length + 2).padStart(2, '0'), nAi = String(entries.length + 3).padStart(2, '0');
  entries.push(
    { id: 'ws-readme', href: '#ws-readme', label: tr('organisms.readmeFold', 'README'), count: '→', onClick: () => setOpenReadme(true) },
    { id: 'ws-map', href: '#ws-map', label: tr('organisms.mapAndToc', 'Map and table of contents'), count: '→', onClick: () => setOpenMap(true) },
    { id: 'ws-ai', href: '#ws-ai', label: tr('organisms.forAi', 'For your AI'), count: '→', onClick: () => setOpenAi(true) },
  );

  return html`<${Page} title=${ws.manifest?.name || ctx.wsName || ctx.org.name} crumbs=${crumbs(ctx, null)}
    identity=${html`<${Stack} direction="wrap" density="compact">
      <${Chip}>${ws.manifest?.status || 'active'}<//>
      ${newChip(unseen)}
      ${ws.manifest?.kind ? html`<${Chip} tone="muted">${ws.manifest.kind}<//>` : null}
      ${ws.manifest?.updatedAt ? html`<${Chip} tone="muted">${tr('organisms.lastSaved', 'Last saved')} ${fmtDate(ws.manifest.updatedAt)}<//>` : null}
      ${showArchived ? html`<${Chip} tone="sun">${tr('organisms.archivedView', 'Archived view')}<//>` : null}
    <//>`}
    actions=${html`
      <${Action} kind="primary" onClick=${openAiFold}>${tr('organisms.forAi', 'For your AI')}<//>
      <${Action} onClick=${() => pickTab('share')}>${tr('organisms.share', 'Share')}<//>
      <${Action} onClick=${() => guardWsDirty(() => setShowSettings(true))}>${tr('organisms.settings', 'Settings')}<//>
      <${Action} kind="tab" selected=${showArchived} onClick=${() => setShowArchived(s => !s)}>${showArchived ? tr('organisms.viewActive', 'Active') : tr('organisms.viewArchived', 'Archived')}<//>`}
    rail=${railTree ? renderTree(ctx, 'overview') : renderRail(ctx, entries, 'overview')}>
    ${ws.manifest?.summary ? html`<${Text} kind="lead" tone="muted">${ws.manifest.summary}<//>` : null}
    <${NumeralBand} tone="plain" size="small" items=${[
      { label: tr('organisms.ws.figRecords', 'records'), value: records, note: (tr('organisms.ws.figTypes', '{n} types')).replace('{n}', String(recordSpaces.length)) },
      { label: tr('organisms.ws.figDocs', 'documents'), value: docs, note: (tr('organisms.ws.figSpaces', '{n} spaces')).replace('{n}', String(docSpaces.length)) },
      { label: tr('organisms.ws.figReview', 'to review'), value: approvals.length, note: approvals.length ? tr('organisms.ws.figReviewSub', 'a publish waits for your decision') : undefined },
      { label: tr('organisms.figLast', 'last change'), value: last ? relTime(last.at) : '·', tone: last ? 'coral' : undefined,
        note: last ? `${shortActor(last.actor)} ${verb(last)} ${(wsT('type.' + last.type) || last.type)} / ${instanceTitle(last.type, last.instance)}` : undefined },
    ]} />

    ${wsObjectives.length ? renderObjectives(ctx) : null}

    ${showSearch || wsQuery ? html`
      <${Stack} density="compact">
        <${Field} type="search" label=${tr('search.wsPlaceholder', 'Search this workspace…')} value=${wsQuery} onInput=${e => setWsQuery(e.target.value)} inputRef=${focusOnce} />
        <${Stack} direction="wrap"><${Action} onClick=${() => { setWsQuery(''); setWsHits(null); setShowSearch(false); }}>${tr('search.clear', 'Clear')}<//><//>
      <//>` : null}

    ${wsHits !== null ? renderWsSearchResults(ctx) : html`
      ${sections}
      ${(ws.apps || []).length || wsCanEdit ? html`<${WorkspaceApps} orgId=${orgId} wsId=${wsId} apps=${ws.apps || []} canEdit=${wsCanEdit} showToast=${showToast} onChanged=${load} />` : null}
      <${Fold} id="ws-readme" number=${nReadme} title=${tr('organisms.readmeFold', 'README')} sub=${readmeTitle} open=${openReadme} onToggle=${() => setOpenReadme(o => !o)}>
        ${readme || wsCanEdit
          ? html`<${ReadmePanel} markdown=${readme} canEdit=${wsCanEdit} kind="workspace" name=${ws.manifest?.name || 'Workspace'} aiPromptSeed=${wsTocSeed} onSave=${saveWsReadme} />`
          : html`<${Text} kind="caption" tone="muted">${tr('organisms.readmeEmpty', 'No README yet.')}<//>`}
      <//>
      <${Fold} id="ws-map" number=${nMap} title=${tr('organisms.mapAndToc', 'Map and table of contents')} open=${openMap} onToggle=${() => setOpenMap(o => !o)}>
        <${Text} kind="caption" tone="muted">${tr('organisms.mapAndTocHint', 'The same structure two ways.')}<//>
        <${StructureMindmap} scope="workspace" graph=${wsGraph} onNavigate=${onWsMapNav} storageKey=${'ws.' + orgId + '.' + wsId} defaultOpen />
        <${StructureOverview} label=${tr('organisms.structureOverviewWs', 'Workspace structure — table of contents')} load=${() => orgService.getWorkspaceOverview(orgId, wsId)} defaultOpen />
      <//>
      <${Fold} id="ws-ai" number=${nAi} title=${tr('organisms.forAiTitle', 'Bring your AI here')} open=${openAi} onToggle=${() => setOpenAi(o => !o)}>
        <${Text} kind="lead">${tr('organisms.ws.forAiLead', 'One instruction that brings your AI into this workspace with its real ids and structure. Paste it into a chat, hand it to a coding agent, or make a contract agent from it.')}<//>
        <${Stack} direction="wrap">${agentMenuItems.filter(m => !m.divider).map((m, i) => html`<${Action} key=${i} onClick=${m.onClick}>${m.label}<//>`)}<//>
      <//>`}
  <//>`;
}

/* ── A page under the same crumb: a space, a panel, the settings ───────────────────────────── */
function renderPage(ctx, { id, last, title, chips = null, doors = null, children }) {
  const { activeSpace, groups, railTree } = ctx;
  // A space page lists its siblings in the rail (the other spaces of the same group) so the reader
  // can move sideways without going back to the cover.
  const group = activeSpace ? groups.find(g => g.kind === 'stacked' && g.spaces.some(ot => ot.name === activeSpace.name)) : null;
  const siblings = group ? html`<${Stack} density="compact">${group.spaces.map(ot => html`
    <${Action} kind=${railKind(ot.name === activeSpace.name)} key=${ot.name} selected=${ot.name === activeSpace.name} onClick=${() => openSpace(ctx, ot)}>${spaceLabel(ctx, ot)}${ctx.unseenOf('space:' + ot.name) > 0 ? ' +' + ctx.unseenOf('space:' + ot.name) : ''}<//>`)}<//>` : null;
  const back = html`<${Action} kind="text" onClick=${() => ctx.guardWsDirty(() => { ctx.setShowSettings(false); ctx.pickTab('overview'); })}>← ${tr('organisms.ws.backToWorkspace', 'Back to the workspace')}<//>`;
  return html`<${Page} title=${title} crumbs=${crumbs(ctx, last)}
    identity=${chips ? html`<${Stack} direction="wrap" density="compact">${chips}<//>` : null}
    actions=${doors}
    rail=${railTree ? renderTree(ctx, id) : renderRail(ctx, [], id, html`${back}${siblings}`)}>
    <${Stack}>${children}<//>
  <//>`;
}

export function renderWorkspaceView(ctx) {
  const { ws, showSettings, activeTab, activeSpace, isDocSpace, unseenOf, setActiveDoc, addSection, startAdd } = ctx;
  if (showSettings) {
    return renderPage(ctx, { id: 'settings', last: tr('organisms.settings', 'Settings'), title: tr('organisms.settings', 'Settings'),
      chips: html`<${Chip} tone="muted">${tr('organisms.template', 'Template')} ${(ws.manifest?.kind || '-')}<//>
        ${ws.manifest?.updatedAt ? html`<${Chip} tone="muted">${tr('organisms.lastSaved', 'Last saved')} ${fmtDate(ws.manifest.updatedAt)}<//>` : null}`,
      children: renderSettingsPanel(ctx) });
  }
  if (activeSpace) {
    const ot = activeSpace;
    const memory = orgService.isMemorySpace(ot);
    const docMode = memory && isDocSpace(ot);
    const n = memory ? countIn(ctx, ot) : 0;
    const u = unseenOf('space:' + ot.name);
    // What the space IS, in its own words. A space whose data lives elsewhere used to read "record
    // type · 0" here, which is two wrong things about a row space at once: it holds no records, and
    // the zero is this page not counting them rather than the space being empty.
    const kind = docMode ? tr('organisms.ws.kindDoc', 'document space')
      : memory ? tr('organisms.ws.kindRecord', 'record type')
      : ot.backing === 'rows' ? tr('organisms.ws.kindRows', 'row space')
      : ot.backing === 'tasks' ? tr('organisms.ws.kindTasks', 'task space')
      : String(ot.backing);
    const chips = html`<${Chip}>${kind}<//><${Chip} tone="muted">${memory ? n : '·'}<//>${u > 0 ? newChip(u) : null}`;
    const doors = !memory ? null : docMode ? html`
        <${Action} onClick=${() => addSection(ot.name, null)}>${tr('organisms.section', 'Section')}<//>
        <${Action} kind="primary" onClick=${() => setActiveDoc({ type: ot.name, mode: 'edit', page: { id: '', title: '', markdown: '' } })}>${tr('organisms.newPage', 'New document')}<//>`
      : (ot.append ? null : html`<${Action} kind="primary" onClick=${() => startAdd(ot)}>${tr('organisms.addDraft', 'Add draft')}<//>`);
    return renderPage(ctx, { id: activeTab, last: spaceLabel(ctx, ot), title: spaceLabel(ctx, ot), chips, doors,
      children: html`${ctx.spaceDesc(ot) ? html`<${Text} kind="lead" tone="muted">${ctx.spaceDesc(ot)}<//>` : null}
        ${!memory ? renderSpaceNotice(ot) : (docMode ? renderDocSpace(ctx, ot) : renderRecordSpace(ctx, ot))}` });
  }
  const panel = PANELS(ctx).find(([id]) => id === activeTab);
  if (activeTab === 'activity') {
    return renderPage(ctx, { id: 'activity', last: tr('organisms.activity', 'Activity'), title: tr('organisms.happened', 'What has happened'), chips: html`<${Chip} tone="muted">${ctx.wsEvents.length}<//>`, children: renderActivityTab(ctx) });
  }
  if (panel) {
    const [id, label] = panel;
    const body = id === 'people' ? html`<${ParticipantsPanel} orgId=${ctx.orgId} wsId=${ctx.wsId} showToast=${ctx.showToast} />`
      : id === 'sources' ? html`<${SourcesPanel} orgId=${ctx.orgId} wsId=${ctx.wsId} showToast=${ctx.showToast} />`
        : id === 'skills' ? html`<${SkillsPanel} orgId=${ctx.orgId} wsId=${ctx.wsId} showToast=${ctx.showToast} />`
          : id === 'share' ? renderShareTab(ctx) : renderReviewTab(ctx);
    const desc = ctx.REL_DESC[id];
    return renderPage(ctx, { id, last: label, title: label, chips: id === 'review' && ctx.approvals.length ? html`<${Chip} tone="sun">${ctx.approvals.length}<//>` : null,
      children: html`${desc ? html`<${Text} kind="lead" tone="muted">${desc}<//>` : null}${body}` });
  }
  return renderCover(ctx);
}
