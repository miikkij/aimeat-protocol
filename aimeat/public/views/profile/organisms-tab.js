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
 *   v2.4.0 — 2026-07-16 — Mount folds my-orgs + public + list-order prefs into GET /v1/organisms/tab
 *     (getOrganismsTab); individual reads kept as fallback.
 *   v2.3.0 — 2026-06-23 — Thread an `openSpace` deep-link from the organism mindmap through onOpenWs
 *     into the Workspace (keyed remount + initialSpace), so a space node opens its tab; cleared on the
 *     Cmd-K and cross-organism-search jump paths so it never goes stale.
 *   v2.2.0 — 2026-06-22 — Cross-organism content search on the list view: one box searches ALL my
 *     organisms (indexed librarian FTS), results grouped per organism; a hit opens that organism +
 *     workspace with the in-workspace search pre-filled. Also listens for the Cmd-K aimeat-open-organism.
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
import { SearchBar } from '/components/SearchBar.js';
import { EmptyState } from '/components/EmptyState.js';
import { useConfirm } from '/components/Modal.js';
import * as orgService from '/js/services/organisms.js';
import * as memoryService from '/js/services/memory.js';
import { fmtDate, orgInitials, exportOrganismZip } from '/views/profile/organisms/helpers.js';
import { IncomingInvitations } from '/views/profile/organisms/panels.js';
import { OrganismHome } from '/views/profile/organisms/home.js';
import { Workspace } from '/views/profile/organisms/workspace.js';
import { swallowed } from '/js/swallowed.js';

