/**
 * @file home.js
 * @description Organism home page — breadcrumb header (avatar, name, badges, description, Export +
 *   Settings) and tabs (Workspaces / Members / Agents / Board). The Settings panel hosts the
 *   labelled+grouped edit form, the read-only metadata line, and the danger zone (leave / delete).
 *   Extracted from organisms-tab.js with no behaviour change.
 * @structure OrganismHome
 * @usage import { OrganismHome } from '/views/profile/organisms/home.js';
 * @version-history
 *   v1.0.0 — 2026-06-19 — Extracted from organisms-tab.js during the module split.
 *   v1.1.0 — 2026-06-22 — Add the free-form README panel, the interactive structure mindmap, and the
 *     development timeline; rename the structure overview to "table of contents" (Osa A/C/D).
 *   v1.1.1 — 2026-06-23 — Mindmap space-node click now deep-links into the workspace on that space's
 *     tab (onOpenWs gained a second `space` arg); was opening the workspace overview.
 *   v1.2.0 — 2026-07-03 — Roster privacy: Settings → Access gains the "Member list" visibility
 *     select (member_visibility: signed-in default / members / admins / public) with an honest
 *     hint (hides the LIST, not content authorship); isMember now prefers `your_membership` from
 *     GET /:id since members[] can be roster-redacted for this caller.
 */
