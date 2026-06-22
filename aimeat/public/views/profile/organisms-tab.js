/**
 * @file organisms-tab.js
 * @description Profile tab for managing organisms (groups, communities, teams). This is now the thin
 *   shell: the organisms list (compact rows + drag-and-drop ordering + sort + create/import), the
 *   discover section, and the routing between the list, an organism's home page, and a workspace.
 *   The bulk of the feature lives in cohesive sub-modules under ./organisms/* (see @structure).
 * @structure
 *   - OrganismsTab — main exported component (list + routing shell)
 *   - renderOrgRow / renderDiscoverDetail — compact list row + discover detail (inner helpers)
 *   Sub-modules: organisms/helpers.js (fmtDate/relTime/orgInitials/exportOrganismZip),
 *   organisms/panels.js (OrgSearch/IncomingInvitations/BoardPreview), organisms/home.js
 *   (OrganismHome), organisms/workspace.js (Workspace), organisms/workspace-list.js, members.js,
 *   agents.js, document.js, schema-form.js, workspace-comments.js, activity-panel.js,
 *   participants-panel.js, sources-panel.js, widgets.js (StructureOverview). KebabMenu/TagInput
 *   were promoted to ./shared.js.
 * @usage
 *   import OrganismsTab from '/views/profile/organisms-tab.js';
 *   <OrganismsTab session={session} showToast={showToast} onStats={onStats} />
 * @version-history
 *   v2.1.0 — 2026-06-22 — Workspace counts come inline via listOrganisms({include:'counts'}) instead
 *     of a per-organism discoverWorkspaces fan-out.
 *   v1.31.1 — 2026-06-19 — JSDoc type annotations for frontend type-checking.
 *   v2.0.0 — 2026-06-19 — Split the ~3825-line module into cohesive sub-modules under ./organisms/*
 *     (no behaviour/visual change). This file keeps only OrganismsTab + the list-row renderers.
 *     KebabMenu/TagInput promoted to ./shared.js; the hidden import file-input now uses the
 *     .pj-hidden-input class instead of an inline style. The pre-2.0 per-version changelog lives in
 *     git history. DocumentView/DocumentEditor now live in ./organisms/document.js (doc-solo.js
 *     imports them from there directly).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef, useMemo } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Spinner, KebabMenu } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import * as orgService from '/js/services/organisms.js';
import * as memoryService from '/js/services/memory.js';
import { fmtDate, orgInitials, exportOrganismZip } from '/views/profile/organisms/helpers.js';
import { IncomingInvitations } from '/views/profile/organisms/panels.js';
import { OrganismHome } from '/views/profile/organisms/home.js';
import { Workspace } from '/views/profile/organisms/workspace.js';

export default function OrganismsTab({ session, showToast, onStats }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [myOrganisms, setMyOrganisms] = useState(null);
  const [publicOrganisms, setPublicOrganisms] = useState([]);
  const [expanded, setExpanded] = useState(null);
  // organism whose workspaces are open, then the specific workspace within it — both restored from
  // sessionStorage so an F5 returns to where you were. openId set + openWs null = the workspace LIST.
  const [openId, setOpenId] = useState(() => { try { return sessionStorage.getItem('aimeat.ws.openId') || null; } catch (e) { return null; } });
  const [openWs, setOpenWs] = useState(() => { try { return sessionStorage.getItem('aimeat.ws.openWs') || null; } catch (e) { return null; } });
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  // List ordering: 'custom' (drag-and-drop, persisted) | 'name' | 'newest'. Persisted together with
  // the manual order in the user-memory key `organisms.ui` so it follows the user across devices.
  const [sortMode, setSortMode] = useState('custom');
  const [customOrder, setCustomOrder] = useState([]);
  const [openSettings, setOpenSettings] = useState(false); // open OrganismHome with the Settings panel showing
  const dragIdRef = useRef(null);
  const [dragOverId, setDragOverId] = useState(null);

  /* ── Create form state ── */
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formType, setFormType] = useState('community');
  const [formPolicy, setFormPolicy] = useState('open');
  const [formVisibility, setFormVisibility] = useState('public');
  const [formInterests, setFormInterests] = useState('');

  const ghii = session?.owner || '';
  const [wsCounts, setWsCounts] = useState({});   // orgId → workspace count (own orgs)

  const loadData = useCallback(async () => {
    try {
      const [myResp, pubResp] = await Promise.all([
        ghii ? orgService.listOrganisms({ member: ghii, include: 'counts' }) : Promise.resolve({ data: { organisms: [] } }),
        orgService.listOrganisms({ visibility: 'public' }),
      ]);
      const mine = myResp?.data?.organisms || [];
      const mineIds = new Set(mine.map(o => o.id));
      const discover = (pubResp?.data?.organisms || []).filter(o => !mineIds.has(o.id));
      setMyOrganisms(mine);
      setPublicOrganisms(discover);
      onStats?.({ organisms: mine.length });
      // Workspace counts for the 📁 row stat come inline via ?include=counts (no per-org fan-out).
      setWsCounts(Object.fromEntries(mine.map(o => [o.id, o.workspace_count ?? 0])));
    } catch {
      setMyOrganisms([]);
      setPublicOrganisms([]);
    }
  }, [ghii, onStats]);

  useEffect(() => {
    if (session) loadData();
  }, [session, loadData]);

  // ── List-order preferences (user memory key `organisms.ui`: { order: [ids], sort: mode }) ──
  const UI_PREFS_KEY = 'organisms.ui';
  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        const r = await memoryService.getMemory(UI_PREFS_KEY, { soft: true });
        const v = r?.data?.value;
        if (v && typeof v === 'object') {
          if (Array.isArray(v.order)) setCustomOrder(v.order.filter(x => typeof x === 'string'));
          if (['custom', 'name', 'newest'].includes(v.sort)) setSortMode(v.sort);
        }
      } catch { /* no saved prefs yet */ }
    })();
  }, [session]);
  const savePrefs = useCallback((order, sort) => {
    memoryService.createMemory(UI_PREFS_KEY, { order, sort }, 'private').catch(() => {});
  }, []);

  // Stable sort keeps server order for ids missing from the saved manual order (appended at the end).
  const sortedMine = useMemo(() => {
    const arr = [...(myOrganisms || [])];
    if (sortMode === 'name') arr.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
    else if (sortMode === 'newest') arr.sort((a, b) => +new Date(b.createdAt || 0) - +new Date(a.createdAt || 0));
    else if (customOrder.length) {
      const pos = new Map(customOrder.map((id, i) => [id, i]));
      arr.sort((a, b) => (pos.has(a.id) ? pos.get(a.id) : Infinity) - (pos.has(b.id) ? pos.get(b.id) : Infinity));
    }
    return arr;
  }, [myOrganisms, sortMode, customOrder]);

  // Drop on a row: move the dragged row to the target's position; switches to manual order and saves.
  const onDropRow = (targetId) => {
    const fromId = dragIdRef.current;
    dragIdRef.current = null;
    setDragOverId(null);
    if (!fromId || fromId === targetId) return;
    const ids = sortedMine.map(o => o.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setCustomOrder(ids);
    setSortMode('custom');
    savePrefs(ids, 'custom');
  };

  // Import a whole organism from a ZIP backup → creates a new organism + opens it.
  const orgFileRef = useRef(null);
  const [importingOrg, setImportingOrg] = useState(false);
  const doImportOrg = async (file) => {
    if (!file) return;
    setImportingOrg(true);
    try {
      const jwt = window.AIMEAT?.auth?.getSession?.()?.jwt || '';
      const res = await fetch('/v1/organisms/import', { method: 'POST', headers: { Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/zip' }, body: file });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message || 'Import failed');
      showToast(t('organisms.orgImported') || 'Organism imported');
      await loadData();
      if (body.data?.organism_id) setOpenId(body.data.organism_id);
    } catch (e) { showToast((e && e.message) || 'Import failed'); }
    finally { setImportingOrg(false); }
  };

  // Persist the open organism + workspace (F5 restore), and drop a restored id the user can no longer open.
  useEffect(() => {
    try { if (openId) sessionStorage.setItem('aimeat.ws.openId', openId); else sessionStorage.removeItem('aimeat.ws.openId'); } catch (e) { /* noop */ }
  }, [openId]);
  useEffect(() => {
    try { if (openWs) sessionStorage.setItem('aimeat.ws.openWs', openWs); else sessionStorage.removeItem('aimeat.ws.openWs'); } catch (e) { /* noop */ }
  }, [openWs]);
  useEffect(() => {
    if (openId && myOrganisms && !myOrganisms.some(o => o.id === openId)) { setOpenId(null); setOpenWs(null); }
  }, [openId, myOrganisms]);

  // Jump from the global command palette (Cmd-K) when this tab is already mounted — open the chosen
  // organism (+ workspace). A cold navigation instead reads sessionStorage on mount (above).
  useEffect(() => {
    const onOpen = (e) => {
      const d = e.detail || {};
      if (!d.orgId) return;
      setOpenId(d.orgId); setOpenWs(d.wsId || null); setOpenSettings(false);
    };
    window.addEventListener('aimeat-open-organism', onOpen);
    return () => window.removeEventListener('aimeat-open-organism', onOpen);
  }, []);

  // Live update listener
  const liveRef = useRef(loadData);
  liveRef.current = loadData;
  useEffect(() => onLiveUpdate(['organisms'], () => liveRef.current()), []);

  const handleCreate = useCallback(async () => {
    if (!formName.trim()) {
      showToast(t('organisms.nameRequired') || 'Name is required');
      return;
    }
    setCreating(true);
    try {
      const interests = formInterests.split(',').map(s => s.trim()).filter(Boolean);
      const result = await orgService.createOrganism({
        name: formName.trim(),
        description: formDesc.trim(),
        type: formType,
        join_policy: formPolicy,
        visibility: formVisibility,
        interests,
      });
      if (result?.data?.organism) {
        showToast(t('organisms.created') || 'Organism created!');
        setShowCreate(false);
        setFormName(''); setFormDesc(''); setFormInterests('');
        loadData();
      } else {
        showToast(result?.error?.message || (t('organisms.createError') || 'Failed to create'));
      }
    } catch {
      showToast(t('organisms.createError') || 'Failed to create');
    } finally { setCreating(false); }
  }, [formName, formDesc, formType, formPolicy, formVisibility, formInterests, showToast, loadData]);

  const handleJoin = useCallback(async (id) => {
    try {
      const result = await orgService.joinOrganism(id);
      if (result?.data?.status === 'joined') {
        showToast(t('organisms.joined') || 'Joined!');
      } else if (result?.data?.status === 'pending') {
        showToast(t('organisms.joinPending') || 'Join request sent — waiting for approval');
      } else {
        showToast(result?.error?.message || 'Could not join');
      }
      loadData();
    } catch {
      showToast(t('organisms.joinError') || 'Failed to join');
    }
  }, [showToast, loadData]);

  const handleLeave = useCallback(async (id, name) => {
    confirm(t('organisms.confirmLeave')?.replace('{name}', name) || `Leave "${name}"?`, async () => {
      try {
        await orgService.leaveOrganism(id);
        showToast(t('organisms.left') || 'Left organism');
        setOpenId(null); setOpenWs(null);
        loadData();
      } catch {
        showToast(t('organisms.leaveError') || 'Failed to leave');
      }
    }, { danger: true });
  }, [showToast, loadData]);

  const handleDelete = useCallback(async (id, name) => {
    confirm(t('organisms.confirmDelete')?.replace('{name}', name) || `Delete "${name}"? This cannot be undone.`, async () => {
      try {
        await orgService.deleteOrganism(id);
        showToast(t('organisms.deleted') || 'Organism deleted');
        setExpanded(null);
        setOpenId(null); setOpenWs(null);
        loadData();
      } catch {
        showToast(t('organisms.deleteError') || 'Failed to delete');
      }
    }, { danger: true });
  }, [showToast, loadData]);

  const toggleExpand = useCallback((id) => {
    setExpanded(prev => prev === id ? null : id);
  }, []);

  // Discover rows expand in place (non-members can't open the home page, so the detail
  // grid + interests they could previously see in the expanded card stay reachable here).
  const renderDiscoverDetail = (org) => {
    const policyLabel = {
      open: t('organisms.policyOpen') || 'Open',
      approval_required: t('organisms.policyApproval') || 'Approval',
      invite_only: t('organisms.policyInvite') || 'Invite Only',
    }[org.joinPolicy] || org.joinPolicy;
    return html`
      <div class="pj-org-detail" onClick=${(e) => e.stopPropagation()}>
        <div class="detail-grid">
          <div class="detail-item">
            <span class="detail-label">${t('organisms.creator') || 'Creator'}</span>
            <span class="detail-value">${(org.creatorGhii)}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">${t('organisms.memberCount') || 'Members'}</span>
            <span class="detail-value">${(org.members || []).length} / ${org.maxMembers || 500}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">${t('organisms.policyLabel') || 'Join policy'}</span>
            <span class="detail-value">${policyLabel}</span>
          </div>
          ${org.createdAt ? html`
            <div class="detail-item">
              <span class="detail-label">${t('organisms.createdAt') || 'Created'}</span>
              <span class="detail-value">${fmtDate(org.createdAt)}</span>
            </div>
          ` : null}
        </div>
        ${(org.interests || []).length > 0 ? html`
          <div class="flex-row-wrap">
            ${org.interests.map(tag => html`<span class="file-tag" key=${tag}>${(tag)}</span>`)}
          </div>` : null}
      </div>`;
  };

  // Compact one-line row: avatar · name + type + lock · description · members/agents/date ·
  // primary action · "…" menu. Management (settings, leave, delete) lives in the menu / home page.
  const renderOrgRow = (org, isMine) => {
    const isCreator = org.creatorGhii === ghii;
    const isAdmin = org.admins?.includes(ghii);
    const isMember = org.members?.includes(ghii);
    const canEdit = isCreator || isAdmin;
    const typeLabel = t(`organisms.types.${org.type}`) || org.type;
    const isExpanded = !isMine && expanded === org.id;
    const visLabel = org.visibility === 'private' ? (t('organisms.visPrivate') || 'Private') : (t('organisms.visListed') || 'Listed');
    const openHome = (withSettings) => { setOpenSettings(!!withSettings); setOpenWs(null); setOpenId(org.id); };
    const activate = () => (isMine || isMember) ? openHome(false) : toggleExpand(org.id);

    const menuItems = isMine ? [
      canEdit && { label: t('organisms.settings') || 'Settings', icon: '⚙', onClick: () => openHome(true) },
      { label: t('organisms.exportOrg') || 'Export organism', icon: '⬇', onClick: () => exportOrganismZip(org, showToast) },
      !isCreator && { label: t('organisms.leave') || 'Leave', danger: true, onClick: () => handleLeave(org.id, org.name) },
      isCreator && { label: t('organisms.delete') || 'Delete', danger: true, onClick: () => handleDelete(org.id, org.name) },
    ] : [];

    return html`
      <div class="pj-org-row ${dragOverId === org.id ? 'pj-org-drag-over' : ''}" key=${org.id}
        draggable=${isMine}
        onDragStart=${isMine ? ((e) => { dragIdRef.current = org.id; e.dataTransfer.effectAllowed = 'move'; }) : undefined}
        onDragOver=${isMine ? ((e) => { e.preventDefault(); setDragOverId(org.id); }) : undefined}
        onDragLeave=${isMine ? (() => setDragOverId(d => (d === org.id ? null : d))) : undefined}
        onDrop=${isMine ? (() => onDropRow(org.id)) : undefined}
        onDragEnd=${isMine ? (() => { dragIdRef.current = null; setDragOverId(null); }) : undefined}>
        <div class="pj-org-avatar" aria-hidden="true">${orgInitials(org.name)}</div>
        <div class="pj-org-main" role="button" tabindex="0" onClick=${activate}
          onKeyDown=${(e) => { if (e.key === 'Enter') activate(); }}>
          <div class="pj-org-titlerow">
            <span class="pj-org-name">${(org.name)}</span>
            <span class="badge badge-info">${typeLabel}</span>
            ${org.visibility !== 'public' ? html`<span class="pj-org-lock" title=${visLabel}>${'🔒'}</span>` : null}
          </div>
          ${org.description ? html`<div class="pj-org-desc">${(org.description)}</div>` : null}
        </div>
        <div class="pj-org-stats">
          ${isMine && wsCounts[org.id] !== undefined ? html`
            <span class="pj-org-stat" title=${t('organisms.tabWorkspaces') || 'Workspaces'}>${'📁'} ${wsCounts[org.id]}</span>` : null}
          <span class="pj-org-stat" title=${t('organisms.members') || 'Members'}>${'👥'} ${(org.members || []).length}</span>
          <span class="pj-org-stat" title=${t('organisms.attachedAgents') || 'Attached agents'}>${'🤖'} ${(org.agentGaiis || []).length}</span>
          ${org.createdAt ? html`<span class="pj-org-stat pj-org-date" title=${t('organisms.createdAt') || 'Created'}>${fmtDate(org.createdAt)}</span>` : null}
        </div>
        ${(isMine || isMember)
          ? html`<button class="btn-outline btn-sm pj-org-openbtn" onClick=${() => openHome(false)}>${t('organisms.open') || 'Open'}</button>`
          : html`<button class="btn-outline btn-sm pj-org-openbtn" onClick=${() => handleJoin(org.id)}>${t('organisms.join') || 'Join'}</button>`}
        ${isMine ? html`<${KebabMenu} label=${t('organisms.moreActions') || 'More actions'} items=${menuItems} />` : null}
        ${isExpanded ? renderDiscoverDetail(org) : null}
      </div>
    `;
  };

  if (openId) {
    const org = [...(myOrganisms || []), ...publicOrganisms].find(o => o.id === openId) || { id: openId };
    // openWs chosen → that workspace; otherwise the organism's HOME page (tabs incl. workspaces).
    if (openWs) {
      return html`<${Workspace} org=${org} wsId=${openWs} session=${session} showToast=${showToast}
        onBack=${() => { setOpenWs(null); }}
        onBackToList=${() => { setOpenWs(null); setOpenId(null); setOpenSettings(false); loadData(); }} />`;
    }
    return html`
      <${OrganismHome} org=${org} ghii=${ghii} showToast=${showToast}
        initialSettings=${openSettings}
        onOpenWs=${(wsId) => setOpenWs(wsId)}
        onBack=${() => { setOpenId(null); setOpenSettings(false); loadData(); }}
        onChanged=${loadData}
        onLeave=${() => handleLeave(org.id, org.name)} />
      <${ConfirmUI} />`;
  }

  if (!myOrganisms) return html`<${Spinner} text=${t('organisms.loading') || 'Loading organisms...'} />`;

  return html`
    <div class="section-title">${t('organisms.title') || 'Organisms'}</div>
    <div class="section-desc">${t('organisms.desc') || 'Organisms are groups — communities, teams, clubs, or projects. Create one or join existing ones to share knowledge, coordinate work, and build together.'}</div>

    <!-- Create form (opened from the topbar button) -->
    <div class="mb-1">
      ${!showCreate ? null : html`
        <div class="create-form">
          <h4 class="card-h3 mb-half">${t('organisms.createTitle') || 'Create New Organism'}</h4>
          <div class="flex-col">
            <input type="text" placeholder=${t('organisms.namePlaceholder') || 'Name'} value=${formName} onInput=${(e) => setFormName(e.target.value)}
              class="input-field input-sm" />
            <textarea placeholder=${t('organisms.descPlaceholder') || 'Description'} value=${formDesc} onInput=${(e) => setFormDesc(e.target.value)} rows="2"
              class="input-field input-sm" />
            <input type="text" placeholder=${t('organisms.interestsPlaceholder') || 'Interests (comma separated)'} value=${formInterests} onInput=${(e) => setFormInterests(e.target.value)}
              class="input-field input-sm" />
            <div class="flex-row-wrap">
              <select value=${formType} onChange=${(e) => setFormType(e.target.value)}
                class="input-field input-sm">
                <option value="community">${t('organisms.types.community') || 'Community'}</option>
                <option value="team">${t('organisms.types.team') || 'Team'}</option>
                <option value="club">${t('organisms.types.club') || 'Club'}</option>
                <option value="cooperative">${t('organisms.types.cooperative') || 'Cooperative'}</option>
                <option value="project">${t('organisms.types.project') || 'Project'}</option>
              </select>
              <select value=${formPolicy} onChange=${(e) => setFormPolicy(e.target.value)}
                class="input-field input-sm">
                <option value="open">${t('organisms.policyOpen') || 'Open (anyone can join)'}</option>
                <option value="approval_required">${t('organisms.policyApproval') || 'Approval required'}</option>
                <option value="invite_only">${t('organisms.policyInvite') || 'Invite only'}</option>
              </select>
              <select value=${formVisibility} onChange=${(e) => setFormVisibility(e.target.value)}
                class="input-field input-sm">
                <option value="public">${t('organisms.visPublic') || 'Public'}</option>
                <option value="listed">${t('organisms.visListed') || 'Listed'}</option>
                <option value="private">${t('organisms.visPrivate') || 'Private'}</option>
              </select>
            </div>
            <div class="form-actions">
              <button class="btn-primary btn-sm" onClick=${handleCreate} disabled=${creating}>
                ${creating ? '...' : (t('organisms.create') || 'Create')}
              </button>
              <button class="btn-ghost btn-sm" onClick=${() => setShowCreate(false)}>
                ${t('organisms.cancel') || 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      `}
    </div>

    <!-- Incoming invitations -->
    <${IncomingInvitations} showToast=${showToast} onChanged=${loadData} />

    <!-- My Organisms -->
    <input type="file" accept=".zip,application/zip" ref=${orgFileRef} class="pj-hidden-input" onChange=${(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; doImportOrg(f); }} />
    <div class="pj-ws-topbar">
      <div class="section-title">${t('organisms.myOrganisms') || 'My Organisms'}</div>
      <div class="pj-org-topbar-actions">
        ${myOrganisms.length > 1 ? html`
          <select class="input-field input-sm pj-org-sort" title=${t('organisms.sortTitle') || 'Sort'} value=${sortMode}
            onChange=${(e) => { const m = e.target.value; setSortMode(m); savePrefs(customOrder, m); }}>
            <option value="custom">${t('organisms.sortCustom') || 'My order'}</option>
            <option value="name">${t('organisms.sortName') || 'Name A–Z'}</option>
            <option value="newest">${t('organisms.sortNewest') || 'Newest first'}</option>
          </select>` : null}
        <button class="btn-outline btn-sm" disabled=${importingOrg} title=${t('organisms.importOrgHint') || 'Restore an organism from a .zip backup'} onClick=${() => orgFileRef.current && orgFileRef.current.click()}>${'⬆ '}${t('organisms.importOrg') || 'Import'}</button>
        <button class="btn-primary btn-sm" onClick=${() => setShowCreate(true)}>${'+ '}${t('organisms.createNew') || 'Create Organism'}</button>
      </div>
    </div>
    ${myOrganisms.length === 0
      ? html`<div class="empty">${t('organisms.empty') || 'You are not part of any organisms yet.'}</div>`
      : html`
        <div class="pj-org-list">${sortedMine.map(org => renderOrgRow(org, true))}</div>
        ${sortMode === 'custom' && sortedMine.length > 1 ? html`
          <div class="pj-org-hint">${t('organisms.reorderHint') || 'Drag rows to reorder — the order is saved to your profile.'}</div>` : null}
      `
    }

    <!-- Discover -->
    ${publicOrganisms.length > 0 && html`
      <div class="section-title section-title-spaced">${t('organisms.discover') || 'Discover'}</div>
      <div class="pj-org-list">${publicOrganisms.map(org => renderOrgRow(org, false))}</div>
    `}
    <${ConfirmUI} />
  `;
}
