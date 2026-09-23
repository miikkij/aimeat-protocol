/**
 * @file workspace-list.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Workspace list for an organism — an organism contains many independent workspaces.
 *   Lists discovered workspaces (with this user's access status + per-row enrichment), supports
 *   create / open / delete / request-access / export / import, an access-request inbox and an
 *   inline participants list, plus a (hidden-by-default) organism dependency map. Extracted from
 *   organisms-tab.js, no behaviour change.
 * @structure WorkspaceList
 * @usage import { WorkspaceList } from '/views/profile/organisms/workspace-list.js';
 * @version-history
 *   v1.2.0 -- 2026-09-22 -- Composed from the shared set (ListRow, Menu, Field, Fold, Chip): no class of
 *     its own; the emoji marks are gone (the participants count is a worded toggle), the archived list is a Fold.
 *   v1.1.0 -- 2026-09-13 -- Compose list and guide rules from poster.css; retire unused list rules.
 *   v1.0.1 — 2026-08-29 — The description line above the bar is gone: the organism home's Workspaces
 *     section carries it under the list, where it reads as a note rather than a preface.
 *   v1.0.0 — 2026-06-19 — Extracted from organisms-tab.js during the module split; the hidden file
 *     input uses the .pj-hidden-input class instead of an inline style (Rule 8).
 *   v1.1.0 — 2026-06-22 — Kill the per-workspace fetch storm: one discoverWorkspaces({include:'enrichment'})
 *     replaces the 1 + 3N (getWorkspace+activity+participants) fan-out; pending-review counts come inline;
 *     the 'organisms' live refresh is debounced (1.5s) so an agent-driven event burst is one reload.
 *   v1.2.0 — 2026-06-26 — Archive/unarchive a workspace (creator/admin) via the kebab menu + an
 *     "archived" badge; archived workspaces are read-only and hidden from AI materials.
 *   v1.3.0 — 2026-07-05 — Per-user manual ordering of the active workspace list: drag rows to
 *     reorder + a sort control (My order / Name / Newest), mirroring the organisms list. The order
 *     is a private per-user preference stored in owner memory (organisms.ws.{orgId}); no server
 *     change. Archived workspaces are not reorderable.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef, useMemo } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { useConfirm } from '/components/Modal.js';
import { Stack, ListRow, Chip, Action, Menu, Field, Fold, Surface, Text } from '/components/poster-parts.js';
import { Mermaid } from '/components/Mermaid.js';
import * as orgService from '/js/services/organisms.js';
import * as memoryService from '/js/services/memory.js';
import { fmtDate, relTime } from '/views/profile/organisms/helpers.js';
import { OrgSearch } from '/views/profile/organisms/panels.js';
import { swallowed } from '/js/swallowed.js';
import { authHeaders } from '/js/services/auth.js';

/* Workspace list — an organism contains many workspaces (each an independent manifest + data set,
 * namespaced under organism.{id}.w.{wsId}.*). Lists the registry (organism.{id}.meta.workspaces),
 * lets the user create a new one (→ opens its setup/generate screen) or open/delete an existing one.
 * Rendered embedded in OrganismHome's Workspaces tab (the back/export topbar + organism title
 * moved to the home header). onCount reports the discovered workspace count for the tab badge. */
