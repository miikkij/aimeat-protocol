/**
 * @file organisms-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   2026-09-22 -- The list is composed from the shared set (Page, Section, ListRow, Menu, Field,
 *     Fold, Surface): no class of its own; the row's counts are words instead of emoji, the "..."
 *     menu is the shared Menu, the archived list is a Fold, the create form uses Fields.
 *   2026-09-13 -- V2w: compose remaining profile section top rules from poster.css.
 *   v2.8.0 -- 2026-09-13 -- Compose list and guide rules from poster.css; retire unused list rules.
 *   2026-09-13 — V1: compose page and B1 section headings from the shared poster classes.
 *   v2.7.0 — 2026-09-06 — The counts and the date always render, empty cell and all, because the
 *     row's trailing block is now a fixed grid and a missing cell would slide the rest into the
 *     wrong track. The door gets a cell of its own so Open on one row and Join on the next cannot
 *     drag the columns to their left.
 *   v2.6.0 — 2026-09-06 — The row's marks (type, lock, archived) leave the title row for a fixed
 *     column of their own, so they stand in one line down the list instead of trailing each name at
 *     a different place. The padlock is an outline SVG and the archived pill a plain badge, both
 *     without the emoji they carried.
 *   v2.5.0 — 2026-08-29 — The organism type is free text (40 chars): the create form gains an "Other"
 *     option with a text field, and the list row shows an unknown type as written instead of the
 *     raw locale key (tOr).
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
import { t, tOr } from '/js/i18n.js';
import { useConfirm } from '/components/Modal.js';
import { Page, Section, Fold, Stack, ListRow, Chip, Action, Menu, Field, Surface, Text, KeyValue, Toolbar } from '/components/poster-parts.js';
import * as orgService from '/js/services/organisms.js';
import * as memoryService from '/js/services/memory.js';
import { fmtDate, orgInitials, exportOrganismZip } from '/views/profile/organisms/helpers.js';
import { IncomingInvitations } from '/views/profile/organisms/panels.js';
import { OrganismHome } from '/views/profile/organisms/home.js';
import { Workspace } from '/views/profile/organisms/workspace.js';
import { swallowed } from '/js/swallowed.js';
import { authHeaders } from '/js/services/auth.js';

/** The padlock beside a non-public organism: an outline that takes the row's own colour. */
const LockMark = html`<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor"
  stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.2" y="7"
  width="9.6" height="7" rx="1.4" /><path d="M5.5 7V5.1a2.5 2.5 0 0 1 5 0V7" /></svg>`;

