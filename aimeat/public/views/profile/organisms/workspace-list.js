/**
 * @file workspace-list.js
 * @description Workspace list for an organism — an organism contains many independent workspaces.
 *   Lists discovered workspaces (with this user's access status + per-row enrichment), supports
 *   create / open / delete / request-access / export / import, an access-request inbox and an
 *   inline participants list, plus a (hidden-by-default) organism dependency map. Extracted from
 *   organisms-tab.js, no behaviour change.
 * @structure WorkspaceList
 * @usage import { WorkspaceList } from '/views/profile/organisms/workspace-list.js';
 * @version-history
 *   v1.0.0 — 2026-06-19 — Extracted from organisms-tab.js during the module split; the hidden file
 *     input uses the .pj-hidden-input class instead of an inline style (Rule 8).
 *   v1.1.0 — 2026-06-22 — Kill the per-workspace fetch storm: one discoverWorkspaces({include:'enrichment'})
 *     replaces the 1 + 3N (getWorkspace+activity+participants) fan-out; pending-review counts come inline;
 *     the 'organisms' live refresh is debounced (1.5s) so an agent-driven event burst is one reload.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Spinner, KebabMenu } from '/views/profile/shared.js';
import { useConfirm } from '/components/Modal.js';
import { EmptyState } from '/components/EmptyState.js';
import { Mermaid } from '/components/Mermaid.js';
import * as orgService from '/js/services/organisms.js';
import { fmtDate, relTime } from '/views/profile/organisms/helpers.js';
import { OrgSearch } from '/views/profile/organisms/panels.js';

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
  const [wsStats, setWsStats] = useState({});             // wsId → { recs, docs, lastEv, hasManifest }
  const [apprByWs, setApprByWs] = useState({});           // wsId → pending review count

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
    orgService.buildOrganismOverviewMermaid(orgId).then(c => { if (!cancelled) setOverview(c); }).catch(() => {});
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

  // ── Export (download ZIP backup) + Import (upload a ZIP as a new workspace) ──
  const jwt = () => { try { return window.AIMEAT?.auth?.getSession?.()?.jwt || ''; } catch { return ''; } };
  const fileRef = useRef(null);
  const doExport = async (w) => {
    try {
      const res = await fetch(`/v1/organisms/${encodeURIComponent(orgId)}/workspace/export?ws=${encodeURIComponent(w.id)}`, { headers: { Authorization: 'Bearer ' + jwt() } });
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
      const res = await fetch(`/v1/organisms/${encodeURIComponent(orgId)}/workspace/import`, { method: 'POST', headers: { Authorization: 'Bearer ' + jwt(), 'Content-Type': 'application/zip' }, body: file });
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

  return html`
    <div class="pj-ws-embedded">
      <${ConfirmUI} />
      <input type="file" accept=".zip,application/zip" ref=${fileRef} class="pj-hidden-input" onChange=${(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; doImport(f); }} />
      <div class="section-desc">${t('organisms.workspacesDesc') || 'Workspaces in this organism — each is an independent space with its own documents, records and history.'}</div>

      <div class="pj-ws-bar">
        ${creating ? html`
          <input class="input-field input-sm pj-ws-name-input" autofocus placeholder=${t('organisms.workspaceName') || 'Workspace name'}
            value=${newName} onInput=${e => setNewName(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') create(); }} />
          <button class="btn-primary btn-sm" onClick=${create} disabled=${busy || !newName.trim()}>${t('organisms.create') || 'Create'}</button>
          <button class="btn-ghost btn-sm" onClick=${() => { setCreating(false); setNewName(''); }}>${t('organisms.cancel') || 'Cancel'}</button>
        ` : html`
          <button class="btn-primary btn-sm" onClick=${() => setCreating(true)}>${'+ '}${t('organisms.newWorkspace') || 'New workspace'}</button>
          <button class="btn-outline btn-sm" disabled=${busy} title=${t('organisms.importHint') || 'Restore a workspace from a .zip backup'} onClick=${() => fileRef.current && fileRef.current.click()}>${'⬆ '}${t('organisms.import') || 'Import'}</button>
          ${overview ? html`<button class="btn-outline btn-sm ${showOverview ? 'pj-org-btn-active' : ''}" onClick=${() => setShowOverview(s => !s)}>${'🗺 '}${t('organisms.showMap') || 'Map'}</button>` : null}`}
      </div>

      <${OrgSearch} orgId=${orgId} onOpenWorkspace=${(ws) => onOpen(ws)} />

      ${list === null ? html`<${Spinner} />`
        : list.length === 0 ? html`<${EmptyState} icon="🗂️" text=${t('organisms.noWorkspaces') || 'No workspaces yet — create one to get started.'} />`
        : html`
          <div class="pj-org-list">
          ${list.map(w => {
            const locked = w.access === 'none';
            const reviews = apprByWs[w.id] || 0;
            const menuItems = w.access === 'owner' ? [
              { label: t('organisms.requests') || 'Access requests', icon: '👥', onClick: () => toggleInbox(w) },
              { label: t('organisms.export') || 'Export backup (.zip)', icon: '⬇', onClick: () => doExport(w) },
              { label: t('organisms.delete') || 'Delete', danger: true, onClick: () => remove(w.id, w.name || w.id) },
            ] : [];
            return html`
            <div class="pj-org-row" key=${w.id}>
              <div class="pj-org-avatar" aria-hidden="true">${'🗂'}</div>
              <div class="pj-org-main ${locked ? 'pj-org-main-static' : ''}" role=${locked ? undefined : 'button'} tabindex=${locked ? undefined : '0'}
                onClick=${locked ? undefined : (() => onOpen(w.id))}
                onKeyDown=${locked ? undefined : ((e) => { if (e.key === 'Enter') onOpen(w.id); })}>
                <div class="pj-org-titlerow">
                  ${locked ? html`<span class="pj-org-lock">${'🔒'}</span>` : null}
                  <span class="pj-org-name">${(w.name || w.id)}</span>
                  ${reviews > 0 ? html`<span class="pj-tab-pill">${'📨 '}${(t('organisms.toReview') || '{n} to review').replace('{n}', String(reviews))}</span>` : null}
                </div>
                <div class="pj-org-desc">${locked
                  ? (t('organisms.byCreator') || 'by {creator}').replace('{creator}', w.created_by || '?')
                  : metaLine(w)}</div>
              </div>
              <div class="pj-org-stats">
                ${(wsStats[w.id]?.owners || []).length > 0 ? html`
                  <button class="pj-org-stat pj-stat-btn ${openPeopleWs === w.id ? 'active' : ''}" title=${t('organisms.participants') || 'Who works here'}
                    onClick=${(e) => { e.stopPropagation(); setOpenPeopleWs(p => (p === w.id ? null : w.id)); }}>${'👥'} ${wsStats[w.id].owners.length}</button>` : null}
                ${w.created_at ? html`<span class="pj-org-stat pj-org-date" title=${t('organisms.createdAt') || 'Created'}>${fmtDate(w.created_at)}</span>` : null}
              </div>
              ${locked
                ? html`<button class="btn-outline btn-sm pj-org-openbtn" disabled=${busy} onClick=${() => requestAccess(w)}>${t('organisms.requestAccess') || 'Request access'}</button>`
                : html`<button class="btn-outline btn-sm pj-org-openbtn" onClick=${() => onOpen(w.id)}>${t('organisms.open') || 'Open'}</button>`}
              ${menuItems.length ? html`<${KebabMenu} label=${t('organisms.moreActions') || 'More actions'} items=${menuItems} />` : null}
              ${openPeopleWs === w.id ? html`
                <div class="pj-org-detail">
                  ${(wsStats[w.id]?.owners || []).map(o => html`
                    <div class="pj-ws-person" key=${'p-' + o.owner}>
                      <span>${'👤 '}<strong>${(o.owner)}</strong></span>
                      ${o.isCreator ? html`<span class="badge badge-success pj-mini">${t('organisms.creatorTag') || 'creator'}</span>` : null}
                      ${o.isSelf ? html`<span class="badge badge-info pj-mini">${t('organisms.you') || 'you'}</span>` : null}
                      ${!o.isLocalNode ? html`<span class="pj-mini">${'🌐 '}${(o.node)}</span>` : null}
                      ${(o.agents || []).length > 0 ? html`<span class="pj-ws-person-agents">${'🤖'} ${(o.agents || []).length}</span>` : null}
                    </div>`)}
                </div>` : null}
              ${openReqWs === w.id ? html`
                <div class="pj-org-detail">
                  ${reqInbox.length === 0 ? html`<div class="pj-ws-inbox-empty">${t('organisms.noRequests') || 'No access requests.'}</div>`
                    : reqInbox.map(r => html`
                      <div class="pj-ws-req" key=${r.requester}>
                        <span class="pj-ws-req-who">${(r.requester)}${r.message ? html` <span class="pj-ws-req-msg">— ${(r.message)}</span>` : null}</span>
                        ${r.status === 'approved'
                          ? html`<span class="pj-ws-req-ok">✓ ${t('organisms.approved') || 'approved'}</span><button class="btn-ghost btn-sm" disabled=${busy} onClick=${() => decide(w, r.requester, 'deny')}>${t('organisms.revoke') || 'Revoke'}</button>`
                          : html`<button class="btn-success btn-sm" disabled=${busy} onClick=${() => decide(w, r.requester, 'approve')}>${t('organisms.approve') || 'Approve'}</button><button class="btn-ghost btn-sm" disabled=${busy} onClick=${() => decide(w, r.requester, 'deny')}>${t('organisms.deny') || 'Deny'}</button>`}
                      </div>`)}
                </div>` : null}
            </div>`;
          })}
        </div>`}

      ${overview && showOverview ? html`
        <div class="pj-chart">
          <div class="pj-chart-head">
            <span class="pj-chart-title">${'🔗 '}${t('organisms.overview') || 'Overview — who & what uses this organism'}</span>
            <button class="btn-ghost btn-sm" onClick=${() => setShowOverview(false)}>${t('organisms.hide') || 'Hide'}</button>
          </div>
          <${Mermaid} chart=${overview} />
        </div>` : null}
    </div>`;
}
