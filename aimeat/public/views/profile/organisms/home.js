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
import { Section, Fold, tr, scrollTo } from '/views/profile/organisms/poster-parts.js';

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
    if (target?.type === 'members') scrollTo('og-members');
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
  const openAiSection = () => { setOpenAi(true); setTimeout(() => scrollTo('og-ai'), 30); };
  const readmeTitle = (readme.match(/^#\s+(.+)$/m) || [])[1] || '';
  const rail = [
    ['og-workspaces', '01', tr('organisms.tabWorkspaces', 'Workspaces'), wsCount ?? ''],
    ['og-members', '02', tr('organisms.tabMembers', 'Members'), memberCount],
    ['og-agents', '03', tr('organisms.tabAgents', 'Agents'), agentCount],
    ['og-board', '04', tr('organisms.tabBoard', 'Board'), '·'],
    ['og-history', '05', tr('organisms.happened', 'What has happened'), timeline ? timeline.length : ''],
    ['og-readme', '06', tr('organisms.readmeFold', 'README'), '→'],
    ['og-map', '07', tr('organisms.mapAndToc', 'Map and table of contents'), '→'],
    ['og-ai', '08', tr('organisms.forAi', 'For your AI'), '→'],
  ];

  return html`
    <div class="og">
      <div class="og-crumb">
        <button type="button" class="og-crumb-link" onClick=${onBack}>${tr('organisms.title', 'Organisms')}</button>
        <span>/</span>
        <span class="og-crumb-here">${org.name || org.id}</span>
      </div>

      <div class="og-mast">
        <div class="og-mast-words">
          <h1 class="og-title">${org.name || org.id}</h1>
          <div class="og-chips">
            <span class="og-chip">${typeLabel}</span>
            <span class="og-chip">${t(`organisms.vis${(org.visibility || 'public')[0].toUpperCase()}${(org.visibility || 'public').slice(1)}`) || org.visibility}</span>
            ${org.joinPolicy ? html`<span class="og-chip og-chip--dim">${t(`organisms.policyShort.${org.joinPolicy}`) || org.joinPolicy}</span>` : null}
            ${org.createdAt ? html`<span class="og-chip og-chip--dim">${tr('organisms.createdAt', 'Created')} ${fmtDate(org.createdAt)}</span>` : null}
            ${org.archived ? html`<span class="og-chip og-chip--sun">${tr('organisms.archived', 'Archived')}</span>` : null}
          </div>
          ${org.description ? html`<p class="og-desc">${org.description}</p>` : null}
        </div>
        <div class="og-mast-actions">
          <button type="button" class="og-slab" onClick=${openAiSection}>${tr('organisms.forAi', 'For your AI')}</button>
          <div class="og-doors">
            <button type="button" class="og-door" onClick=${() => setView('settings')}>${tr('organisms.settings', 'Settings')}</button>
            <button type="button" class="og-door og-door--quiet" onClick=${() => exportOrganismZip(org, showToast)}>${tr('organisms.exportBackup', 'Export backup')}</button>
          </div>
        </div>
      </div>

      <div class="og-strip">
        <div><b>${wsCount ?? '·'}</b><span>${tr('organisms.figWorkspaces', 'workspaces')}</span></div>
        <div><b>${memberCount}</b><span>${tr('organisms.figMembers', 'members')}</span>${reqText ? html`<small>${reqText}</small>` : null}</div>
        <div><b>${agentCount}</b><span>${tr('organisms.figAgents', 'agents')}</span></div>
        <div><b class=${last ? 'og-strip-coral' : ''}>${last ? (last.isCurrent ? tr('timeline.now', 'now') : String(last.at).slice(0, 10)) : '·'}</b><span>${tr('organisms.figLast', 'last change')}</span>${last ? html`<small>${last.event}</small>` : null}</div>
      </div>

      <div class="og-grid">
        <div class="og-main">
          <${Section} id="og-workspaces" num="01" first=${true} title=${tr('organisms.tabWorkspaces', 'Workspaces')} count=${wsCount}>
            <${WorkspaceList} org=${org} showToast=${showToast} onOpen=${onOpenWs} onCount=${setWsCount} />
            <p class="og-hint">${tr('organisms.workspacesDesc', 'Each workspace is an independent space with its own documents, records and history.')}</p>
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
              : html`<p class="og-hint">${tr('organisms.noBoard', 'This organism has no board.')}</p>`}
          <//>

          <${Section} id="og-history" num="05" title=${tr('organisms.happened', 'What has happened')} count=${timeline ? timeline.length : null}
            doors=${fullTimeline ? null : html`<button type="button" class="og-door og-door--quiet" onClick=${() => setFullTimeline(true)}>${tr('organisms.fullTimeline', 'Full timeline →')}</button>`}>
            ${fullTimeline ? html`<${TimelinePanel} orgId=${org.id} defaultOpen=${true} />` : html`<${TimelineRecent} rows=${timeline} limit=${5} />`}
          <//>

          <${Fold} id="og-readme" num="06" title=${tr('organisms.readmeFold', 'README')} sub=${readmeTitle} open=${openReadme} onToggle=${() => setOpenReadme(o => !o)}>
            ${readme || canEdit
              ? html`<${ReadmePanel} markdown=${readme} canEdit=${canEdit} kind="organism" name=${org.name} aiPromptSeed=${tocSeed} onSave=${saveReadme} />`
              : html`<p class="og-hint">${tr('organisms.readmeEmpty', 'No README yet.')}</p>`}
          <//>

          <${Fold} id="og-map" num="07" title=${tr('organisms.mapAndToc', 'Map and table of contents')} open=${openMap} onToggle=${() => setOpenMap(o => !o)}>
            <p class="og-hint">${tr('organisms.mapAndTocHint', 'The same structure two ways.')}</p>
            <${StructureMindmap} scope="organism" graph=${graph} onNavigate=${onMapNav} storageKey=${'org.' + org.id} defaultOpen />
            <${StructureOverview} label=${tr('organisms.structureOverviewOrg', 'Organism structure — table of contents')}
              load=${() => orgService.getOrganismOverview(org.id)} defaultOpen />
          <//>

          <${Fold} id="og-ai" num="08" title=${tr('organisms.forAiTitle', 'Bring your AI here')} sub=${tr('organisms.forAiHint', '')} open=${openAi} onToggle=${() => setOpenAi(o => !o)}>
            <p class="og-lead">${tr('organisms.instrBlockLead', 'Paste this into your AI’s instructions and every conversation starts already knowing this organism’s structure.')}</p>
            <${InstructionBlock} orgId=${org.id} />
          <//>
        </div>

        <nav class="og-rail" aria-label=${tr('organisms.railTitle', 'In this organism')}>
          <span class="og-rail-label">${tr('organisms.railTitle', 'In this organism')}</span>
          ${rail.map(([id, num, label, count]) => html`
            <a class="og-rail-link" key=${id} href=${'#' + id} onClick=${(e) => { e.preventDefault(); if (id === 'og-readme') setOpenReadme(true); if (id === 'og-map') setOpenMap(true); if (id === 'og-ai') setOpenAi(true); setTimeout(() => scrollTo(id), 30); }}>
              <i>${num}</i>${label}<em>${count}</em>
            </a>`)}
          <hr />
          <button type="button" class="og-rail-link" onClick=${() => setView('settings')}><i>09</i>${tr('organisms.settings', 'Settings')}<em>→</em></button>
        </nav>
      </div>

      <${ConfirmUI} />
    </div>`;
}