/** The trail to the organisms list (Settings & Controls / Information / Organisms). */
const listCrumbs = () => [{ label: t('nav.profile') }, { label: t('profile.landing.menuInformation') }, { label: t('organisms.title') || 'Organisms' }];

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
  const [justJoinedOrg, setJustJoinedOrg] = useState(null); // org id from the invite-accept redirect (?joined=1)
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
  const [formTypeCustom, setFormTypeCustom] = useState('');
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
      const res = await fetch('/v1/organisms/import', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/zip' }, body: file });
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
      // ?joined=1 arrives from the invitation-accept redirect: the person just became a member
      // of THIS organism. The welcome banner says whose team they joined and points at the chat
      // connection, because that is their actual next step (UX-remake v3, P8).
      if (org && params.get('joined') === '1') setJustJoinedOrg(org);
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
        type: formType === '__custom' ? (formTypeCustom.trim() || 'community') : formType,
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
  }, [formName, formDesc, formType, formTypeCustom, formPolicy, formVisibility, formInterests, showToast, loadData]);

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
    return html`<${Stack} density="compact">
      <${KeyValue} label=${t('organisms.creator') || 'Creator'} value=${org.creatorGhii} mono=${true} />
      <${KeyValue} label=${t('organisms.memberCount') || 'Members'} value=${`${(org.members || []).length} / ${org.maxMembers || 500}`} />
      <${KeyValue} label=${t('organisms.policyLabel') || 'Join policy'} value=${policyLabel} />
      ${org.createdAt ? html`<${KeyValue} label=${t('organisms.createdAt') || 'Created'} value=${fmtDate(org.createdAt)} />` : null}
      ${(org.interests || []).length > 0 ? html`<${Stack} direction="wrap" density="compact">
        ${org.interests.map(tag => html`<${Chip} key=${tag}>${tag}<//>`)}<//>` : null}
    <//>`;
  };

  // Compact one-line row: initials · name + description · marks (type + lock + archived) ·
  // workspaces/members/agents/date · primary action · "…" menu.
  // Management (settings, leave, delete) lives in the menu / home page.
  const renderOrgRow = (org, isMine) => {
    const isCreator = org.creatorGhii === ghii;
    const isAdmin = org.admins?.includes(ghii);
    const isMember = org.members?.includes(ghii);
    const canEdit = isCreator || isAdmin;
    const typeLabel = tOr(`organisms.types.${org.type}`, org.type);
    const isExpanded = !isMine && expanded === org.id;
    const visLabel = org.visibility === 'private' ? (t('organisms.visPrivate') || 'Private') : (t('organisms.visListed') || 'Listed');
    const openHome = (withSettings) => { setOpenSettings(!!withSettings); setOpenWs(null); setOpenId(org.id); };
    const activate = () => (isMine || isMember) ? openHome(false) : toggleExpand(org.id);

    const menuItems = isMine ? [
      canEdit && { label: t('organisms.settings') || 'Settings', onClick: () => openHome(true) },
      { label: t('organisms.exportOrg') || 'Export organism', onClick: () => exportOrganismZip(org, showToast) },
      canEdit && (org.archived
        ? { label: t('organisms.unarchive') || 'Unarchive', onClick: () => handleArchive(org.id, org.name, false) }
        : { label: t('organisms.archive') || 'Archive', onClick: () => handleArchive(org.id, org.name, true) }),
      !isCreator && { label: t('organisms.leave') || 'Leave', danger: true, onClick: () => handleLeave(org.id, org.name) },
      isCreator && { label: t('organisms.delete') || 'Delete', danger: true, onClick: () => handleDelete(org.id, org.name) },
    ] : [];
    const counts = [
      isMine && wsCounts[org.id] !== undefined ? `${t('organisms.tabWorkspaces') || 'Workspaces'} ${wsCounts[org.id]}` : null,
      `${t('organisms.members') || 'Members'} ${org.member_count ?? (org.members || []).length}`,
      `${t('organisms.attachedAgents') || 'Attached agents'} ${(org.agentGaiis || []).length}`,
      org.createdAt ? fmtDate(org.createdAt) : null,
    ].filter(Boolean).join(' · ');

    // The row is dragged by a plain wrapper, because a list row takes no drag handlers.
    return html`
      <div key=${org.id}
        draggable=${isMine}
        onDragStart=${isMine ? ((e) => { dragIdRef.current = org.id; e.dataTransfer.effectAllowed = 'move'; }) : undefined}
        onDragOver=${isMine ? ((e) => { e.preventDefault(); setDragOverId(org.id); }) : undefined}
        onDragLeave=${isMine ? (() => setDragOverId(d => (d === org.id ? null : d))) : undefined}
        onDrop=${isMine ? (() => onDropRow(org.id)) : undefined}
        onDragEnd=${isMine ? (() => { dragIdRef.current = null; setDragOverId(null); }) : undefined}>
        <${ListRow} density="compact" selected=${dragOverId === org.id || isExpanded} detailKind="text"
          mark=${html`<${Chip}>${orgInitials(org.name)}<//>`}
          name=${org.name} onOpen=${activate} detail=${org.description || undefined}
          value=${counts}
          actions=${html`
            <${Stack} direction="wrap" density="compact" align="center">
              <${Chip} title=${typeLabel}>${typeLabel}<//>
              ${org.visibility !== 'public' ? html`<${Text} kind="caption" title=${visLabel}>${LockMark}<//>` : null}
              ${org.archived ? html`<${Chip} tone="muted" title=${t('organisms.archivedHint') || 'Archived — read-only, hidden from AI operations'}>${t('organisms.archived') || 'archived'}<//>` : null}
            <//>
            ${(isMine || isMember)
              ? html`<${Action} onClick=${() => openHome(false)}>${t('organisms.open') || 'Open'}<//>`
              : html`<${Action} onClick=${() => handleJoin(org.id)}>${t('organisms.join') || 'Join'}<//>`}
            ${isMine ? html`<${Menu} label=${t('organisms.moreActions') || 'More actions'} items=${menuItems} />` : null}`}>
          ${isExpanded ? renderDiscoverDetail(org) : null}
        <//>
      </div>`;
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
      ${justJoinedOrg === openId ? html`
        <${Surface} kind="box" tone="sun">
          <${Stack} direction="wrap" align="between">
            <${Stack} density="compact">
              <${Text} kind="heading">${(tOr('organisms.joinedBanner.title', 'You are now a member of {name}.')).replace('{name}', org.name || '')}<//>
              <${Text}>${tOr('organisms.joinedBanner.body', 'Connect your own AI to this team and you can use everything here straight from the chat you already use.')}<//>
            <//>
            <${Stack} direction="wrap" align="center">
              <${Action} kind="primary" href="/v1/profile?tab=mcp">${tOr('organisms.joinedBanner.connect', 'Connect your AI')}<//>
              <${Action} onClick=${() => setJustJoinedOrg(null)}>${tOr('organisms.joinedBanner.dismiss', 'Browse first')}<//>
            <//>
          <//>
        <//>` : null}
      <${OrganismHome} org=${org} ghii=${ghii} showToast=${showToast}
        initialSettings=${openSettings}
        onOpenWs=${(wsId, space) => { setOpenSpace(space || null); setOpenWs(wsId); }}
        onBack=${() => { setOpenId(null); setOpenSettings(false); loadData(); }}
        onChanged=${loadData}
        onLeave=${() => handleLeave(org.id, org.name)} />
      <${ConfirmUI} />`;
  }

  if (!myOrganisms) return html`<${Page} title=${t('organisms.title') || 'Organisms'} crumbs=${listCrumbs()}>
    <${Text} tone="muted">${t('organisms.loading') || 'Loading organisms...'}<//><//>`;

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

  const onTypeChange = (e) => {
    // The type sets SAFE defaults (UX-remake v3, P12): a team's internal space must
    // not be born open + public because nobody read three unexplained dropdowns.
    // The user can still change both after picking the type.
    const v = e.target.value;
    setFormType(v);
    if (v === 'team' || v === 'cooperative' || v === 'project') {
      setFormPolicy('invite_only');
      setFormVisibility('private');
    } else {
      setFormPolicy('open');
      setFormVisibility('public');
    }
  };
  const createForm = html`
    <${Surface} kind="box">
      <${Stack}>
        <${Text} kind="heading">${t('organisms.createTitle') || 'Create New Organism'}<//>
        <${Field} placeholder=${t('organisms.namePlaceholder') || 'Name'} value=${formName} onInput=${(e) => setFormName(e.target.value)} />
        <${Field} type="textarea" rows=${2} placeholder=${t('organisms.descPlaceholder') || 'Description'} value=${formDesc} onInput=${(e) => setFormDesc(e.target.value)} />
        <${Field} placeholder=${t('organisms.interestsPlaceholder') || 'Interests (comma separated)'} value=${formInterests} onInput=${(e) => setFormInterests(e.target.value)} />
        <${Stack} direction="wrap">
          <${Field} type="select" value=${formType} onChange=${onTypeChange} options=${[
            { value: 'community', label: t('organisms.types.community') || 'Community' },
            { value: 'team', label: t('organisms.types.team') || 'Team' },
            { value: 'club', label: t('organisms.types.club') || 'Club' },
            { value: 'cooperative', label: t('organisms.types.cooperative') || 'Cooperative' },
            { value: 'project', label: t('organisms.types.project') || 'Project' },
            { value: '__custom', label: t('organisms.typeCustom') || 'Other' },
          ]} />
          ${formType === '__custom' ? html`
            <${Field} maxLength=${40} value=${formTypeCustom}
              placeholder=${t('organisms.typeCustomPlaceholder') || 'Type, in your own words'}
              onInput=${(e) => setFormTypeCustom(e.target.value)} />` : null}
          <${Field} type="select" value=${formPolicy} onChange=${(e) => setFormPolicy(e.target.value)} options=${[
            { value: 'open', label: t('organisms.policyOpen') || 'Open (anyone can join)' },
            { value: 'approval_required', label: t('organisms.policyApproval') || 'Approval required' },
            { value: 'invite_only', label: t('organisms.policyInvite') || 'Invite only' },
          ]} />
          <${Field} type="select" value=${formVisibility} onChange=${(e) => setFormVisibility(e.target.value)} options=${[
            { value: 'public', label: t('organisms.visPublic') || 'Public' },
            { value: 'listed', label: t('organisms.visListed') || 'Listed' },
            { value: 'private', label: t('organisms.visPrivate') || 'Private' },
          ]} />
        <//>
        <${Text} kind="caption" tone="muted">
          ${tOr('organisms.policyHint.' + formPolicy, '')}${' '}
          ${tOr('organisms.visHint.' + formVisibility, '')}
        <//>
        <${Stack} direction="wrap" align="center">
          <${Action} kind="primary" onClick=${handleCreate} disabled=${creating}>
            ${creating ? '...' : (t('organisms.create') || 'Create')}
          <//>
          <${Action} onClick=${() => setShowCreate(false)}>${t('organisms.cancel') || 'Cancel'}<//>
        <//>
      <//>
    <//>`;

  const searchResults = () => html`<${Stack}>
    ${gBusy && !gHits.length ? html`<${Text} tone="muted">${t('search.searching') || 'Searching…'}<//>` : null}
    ${!gHits.length && !gBusy ? html`<${Text} tone="muted">${t('search.noMatches') || 'No matches'}<//>` : null}
    ${Object.entries(gGroups).map(([orgId, hits]) => html`
      <${Section} key=${orgId} title=${orgNameOf(orgId)} count=${hits.length} size="small" density="compact">
        ${hits.map(hh => html`<${ListRow} key=${hh.key} density="compact" preview=${true} onOpen=${() => openGHit(hh)}
          name=${html`${hh.title || hh.key}${hh.workspaceId ? ` · ${hh.workspaceId}` : ''}`} detail=${hh.snippet || ''} />`)}
      <//>`)}
  <//>`;

  // Active organisms drive the working list; archived ones move into a folded "Archived"
  // row below (read-only/retired — out of the way, but restorable from there).
  const activeMine = sortedMine.filter(o => !o.archived);
  const archivedMine = sortedMine.filter(o => o.archived);
  const mySection = html`
    <${Section} title=${t('organisms.myOrganisms') || 'My Organisms'} density="compact"
      actions=${myOrganisms.length > 1 ? html`
        <${Field} type="select" label=${t('organisms.sortTitle') || 'Sort'} value=${sortMode}
          onChange=${(e) => { const m = e.target.value; setSortMode(m); savePrefs(customOrder, m); }} options=${[
            { value: 'custom', label: t('organisms.sortCustom') || 'My order' },
            { value: 'name', label: t('organisms.sortName') || 'Name A–Z' },
            { value: 'newest', label: t('organisms.sortNewest') || 'Newest first' },
          ]} />` : null}>
      ${activeMine.length === 0 && archivedMine.length === 0
        ? html`<${Text} tone="muted">${t('organisms.empty') || 'You are not part of any organisms yet.'}<//>`
        : html`
          ${activeMine.length === 0
            ? html`<${Text} tone="muted">${t('organisms.allArchived') || 'All your organisms are archived.'}<//>`
            : html`
              <${Stack} density="compact">${activeMine.map(org => renderOrgRow(org, true))}<//>
              ${sortMode === 'custom' && activeMine.length > 1 ? html`
                <${Text} kind="caption" tone="muted">${t('organisms.reorderHint') || 'Drag rows to reorder — the order is saved to your profile.'}<//>` : null}`}
          ${archivedMine.length > 0 ? html`
            <${Fold} title=${(t('organisms.archivedSection') || 'Archived ({n})').replace('{n}', String(archivedMine.length))}
              open=${archivedOpen} onToggle=${() => setArchivedOpen(o => !o)}>
              <${Stack} density="compact">${archivedMine.map(org => renderOrgRow(org, true))}<//>
            <//>` : null}
        `}
    <//>`;

  return html`<${Page} title=${t('organisms.title') || 'Organisms'} crumbs=${listCrumbs()}
    actions=${html`
      <${Action} disabled=${importingOrg} title=${t('organisms.importOrgHint') || 'Restore an organism from a .zip backup'} onClick=${() => orgFileRef.current && orgFileRef.current.click()}>${t('organisms.importOrg') || 'Import'}<//>
      <${Action} kind="primary" onClick=${() => setShowCreate(true)}>${t('organisms.createNew') || 'Create Organism'}<//>`}>
    <${Stack}>
      <${Text} kind="lead" tone="muted">${t('organisms.desc') || 'Organisms are groups — communities, teams, clubs, or projects. Create one or join existing ones to share knowledge, coordinate work, and build together.'}<//>
      ${showCreate ? createForm : null}
      <${Toolbar} label=${t('search.allOrgsPlaceholder') || 'Search across all organisms'}
        search=${{ label: t('search.allOrgsPlaceholder') || 'Search across all organisms', value: gQuery, onInput: e => setGQuery(e.target.value) }}
        actions=${gHits !== null ? html`<${Action} onClick=${() => setGQuery('')}>${t('search.clear') || 'Clear'}<//>` : null} />
      ${gHits !== null ? searchResults() : html`
        <${IncomingInvitations} showToast=${showToast} onChanged=${loadData} />
        <input type="file" accept=".zip,application/zip" ref=${orgFileRef} hidden onChange=${(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; doImportOrg(f); }} />
        ${mySection}
        ${publicOrganisms.length > 0 && html`
          <${Section} title=${t('organisms.discover') || 'Discover'} density="compact">
            <${Stack} density="compact">${publicOrganisms.map(org => renderOrgRow(org, false))}<//>
          <//>`}
      `}
    <//>
    <${ConfirmUI} />
  <//>`;
}