import { h } from 'preact';
import { useState, useEffect, useMemo, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { TagInput } from '/views/profile/shared.js';
import { useConfirm } from '/components/Modal.js';
import * as orgService from '/js/services/organisms.js';
import { copyToClipboard } from '/js/utils.js';
import { recordRecent } from '/js/recents.js';
import { fmtDate, orgInitials, exportOrganismZip } from '/views/profile/organisms/helpers.js';
import { StructureOverview } from '/views/profile/organisms/widgets.js';
import { ReadmePanel } from '/views/profile/organisms/readme-panel.js';
import { StructureMindmap } from '/views/profile/organisms/mindmap.js';
import { TimelinePanel } from '/views/profile/organisms/timeline-panel.js';
import { WorkspaceList } from '/views/profile/organisms/workspace-list.js';
import { OrgMemberManager } from '/views/profile/organisms/members.js';
import { OrgAgentsPanel } from '/views/profile/organisms/agents.js';
import { BoardPreview } from '/views/profile/organisms/panels.js';

/* ───────────────── Organism home page ─────────────────
 * One home per organism: breadcrumb header (avatar, name, badges, description,
 * Export + Settings) and tabs — Workspaces (the workspace list + content search),
 * Members (invite/approve/roster/blocked), Agents (attach/detach), Board (link to
 * the Boards tab). The Settings panel hosts the edit form, the metadata that used
 * to live in the expanded list card, and the danger zone (leave / delete). */
export function OrganismHome({ org, ghii, showToast, initialSettings, onOpenWs, onBack, onChanged, onLeave }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem('aimeat.org.tab') || 'workspaces'; } catch { return 'workspaces'; } });
  const [showSettings, setShowSettings] = useState(!!initialSettings);
  const [wsCount, setWsCount] = useState(null);
  const [pendingJoin, setPendingJoin] = useState(0);   // Members tab pill — visible without opening the tab
  useEffect(() => { try { sessionStorage.setItem('aimeat.org.tab', tab); } catch { /* noop */ } }, [tab]);

  const isCreator = org.creatorGhii === ghii;
  const isAdmin = org.admins?.includes(ghii);
  // members[] can be roster-redacted (memberVisibility) — your_membership from GET /:id is the
  // caller-scoped truth, with the array as fallback for orgs whose roster this caller CAN see.
  const [yourMembership, setYourMembership] = useState(null);
  const isMember = (yourMembership?.status === 'active') || org.members?.includes(ghii);
  const canEdit = isCreator || isAdmin;
  const typeLabel = t(`organisms.types.${org.type}`) || org.type;

  // README (free-form description), structure GRAPH (mindmap data), and the OKF table-of-contents
  // markdown (seed for the AI-fill prompt). Loaded together and refreshed on live updates.
  const [readme, setReadme] = useState(org.readme || '');
  const [graph, setGraph] = useState(null);
  const [tocSeed, setTocSeed] = useState('');
  useEffect(() => {
    let cancelled = false;
    const loadExtras = async () => {
      const [g, full, toc] = await Promise.all([
        orgService.getOrganismGraph(org.id),
        orgService.getOrganism(org.id),
        orgService.getOrganismOverview(org.id),
      ]);
      if (cancelled) return;
      setGraph(g);
      setReadme(full?.data?.readme || '');
      setYourMembership(full?.data?.your_membership ?? null);
      setTocSeed(toc || '');
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

  // Mindmap node click → navigate: a workspace node opens that workspace; a space node opens its
  // workspace straight on that space's tab; a user node jumps to the Members tab.
  const onMapNav = (target) => {
    if (target?.type === 'members') { setShowSettings(false); setTab('members'); }
    else if (target?.wsId) onOpenWs(target.wsId, target.type === 'space' ? target.space : undefined);
  };

  useEffect(() => {
    if (!canEdit) return undefined;
    let cancelled = false;
    const fetchIt = () => orgService.listJoinRequests(org.id)
      .then(r => { if (!cancelled) setPendingJoin(((r?.data?.join_requests) || []).filter(x => x.status === 'pending').length); })
      .catch(() => {});
    fetchIt();
    const off = onLiveUpdate(['organisms'], fetchIt);
    return () => { cancelled = true; off(); };
  }, [org.id, canEdit]);

  // Feed the home page's "Continue" list (only once the real name is known, not the {id} stub).
  useEffect(() => {
    if (org.name) recordRecent({ type: 'organism', id: org.id, label: org.name, data: { orgId: org.id } });
  }, [org.id, org.name]);

  /* ── Settings: labelled + grouped form (Identity / Access) with live dirty-check, a one-line
   * read-only metadata row, per-choice access hints, and a clearly separated danger zone whose
   * delete needs the organism's name typed and states exactly what gets removed. ── */
  const baseline = useMemo(() => ({
    name: org.name || '', description: org.description || '', type: org.type || 'community',
    join_policy: org.joinPolicy || 'open', visibility: org.visibility || 'public',
    member_visibility: org.memberVisibility || 'authenticated',
    interests: [...(org.interests || [])],
  }), [org]);
  const [form, setForm] = useState(baseline);
  const [saving, setSaving] = useState(false);
  // Sync the form whenever fresher org data arrives (e.g. the home mounted from an F5 with only a
  // {id} stub before the list loaded) — but ONLY while the user hasn't touched the fields, so a
  // live-update reload never clobbers typing.
  const prevBaselineRef = useRef(baseline);
  useEffect(() => {
    const prev = prevBaselineRef.current;
    const untouched = form.name === prev.name && form.description === prev.description
      && form.type === prev.type && form.join_policy === prev.join_policy
      && form.visibility === prev.visibility && form.member_visibility === prev.member_visibility
      && form.interests.join(' ') === prev.interests.join(' ');
    if (untouched) setForm(baseline);
    prevBaselineRef.current = baseline;
  }, [baseline]);  const dirty = form.name !== baseline.name || form.description !== baseline.description
    || form.type !== baseline.type || form.join_policy !== baseline.join_policy
    || form.visibility !== baseline.visibility
    || form.member_visibility !== baseline.member_visibility
    || form.interests.join(' ') !== baseline.interests.join(' ');
  // Save doubles as the unsaved-changes indicator: enabled ⇔ something actually changed.
  const saveEdit = async () => {
    if (!form.name.trim()) { showToast(t('organisms.nameRequired') || 'Name is required'); return; }
    setSaving(true);
    try {
      const result = await orgService.updateOrganism(org.id, {
        name: form.name.trim(), description: form.description.trim(),
        type: form.type, join_policy: form.join_policy, visibility: form.visibility,
        member_visibility: form.member_visibility, interests: form.interests,
      });
      if (result?.ok !== false) { showToast(t('organisms.updated') || 'Organism updated'); onChanged?.(); }
      else showToast(result?.error?.message || (t('organisms.updateError') || 'Failed to update'));
    } catch { showToast(t('organisms.updateError') || 'Failed to update'); }
    finally { setSaving(false); }
  };
  // Leaving a dirty form (closing settings / breadcrumb back) asks before dropping the changes.
  const guardDirty = (fn) => {
    if (showSettings && dirty) confirm(t('organisms.discardChanges') || 'Discard unsaved changes?', () => { setForm(baseline); fn(); }, { danger: true });
    else fn();
  };

  const boardIdShort = org.boardId && org.boardId.length > 20
    ? `${org.boardId.slice(0, 12)}…${org.boardId.slice(-6)}` : (org.boardId || '');
  const copyBoardId = async () => {
    const ok = await copyToClipboard(org.boardId);
    showToast(ok ? (t('organisms.copied') || 'Copied') : (t('organisms.copyFailed') || 'Could not copy'));
  };

  // What a delete actually removes (counted from the accessible workspaces when settings opens).
  const [delStats, setDelStats] = useState(null);   // { ws, recs, docs }
  const [delOpen, setDelOpen] = useState(false);
  const [delName, setDelName] = useState('');
  useEffect(() => {
    if (!showSettings || !isCreator) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const wss = (await orgService.discoverWorkspaces(org.id)).filter(w => w.access !== 'none');
        let recs = 0, docs = 0;
        await Promise.all(wss.map(async (w) => {
          const wsData = await orgService.getWorkspace(org.id, w.id).catch(() => null);
          for (const ot of (wsData?.manifest?.objectTypes || []).filter(orgService.isMemorySpace)) {
            const n = new Set([...(wsData.drafts?.[ot.name] || []), ...(wsData.objects?.[ot.name] || [])].map(d => d.id)).size;
            if (orgService.isDocSpace(ot)) docs += n; else recs += n;
          }
        }));
        if (!cancelled) setDelStats({ ws: wss.length, recs, docs });
      } catch { /* the counts are a courtesy — the generic warning still shows */ }
    })();
    return () => { cancelled = true; };
  }, [org.id, showSettings, isCreator]);
  const delStatsText = delStats
    ? (t('organisms.deleteOrganismStats') || 'Deletes {w} workspaces, {r} records and {d} documents. This cannot be undone.')
        .replace('{w}', String(delStats.ws)).replace('{r}', String(delStats.recs)).replace('{d}', String(delStats.docs))
    : (t('organisms.deleteWarnGeneric') || 'Deletes the organism with all its workspaces and content. This cannot be undone.');
  const doDelete = () => {
    confirm(`${(t('organisms.confirmDeleteName') || 'Delete “{name}”?').replace('{name}', org.name || org.id)} ${delStatsText}`, async () => {
      try {
        await orgService.deleteOrganism(org.id);
        showToast(t('organisms.deleted') || 'Organism deleted');
        onBack(); onChanged?.();
      } catch { showToast(t('organisms.deleteError') || 'Failed to delete'); }
    }, { danger: true, title: t('organisms.deleteOrganismTitle') || 'Delete this organism' });
  };
  // Archive / unarchive the whole organism (creator/admin) — read-only + hidden from AI materials,
  // cascades to its workspaces, fully reversible (smart restore). Unlike delete, nothing is destroyed.
  const doArchive = (archived) => {
    confirm(
      (archived
        ? (t('organisms.confirmArchive') || 'Archive “{name}”? It becomes read-only and is hidden from AI operations until you unarchive it. Its workspaces are archived too.')
        : (t('organisms.confirmUnarchive') || 'Unarchive “{name}”? It and the workspaces archived with it become active again.')
      ).replace('{name}', org.name || org.id),
      async () => {
        try {
          if (archived) await orgService.archiveContent(org.id, { level: 'organism' });
          else await orgService.unarchiveContent(org.id, { level: 'organism' });
          showToast(archived ? (t('organisms.organismArchived') || 'Organism archived') : (t('organisms.organismUnarchived') || 'Organism restored'));
          onChanged?.();
        } catch (e) { showToast((e && e.message) || 'Failed'); }
      },
      { title: archived ? (t('organisms.archive') || 'Archive') : (t('organisms.unarchive') || 'Unarchive') },
    );
  };

  const extraAdmins = (org.admins || []).filter(a => a !== org.creatorGhii);
  const visHint = t(`organisms.visHint.${form.visibility}`);
  const policyHint = t(`organisms.policyHint.${form.join_policy}`);
  const hintText = [visHint, policyHint].filter(h => h && !h.startsWith('organisms.')).join(' ');

  const renderSettings = () => html`
    <div class="card-detail pj-org-settings">
      <div class="pj-meta-line">
        ${org.createdAt ? html`<span>${t('organisms.createdAt') || 'Created'} ${fmtDate(org.createdAt)}</span>` : null}
        <span>${t('organisms.creator') || 'Creator'} ${(org.creatorGhii || '-')}</span>
        ${extraAdmins.length > 0 ? html`<span>${t('organisms.admins') || 'Admins'} ${(extraAdmins.join(', '))}</span>` : null}
        ${org.boardId ? html`
          <span>${t('organisms.board') || 'Board'} <span class="mono" title=${(org.boardId)}>${(boardIdShort)}</span>
            <button class="pj-icon-btn" title=${t('organisms.copyId') || 'Copy ID'} onClick=${copyBoardId}>${'📋'}</button>
          </span>` : null}
      </div>

      ${canEdit ? html`
        <div class="pj-form-group">${t('organisms.formIdentity') || 'Identity'}</div>
        <label class="pj-field"><span>${t('organisms.fieldName') || 'Name'}</span>
          <input type="text" class="input-field input-sm" value=${form.name} onInput=${(e) => setForm(f => ({ ...f, name: e.target.value }))} /></label>
        <label class="pj-field"><span>${t('organisms.fieldDescription') || 'Description'}</span>
          <textarea class="input-field input-sm" rows="2" value=${form.description} onInput=${(e) => setForm(f => ({ ...f, description: e.target.value }))}></textarea></label>
        <div class="pj-field"><span>${t('organisms.fieldInterests') || 'Interests'}</span>
          <${TagInput} tags=${form.interests} onChange=${(tags) => setForm(f => ({ ...f, interests: tags }))} placeholder=${t('organisms.addTag') || 'Add…'} /></div>

        <div class="pj-form-group">${t('organisms.formAccess') || 'Access'}</div>
        <div class="pj-form-row">
          <label class="pj-field"><span>${t('organisms.fieldType') || 'Type'}</span>
            <select class="input-field input-sm" value=${form.type} onChange=${(e) => setForm(f => ({ ...f, type: e.target.value }))}>
              <option value="community">${t('organisms.types.community') || 'Community'}</option>
              <option value="team">${t('organisms.types.team') || 'Team'}</option>
              <option value="club">${t('organisms.types.club') || 'Club'}</option>
              <option value="cooperative">${t('organisms.types.cooperative') || 'Cooperative'}</option>
              <option value="project">${t('organisms.types.project') || 'Project'}</option>
            </select></label>
          <label class="pj-field"><span>${t('organisms.policyLabel') || 'Join policy'}</span>
            <select class="input-field input-sm" value=${form.join_policy} onChange=${(e) => setForm(f => ({ ...f, join_policy: e.target.value }))}>
              <option value="open">${t('organisms.policyOpen') || 'Open (anyone can join)'}</option>
              <option value="approval_required">${t('organisms.policyApproval') || 'Approval required'}</option>
              <option value="invite_only">${t('organisms.policyInvite') || 'Invite only'}</option>
            </select></label>
          <label class="pj-field"><span>${t('organisms.fieldVisibility') || 'Visibility'}</span>
            <select class="input-field input-sm" value=${form.visibility} onChange=${(e) => setForm(f => ({ ...f, visibility: e.target.value }))}>
              <option value="public">${t('organisms.visPublic') || 'Public'}</option>
              <option value="listed">${t('organisms.visListed') || 'Listed'}</option>
              <option value="private">${t('organisms.visPrivate') || 'Private'}</option>
            </select></label>
          <label class="pj-field"><span>${t('organisms.memberVisLabel') || 'Member list'}</span>
            <select class="input-field input-sm" value=${form.member_visibility} onChange=${(e) => setForm(f => ({ ...f, member_visibility: e.target.value }))}>
              <option value="authenticated">${t('organisms.memberVis.authenticated') || 'Signed-in users'}</option>
              <option value="members">${t('organisms.memberVis.members') || 'Members only'}</option>
              <option value="admins">${t('organisms.memberVis.admins') || 'Admins only'}</option>
              <option value="public">${t('organisms.memberVis.public') || 'Public (anyone)'}</option>
            </select></label>
        </div>
        ${hintText ? html`<div class="pj-form-hint">${hintText}</div>` : null}
        <div class="pj-form-hint">${t('organisms.memberVisHint') || 'Who can see who belongs here. Hides the member LIST only — content authorship (comments, records, activity) stays visible, and the creator/admins are always shown.'}</div>

        <div class="form-actions">
          <button class="btn-primary btn-sm" onClick=${saveEdit} disabled=${saving || !dirty || !form.name.trim()}>
            ${saving ? '...' : (t('organisms.saveChanges') || 'Save changes')}</button>
          <button class="btn-ghost btn-sm" onClick=${() => { setForm(baseline); setShowSettings(false); }}>${t('organisms.cancel') || 'Cancel'}</button>
        </div>
      ` : null}
    </div>

    ${canEdit ? html`
      <div class="pj-danger-box">
        <div class="pj-danger-row">
          <div class="pj-danger-text">
            <div class="pj-danger-title">${org.archived ? (t('organisms.unarchiveOrganismTitle') || 'Unarchive this organism') : (t('organisms.archiveOrganismTitle') || 'Archive this organism')}</div>
            <div class="pj-danger-sub">${org.archived
              ? (t('organisms.unarchiveOrganismSub') || 'Make it active again. Workspaces archived together with it are restored.')
              : (t('organisms.archiveOrganismSub') || 'Make it read-only and hide it (and its workspaces) from AI operations. Reversible — nothing is deleted.')}</div>
          </div>
          <button class="btn-outline btn-sm" onClick=${() => doArchive(!org.archived)}>${org.archived ? `♻️ ${t('organisms.unarchive') || 'Unarchive'}` : `🗄️ ${t('organisms.archive') || 'Archive'}`}</button>
        </div>
      </div>` : null}

    ${(isCreator || isMember) ? html`
      <div class="pj-danger pj-danger-box">
        ${isCreator ? html`
          <div class="pj-danger-row">
            <div class="pj-danger-text">
              <div class="pj-danger-title">${t('organisms.deleteOrganismTitle') || 'Delete this organism'}</div>
              <div class="pj-danger-sub">${delStatsText}</div>
            </div>
            <button class="btn-danger btn-sm" onClick=${() => { setDelOpen(o => !o); setDelName(''); }}>${t('organisms.deleteDots') || 'Delete…'}</button>
          </div>
          ${delOpen ? html`
            <div class="pj-danger-confirm">
              <label class="pj-field"><span>${(t('organisms.confirmTypeName') || 'Type the organism’s name to confirm') + ': ' + (org.name || '')}</span>
                <input type="text" class="input-field input-sm" value=${delName} onInput=${(e) => setDelName(e.target.value)} placeholder=${org.name || ''} /></label>
              <button class="btn-danger btn-sm" disabled=${delName.trim() !== (org.name || '').trim()} onClick=${doDelete}>${t('organisms.delete') || 'Delete'}</button>
            </div>` : null}
        ` : null}
        ${isMember && !isCreator ? html`
          <div class="pj-danger-row">
            <div class="pj-danger-text">
              <div class="pj-danger-title">${t('organisms.leave') || 'Leave'}</div>
            </div>
            <button class="btn-danger btn-sm" onClick=${onLeave}>${t('organisms.leave') || 'Leave'}</button>
          </div>` : null}
      </div>` : null}
  `;

  const reqPill = pendingJoin > 0
    ? (pendingJoin === 1 ? (t('organisms.reqOne') || '1 request') : (t('organisms.reqMany') || '{n} requests').replace('{n}', String(pendingJoin)))
    : null;
  const tabs = [
    { id: 'workspaces', label: t('organisms.tabWorkspaces') || 'Workspaces', count: wsCount },
    { id: 'members', label: t('organisms.tabMembers') || 'Members', count: (org.members || []).length, pill: reqPill },
    { id: 'agents', label: t('organisms.tabAgents') || 'Agents', count: (org.agentGaiis || []).length },
    { id: 'board', label: t('organisms.tabBoard') || 'Board', count: null },
  ];

  // Settings REPLACES the tab content — while it is open no tab is highlighted (a lit tab above
  // settings content lies about what the user is looking at), and the breadcrumb says so.
  const activeHomeTab = showSettings ? '' : tab;
  const pickHomeTab = (id) => guardDirty(() => { setShowSettings(false); setTab(id); });

  return html`
    <div class="pj-ws">
      <div class="pj-org-breadcrumb">
        <button class="pj-org-crumb-link" onClick=${() => guardDirty(onBack)}>${t('organisms.title') || 'Organisms'}</button>
        <span class="pj-org-crumb-sep">/</span>
        ${showSettings ? html`
          <button class="pj-org-crumb-link" onClick=${() => guardDirty(() => setShowSettings(false))}>${(org.name || org.id)}</button>
          <span class="pj-org-crumb-sep">/</span>
          <span>${t('organisms.settings') || 'Settings'}</span>
        ` : html`<span>${(org.name || org.id)}</span>`}
      </div>

      <div class="pj-org-home-head">
        <div class="pj-org-avatar pj-org-avatar-lg" aria-hidden="true">${orgInitials(org.name)}</div>
        <div class="pj-org-home-title">
          <div class="pj-org-titlerow">
            <span class="pj-org-home-name">${(org.name || org.id)}</span>
            <span class="badge badge-info">${typeLabel}</span>
            <span class="badge ${org.visibility === 'public' ? 'badge-success' : 'badge-warn'}">${org.visibility || ''}</span>
          </div>
          ${org.description ? html`<div class="section-desc pj-org-home-desc">${(org.description)}</div>` : null}
        </div>
        <div class="pj-org-home-actions">
          <button class="btn-outline btn-sm" title=${t('organisms.exportOrgHint') || 'Download a ZIP backup of the whole organism (all workspaces)'}
            onClick=${() => exportOrganismZip(org, showToast)}>${'⬇ '}${t('organisms.exportOrg') || 'Export'}</button>
          <button class="btn-outline btn-sm ${showSettings ? 'pj-org-btn-active' : ''}" onClick=${() => guardDirty(() => setShowSettings(s => !s))}>${'⚙ '}${t('organisms.settings') || 'Settings'}</button>
        </div>
      </div>

      <${ReadmePanel} markdown=${readme} canEdit=${canEdit} kind="organism" name=${org.name}
        aiPromptSeed=${tocSeed} onSave=${saveReadme} />

      <${StructureMindmap} scope="organism" graph=${graph} onNavigate=${onMapNav} storageKey=${'org.' + org.id} />

      <${StructureOverview} label=${t('organisms.structureOverviewOrg') || 'Organism structure — table of contents'}
        load=${() => orgService.getOrganismOverview(org.id)} />

      <${TimelinePanel} orgId=${org.id} />

      <div class="pj-org-tabs" role="tablist">
        ${tabs.map(tb => html`
          <button class="pj-org-tab ${activeHomeTab === tb.id ? 'active' : ''}" role="tab" aria-selected=${activeHomeTab === tb.id} key=${tb.id}
            onClick=${() => pickHomeTab(tb.id)}>
            ${tb.label}${tb.count !== null && tb.count !== undefined ? html`<span class="pj-org-tab-count">${tb.count}</span>` : null}
            ${tb.pill ? html`<span class="pj-tab-pill">${tb.pill}</span>` : null}
          </button>`)}
      </div>

      ${showSettings ? renderSettings() : null}

      ${activeHomeTab === 'workspaces' ? html`
        <${WorkspaceList} org=${org} showToast=${showToast} onOpen=${onOpenWs} onCount=${setWsCount} />
      ` : null}

      ${activeHomeTab === 'members' ? html`
        <${OrgMemberManager} org=${org} ghii=${ghii} canManage=${canEdit} isCreator=${isCreator}
          showToast=${showToast} confirm=${confirm} onChanged=${onChanged} show="members" />` : null}

      ${activeHomeTab === 'agents' ? html`
        <${OrgAgentsPanel} org=${org} ghii=${ghii} canManage=${canEdit} showToast=${showToast} onChanged=${onChanged} />` : null}

      ${activeHomeTab === 'board' ? (org.boardId
        ? html`<${BoardPreview} boardId=${org.boardId} showToast=${showToast} />`
        : html`<div class="card-detail"><div class="section-desc">${t('organisms.noBoard') || 'This organism has no board.'}</div></div>`) : null}

      <${ConfirmUI} />
    </div>`;
}
