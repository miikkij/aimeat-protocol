/**
 * @file home.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Organism home page in the poster face (design canvas "AIMEAT Organismin sivu",
 *   direction A "Kansi ja sisällys"). One page that answers, in order: what is here (workspaces),
 *   who is here (members, agents), what has happened (the latest changes), how to bring an AI in
 *   (the instruction block), and only then how it is run (settings, a page of its own). A masthead
 *   with the name, the chips and the description, a strip of four figures, the sections under ink
 *   rules, and a sticky contents rail on the right that names each section with its count. The map
 *   and the table of contents are one folded row (two views of the same structure), the README
 *   another, and the AI instruction a third, opened by the hot slab in the masthead.
 * @structure OrganismHome
 * @usage import { OrganismHome } from '/views/profile/organisms/home.js';
 * @version-history
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
import { t, tOr } from '/js/i18n.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { useConfirm } from '/components/Modal.js';
import * as orgService from '/js/services/organisms.js';
import { recordRecent } from '/js/recents.js';
import { fmtDate, exportOrganismZip } from '/views/profile/organisms/helpers.js';
import { StructureOverview } from '/views/profile/organisms/widgets.js';
import { ReadmePanel } from '/views/profile/organisms/readme-panel.js';
import { StructureMindmap } from '/views/profile/organisms/mindmap.js';
import { TimelinePanel, TimelineRecent, loadTimelineRows } from '/views/profile/organisms/timeline-panel.js';
import { WorkspaceList } from '/views/profile/organisms/workspace-list.js';
import { OrgMemberManager } from '/views/profile/organisms/members.js';
import { OrgAgentsPanel } from '/views/profile/organisms/agents.js';
import { BoardPreview } from '/views/profile/organisms/panels.js';
import { InstructionBlock } from '/views/profile/instruction-block.js';
import { OrganismSettings } from '/views/profile/organisms/home-settings.js';
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

export function OrganismHome({ org, ghii, showToast, initialSettings, onOpenWs, onBack, onChanged, onLeave }) {
  useViewCSS('/css/views/organism.css');
  const { confirm, ConfirmUI } = useConfirm();
  const [view, setView] = useState(initialSettings ? 'settings' : 'home');
  const [wsCount, setWsCount] = useState(null);
  const [pendingJoin, setPendingJoin] = useState(0);
  const [openReadme, setOpenReadme] = useState(false);
  const [openMap, setOpenMap] = useState(false);
  const [openAi, setOpenAi] = useState(false);
  const [fullTimeline, setFullTimeline] = useState(false);
  const [timeline, setTimeline] = useState(null);

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
  // and the history rows. Loaded together and refreshed on live updates.
  const [readme, setReadme] = useState(org.readme || '');
  const [graph, setGraph] = useState(null);
  const [tocSeed, setTocSeed] = useState('');
  useEffect(() => {
    let cancelled = false;
    const loadExtras = async () => {
      const [g, full, toc, rows] = await Promise.all([
        orgService.getOrganismGraph(org.id),
        orgService.getOrganism(org.id),
        orgService.getOrganismOverview(org.id),
        loadTimelineRows(org.id).catch(err => { swallowed('home: timeline', err); return []; }),
      ]);
      if (cancelled) return;
      setGraph(g);
      setReadme(full?.data?.readme || '');
      setYourMembership(full?.data?.your_membership ?? null);
      setTocSeed(toc || '');
      setTimeline(rows);
    };
    loadExtras();
    const off = onLiveUpdate(['organisms'], loadExtras);
    return () => { cancelled = true; off(); };
  }, [org.id]);

  const saveReadme = async (md) => {
    await orgService.updateOrganism(org.id, { readme: md });
    setReadme(md);
    showToast?.(t('readme.saved') || 'README saved', 'success');
  };

  // A map node opens what it names: a workspace, a space's tab in its workspace, or the members.
  const onMapNav = (target) => {
    if (target?.type === 'members') scrollToSection('og-members');
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
    if (org.name) recordRecent({ type: 'organism', id: org.id, label: org.name, data: { orgId: org.id } });
  }, [org.id, org.name]);

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
  const openAiSection = () => { setOpenAi(true); setTimeout(() => scrollToSection('og-ai'), 30); };
  const readmeTitle = (readme.match(/^#\s+(.+)$/m) || [])[1] || '';
  // The rail: every section scrolls into view (the three folds open first), then Settings, a page of its own.
  const sections = [
    { id: 'og-workspaces', num: '01', label: tr('organisms.tabWorkspaces', 'Workspaces'), count: wsCount ?? '' },
    { id: 'og-members', num: '02', label: tr('organisms.tabMembers', 'Members'), count: memberCount },
    { id: 'og-agents', num: '03', label: tr('organisms.tabAgents', 'Agents'), count: agentCount },
    { id: 'og-board', num: '04', label: tr('organisms.tabBoard', 'Board'), count: '·' },
    { id: 'og-history', num: '05', label: tr('organisms.happened', 'What has happened'), count: timeline ? timeline.length : '' },
    { id: 'og-readme', num: '06', label: tr('organisms.readmeFold', 'README'), count: '→', open: () => setOpenReadme(true) },
    { id: 'og-map', num: '07', label: tr('organisms.mapAndToc', 'Map and table of contents'), count: '→', open: () => setOpenMap(true) },
    { id: 'og-ai', num: '08', label: tr('organisms.forAi', 'For your AI'), count: '→', open: () => setOpenAi(true) },
  ].map((s) => ({ ...s, href: '#' + s.id }));
  const railTitle = tr('organisms.railTitle', 'In this organism');
  const rail = {
    title: railTitle,
    groups: [
      { label: railTitle, items: sections.map(railSection) },
      { items: [{ key: 'settings', mark: '09', label: tr('organisms.settings', 'Settings'), count: '→', onClick: () => setView('settings') }] },
    ],
  };
  const visWord = t(`organisms.vis${(org.visibility || 'public')[0].toUpperCase()}${(org.visibility || 'public').slice(1)}`) || org.visibility;

  return html`
    <${SettingsPage}
      crumb=${[{ label: tr('organisms.title', 'Organisms'), onClick: onBack }, org.name || org.id]}
      title=${org.name || org.id}
      marks=${[
        { label: typeLabel },
        { label: visWord },
        org.joinPolicy ? { label: t(`organisms.policyShort.${org.joinPolicy}`) || org.joinPolicy, tone: 'dim' } : null,
        org.createdAt ? { label: `${tr('organisms.createdAt', 'Created')} ${fmtDate(org.createdAt)}`, tone: 'dim' } : null,
        org.archived ? { label: tr('organisms.archived', 'Archived'), kind: 'status', tone: 'off' } : null,
      ]}
      desc=${org.description || null}
      actions=${html`
        <${Loud} onClick=${openAiSection}>${tr('organisms.forAi', 'For your AI')}<//>
        <${Actions}>
          <${Action} small onClick=${() => setView('settings')}>${tr('organisms.settings', 'Settings')}<//>
          <${Action} small soft onClick=${() => exportOrganismZip(org, showToast)}>${tr('organisms.exportBackup', 'Export backup')}<//>
        <//>`}
      strip=${html`<${FigureStrip} items=${[
        { key: 'ws', n: wsCount ?? '·', label: tr('organisms.figWorkspaces', 'workspaces') },
        { key: 'members', n: memberCount, label: tr('organisms.figMembers', 'members'), sub: reqText || undefined },
        { key: 'agents', n: agentCount, label: tr('organisms.figAgents', 'agents') },
        { key: 'last', n: last ? (last.isCurrent ? tr('timeline.now', 'now') : String(last.at).slice(0, 10)) : '·', tone: last ? 'coral' : undefined,
          label: tr('organisms.figLast', 'last change'), sub: last ? last.event : undefined },
      ]} />`}
      rail=${rail}
      after=${html`<${ConfirmUI} />`}>
      <${Section} id="og-workspaces" num="01" first=${true} title=${tr('organisms.tabWorkspaces', 'Workspaces')} count=${wsCount}>
        <${WorkspaceList} org=${org} showToast=${showToast} onOpen=${onOpenWs} onCount=${setWsCount} />
        <${Row} align="end">
          <${Note}>${tr('organisms.workspacesDesc', 'Each workspace is an independent space with its own documents, records and history.')}<//>
          <${HelpTip} term="concept.workspace" label=${tr('organisms.tabWorkspaces', 'Workspaces')} />
        <//>
      <//>

      <${Section} id="og-members" num="02" title=${tr('organisms.tabMembers', 'Members')} count=${memberCount}>
        <${OrgMemberManager} org=${org} ghii=${ghii} canManage=${canEdit} isCreator=${isCreator}
          showToast=${showToast} confirm=${confirm} onChanged=${onChanged} show="members" />
      <//>

      <${Section} id="og-agents" num="03" title=${tr('organisms.tabAgents', 'Agents')} count=${agentCount}>
        <${OrgAgentsPanel} org=${org} ghii=${ghii} canManage=${canEdit} showToast=${showToast} onChanged=${onChanged} />
      <//>

      <${Section} id="og-board" num="04" title=${tr('organisms.tabBoard', 'Board')}>
        ${org.boardId
          ? html`<${BoardPreview} boardId=${org.boardId} showToast=${showToast} />`
          : html`<${Note}>${tr('organisms.noBoard', 'This organism has no board.')}<//>`}
      <//>

      <${Section} id="og-history" num="05" title=${tr('organisms.happened', 'What has happened')} count=${timeline ? timeline.length : null}
        doors=${fullTimeline ? null : html`<${Action} small soft onClick=${() => setFullTimeline(true)}>${tr('organisms.fullTimeline', 'Full timeline →')}<//>`}>
        ${fullTimeline ? html`<${TimelinePanel} orgId=${org.id} defaultOpen=${true} />` : html`<${TimelineRecent} rows=${timeline} limit=${5} />`}
      <//>

      <${Section} fold id="og-readme" num="06" title=${tr('organisms.readmeFold', 'README')} sub=${readmeTitle} open=${openReadme} onToggle=${() => setOpenReadme(o => !o)}>
        ${readme || canEdit
          ? html`<${ReadmePanel} markdown=${readme} canEdit=${canEdit} kind="organism" name=${org.name} aiPromptSeed=${tocSeed} onSave=${saveReadme} />`
          : html`<${Note}>${tr('organisms.readmeEmpty', 'No README yet.')}<//>`}
      <//>

      <${Section} fold id="og-map" num="07" title=${tr('organisms.mapAndToc', 'Map and table of contents')} open=${openMap} onToggle=${() => setOpenMap(o => !o)}>
        <${Note}>${tr('organisms.mapAndTocHint', 'The same structure two ways.')}<//>
        <${StructureMindmap} scope="organism" graph=${graph} onNavigate=${onMapNav} storageKey=${'org.' + org.id} defaultOpen />
        <${StructureOverview} label=${tr('organisms.structureOverviewOrg', 'Organism structure — table of contents')}
          load=${() => orgService.getOrganismOverview(org.id)} defaultOpen />
      <//>

      <${Section} fold id="og-ai" num="08" title=${tr('organisms.forAiTitle', 'Bring your AI here')} sub=${tr('organisms.forAiHint', '')} open=${openAi} onToggle=${() => setOpenAi(o => !o)}>
        <${Note} kind="lead">${tr('organisms.instrBlockLead', 'Paste this into your AI’s instructions and every conversation starts already knowing this organism’s structure.')}<//>
        <${InstructionBlock} orgId=${org.id} />
      <//>
    <//>`;
}