export function WorkspaceList({ org, showToast, onOpen, onCount }) {
  const orgId = org.id;
  const { confirm, ConfirmUI } = useConfirm();
  const [list, setList] = useState(null);   // null = loading
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [overview, setOverview] = useState('');           // organism dependency-overview chart (mermaid)
  const [showOverview, setShowOverview] = useState(false); // map hidden by default — the list is the content
  const [openReqWs, setOpenReqWs] = useState(null);       // which owned workspace's request-inbox is open
  const [reqInbox, setReqInbox] = useState([]);           // access requests for openReqWs
  const [openPeopleWs, setOpenPeopleWs] = useState(null); // which workspace's inline participants list is open
  const [archivedOpen, setArchivedOpen] = useState(false); // collapsible "Archived workspaces" section
  const [wsStats, setWsStats] = useState({});             // wsId → { recs, docs, lastEv, hasManifest }
  const [apprByWs, setApprByWs] = useState({});           // wsId → pending review count

  // ── Per-user manual ordering (mirrors the organisms list) ──────────────────────────────────────
  // The active workspace order is a private, per-user preference — NOT organism content — so it lives
  // in the owner's own memory under a per-organism key. Only this user sees their order; no server or
  // consent change. Archived workspaces are excluded from ordering (they collapse into their own list).
  const UI_PREFS_KEY = `organisms.ws.${orgId}`;
  const [customOrder, setCustomOrder] = useState([]);     // wsIds in the user's manual order
  const [sortMode, setSortMode] = useState('custom');     // 'custom' | 'name' | 'newest'
  const [dragOverId, setDragOverId] = useState(null);
  const dragIdRef = useRef(null);
  // Load saved order/sort for THIS organism; reset first so switching organisms never carries prefs over.
  useEffect(() => {
    let alive = true;
    setCustomOrder([]); setSortMode('custom');
    (async () => {
      try {
        const r = await memoryService.getMemory(UI_PREFS_KEY, { soft: true });
        const v = r?.data?.value;
        if (alive && v && typeof v === 'object') {
          if (Array.isArray(v.order)) setCustomOrder(v.order.filter(x => typeof x === 'string'));
          if (['custom', 'name', 'newest'].includes(v.sort)) setSortMode(v.sort);
        }
      } catch (err) { swallowed('workspace-list: WorkspaceList', err); }
    })();
    return () => { alive = false; };
  }, [UI_PREFS_KEY]);
  const savePrefs = useCallback((order, sort) => {
    memoryService.createMemory(UI_PREFS_KEY, { order, sort }, 'private').catch(err => { swallowed('workspace-list: WorkspaceList', err); });
  }, [UI_PREFS_KEY]);

  // Active workspaces sorted for display; archived ones stay in server order in their own section.
  // Stable sort keeps server order for ids missing from the saved manual order (appended at the end).
  const activeSorted = useMemo(() => {
    const arr = (list || []).filter(w => !w.archived);
    if (sortMode === 'name') arr.sort((a, b) => (a.name || a.id || '').localeCompare(b.name || b.id || '', undefined, { sensitivity: 'base' }));
    else if (sortMode === 'newest') arr.sort((a, b) => +new Date(b.created_at || 0) - +new Date(a.created_at || 0));
    else if (customOrder.length) {
      const pos = new Map(customOrder.map((id, i) => [id, i]));
      arr.sort((a, b) => (pos.has(a.id) ? pos.get(a.id) : Infinity) - (pos.has(b.id) ? pos.get(b.id) : Infinity));
    }
    return arr;
  }, [list, sortMode, customOrder]);
  const archivedList = useMemo(() => (list || []).filter(w => w.archived), [list]);

  // Drop on a row: move the dragged workspace to the target's position; switch to manual order and save.
  const onDropRow = (targetId) => {
    const fromId = dragIdRef.current;
    dragIdRef.current = null;
    setDragOverId(null);
    if (!fromId || fromId === targetId) return;
    const ids = activeSorted.map(w => w.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setCustomOrder(ids);
    setSortMode('custom');
    savePrefs(ids, 'custom');
  };

  // Discovery: every workspace in the org (membership-gated) with this user's access status. A member
  // sees workspaces they can't yet read (access:'none') so they can request access. Row enrichment
  // (record/doc counts, last event, review counter) loads per workspace afterwards, best effort.
  // ONE enriched request replaces the old discover + per-row getWorkspace+activity+participants
  // fan-out (1 + 3N requests, each re-scanning the same workspace memory). The server computes the
  // same recs/docs/lastEvent/participants + pending-review counts and returns them inline.
  const load = useCallback(async () => {
    const l = await orgService.discoverWorkspaces(orgId, { include: 'enrichment' });
    setList(l);
    onCount?.(Array.isArray(l) ? l.length : 0);
    const stats = {};
    const reviews = {};
    for (const w of (l || [])) {
      const e = w.enrichment;
      if (w.access === 'none' || !e) continue;
      if (e.pendingReviews) reviews[w.id] = e.pendingReviews;
      stats[w.id] = {
        recs: e.recs || 0,
        docs: e.docs || 0,
        lastEv: e.lastEvent || null,
        hasManifest: !!e.hasManifest,
        // UI only reads owners[].length and per-owner {owner,isCreator,isSelf,isLocalNode,agents.length}.
        owners: (e.participants || []).map(p => ({
          owner: p.owner, node: p.node, isLocalNode: p.isLocalNode,
          isCreator: p.isCreator, isSelf: p.isSelf, agents: new Array(p.agentsCount || 0),
        })),
      };
    }
    setWsStats(stats);
    setApprByWs(reviews);
  }, [orgId, onCount]);
  useEffect(() => { load(); }, [load]);

  const requestAccess = async (w) => {
    setBusy(true);
    try { await orgService.requestWorkspaceAccess(orgId, w.id); showToast((t('organisms.accessRequested') || 'Access requested — {creator} will decide.').replace('{creator}', w.created_by || '')); }
    catch (e) { showToast((e && e.message) || 'Failed to request access'); }
    finally { setBusy(false); }
  };
  const toggleInbox = async (w) => {
    if (openReqWs === w.id) { setOpenReqWs(null); return; }
    setOpenReqWs(w.id); setReqInbox(await orgService.listWorkspaceRequests(orgId, w.id));
  };
  const decide = async (w, requester, decision) => {
    setBusy(true);
    try { await orgService.decideWorkspaceAccess(orgId, w.id, requester, decision); setReqInbox(await orgService.listWorkspaceRequests(orgId, w.id)); }
    catch (e) { showToast((e && e.message) || 'Failed'); }
    finally { setBusy(false); }
  };
  // Rebuild the overview (deterministic — aggregates members, agents, workspaces + their structure,
  // and knowledge packages) ONLY when the map is actually shown. The map is hidden by default, so
  // building it eagerly on every workspace-list change was a multi-request "build" storm for a chart
  // nobody was looking at.
  useEffect(() => {
    if (!showOverview) return;
    let cancelled = false;
    orgService.buildOrganismOverviewMermaid(orgId).then(c => { if (!cancelled) setOverview(c); }).catch(err => { swallowed('workspace-list: decide', err); });
    return () => { cancelled = true; };
  }, [orgId, list, showOverview]);
  // Re-load on organism changes, but DEBOUNCE: on a busy node dozens of agents emit 'organisms'
  // events ~1/sec; a trailing debounce collapses a burst into one reload (the load is now a single
  // cheap request). `onLiveUpdate` reads the Set-typed domains correctly — never via e.detail directly.
  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => {
    let timer = null;
    const off = onLiveUpdate(['organisms'], () => { clearTimeout(timer); timer = setTimeout(() => liveRef.current(), 1500); });
    return () => { clearTimeout(timer); off(); };
  }, []);

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const entry = await orgService.createWorkspace(orgId, name);
      setNewName(''); setCreating(false);
      onOpen(entry.id);   // open the new (empty) workspace → its setup / generate screen
    } catch (e) { showToast((e && e.message) || 'Failed to create workspace'); }
    finally { setBusy(false); }
  };

  const remove = (wsId, name) => {
    confirm(
      (t('organisms.deleteWorkspaceConfirm') || 'Delete the workspace “{name}” and all its content? This cannot be undone.').replace('{name}', name),
      async () => {
        setBusy(true);
        try { await orgService.deleteWorkspace(orgId, wsId); await load(); showToast(t('organisms.workspaceDeleted') || 'Workspace deleted'); }
        catch (e) { showToast((e && e.message) || 'Failed to delete'); }
        finally { setBusy(false); }
      },
      { danger: true, title: t('organisms.deleteWorkspace') || 'Delete workspace' },
    );
  };

  // Archive / unarchive a whole workspace (creator/admin). Archived workspaces become read-only and
  // drop out of AI materials (overview/read/search) but stay searchable in the archive + restorable.
  const setArchived = async (w, archived) => {
    setBusy(true);
    try {
      const target = { level: 'workspace', ws: w.id };
      if (archived) await orgService.archiveContent(orgId, target); else await orgService.unarchiveContent(orgId, target);
      await load();
      showToast(archived ? (t('organisms.workspaceArchived') || 'Workspace archived') : (t('organisms.workspaceUnarchived') || 'Workspace restored'));
    } catch (e) { showToast((e && e.message) || 'Failed'); }
    finally { setBusy(false); }
  };

  // ── Export (download ZIP backup) + Import (upload a ZIP as a new workspace) ──
  const fileRef = useRef(null);
  const doExport = async (w) => {
    try {
      const res = await fetch(`/v1/organisms/${encodeURIComponent(orgId)}/workspace/export?ws=${encodeURIComponent(w.id)}`, { headers: authHeaders() });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `workspace-${String(w.name || w.id).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40)}.zip`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { showToast((e && e.message) || 'Export failed'); }
  };
  const doImport = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await fetch(`/v1/organisms/${encodeURIComponent(orgId)}/workspace/import`, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/zip' }, body: file });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message || 'Import failed');
      showToast(t('organisms.imported') || 'Workspace imported');
      await load();
      if (body.data?.ws) onOpen(body.data.ws);
    } catch (e) { showToast((e && e.message) || 'Import failed'); }
    finally { setBusy(false); }
  };
  // One enriched meta line per row: "{n} records · {n} docs · last: goal/x published 2 h ago".
  const metaLine = (w) => {
    const s = wsStats[w.id];
    if (!s) return w.access === 'owner' ? (t('organisms.yours') || 'yours') : (t('organisms.byCreator') || 'by {creator}').replace('{creator}', w.created_by || '?');
    if (!s.hasManifest) return t('organisms.wsNotSetUp') || 'new — set up when opened';
    const parts = [
      s.recs === 1 ? (t('organisms.recOne') || '1 record') : (t('organisms.recMany') || '{n} records').replace('{n}', String(s.recs)),
      s.docs === 1 ? (t('organisms.docOne') || '1 document') : (t('organisms.docMany') || '{n} documents').replace('{n}', String(s.docs)),
    ];
    if (s.lastEv) {
      const verb = s.lastEv.action === 'publish' ? (t('organisms.publishedVerb') || 'published') : (t('organisms.editedVerb') || 'edited');
      parts.push(`${t('organisms.lastLabel') || 'last:'} ${s.lastEv.type}/${s.lastEv.instance} ${verb} ${relTime(s.lastEv.at)}`);
    } else parts.push(t('organisms.noActivityYet') || 'no activity yet');
    return parts.join(' · ');
  };

  const sortField = activeSorted.length > 1 ? html`
    <${Field} type="select" label=${t('organisms.sortTitle') || 'Sort'} value=${sortMode}
      onChange=${(e) => { const m = e.target.value; setSortMode(m); savePrefs(customOrder, m); }} options=${[
        { value: 'custom', label: t('organisms.sortCustom') || 'My order' },
        { value: 'name', label: t('organisms.sortName') || 'Name A–Z' },
        { value: 'newest', label: t('organisms.sortNewest') || 'Newest first' },
      ]} />` : null;

  const renderWsRow = (w, canDrag) => {
    const locked = w.access === 'none';
    const reviews = apprByWs[w.id] || 0;
    const owners = wsStats[w.id]?.owners || [];
    const menuItems = w.access === 'owner' ? [
      { label: t('organisms.requests') || 'Access requests', onClick: () => toggleInbox(w) },
      { label: t('organisms.export') || 'Export backup (.zip)', onClick: () => doExport(w) },
      w.archived
        ? { label: t('organisms.unarchive') || 'Unarchive', onClick: () => setArchived(w, false) }
        : { label: t('organisms.archive') || 'Archive', onClick: () => setArchived(w, true) },
      { label: t('organisms.delete') || 'Delete', danger: true, onClick: () => remove(w.id, w.name || w.id) },
    ] : [];
    // The row is dragged by a plain wrapper, because a list row takes no drag handlers.
    return html`
      <div key=${w.id}
        draggable=${canDrag}
        onDragStart=${canDrag ? ((e) => { dragIdRef.current = w.id; e.dataTransfer.effectAllowed = 'move'; }) : undefined}
        onDragOver=${canDrag ? ((e) => { e.preventDefault(); setDragOverId(w.id); }) : undefined}
        onDragLeave=${canDrag ? (() => setDragOverId(d => (d === w.id ? null : d))) : undefined}
        onDrop=${canDrag ? (() => onDropRow(w.id)) : undefined}
        onDragEnd=${canDrag ? (() => { dragIdRef.current = null; setDragOverId(null); }) : undefined}>
        <${ListRow} density="compact" selected=${dragOverId === w.id} detailKind="text"
          name=${w.name || w.id} onOpen=${locked ? undefined : (() => onOpen(w.id))}
          detail=${locked ? (t('organisms.byCreator') || 'by {creator}').replace('{creator}', w.created_by || '?') : metaLine(w)}
          value=${w.created_at ? fmtDate(w.created_at) : undefined}
          actions=${html`
            ${w.archived ? html`<${Chip} tone="muted" title=${t('organisms.archivedHint') || 'Archived — read-only, hidden from AI operations'}>${t('organisms.archived') || 'archived'}<//>` : null}
            ${reviews > 0 ? html`<${Chip} tone="sun">${(t('organisms.toReview') || '{n} to review').replace('{n}', String(reviews))}<//>` : null}
            ${owners.length > 0 ? html`<${Action} kind="tab" selected=${openPeopleWs === w.id} expanded=${openPeopleWs === w.id}
              onClick=${(e) => { e.stopPropagation(); setOpenPeopleWs(p => (p === w.id ? null : w.id)); }}>${t('organisms.participants') || 'Who works here'} ${owners.length}<//>` : null}
            ${locked
              ? html`<${Action} disabled=${busy} onClick=${() => requestAccess(w)}>${t('organisms.requestAccess') || 'Request access'}<//>`
              : html`<${Action} onClick=${() => onOpen(w.id)}>${t('organisms.open') || 'Open'}<//>`}
            ${menuItems.length ? html`<${Menu} label=${t('organisms.moreActions') || 'More actions'} items=${menuItems} />` : null}`}>
          ${openPeopleWs === w.id ? html`<${Stack} density="compact">
            ${owners.map(o => html`<${ListRow} key=${'p-' + o.owner} density="compact" name=${o.owner}
              detail=${!o.isLocalNode ? o.node : undefined}
              value=${(o.agents || []).length > 0 ? `${t('organisms.attachedAgents') || 'Attached agents'} ${(o.agents || []).length}` : undefined}
              actions=${o.isCreator || o.isSelf ? html`
                ${o.isCreator ? html`<${Chip} tone="sun">${t('organisms.creatorTag') || 'creator'}<//>` : null}
                ${o.isSelf ? html`<${Chip}>${t('organisms.you') || 'you'}<//>` : null}` : undefined} />`)}
          <//>` : null}
          ${openReqWs === w.id ? html`<${Stack} density="compact">
            ${reqInbox.length === 0 ? html`<${Text} kind="caption" tone="muted">${t('organisms.noRequests') || 'No access requests.'}<//>`
              : reqInbox.map(r => html`<${ListRow} key=${r.requester} density="compact" name=${r.requester}
                  detail=${r.message ? `— ${r.message}` : undefined} detailKind="text"
                  actions=${r.status === 'approved'
                    ? html`<${Text} kind="caption" tone="success">✓ ${t('organisms.approved') || 'approved'}<//><${Action} disabled=${busy} onClick=${() => decide(w, r.requester, 'deny')}>${t('organisms.revoke') || 'Revoke'}<//>`
                    : html`<${Action} disabled=${busy} onClick=${() => decide(w, r.requester, 'approve')}>${t('organisms.approve') || 'Approve'}<//><${Action} disabled=${busy} onClick=${() => decide(w, r.requester, 'deny')}>${t('organisms.deny') || 'Deny'}<//>`} />`)}
          <//>` : null}
        <//>
      </div>`;
  };

  return html`<${Stack}>
    <${ConfirmUI} />
    <input type="file" accept=".zip,application/zip" ref=${fileRef} hidden onChange=${(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; doImport(f); }} />

    <${Stack} direction="wrap" align="end">
      ${creating ? html`
        <${Field} placeholder=${t('organisms.workspaceName') || 'Workspace name'} inputRef=${focusOnce}
          value=${newName} onInput=${e => setNewName(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') create(); }} />
        <${Action} kind="primary" onClick=${create} disabled=${busy || !newName.trim()}>${t('organisms.create') || 'Create'}<//>
        <${Action} onClick=${() => { setCreating(false); setNewName(''); }}>${t('organisms.cancel') || 'Cancel'}<//>
      ` : html`
        <${Action} onClick=${() => setCreating(true)}>${t('organisms.newWorkspace') || 'New workspace'}<//>
        <${Action} disabled=${busy} title=${t('organisms.importHint') || 'Restore a workspace from a .zip backup'} onClick=${() => fileRef.current && fileRef.current.click()}>${t('organisms.import') || 'Import'}<//>
        ${overview ? html`<${Action} kind="tab" selected=${showOverview} onClick=${() => setShowOverview(s => !s)}>${t('organisms.showMap') || 'Map'}<//>` : null}
        ${sortField}`}
    <//>

    <${OrgSearch} orgId=${orgId} onOpenWorkspace=${(ws) => onOpen(ws)} />

    ${list === null ? html`<${Text} tone="muted">${t('profile.loading')}<//>`
      : list.length === 0 ? html`<${Text} tone="muted">${t('organisms.noWorkspaces') || 'No workspaces yet — create one to get started.'}<//>`
      : html`
        <${Stack} density="compact">${activeSorted.map(w => renderWsRow(w, true))}<//>
        ${sortMode === 'custom' && activeSorted.length > 1 ? html`
          <${Text} kind="caption" tone="muted">${t('organisms.reorderHint') || 'Drag rows to reorder — the order is saved to your profile.'}<//>` : null}
        ${archivedList.length > 0 ? html`
          <${Fold} title=${(t('organisms.archivedWorkspacesSection') || 'Archived workspaces ({n})').replace('{n}', String(archivedList.length))}
            open=${archivedOpen} onToggle=${() => setArchivedOpen(o => !o)}>
            <${Stack} density="compact">${archivedList.map(w => renderWsRow(w, false))}<//>
          <//>` : null}`}

    ${overview && showOverview ? html`
      <${Surface} kind="box">
        <${Stack}>
          <${Stack} direction="horizontal" align="between">
            <${Text} kind="label">${t('organisms.overview') || 'Overview — who & what uses this organism'}<//>
            <${Action} onClick=${() => setShowOverview(false)}>${t('organisms.hide') || 'Hide'}<//>
          <//>
          <${Mermaid} chart=${overview} />
        <//>
      <//>` : null}
  <//>`;
}

/** The name field takes the focus once, when it opens (the old input's autofocus). */
const focusOnce = (el) => { if (el && !el.dataset.focused) { el.dataset.focused = 'yes'; el.focus(); } };
