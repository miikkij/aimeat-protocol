/**
 * @file public/views/profile/organisms/workspace/cover-sections.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The three sections of a workspace's cover, in the order a person comes for them:
 *   Documents (every document space with its documents by title, newest first, eight per space and
 *   then "all N"; a document opens in one press, and "Open in Pages" opens it in the AIMEAT Pages
 *   app), Records (one row per records space, row space and task space, saying what it holds, what
 *   is new and its newest item by title; a row space's count is the workspace read's `row_spaces`),
 *   and Workspace (README, What has happened, People, Review, Suggestions, Apps, Sources, Skills,
 *   Share, the map and Bring your AI here, each one row that says its state and opens in place).
 *   Pure render functions over the ctx bag the parent Workspace assembles (workspace.js).
 * @structure pagesLink(orgId, wsId, docId) · readmeLead(md) · docsSection(ctx, num) ·
 *   recordsSection(ctx, num) · workspaceSection(ctx, num)
 * @usage import { docsSection, recordsSection, workspaceSection } from './cover-sections.js';
 * @version-history
 *   v1.0.0 -- 2026-11-27 -- Initial: documents first and by title, records one row per space, the
 *     workspace's own parts as rows that say their state (the cover in cover.js draws them).
 */
import { h } from 'preact';
import htm from 'htm';
import { t, tn } from '/js/i18n.js';
import * as orgService from '/js/services/organisms.js';
import { relTime } from '/views/profile/organisms/helpers.js';
import { ReadmePanel } from '/views/profile/organisms/readme-panel.js';
import { StructureMindmap } from '/views/profile/organisms/mindmap.js';
import { StructureOverview } from '/views/profile/organisms/widgets.js';
import { WorkspaceApps } from '/views/profile/organisms/workspace-apps.js';
import { ParticipantsPanel } from '/views/profile/organisms/participants-panel.js';
import { SourcesPanel } from '/views/profile/organisms/sources-panel.js';
import { SkillsPanel } from '/views/profile/organisms/skills-panel.js';
import { Section } from '/components/Section.js';
import { Folds, FoldRow } from '/components/Folds.js';
import { Action, Actions } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { List, Row, Name, Desc, Who, Doors, Group, More } from '/components/List.js';
import { gotoEvent, ovAddNew } from './overview.js';
import { renderSpacesAdd, renderShareTab, renderReviewTab } from './panels.js';
import { shortActor } from './helpers.js';

const html = htm.bind(h);
const PER_SPACE = 8;

/** The AIMEAT Pages app's address on this server's app host (skill aimeat-pages-links). A local
 *  server has no app host, so it gets aimeat.io's. */