export default function OrganismsTab({ session, showToast, onStats }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [myOrganisms, setMyOrganisms] = useState(null);
  const [publicOrganisms, setPublicOrganisms] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [archivedOpen, setArchivedOpen] = useState(false);   // collapsible "Archived" section (closed by default)
  // organism whose workspaces are open, then the specific workspace within it — both restored from
  // sessionStorage so an F5 returns to where you were. openId set + openWs null = the workspace LIST.
  // eslint-disable-next-line aimeat/no-silent-catch -- a browser API refusing here IS the answer
  const [openId, setOpenId] = useState(() => { try { return sessionStorage.getItem('aimeat.ws.openId') || null; } catch { return null; } });
  // eslint-disable-next-line aimeat/no-silent-catch -- a browser API refusing here IS the answer
  const [openWs, setOpenWs] = useState(() => { try { return sessionStorage.getItem('aimeat.ws.openWs') || null; } catch { return null; } });
  // Transient deep-link target from the organism mindmap: open this space's tab on first render of the
  // workspace. In-memory only (not persisted) — an F5 lands on the workspace overview, not a stale tab.
  const [openSpace, setOpenSpace] = useState(null);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  // List ordering: 'custom' (drag-and-drop, persisted) | 'name' | 'newest'. Persisted together with
  // the manual order in the user-memory key `organisms.ui` so it follows the user across devices.
  const [sortMode, setSortMode] = useState('custom');
  const [customOrder, setCustomOrder] = useState([]);
  const [openSettings, setOpenSettings] = useState(false); // open OrganismHome with the Settings panel showing
  // Cross-organism content search (all my organisms at once) — indexed librarian FTS, grouped per
  // organism. Replaces the org lists while a query is active; a hit opens that organism + workspace
  // with the in-workspace search pre-filled to the same query.
  const [gQuery, setGQuery] = useState('');
  const [gHits, setGHits] = useState(null);   // null = not searching
  const [gBusy, setGBusy] = useState(false);
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
    // Apply the saved list-order prefs (organisms.ui) whether they came from the composite or a fallback read.
    const applyPrefs = (v) => {
      if (v && typeof v === 'object') {
        if (Array.isArray(v.order)) setCustomOrder(v.order.filter(x => typeof x === 'string'));
        if (['custom', 'name', 'newest'].includes(v.sort)) setSortMode(v.sort);
      }
    };
    try {
      // Mount fold: ONE composite (my organisms + counts + public discovery + list-order prefs). On
      // failure, fall back to the two listOrganisms reads + a separate organisms.ui prefs read.
      const ov = await orgService.getOrganismsTab();
      if (ov) {
        const mineIds = new Set(ov.mine.map(o => o.id));
        setMyOrganisms(ov.mine);
        setPublicOrganisms(ov.public.filter(o => !mineIds.has(o.id)));
        onStats?.({ organisms: ov.mine.length });
        setWsCounts(Object.fromEntries(ov.mine.map(o => [o.id, o.workspace_count ?? 0])));
        applyPrefs(ov.uiPrefs);
        return;
      }
      const [myResp, pubResp] = await Promise.all([
        ghii ? orgService.listOrganisms({ member: ghii, include: 'counts' }) : Promise.resolve({ data: { organisms: [] } }),
        orgService.listOrganisms({ visibility: 'public' }),
      ]);
      const mine = myResp?.data?.organisms || [];
      const mineIds = new Set(mine.map(o => o.id));
      setMyOrganisms(mine);
      setPublicOrganisms((pubResp?.data?.organisms || []).filter(o => !mineIds.has(o.id)));
      onStats?.({ organisms: mine.length });
      setWsCounts(Object.fromEntries(mine.map(o => [o.id, o.workspace_count ?? 0])));
      try { const r = await memoryService.getMemory('organisms.ui', { soft: true }); applyPrefs(r?.data?.value); } catch (err) { swallowed('organisms-tab: applyPrefs', err); }
    } catch (err) {
      swallowed('organisms-tab: applyPrefs', err);
      setMyOrganisms([]);
      setPublicOrganisms([]);
    }
  }, [ghii, onStats]);

  useEffect(() => {
    if (session) loadData();
  }, [session, loadData]);

  // ── List-order preferences (user memory key `organisms.ui`: { order: [ids], sort: mode }) ──
  // Read as part of loadData's mount composite (above); this key backs savePrefs.
  const UI_PREFS_KEY = 'organisms.ui';
  const savePrefs = useCallback((order, sort) => {
    memoryService.createMemory(UI_PREFS_KEY, { order, sort }, 'private').catch(err => { swallowed('organisms-tab: applyPrefs', err); });
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
    try { if (openId) sessionStorage.setItem('aimeat.ws.openId', openId); else sessionStorage.removeItem('aimeat.ws.openId'); } catch { /* noop */ }   // eslint-disable-line aimeat/no-silent-catch -- noop
  }, [openId]);
  useEffect(() => {
    try { if (openWs) sessionStorage.setItem('aimeat.ws.openWs', openWs); else sessionStorage.removeItem('aimeat.ws.openWs'); } catch { /* noop */ }   // eslint-disable-line aimeat/no-silent-catch -- noop
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
      setOpenId(d.orgId); setOpenWs(d.wsId || null); setOpenSpace(null); setOpenSettings(false);
    };
    window.addEventListener('aimeat-open-organism', onOpen);
    return () => window.removeEventListener('aimeat-open-organism', onOpen);
  }, []);

  // Deep link from another view (e.g. the Secretary's "Open" links open in a new tab):
  // ?org=…&ws=… opens that organism (+ workspace) on a cold navigation. Runs once on mount.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const org = params.get('org');
      if (org) { setOpenId(org); setOpenWs(params.get('ws') || null); setOpenSpace(null); setOpenSettings(false); }
    } catch (err) { swallowed('organisms-tab: onOpen', err); }
  }, []);

  // Cross-organism content search (debounced) — librarian FTS across all my own content.
  useEffect(() => {
    const query = gQuery.trim();
    if (query.length < 2) { setGHits(null); setGBusy(false); return undefined; }
    let cancelled = false;
    setGBusy(true);
    const tid = setTimeout(async () => {
      const hits = await memoryService.librarianSearch(query, 60, 'own').catch(err => { swallowed('organisms-tab: onOpen', err); return []; });
      if (!cancelled) { setGHits(hits || []); setGBusy(false); }
    }, 220);
    return () => { cancelled = true; clearTimeout(tid); };
  }, [gQuery]);

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
    } catch (err) {
      swallowed('organisms-tab: onOpen', err);
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
    } catch (err) {
      swallowed('organisms-tab: onOpen', err);
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
      } catch (err) {
        swallowed('organisms-tab: onOpen', err);
        showToast(t('organisms.leaveError') || 'Failed to leave');
      }
    }, { danger: true });
  }, [showToast, loadData, confirm]);

  const handleDelete = useCallback(async (id, name) => {
    confirm(t('organisms.confirmDelete')?.replace('{name}', name) || `Delete "${name}"? This cannot be undone.`, async () => {
      try {
        await orgService.deleteOrganism(id);
        showToast(t('organisms.deleted') || 'Organism deleted');
        setExpanded(null);
        setOpenId(null); setOpenWs(null);
        loadData();
      } catch (err) {
        swallowed('organisms-tab: onOpen', err);
        showToast(t('organisms.deleteError') || 'Failed to delete');
      }
    }, { danger: true });
  }, [showToast, loadData, confirm]);

  // Archive / unarchive a whole organism (creator/admin). Archived organisms become read-only and
  // their content is excluded from AI materials (overview/read/search); the workspaces cascade-archive
  // and unarchive uses smart restore. Reversible — not a delete.
  const handleArchive = useCallback(async (id, name, archived) => {
    const verb = archived ? (t('organisms.archive') || 'Archive') : (t('organisms.unarchive') || 'Unarchive');
    confirm(
      (archived
        ? (t('organisms.confirmArchive') || 'Archive “{name}”? It becomes read-only and is hidden from AI operations until you unarchive it. Its workspaces are archived too.')
        : (t('organisms.confirmUnarchive') || 'Unarchive “{name}”? It and the workspaces archived with it become active again.')
      ).replace('{name}', name),
      async () => {
        try {
          if (archived) await orgService.archiveContent(id, { level: 'organism' });
          else await orgService.unarchiveContent(id, { level: 'organism' });
          showToast(archived ? (t('organisms.organismArchived') || 'Organism archived') : (t('organisms.organismUnarchived') || 'Organism restored'));
          loadData();
        } catch (e) { showToast((e && e.message) || 'Failed'); }
      },
      { title: verb },
    );
  }, [showToast, loadData, confirm]);

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
      canEdit && (org.archived
        ? { label: t('organisms.unarchive') || 'Unarchive', icon: '♻️', onClick: () => handleArchive(org.id, org.name, false) }
        : { label: t('organisms.archive') || 'Archive', icon: '🗄️', onClick: () => handleArchive(org.id, org.name, true) }),
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
            ${org.archived ? html`<span class="pj-tab-pill" title=${t('organisms.archivedHint') || 'Archived — read-only, hidden from AI operations'}>${'🗄️ '}${t('organisms.archived') || 'archived'}</span>` : null}
          </div>
          ${org.description ? html`<div class="pj-org-desc">${(org.description)}</div>` : null}
        </div>
        <div class="pj-org-stats">
          ${isMine && wsCounts[org.id] !== undefined ? html`
            <span class="pj-org-stat" title=${t('organisms.tabWorkspaces') || 'Workspaces'}>${'📁'} ${wsCounts[org.id]}</span>` : null}
          <span class="pj-org-stat" title=${t('organisms.members') || 'Members'}>${'👥'} ${org.member_count ?? (org.members || []).length}</span>
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
        key=${openWs + (openSpace ? ':' + openSpace : '')} initialSpace=${openSpace}
        onBack=${() => { setOpenWs(null); setOpenSpace(null); }}
        onBackToList=${() => { setOpenWs(null); setOpenSpace(null); setOpenId(null); setOpenSettings(false); loadData(); }} />`;
    }
    return html`
      <${OrganismHome} org=${org} ghii=${ghii} showToast=${showToast}
        initialSettings=${openSettings}
        onOpenWs=${(wsId, space) => { setOpenSpace(space || null); setOpenWs(wsId); }}
        onBack=${() => { setOpenId(null); setOpenSettings(false); loadData(); }}
        onChanged=${loadData}
        onLeave=${() => handleLeave(org.id, org.name)} />
      <${ConfirmUI} />`;
  }

  if (!myOrganisms) return html`<${Spinner} text=${t('organisms.loading') || 'Loading organisms...'} />`;

  // Open a cross-organism search hit: jump to its organism + workspace, pre-filling the in-workspace
  // search with the query so you land on the filtered result list (reuses Kerros 1).
  const openGHit = (hit) => {
    try { if (hit.workspaceId) sessionStorage.setItem(`aimeat.ws.${hit.organismId}.${hit.workspaceId}.search`, gQuery.trim()); } catch { /* noop */ }   // eslint-disable-line aimeat/no-silent-catch -- noop
    setOpenId(hit.organismId);
    setOpenWs(hit.workspaceId || null);
    setOpenSpace(null);
    setOpenSettings(false);
  };
  // Group the librarian hits under each organism (name from my list / discover), for the results view.
  const orgNameOf = (id) => (myOrganisms || []).find(o => o.id === id)?.name
    || publicOrganisms.find(o => o.id === id)?.name || id;
  const gGroups = {};
  for (const hh of (gHits || [])) { if (!hh.organismId) continue; (gGroups[hh.organismId] = gGroups[hh.organismId] || []).push(hh); }

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

    <!-- Cross-organism content search: one box over ALL my organisms, results grouped per organism -->
    <div class="pj-org-globalsearch">
      <${SearchBar} value=${gQuery} onInput=${e => setGQuery(e.target.value)}
        placeholder=${t('search.allOrgsPlaceholder') || 'Search across all organisms…'} ariaLabel=${t('search.allOrgsPlaceholder') || 'Search across all organisms'} />
      ${gHits !== null ? html`<button class="btn-ghost btn-sm" onClick=${() => setGQuery('')}>${t('search.clear') || 'Clear'}</button>` : null}
    </div>

    ${gHits !== null ? html`
      <div class="pj-search-results">
        ${gBusy && !gHits.length ? html`<${Spinner} text=${t('search.searching') || 'Searching…'} />` : null}
        ${!gHits.length && !gBusy ? html`<${EmptyState} text=${t('search.noMatches') || 'No matches'} />` : null}
        ${Object.entries(gGroups).map(([orgId, hits]) => html`
          <div class="pj-search-group" key=${orgId}>
            <div class="pj-search-group-head">${orgNameOf(orgId)}<span class="pj-org-tab-count">${hits.length}</span></div>
            ${hits.map(hh => html`
              <button class="pj-search-hit" key=${hh.key} onClick=${() => openGHit(hh)}>
                <span class="pj-search-hit-title">${hh.title || hh.key}${hh.workspaceId ? html` <span class="pj-mini">· ${hh.workspaceId}</span>` : null}</span>
                <span class="pj-search-hit-snippet">${hh.snippet || ''}</span>
              </button>`)}
          </div>`)}
      </div>
    ` : html`
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
    ${(() => {
      // Active organisms drive the working list; archived ones move into a collapsed "Archived"
      // section below (read-only/retired — out of the way, but restorable from there).
      const activeMine = sortedMine.filter(o => !o.archived);
      const archivedMine = sortedMine.filter(o => o.archived);
      return html`
        ${activeMine.length === 0 && archivedMine.length === 0
          ? html`<div class="empty">${t('organisms.empty') || 'You are not part of any organisms yet.'}</div>`
          : html`
            ${activeMine.length === 0
              ? html`<div class="empty">${t('organisms.allArchived') || 'All your organisms are archived.'}</div>`
              : html`
                <div class="pj-org-list">${activeMine.map(org => renderOrgRow(org, true))}</div>
                ${sortMode === 'custom' && activeMine.length > 1 ? html`
                  <div class="pj-org-hint">${t('organisms.reorderHint') || 'Drag rows to reorder — the order is saved to your profile.'}</div>` : null}`}
            ${archivedMine.length > 0 ? html`
              <button class="pj-struct-toggle section-title-spaced" aria-expanded=${archivedOpen} onClick=${() => setArchivedOpen(o => !o)}>
                <span class="pj-struct-caret">${archivedOpen ? '▾' : '▸'}</span>
                <span>${'🗄️ '}${(t('organisms.archivedSection') || 'Archived ({n})').replace('{n}', String(archivedMine.length))}</span>
              </button>
              ${archivedOpen ? html`<div class="pj-org-list">${archivedMine.map(org => renderOrgRow(org, true))}</div>` : null}` : null}
          `}
      `;
    })()}

    <!-- Discover -->
    ${publicOrganisms.length > 0 && html`
      <div class="section-title section-title-spaced">${t('organisms.discover') || 'Discover'}</div>
      <div class="pj-org-list">${publicOrganisms.map(org => renderOrgRow(org, false))}</div>
    `}
    `}
    <${ConfirmUI} />
  `;
}
