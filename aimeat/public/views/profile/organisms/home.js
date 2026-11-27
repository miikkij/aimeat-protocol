/**
 * @file home.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One shared place's page (an organism) in the poster face. It answers, in order: what
 *   is here (the workspaces, always open, each row saying what is inside before it is entered), what
 *   waits for this person (a line in the band under the figures, red only for what this person
 *   decides, and the waiting list itself after the workspaces), who is here (Members and Agents as
 *   two rows that say their state), and what the place is about (README, Board, What has happened,
 *   the map, the AI instruction, the directive and the measures, one row each that says its state
 *   and opens in place). How it is run (settings) is a page of its own. One loud action, "For your
 *   AI", opens the AI instruction's row. The rows are home-rows.js.
 * @structure OrganismHome
 * @usage import { OrganismHome } from '/views/profile/organisms/home.js';
 * @version-history
 *   v4.0.0 -- 2026-11-27 -- The page leads with its workspaces. What waits for the person is a line in
 *     the band under the figures (red only for what this person decides: a request to join, an
 *     approval of their own place), and the approvals or a team's three sections follow the
 *     workspaces instead of pushing them down. Members and Agents are two rows under "People and
 *     agents"; README, Board, What has happened, the map, Bring your AI here, the directive and the
 *     measures are rows under "About this place" that say their state in one sentence and open in
 *     place (home-rows.js). "+ New workspace" is a plain action in the Workspaces head, and "For your
 *     AI" turns quiet while the new workspace's name is asked. The rail says "In this shared place".
 *     One extra read: the board's newest notice and its count (GET /v1/boards/:id/posts?limit=1),
 *     with the page's other reads and on the same live event.
 *   v3.16.0 -- 2026-11-26 -- The page of an organism that is not a team starts with the approvals that
 *     wait in it (approvals-section.js), decided on the row; the sections after it are numbered one
 *     higher while there is one. The waiting list opens this page for an approval with no workspace.
 *   v3.15.0 -- 2026-11-20 -- The Members section tells every member when the creators see the value report per member, with their own numbers (PerMemberNotice).
 *   v3.14.0 -- 2026-11-20 -- A folded section "Measures" for the creators and admins (measures-panel.js): the organism's own measures with their numbers, read when the section opens.
 *   v3.13.0 -- 2026-11-20 -- A folded section "Directive for members' AI" (directive-panel.js): the organism's directive, and for its creators the answers as counts and the sentence to make or change it. The folded sections with a detail line (06, 08, 09) take FoldSection's `wrap`: at 390 px the detail ran past the edge and was cut off.
 *   v3.12.0 -- 2026-11-14 -- A team's page opens with what waits for you, the team context and skill, and you in this team (team-sections.js, team setup T14, T15); the organism's sections follow, numbered on.
 *   v3.11.1 -- 2026-11-14 -- A team's title, crumb and description are in the reader's language (orgName, orgDescription, team setup T24).
 *   v3.11.0 -- 2026-10-31 -- "Show in the overview" under the map: the Overview page opened on this organism (views/home/overview.js).
 *   v3.10.0 -- 2026-10-03 -- The question mark that explains a workspace, concept.workspace, after the line under the workspace list (components/HelpTip.js; guidance part B).
 *   v3.9.0 -- 2026-09-26 -- Every part is a kit component (page group G2a): the page is the SettingsPage (crumb, title, the tags as data, the description, the For your AI slab and the two ways, the FigureStrip, the rail as data whose folds open before they scroll), the sections the Section (open and folded), the hints the Note. The join policy and the creation date are the dim tag again, as main drew them (og-chip--dim). The page writes no class.
 *   v3.8.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v3.7.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v3.6.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v3.5.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v3.4.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v3.3.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   v3.2.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v3.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v3.0.1 — 2026-08-29 — Section, Fold, tr and scrollTo moved to poster-parts.js so the workspace cover is
 *     built from the same pieces; pure extraction.
 *   v3.0.0 — 2026-08-29 — The poster face. Before this the AI instruction block, the README, the map,
 *     the table of contents and the timeline all stacked above the tabs (opened, the first workspace
 *     ended 3 000 px down), settings replaced the tab content while the tabs stayed lit, and the
 *     breadcrumb appeared twice. Settings moved to home-settings.js as a page; the timeline's latest
 *     rows are a section and the full panel is a door; the tabs are sections with a rail.
 *     (Earlier history: the tabbed home with the settings panel, the development timeline and the
 *     table of contents; the member-visibility select; `your_membership` from GET /:id.)
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t, tn, tOr } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { useConfirm } from '/components/Modal.js';
import * as orgService from '/js/services/organisms.js';
import { recordRecent } from '/js/recents.js';
import { fmtDate, orgName, orgDescription, exportOrganismZip } from '/views/profile/organisms/helpers.js';
import { loadTimelineRows } from '/views/profile/organisms/timeline-panel.js';
import { WorkspaceList } from '/views/profile/organisms/workspace-list.js';
import { OrganismSettings } from '/views/profile/organisms/home-settings.js';
import { useTeam, TeamSections } from '/views/profile/organisms/team-sections.js';
import { OrgApprovals } from './approvals-section.js';
import { peopleSection, aboutSection } from './home-rows.js';
import { swallowed } from '/js/swallowed.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { Section } from '/components/Section.js';
import { railSection, scrollToSection } from '/components/Rail.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Row } from '/components/Layout.js';
import { HelpTip } from '/components/HelpTip.js';
import { tr } from '/views/profile/organisms/poster-parts.js';

const pad = (n) => String(n).padStart(2, '0');

export function OrganismHome({ org, ghii, showToast, initialSettings, onOpenWs, onBack, onChanged, onLeave }) {
  useViewCSS('/css/views/organism.css');
  const { confirm, ConfirmUI } = useConfirm();
  const [view, setView] = useState(initialSettings ? 'settings' : 'home');
  const [wsCount, setWsCount] = useState(null);
  const [pendingJoin, setPendingJoin] = useState(0);
  // How many approvals wait in this organism (approvals-section.js tells it): with one or more the
  // band says so and their section follows the workspaces.
  const [approvalCount, setApprovalCount] = useState(0);
  // Which rows under "People and agents" and "About this place" are open (home-rows.js).
  const [opened, setOpened] = useState({});
  const toggle = (key) => setOpened(o => ({ ...o, [key]: !o[key] }));
  const openRow = (key) => setOpened(o => ({ ...o, [key]: true }));
  // "+ New workspace" in the Workspaces head shows the name field in the list (workspace-list.js).
  const [creatingWs, setCreatingWs] = useState(false);
  // While the creators see the value report per member, every member is told so with their own numbers.
  const [perMember, setPerMember] = useState(null);
  const [directive, setDirective] = useState({ directives: null, summary: null });
  const [fullTimeline, setFullTimeline] = useState(false);
  const [timeline, setTimeline] = useState(null);
  const [board, setBoard] = useState(null);   // { n, newest } of the organism's board
  const team = useTeam(org);

  // Ownership is plural. `owners` is the truth; `creatorGhii` is the deprecated mirror of owners[0]
  // and is only read for an organism served by a node that predates the split.
  const isCreator = (org.owners?.length ? org.owners : [org.creatorGhii]).includes(ghii);
  const isAdmin = org.admins?.includes(ghii);
  // members[] can be roster-redacted (memberVisibility): your_membership from GET /:id is the
  // caller-scoped truth, with the array as fallback for orgs whose roster this caller CAN see.
  const [yourMembership, setYourMembership] = useState(null);
  const isMember = (yourMembership?.status === 'active') || org.members?.includes(ghii);
  const canEdit = isCreator || isAdmin;
  // A preset type has a translation; a free-text one is shown as the person wrote it.
  const typeLabel = tOr(`organisms.types.${org.type}`, org.type);

  // README, the structure graph (the map's data), the table-of-contents seed for the README prompt,
  // the history rows and the board's newest notice. Loaded together and refreshed on live updates.
  const [readme, setReadme] = useState(org.readme || '');
  const [graph, setGraph] = useState(null);
  const [tocSeed, setTocSeed] = useState('');
  useEffect(() => {
    let cancelled = false;
    const loadExtras = async () => {
      const [g, full, toc, rows, posts] = await Promise.all([
        orgService.getOrganismGraph(org.id),
        orgService.getOrganism(org.id),
        orgService.getOrganismOverview(org.id),
        loadTimelineRows(org.id).catch(err => { swallowed('home: timeline', err); return []; }),
        org.boardId
          ? apiGet(`/v1/boards/${encodeURIComponent(org.boardId)}/posts?limit=1`).catch(err => { swallowed('home: board', err); return null; })
          : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setGraph(g);
      setReadme(full?.data?.readme || '');
      setYourMembership(full?.data?.your_membership ?? null);
      setDirective({ directives: full?.data?.organism_directive ?? null, summary: full?.data?.organism_directive_summary ?? null });
      setPerMember(full?.data?.value_per_member ?? null);
      setTocSeed(toc || '');
      setTimeline(rows);
      const p = posts?.data;
      setBoard(p ? { n: Number(p.total ?? (p.posts || []).length) || 0, newest: p.posts?.[0]?.created_at || null } : null);
    };
    loadExtras();
    const off = onLiveUpdate(['organisms'], loadExtras);
    return () => { cancelled = true; off(); };
  }, [org.id, org.boardId]);

  const saveReadme = async (md) => {
    await orgService.updateOrganism(org.id, { readme: md });
    setReadme(md);
    showToast?.(t('readme.saved') || 'README saved', 'success');
  };

  // A map node opens what it names: a workspace, a space's tab in its workspace, or the members.
  const onMapNav = (target) => {
    if (target?.type === 'members') { openRow('members'); setTimeout(() => scrollToSection('og-members'), 30); }
    else if (target?.wsId) onOpenWs(target.wsId, target.type === 'space' ? target.space : undefined);
  };

  useEffect(() => {
    if (!canEdit) return undefined;
    let cancelled = false;
    const fetchIt = () => orgService.listJoinRequests(org.id)
      .then(r => { if (!cancelled) setPendingJoin(((r?.data?.join_requests) || []).filter(x => x.status === 'pending').length); })
      .catch(err => { swallowed('home: fetchIt', err); });
    fetchIt();
    const off = onLiveUpdate(['organisms'], fetchIt);
    return () => { cancelled = true; off(); };
  }, [org.id, canEdit]);

  // Feed the home page's "Continue" list (only once the real name is known, not the {id} stub).
  useEffect(() => {
    const label = orgName(org);
    if (org.name) recordRecent({ type: 'organism', id: org.id, label, data: { orgId: org.id } });
  }, [org]);

  if (view === 'settings') {
    return html`
      <${OrganismSettings} org=${org} ghii=${ghii} isCreator=${isCreator} isMember=${isMember} canEdit=${canEdit}
        showToast=${showToast} confirm=${confirm} onBack=${() => setView('home')} onChanged=${onChanged}
        onLeave=${onLeave} onDeleted=${() => { onBack(); onChanged?.(); }} />
      <${ConfirmUI} />`;
  }

  const reqText = pendingJoin > 0
    ? (pendingJoin === 1 ? tr('organisms.reqOne', '1 request') : tr('organisms.reqMany', '{n} requests').replace('{n}', String(pendingJoin)))
    : '';
  const last = timeline && timeline[0];
  const memberCount = (org.members || []).length;
  const agentCount = (org.agentGaiis || []).length;
  const goTo = (key, id) => { openRow(key); setTimeout(() => scrollToSection(id), 30); };
  // The directive row: for a member when there is one, and always for its creators, who make it.
  const showDirective = canEdit || !!directive.directives;

  // The sections in order, numbered as they are drawn: the workspaces, what waits (a team's three
  // sections, or the approvals while any wait), the people, and the place itself.
  const waitingParts = team ? [
    { id: 'og-team-waiting', label: t('organisms.team.waitingTitle'), count: team.items.length + team.approvals.length },
    { id: 'og-team-brain', label: t('organisms.team.brainTitle'), count: '·' },
    { id: 'og-team-you', label: t('organisms.team.youTitle'), count: '·' },
  ] : approvalCount > 0 ? [{ id: 'og-approvals', label: t('organisms.approvals.title'), count: approvalCount }] : [];
  const parts = [
    { id: 'og-workspaces', label: tr('organisms.tabWorkspaces', 'Workspaces'), count: wsCount ?? '' },
    ...waitingParts,
    { id: 'og-people', label: t('organisms.place.peopleTitle'), count: memberCount + agentCount },
    { id: 'og-about', label: t('organisms.place.aboutTitle'), count: '→' },
  ].map((s, i) => ({ ...s, num: pad(i + 1), href: '#' + s.id }));
  const numOf = (id) => parts.find(s => s.id === id)?.num || '';
  const railTitle = tr('organisms.railTitle', 'In this shared place');
  const rail = {
    title: railTitle,
    groups: [
      { label: railTitle, items: parts.map(railSection) },
      { items: [{ key: 'settings', mark: '·', label: tr('organisms.settings', 'Settings'), count: '→', onClick: () => setView('settings') }] },
    ],
  };
  const visWord = t(`organisms.vis${(org.visibility || 'public')[0].toUpperCase()}${(org.visibility || 'public').slice(1)}`) || org.visibility;

  // What waits for this person, said in the band under the figures. Red only for what this person
  // decides: a request to join or an approval in a place they run.
  const teamWaits = team ? team.items.length + team.approvals.length : 0;
  const waits = [
    canEdit && pendingJoin > 0 ? { key: 'join', tone: 'danger', words: tn('organisms.place.bandJoin', pendingJoin), go: () => goTo('members', 'og-members') } : null,
    !team && approvalCount > 0 ? { key: 'appr', tone: canEdit ? 'danger' : 'attention', words: tn('organisms.place.bandApprovals', approvalCount), go: () => scrollToSection('og-approvals') } : null,
    teamWaits > 0 ? { key: 'team', tone: team.approvals.length ? 'danger' : 'attention', words: tn('organisms.place.bandTeam', teamWaits), go: () => scrollToSection('og-team-waiting') } : null,
  ].filter(Boolean);
  const band = waits.map(w => html`
    <${Note} key=${w.key} kind="state" tone=${w.tone}>${w.words} <${Action} tone="inline" small onClick=${w.go}>${t('organisms.place.bandShow')}<//><//>`);

  const peopleProps = { org, ghii, canEdit, isCreator, showToast, confirm, onChanged, perMember, memberCount, agentCount, pendingJoin, opened, toggle };
  const aboutProps = { org, canEdit, showToast, readme, tocSeed, saveReadme, timeline, board, graph, onMapNav, directive, showDirective, fullTimeline, setFullTimeline, opened, toggle };

  return html`
    <${SettingsPage}
      crumb=${[{ label: tr('organisms.title', 'Shared places'), onClick: onBack }, orgName(org)]}
      title=${orgName(org)}
      marks=${[
        { label: typeLabel },
        { label: visWord },
        org.joinPolicy ? { label: t(`organisms.policyShort.${org.joinPolicy}`) || org.joinPolicy, tone: 'dim' } : null,
        org.createdAt ? { label: `${tr('organisms.createdAt', 'Created')} ${fmtDate(org.createdAt)}`, tone: 'dim' } : null,
        org.archived ? { label: tr('organisms.archived', 'Archived'), kind: 'status', tone: 'off' } : null,
      ]}
      desc=${orgDescription(org) || null}
      actions=${html`
        <${Loud} quiet=${creatingWs} onClick=${() => goTo('ai', 'og-ai')}>${tr('organisms.forAi', 'For your AI')}<//>
        <${Actions}>
          <${Action} small onClick=${() => setView('settings')}>${tr('organisms.settings', 'Settings')}<//>
          <${Action} small soft onClick=${() => exportOrganismZip(org, showToast)}>${tr('organisms.exportBackup', 'Export backup')}<//>
        <//>`}
      strip=${html`<${FigureStrip} items=${[
        { key: 'ws', n: wsCount ?? '·', label: tr('organisms.figWorkspaces', 'workspaces') },
        { key: 'members', n: memberCount, label: tr('organisms.figMembers', 'members'), sub: reqText || undefined, tone: canEdit && pendingJoin ? 'notice' : undefined },
        { key: 'agents', n: agentCount, label: tr('organisms.figAgents', 'agents') },
        { key: 'last', n: last ? (last.isCurrent ? tr('timeline.now', 'now') : String(last.at).slice(0, 10)) : '·', tone: last ? 'coral' : undefined,
          label: tr('organisms.figLast', 'last change'), sub: last ? last.event : undefined },
      ]} />${band}`}
      rail=${rail}
      after=${html`<${ConfirmUI} />`}>
      <${Section} id="og-workspaces" num=${numOf('og-workspaces')} first title=${tr('organisms.tabWorkspaces', 'Workspaces')} count=${wsCount}
        doors=${creatingWs ? null : html`<${Action} small soft onClick=${() => setCreatingWs(true)}>${'+ '}${tr('organisms.newWorkspace', 'New workspace')}<//>`}>
        <${WorkspaceList} org=${org} showToast=${showToast} onOpen=${onOpenWs} onCount=${setWsCount} creating=${creatingWs} onCreating=${setCreatingWs} />
        <${Row} align="end">
          <${Note}>${tr('organisms.workspacesDesc', 'Each workspace is one subject inside a shared place, with its own readers.')}<//>
          <${HelpTip} term="concept.workspace" label=${tr('organisms.tabWorkspaces', 'Workspaces')} />
        <//>
      <//>
      ${team ? html`<${TeamSections} team=${team} me=${ghii} first=${false} num=${(i) => numOf(['og-team-waiting', 'og-team-brain', 'og-team-you'][i - 1])} />` : html`
        <${OrgApprovals} org=${org} ghii=${ghii} isCreator=${isCreator} isAdmin=${isAdmin} showToast=${showToast}
          onOpenWs=${onOpenWs} id="og-approvals" num=${numOf('og-approvals')} onCount=${setApprovalCount} />`}
      ${peopleSection({ ...peopleProps, num: numOf('og-people') })}
      ${aboutSection({ ...aboutProps, num: numOf('og-about') })}
    <//>`;
}