const PAGES_HOST = () => {
  const host = String(window.location.hostname || '');
  return /^(localhost|127\.|\[|\d+\.\d+\.\d+\.\d+$)/.test(host) || !host.includes('.') ? 'aimeat-pages.apps.aimeat.io' : `aimeat-pages.apps.${host}`;
};
export const pagesLink = (orgId, wsId, docId) =>
  `https://${PAGES_HOST()}/#org=${encodeURIComponent(orgId)}&ws=${encodeURIComponent(wsId)}&doc=${encodeURIComponent(docId)}`;

/** The README's first paragraph that is not a heading: the page's description when the manifest has no summary. */
export const readmeLead = (md) => (String(md || '').split(/\n\s*\n/).map(s => s.trim()).find(s => s && !/^#/.test(s) && !/^[-*|>]/.test(s)) || '').replace(/\s+/g, ' ');

const spaceLabel = (ctx, ot) => ctx.wsT('type.' + ot.name) || ot.name;
const openSpace = (ctx, ot) => ctx.pickTab('space:' + ot.name);
const isDocs = (ctx, ot) => orgService.isMemorySpace(ot) && ctx.isDocSpace(ot);
const newest = (items) => [...items].sort((a, b) => String(b._updatedAt || b._createdAt || '').localeCompare(String(a._updatedAt || a._createdAt || '')));
const newMark = (n) => (n > 0 ? html`<${Mark} key="new" tone="sun">${t('organisms.ws.newChip', { n })}<//>` : null);

/* ── Documents ──────────────────────────────────────────────────────────────────────────────── */

/** One document in one press: the document page, opened on this document (the call the tree makes). */
const openDoc = (ctx, ot, d) => { ctx.setActiveDoc({ type: ot.name, mode: 'view', page: { id: d.id } }); openSpace(ctx, ot); };

function docRows(ctx, ot) {
  const docs = newest(ctx.mergedDocs(ot));
  const shown = docs.slice(0, PER_SPACE);
  const newDoc = () => { ctx.setActiveDoc({ type: ot.name, mode: 'edit', page: { id: '', title: '', markdown: '' } }); openSpace(ctx, ot); };
  return html`
    <${Group} key=${ot.name} title=${spaceLabel(ctx, ot)} count=${docs.length} apart
      doors=${html`${newMark(ctx.unseenOf('space:' + ot.name))}${ctx.showArchived ? null : html`<${Action} small soft onClick=${newDoc}>${'+ '}${t('organisms.newPage')}<//>`}`}>
      <${List} cols="name-who-doors" empty=${t('organisms.ws.docsNone')}>
        ${shown.map(d => html`
          <${Row} key=${d.id}>
            <${Name} onOpen=${() => openDoc(ctx, ot, d)} tag=${d._draft && !d._published ? html`<${Mark} key="d" tone="sun">${t('organisms.draft')}<//>` : null}>${d.title || d.id}<//>
            <${Who}>${[shortActor(d._writtenBy), d._updatedAt ? relTime(d._updatedAt) : ''].filter(Boolean).join(' · ')}<//>
            <${Doors}><${Action} small row soft href=${pagesLink(ctx.orgId, ctx.wsId, d.id)} newTab>${t('organisms.ws.openInPages')}<//><//>
          <//>`)}
      <//>
      ${docs.length > PER_SPACE ? html`<${More} label=${t('organisms.ws.allDocs', { n: docs.length, space: spaceLabel(ctx, ot) })} onMore=${() => openSpace(ctx, ot)} />` : null}
    <//>`;
}

export function docsSection(ctx, num) {
  const spaces = ctx.allTypes.filter(ot => isDocs(ctx, ot));
  const total = spaces.reduce((n, ot) => n + ctx.mergedDocs(ot).length, 0);
  const doors = html`
    ${ctx.showSearch ? null : html`<${Action} small soft onClick=${() => ctx.setShowSearch(true)}>${t('organisms.ws.searchDoor')}<//>`}
    ${ctx.showArchived ? null : html`<${Action} small soft onClick=${() => ctx.guardWsDirty(() => { ctx.setShowSettings(false); ctx.setShowSpaces(s => !s); })}>${'+ '}${t('organisms.ws.docSpace')}<//>`}`;
  return html`
    <${Section} key="ws-docs" id="ws-docs" num=${num} first title=${t('organisms.ws.docsTitle')} count=${total || null} doors=${doors}>
      ${ctx.showSpaces ? renderSpacesAdd(ctx) : null}
      ${spaces.length ? spaces.map(ot => docRows(ctx, ot)) : html`<${Note} kind="quiet">${t('organisms.ws.docSpacesNone')}<//>`}
    <//>`;
}

/* ── Records, rows and tasks ────────────────────────────────────────────────────────────────── */

function recordWords(ctx, ot) {
  if (orgService.isMemorySpace(ot)) {
    const recs = newest(ctx.mergedRecords(ot));
    if (!recs.length) return t('organisms.ws.recsNone');
    const u = ctx.unseenOf('space:' + ot.name);
    const top = recs[0];
    return [
      tn('organisms.ws.recsCount', recs.length),
      u ? t('organisms.ws.newChip', { n: u }) : '',
      t('organisms.ws.newestTitle', { title: ctx.instanceTitle(ot.name, top.id) }),
    ].filter(Boolean).join(' · ');
  }
  if (ot.backing === 'rows') {
    const st = ctx.ws.row_spaces?.[ot.name];
    if (!st || !st.rows) return t('organisms.ws.rowsNone');
    return tn('organisms.ws.rowsCount', st.rows, { when: relTime(st.newest || st.lastWriteAt) });
  }
  if (ot.backing === 'tasks') return t('organisms.ws.tasksWords');
  return String(ot.backing || '');
}

export function recordsSection(ctx, num) {
  const spaces = ctx.allTypes.filter(ot => !isDocs(ctx, ot));
  if (!spaces.length) return null;
  const total = spaces.reduce((n, ot) => n + (orgService.isMemorySpace(ot) ? ctx.mergedRecords(ot).length : 0), 0);
  const kind = (ot) => (ot.backing === 'rows' ? t('organisms.ws.kindRows') : ot.backing === 'tasks' ? t('organisms.ws.kindTasks') : null);
  return html`
    <${Section} key="ws-records" id="ws-records" num=${num} title=${t('organisms.groupRecords')} count=${total || null}>
      <${List} cols="name-desc-doors">
        ${spaces.map(ot => {
          const memory = orgService.isMemorySpace(ot);
          const empty = memory && !ctx.mergedRecords(ot).length;
          return html`
            <${Row} key=${ot.name}>
              <${Name} onOpen=${() => openSpace(ctx, ot)} tag=${[kind(ot), ot.contract || null]}>${spaceLabel(ctx, ot)}<//>
              <${Desc}>${recordWords(ctx, ot)}<//>
              <${Doors}>${empty && !ot.append && !ctx.showArchived
                ? html`<${Action} small row soft onClick=${() => ovAddNew(ctx, ot, false)}>${t('organisms.ws.addFirst')}<//>`
                : html`<${Action} small row onClick=${() => openSpace(ctx, ot)}>${t('organisms.ws.open')}<//>`}<//>
            <//>`;
        })}
      <//>
    <//>`;
}

