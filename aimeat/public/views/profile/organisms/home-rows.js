/**
 * @file public/views/profile/organisms/home-rows.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shared place's page after its workspaces: "People and agents" (Members, Agents)
 *   and "About this place" (README, Board, What has happened, Map, Your AI, Directive, Measures).
 *   Each is one row that says its state in one sentence and opens in place (FoldSection's inner
 *   cut), so the parts a person needs now and then do not push the workspaces down. Pure render
 *   functions over the state the page (home.js) holds; the words of each row's state are built here.
 * @structure peopleSection(p) · aboutSection(p) · readmeHeadings(md)
 * @usage ${peopleSection({ ...p, num: '02' })} ${aboutSection({ ...p, num: '03' })}
 * @version-history
 *   v1.0.0 -- 2026-11-27 -- Initial: the members, the agents and the parts about the place as rows that
 *     say their state (the shared place's page leads with its workspaces).
 */
import { h } from 'preact';
import htm from 'htm';
import { t, tn } from '/js/i18n.js';
import * as orgService from '/js/services/organisms.js';
import { Section } from '/components/Section.js';
import { Action, Actions } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { relTime } from '/views/profile/organisms/helpers.js';
import { StructureOverview } from '/views/profile/organisms/widgets.js';
import { ReadmePanel } from '/views/profile/organisms/readme-panel.js';
import { DirectivePanel } from '/views/profile/organisms/directive-panel.js';
import { MeasuresPanel } from '/views/profile/organisms/measures-panel.js';
import { PerMemberNotice } from '/views/profile/organisms/per-member-setting.js';
import { StructureMindmap } from '/views/profile/organisms/mindmap.js';
import { TimelinePanel, TimelineRecent } from '/views/profile/organisms/timeline-panel.js';
import { OrgMemberManager } from '/views/profile/organisms/members.js';
import { OrgAgentsPanel } from '/views/profile/organisms/agents.js';
import { BoardPreview } from '/views/profile/organisms/panels.js';
import { InstructionBlock } from '/views/profile/instruction-block.js';

const html = htm.bind(h);

