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
 *   v1.17.1 -- 2026-09-26 -- A workspace's creator tag is green again, as main drew it
 *     (.badge-success: Mark tone="fine"; fix pass).
 *   v1.17.0 -- 2026-09-26 -- Every part is a library component that takes data: the workspaces are the
 *     List (mark-name-tags-stats-doors, the organisms list's cut): the 🗂 mark, the name as the door
 *     in (Enter too) with its meta line and its states after it, the lock in the tags column, the
 *     "who works here" counter as the pressed fold Tab and the date in the counts, Open or Request
 *     access and the ⋯ menu in the doors, drag to reorder on the Row; who works here and the access
 *     requests open in the row's Panel as dense Lists. The bar is a Layout row of the Text field,
 *     the loud action, the action links and the sort Select; the import's file field is FileDrop's
 *     hidden one; the map is the Object box. The ⋮ menu is the ⋯ CardMenu (Escape closes it too).
 *     The page writes no class (page migration G2b).
 *   v1.16.0 -- 2026-09-26 -- The line under a workspace's name is the Listing's typewriter line (.listing-meta), a unification: Jouni's decision "Meta line".
 *   v1.15.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.14.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.13.0 -- 2026-09-26 -- The archived workspaces open under the FoldSection (components/FoldSection.js), a unification: the look most tabs use.
 *   v1.12.0 -- 2026-09-26 -- The "who works here" counter shows the people panel and stays pressed while it shows: the Tab's fold tone (.poster-tab--fold, .is-on, aria-pressed), a unification: Jouni's decision "Tabs and filters".
 *   v1.11.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.10.0 -- 2026-09-25 -- "Map" (it shows the workspaces' map) is the action link (.poster-action); aria-expanded says it is open (a unification: Jouni's decision "Action link").
 *   v1.9.0 -- 2026-09-25 -- A workspace's "archived" and "N to review", and an approved join request, are the Status (.poster-status: off, attention, fine), a unification: Jouni's decision "Status".
 *   v1.8.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.8.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.7.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.6.0 -- 2026-09-25 -- A picture of a person or a thing is the Object box's avatar cut (.poster-box--avatar), the look most Settings tabs draw (UI consolidation phase 5, a unification).
 *   v1.5.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.4.0 -- 2026-09-25 -- Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v1.3.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.2.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
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
 *   v1.4.0 — 2026-09-25 — Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef, useMemo } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { useConfirm } from '/components/Modal.js';