/* ── The workspace's own parts, one row each ───────────────────────────────────────────────── */

function row(ctx, key, id, title, state, body, onOpen) {
  const open = !!ctx.wsRows[key];
  return html`
    <${Section} fold inner wrap key=${key} id=${id} title=${title} sub=${state} open=${open}
      onToggle=${() => { if (!open && onOpen) onOpen(); ctx.toggleWsRow(key); }}>
      ${open ? body() : null}
    <//>`;
}

/** Who wrote here lately, by name: the newest events' people and agents. */
function peopleWords(ctx) {
  const names = [...new Set(ctx.wsEvents.map(e => shortActor(e.actor)).filter(Boolean))];
  const agents = new Set(ctx.wsEvents.map(e => e.agent).filter(Boolean)).size;
  if (!names.length) return t('organisms.ws.row.peopleNone');
  const shown = names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ');
  return agents ? `${shown} · ${tn('organisms.wsAgents', agents)}` : shown;
}

export function workspaceSection(ctx, num) {
  const { ws, wsEvents, approvals, suggestions, orgId, wsId, wsCanEdit, showToast } = ctx;
  const readme = ws.readme || '';
  const readmeTitle = (readme.match(/^#\s+(.+)$/m) || [])[1] || '';
  const minutes = Math.max(1, Math.round(readme.split(/\s+/).filter(Boolean).length / 200));
  const readmeState = readme ? [readmeTitle ? `"${readmeTitle}"` : '', tn('organisms.ws.row.readMinutes', minutes)].filter(Boolean).join(' · ') : t('organisms.ws.row.readmeNone');
  const historyState = wsEvents.length ? tn('organisms.ws.row.history', wsEvents.length, { when: relTime(wsEvents[0].at) }) : t('organisms.noneYet');
  const waiting = (suggestions || []).filter(s => s.status === 'pending');
  const apps = ws.apps || [];
  const spaces = (ws.manifest?.objectTypes || []).length;
  const eventRow = (e, i) => html`
    <${FoldRow} key=${i} onClick=${() => gotoEvent(ctx, e)} num=${relTime(e.at)}
      who=${html`${shortActor(e.actor)}${e.agent ? html` · ${e.agent}` : null}`}
      verb=${e.action === 'publish' ? t('organisms.publishedVerb') : t('organisms.editedVerb')}
      name=${html`${(ctx.wsT('type.' + e.type) || e.type)} / ${ctx.instanceTitle(e.type, e.instance)}`} />`;
  return html`
    <${Section} key="ws-workspace" id="ws-workspace" num=${num} title=${t('organisms.groupRelated')}>
      ${row(ctx, 'readme', 'ws-readme', t('organisms.readmeFold'), readmeState, () => (readme || wsCanEdit
        ? html`<${ReadmePanel} markdown=${readme} canEdit=${wsCanEdit} kind="workspace" name=${ws.manifest?.name || 'Workspace'} aiPromptSeed=${ctx.wsTocSeed} onSave=${ctx.saveWsReadme} />`
        : html`<${Note} kind="quiet">${t('organisms.ws.row.readmeNone')}<//>`))}
      ${row(ctx, 'history', 'ws-history', t('organisms.happened'), historyState, () => html`
        ${wsEvents.length ? html`<${Folds}>${wsEvents.slice(0, 5).map(eventRow)}<//>` : html`<${Note} kind="quiet">${t('organisms.noneYet')}<//>`}
        <${Actions}><${Action} small soft onClick=${() => ctx.pickTab('activity')}>${t('organisms.ws.fullActivity', { n: wsEvents.length })}<//><//>`)}
      ${row(ctx, 'people', 'ws-people', t('organisms.tabPeople'), peopleWords(ctx), () => html`
        <${ParticipantsPanel} orgId=${orgId} wsId=${wsId} showToast=${showToast} />`)}
      ${row(ctx, 'review', 'ws-review', t('organisms.tabReview'),
        approvals.length ? tn('organisms.ws.row.reviewWaits', approvals.length) : t('organisms.ws.row.reviewNone'), () => renderReviewTab(ctx))}
      ${row(ctx, 'suggestions', 'ws-suggestions', t('organisms.ws.row.suggestions'),
        waiting.length ? tn('organisms.ws.row.suggestionsWait', waiting.length) : t('organisms.ws.row.suggestionsNone'), () => html`
        <${List} cols="name-who-doors" dense empty=${t('organisms.ws.row.suggestionsNone')}>
          ${waiting.map(s => html`
            <${Row} key=${s.id}>
              <${Name} desc=${s.summary || undefined}>${s.label || s.kind}<//>
              <${Who} sub=${s.requested_at ? relTime(s.requested_at) : undefined}>${shortActor(s.requested_by)}<//>
              <${Doors}>${s.can_decide ? html`
                <${Action} small row disabled=${ctx.busy} onClick=${() => ctx.decideSuggestion(s.id, 'approve')}>${t('organisms.approve')}<//>
                <${Action} small row soft disabled=${ctx.busy} onClick=${() => ctx.decideSuggestion(s.id, 'decline')}>${t('organisms.ws.row.decline')}<//>` : null}<//>
            <//>`)}
        <//>`)}
      ${apps.length || wsCanEdit ? row(ctx, 'apps', 'ws-apps', t('organisms.ws.row.apps'),
        apps.length ? tn('organisms.ws.row.appsPinned', apps.length) : t('organisms.ws.row.appsNone'), () => html`
        <${WorkspaceApps} orgId=${orgId} wsId=${wsId} apps=${apps} canEdit=${wsCanEdit} showToast=${showToast} onChanged=${ctx.load} />`) : null}
      ${row(ctx, 'sources', 'ws-sources', t('organisms.sources'), t('organisms.ws.row.sourcesState'), () => html`
        <${SourcesPanel} orgId=${orgId} wsId=${wsId} showToast=${showToast} />`)}
      ${row(ctx, 'skills', 'ws-skills', t('skills.wsTabLabel'), t('organisms.ws.row.skillsState'), () => html`
        <${SkillsPanel} orgId=${orgId} wsId=${wsId} showToast=${showToast} />`)}
      ${row(ctx, 'share', 'ws-share', t('organisms.share'),
        ctx.share ? (ctx.anythingPublic() ? t('organisms.ws.row.sharePublic') : t('organisms.ws.row.shareNone')) : t('organisms.ws.row.shareState'),
        () => renderShareTab(ctx), () => { if (!ctx.share) ctx.loadShare(); })}
      ${row(ctx, 'map', 'ws-map', t('organisms.mapAndToc'), tn('organisms.place.spaces', spaces), () => html`
        <${StructureMindmap} scope="workspace" graph=${ctx.wsGraph} onNavigate=${ctx.onWsMapNav} storageKey=${'ws.' + orgId + '.' + wsId} defaultOpen />
        <${StructureOverview} label=${t('organisms.structureOverviewWs')} load=${() => orgService.getWorkspaceOverview(orgId, wsId)} defaultOpen />`)}
      ${row(ctx, 'ai', 'ws-ai', t('organisms.forAiTitle'), t('organisms.ws.row.aiState'), () => html`
        <${Note} kind="lead">${t('organisms.ws.forAiLead')}<//>
        <${Actions}>${ctx.agentMenuItems.filter(m => !m.divider).map((m, i) => html`<${Action} small soft=${i === 2} key=${i} onClick=${m.onClick}>${m.label}<//>`)}<//>`)}
    <//>`;
}