/** The headings under the README's title (## and deeper). */
export const readmeHeadings = (md) => (String(md || '').match(/^#{2,6}\s+\S/gm) || []).length;

/** A row that opens in place: its title, its state in one sentence, its body while open. The anchor
 *  is written as `id: '…'` at each call, which the places index test reads (places-index.test.ts). */
function row(p, { key, id, title, state }, body) {
  return html`
    <${Section} fold inner wrap key=${key} id=${id} title=${title} sub=${state} open=${!!p.opened[key]} onToggle=${() => p.toggle(key)}>
      ${p.opened[key] ? body() : null}
    <//>`;
}

/** Members and agents, each one row. */
export function peopleSection(p) {
  const { org, ghii, canEdit, isCreator, showToast, confirm, onChanged, perMember, memberCount, agentCount, pendingJoin, num } = p;
  const members = [
    tn('organisms.place.people', memberCount),
    canEdit && pendingJoin ? tn('organisms.place.joinWaits', pendingJoin) : '',
  ].filter(Boolean).join(' ');
  const agents = agentCount ? tn('organisms.place.agents', agentCount) : t('organisms.place.agentsNone');
  return html`
    <${Section} id="og-people" num=${num} title=${t('organisms.place.peopleTitle')} count=${memberCount + agentCount}>
      ${row(p, { key: 'members', id: 'og-members', title: t('organisms.tabMembers'), state: members }, () => html`
        <${PerMemberNotice} info=${perMember} />
        <${OrgMemberManager} org=${org} ghii=${ghii} canManage=${canEdit} isCreator=${isCreator}
          showToast=${showToast} confirm=${confirm} onChanged=${onChanged} show="members" />`)}
      ${row(p, { key: 'agents', id: 'og-agents', title: t('organisms.tabAgents'), state: agents }, () => html`
        <${OrgAgentsPanel} org=${org} ghii=${ghii} canManage=${canEdit} showToast=${showToast} onChanged=${onChanged} />`)}
    <//>`;
}

/** The README, the board, the history, the map, the AI instruction, the directive and the measures. */
export function aboutSection(p) {
  const { org, canEdit, readme, tocSeed, saveReadme, timeline, board, graph, onMapNav, directive, showDirective, fullTimeline, setFullTimeline, num } = p;
  const readmeTitle = (readme.match(/^#\s+(.+)$/m) || [])[1] || '';
  const headings = readmeHeadings(readme);
  const readmeState = !readme ? t('organisms.place.readmeNone')
    : [readmeTitle ? `"${readmeTitle}"` : '', headings ? tn('organisms.place.headings', headings) : ''].filter(Boolean).join(' · ') || t('organisms.place.readmeSome');
  const boardState = !org.boardId ? t('organisms.place.boardNone')
    : !board ? '' : board.n ? tn('organisms.place.boardPosts', board.n, { when: relTime(board.newest) }) : t('organisms.place.boardEmpty');
  const last = timeline && timeline[0];
  const historyState = !timeline ? '' : !timeline.length ? t('timeline.empty')
    : tn('organisms.place.changes', timeline.length, { when: last.isCurrent ? t('timeline.now') : String(last.at).slice(0, 10) });
  const wsList = graph?.workspaces || [];
  const spaces = wsList.reduce((n, w) => n + (w.spaces || []).length, 0);
  const mapState = graph ? `${tn('organisms.place.workspaces', wsList.length)} · ${tn('organisms.place.spaces', spaces)}` : '';
  const own = (directive.directives?.items || []).find((d) => d.level === 'organism') || directive.summary?.directive || null;
  const directiveState = !own ? t('organisms.place.directiveNone')
    : directive.summary?.review_due ? t('organisms.place.directiveDue') : t('organisms.place.directiveOn');
  return html`
    <${Section} id="og-about" num=${num} title=${t('organisms.place.aboutTitle')}>
      ${row(p, { key: 'readme', id: 'og-readme', title: t('organisms.readmeFold'), state: readmeState }, () => (readme || canEdit
        ? html`<${ReadmePanel} markdown=${readme} canEdit=${canEdit} kind="organism" name=${org.name} aiPromptSeed=${tocSeed} onSave=${saveReadme} />`
        : html`<${Note}>${t('organisms.readmeEmpty')}<//>`))}
      ${row(p, { key: 'board', id: 'og-board', title: t('organisms.tabBoard'), state: boardState }, () => (org.boardId
        ? html`<${BoardPreview} boardId=${org.boardId} showToast=${p.showToast} />`
        : html`<${Note}>${t('organisms.noBoard')}<//>`))}
      ${row(p, { key: 'history', id: 'og-history', title: t('organisms.happened'), state: historyState }, () => html`
        ${fullTimeline ? html`<${TimelinePanel} orgId=${org.id} defaultOpen=${true} />` : html`
          <${TimelineRecent} rows=${timeline} limit=${5} />
          <${Actions}><${Action} small soft onClick=${() => setFullTimeline(true)}>${t('organisms.fullTimeline')}<//><//>`}`)}
      ${row(p, { key: 'map', id: 'og-map', title: t('organisms.mapAndToc'), state: mapState }, () => html`
        <${StructureMindmap} scope="organism" graph=${graph} onNavigate=${onMapNav} storageKey=${'org.' + org.id} defaultOpen />
        <${Actions}><${Action} href=${`/v1/home?overview=1&focus=${encodeURIComponent(`organism:${org.id}`)}`}>${t('home.overview.showIn')}<//><//>
        <${StructureOverview} label=${t('organisms.structureOverviewOrg')} load=${() => orgService.getOrganismOverview(org.id)} defaultOpen />`)}
      ${row(p, { key: 'ai', id: 'og-ai', title: t('organisms.forAiTitle'), state: t('organisms.place.aiState') }, () => html`
        <${Note} kind="lead">${t('organisms.instrBlockLead')}<//>
        <${InstructionBlock} orgId=${org.id} />`)}
      ${showDirective ? row(p, { key: 'directive', id: 'og-directive', title: t('organisms.directive.title'), state: directiveState }, () => html`
        <${DirectivePanel} org=${org} directives=${directive.directives} summary=${directive.summary} canEdit=${canEdit} />`) : null}
      ${canEdit ? row(p, { key: 'measures', id: 'og-measures', title: t('organisms.measures.title'), state: t('organisms.measures.sub') }, () => html`
        <${MeasuresPanel} org=${org} />`) : null}
    <//>`;
}