import { FoldSection } from '/components/FoldSection.js';
import { Mermaid } from '/components/Mermaid.js';
import { Box } from '/components/Box.js';
import { Action, Loud } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Tab } from '/components/Tabs.js';
import { TextField } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { FileDrop } from '/components/FileDrop.js';
import { Row as Line } from '/components/Layout.js';
import { List, Row, Name, Cell, Lead, Stats, Stat, Doors } from '/components/List.js';
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

  // Who works in a workspace: one line per person, with their marks.
  const peopleList = (w) => html`
    <${List} cols="name" dense>
      ${(wsStats[w.id]?.owners || []).map(o => html`
        <${Row} key=${'p-' + o.owner}>
          <${Name} tag=${[
            o.isCreator ? html`<${Mark} key="c" tone="fine">${t('organisms.creatorTag') || 'creator'}<//>` : null,
            o.isSelf ? html`<${Mark} key="y" tone="sun">${t('organisms.you') || 'you'}<//>` : null,
          ]} after=${html`${!o.isLocalNode ? html` <${Note} kind="meta" inline>${'🌐 '}${(o.node)}<//>` : null}${(o.agents || []).length > 0 ? html` <${Note} kind="meta" inline>${'🤖'} ${(o.agents || []).length}<//>` : null}`}>${'👤 '}${(o.owner)}<//>
        <//>`)}
    <//>`;
  // The access requests of a workspace the reader owns, each with its answer.
  const requestList = (w) => html`
    <${List} cols="name-doors" dense empty=${t('organisms.noRequests') || 'No access requests.'}>
      ${reqInbox.map(r => html`
        <${Row} key=${r.requester}>
          <${Name} desc=${r.message ? '— ' + r.message : undefined}>${(r.requester)}<//>
          <${Doors}>${r.status === 'approved'
            ? html`<${Mark} kind="status" tone="fine">✓ ${t('organisms.approved') || 'approved'}<//><${Action} small disabled=${busy} onClick=${() => decide(w, r.requester, 'deny')}>${t('organisms.revoke') || 'Revoke'}<//>`
            : html`<${Action} small disabled=${busy} onClick=${() => decide(w, r.requester, 'approve')}>${t('organisms.approve') || 'Approve'}<//><${Action} small disabled=${busy} onClick=${() => decide(w, r.requester, 'deny')}>${t('organisms.deny') || 'Deny'}<//>`}<//>
        <//>`)}
    <//>`;

  const renderWsRow = (w, canDrag) => {
    const locked = w.access === 'none';
    const reviews = apprByWs[w.id] || 0;
    const people = (wsStats[w.id]?.owners || []).length;
    const peopleOpen = openPeopleWs === w.id;
    const reqOpen = openReqWs === w.id;
    const menuItems = w.access === 'owner' ? [
      { label: t('organisms.requests') || 'Access requests', icon: '👥', onClick: () => toggleInbox(w) },
      { label: t('organisms.export') || 'Export backup (.zip)', icon: '⬇', onClick: () => doExport(w) },
      w.archived
        ? { label: t('organisms.unarchive') || 'Unarchive', icon: '♻️', onClick: () => setArchived(w, false) }
        : { label: t('organisms.archive') || 'Archive', icon: '🗄️', onClick: () => setArchived(w, true) },
      { label: t('organisms.delete') || 'Delete', danger: true, onClick: () => remove(w.id, w.name || w.id) },
    ] : [];
    return html`
      <${Row} key=${w.id} draggable=${canDrag} dragOver=${dragOverId === w.id}
        onDragStart=${canDrag ? ((e) => { dragIdRef.current = w.id; e.dataTransfer.effectAllowed = 'move'; }) : undefined}
        onDragOver=${canDrag ? ((e) => { e.preventDefault(); setDragOverId(w.id); }) : undefined}
        onDragLeave=${canDrag ? (() => setDragOverId(d => (d === w.id ? null : d))) : undefined}
        onDrop=${canDrag ? (() => onDropRow(w.id)) : undefined}
        onDragEnd=${canDrag ? (() => { dragIdRef.current = null; setDragOverId(null); }) : undefined}
        open=${peopleOpen || reqOpen} panel=${html`${peopleOpen ? peopleList(w) : null}${reqOpen ? requestList(w) : null}`}>
        <${Lead} text=${'🗂'} />
        <${Name} onOpen=${locked ? undefined : () => onOpen(w.id)}
          after=${html`${w.archived ? html` <${Mark} kind="status" tone="off" title=${t('organisms.archivedHint') || 'Archived — read-only, hidden from AI operations'}>${'🗄️ '}${t('organisms.archived') || 'archived'}<//>` : null}${reviews > 0 ? html` <${Mark} kind="status" tone="attention">${'📨 '}${(t('organisms.toReview') || '{n} to review').replace('{n}', String(reviews))}<//>` : null}`}
          meta=${locked ? (t('organisms.byCreator') || 'by {creator}').replace('{creator}', w.created_by || '?') : metaLine(w)}>${(w.name || w.id)}<//>
        <${Cell} line>${locked ? html`<span>${'🔒'}</span>` : null}<//>
        <${Stats}>
          ${people > 0 ? html`<${Stat}><${Tab} tone="fold" on=${peopleOpen} pressed=${peopleOpen} title=${t('organisms.participants') || 'Who works here'}
            onClick=${(e) => { e.stopPropagation(); setOpenPeopleWs(p => (p === w.id ? null : w.id)); }}>${'👥'} ${people}<//><//>` : html`<${Stat} />`}
          ${w.created_at ? html`<${Stat} date title=${t('organisms.createdAt') || 'Created'}>${fmtDate(w.created_at)}<//>` : null}
        <//>
        <${Doors} menu=${menuItems.length ? menuItems : null} menuLabel=${t('organisms.moreActions') || 'More actions'}>
          ${locked
            ? html`<${Action} small disabled=${busy} onClick=${() => requestAccess(w)}>${t('organisms.requestAccess') || 'Request access'}<//>`
            : html`<${Action} small onClick=${() => onOpen(w.id)}>${t('organisms.open') || 'Open'}<//>`}
        <//>
      <//>`;
  };

  const importWords = t('organisms.importHint') || 'Restore a workspace from a .zip backup';
  return html`
    <div>
      <${ConfirmUI} />
      <${FileDrop} hidden accept=".zip,application/zip" inputRef=${fileRef} onFiles=${([f]) => doImport(f)} />

      <${Line} wrap below="medium">
        ${creating ? html`
          <${TextField} size="medium" autoFocus placeholder=${t('organisms.workspaceName') || 'Workspace name'} ariaLabel=${t('organisms.workspaceName') || 'Workspace name'}
            value=${newName} onInput=${setNewName} onEnter=${create} />
          <${Loud} control onClick=${create} disabled=${busy || !newName.trim()}>${t('organisms.create') || 'Create'}<//>
          <${Action} small onClick=${() => { setCreating(false); setNewName(''); }}>${t('organisms.cancel') || 'Cancel'}<//>
        ` : html`
          <${Loud} control onClick=${() => setCreating(true)}>${'+ '}${t('organisms.newWorkspace') || 'New workspace'}<//>
          <${Action} small disabled=${busy} title=${importWords} onClick=${() => fileRef.current && fileRef.current.click()}>${'⬆ '}${t('organisms.import') || 'Import'}<//>
          ${overview ? html`<${Action} small expanded=${showOverview} onClick=${() => setShowOverview(s => !s)}>${'🗺 '}${t('organisms.showMap') || 'Map'}<//>` : null}
          ${activeSorted.length > 1 ? html`
            <${Select} fit title=${t('organisms.sortTitle') || 'Sort'} ariaLabel=${t('organisms.sortTitle') || 'Sort'} value=${sortMode}
              onChange=${(m) => { setSortMode(m); savePrefs(customOrder, m); }}
              options=${[['custom', t('organisms.sortCustom') || 'My order'], ['name', t('organisms.sortName') || 'Name A–Z'], ['newest', t('organisms.sortNewest') || 'Newest first']]} />` : null}`}
      <//>

      <${OrgSearch} orgId=${orgId} onOpenWorkspace=${(ws) => onOpen(ws)} />

      ${list === null ? html`<${Note} kind="loading" />`
        : list.length === 0 ? html`<${Note} kind="quiet">${t('organisms.noWorkspaces') || 'No workspaces yet — create one to get started.'}<//>`
        : html`
          <${List} cols="mark-name-tags-stats-doors" keepCols>${activeSorted.map(w => renderWsRow(w, true))}<//>
          ${sortMode === 'custom' && activeSorted.length > 1 ? html`
            <${Note}>${t('organisms.reorderHint') || 'Drag rows to reorder — the order is saved to your profile.'}<//>` : null}
          ${archivedList.length > 0 ? html`
            <${FoldSection} num="" title=${'🗄️ ' + (t('organisms.archivedWorkspacesSection') || 'Archived workspaces ({n})').replace('{n}', String(archivedList.length))} open=${archivedOpen} onToggle=${() => setArchivedOpen(o => !o)}>
              <${List} cols="mark-name-tags-stats-doors" keepCols>${archivedList.map(w => renderWsRow(w, false))}<//>
            <//>` : null}`}

      ${overview && showOverview ? html`
        <${Box} name=${'🔗 ' + (t('organisms.overview') || 'Overview — who & what uses this organism')}
          end=${html`<${Action} small onClick=${() => setShowOverview(false)}>${t('organisms.hide') || 'Hide'}<//>`}>
          <${Mermaid} chart=${overview} />
        <//>` : null}
    </div>`;
}
