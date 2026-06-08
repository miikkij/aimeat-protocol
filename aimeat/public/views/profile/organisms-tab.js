/**
 * @file organisms-tab.js
 * @description Profile tab for managing organisms (groups, communities, teams).
 *   Allows creating, editing, joining, leaving, and deleting organisms.
 *   Displays user's organisms and a public discovery section.
 * @structure
 *   - OrganismsTab — main exported component
 *   - renderEditForm — inline edit form for an organism
 *   - renderOrgCard — card component for a single organism
 * @usage
 *   import OrganismsTab from '/views/profile/organisms-tab.js';
 *   <OrganismsTab session={session} showToast={showToast} onStats={onStats} />
 * @version-history
 *   v1.0.0 — 2026-03-17 — Remove all inline style attributes; use CSS utility classes
 *   v1.1.0 — 2026-06-08 — Doc index merges draft+published per id (draft badge no longer hidden by a
 *     published version); editor hydrates private /v1/storage images to auth'd blob URLs; new
 *     DocumentView with a Draft/Published comparison toggle.
 *   v1.2.0 — 2026-06-08 — DocumentView resolves storage images in the markdown text (re-render-safe,
 *     fixes broken image after toggling versions); saving a draft opens it (no more empty state);
 *     open workspace + document persist to sessionStorage so an F5 returns to where you were.
 *   v1.3.0 — 2026-06-08 — Per-image visibility panel in the editor (badge + toggle + "make all
 *     public"); save rewrites each image URL to match its visibility (public → /v1/pub/<ghii>/<key>
 *     so other viewers can load it, private → /v1/storage/<key> owner-only).
 *   v1.4.0 — 2026-06-08 — SourcesPanel: attach memory/storage/knowledge references (own or external/
 *     discover) the workspace draws on; pointers only, stored at organism.{id}.meta.sources.
 *   v1.5.0 — 2026-06-08 — UI pass to reuse core primitives + readability: doc view shows Created/
 *     Last-saved/Published (KeyValueRow + dt); canonical .seg replaces per-view version/picker tabs;
 *     VisibilityPill + EmptyState + SearchBar + fmtBytes reused; "move…" dropdown dropped (drag-and-
 *     drop only); recognizable upload button; tree/detail/panels recolored (white cards on the gray
 *     section so a selected item's accent actually stands out); "File visibility" rename.
 *   v1.6.0 — 2026-06-08 — Multi-workspace: an organism opens to a WorkspaceList (registry at
 *     organism.{id}.meta.workspaces); each workspace is independent (data under …w.{wsId}.*), with
 *     New/open/delete + F5 restore of openWs. wsId threaded through Workspace + SourcesPanel. Also:
 *     split genBusy/applyBusy so Generate and Validate&apply spin independently.
 *   v1.7.0 — 2026-06-08 — Records are viewable/editable (not just publishable): a draft has Edit
 *     (SchemaForm pre-filled, gated on schema load so it seeds) + click-to-expand field view
 *     (KeyValueRow); published records expand too. "+ Space" surfaced in the workspace bar (was
 *     Settings-only) with an inline document/records add form.
 *   v1.8.0 — 2026-06-08 — "AI access prompt" buttons (For chat / For coding agent) copy a ready
 *     prompt teaching an AI how to access + use THIS workspace (full schema inlined) — bridges the
 *     MCP discovery gap. See orgService.buildAccessPrompt.
 *   v1.9.0 — 2026-06-08 — Two deterministic Mermaid charts (vendored renderer, lazy-loaded): an
 *     organism Overview (members/agents/workspaces+structure/knowledge/federation-consent) at the
 *     top of the workspace list, and the manifest-defined edit→publish→version flow as the first
 *     item inside a workspace. Built from stable data — orgService.buildOrganismOverviewMermaid /
 *     buildEditFlowMermaid.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Spinner, VisibilityPill } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { EmptyState } from '/components/EmptyState.js';
import { KeyValueRow } from '/components/KeyValueRow.js';
import { SearchBar } from '/components/SearchBar.js';
import * as orgService from '/js/services/organisms.js';
import * as memoryService from '/js/services/memory.js';
import * as knowledgeService from '/js/services/knowledge.js';
import { OpenRouterSettings } from './generator-settings.js';
import { copyToClipboard } from '/js/utils.js';
import { dt, fmtBytes } from '/js/format.js';
import { Markdown, slugifyHeading } from '/components/Markdown.js';
import { Mermaid } from '/components/Mermaid.js';

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
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({});

  /* ── Create form state ── */
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formType, setFormType] = useState('community');
  const [formPolicy, setFormPolicy] = useState('open');
  const [formVisibility, setFormVisibility] = useState('public');
  const [formInterests, setFormInterests] = useState('');

  const ghii = session?.owner || '';

  const loadData = useCallback(async () => {
    try {
      const [myResp, pubResp] = await Promise.all([
        ghii ? orgService.listOrganisms({ member: ghii }) : Promise.resolve({ data: { organisms: [] } }),
        orgService.listOrganisms({ visibility: 'public' }),
      ]);
      const mine = myResp?.data?.organisms || [];
      const mineIds = new Set(mine.map(o => o.id));
      const discover = (pubResp?.data?.organisms || []).filter(o => !mineIds.has(o.id));
      setMyOrganisms(mine);
      setPublicOrganisms(discover);
      onStats?.({ organisms: mine.length });
    } catch {
      setMyOrganisms([]);
      setPublicOrganisms([]);
    }
  }, [ghii, onStats]);

  useEffect(() => {
    if (session) loadData();
  }, [session, loadData]);

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

  // Live update listener
  const liveRef = useRef(loadData);
  liveRef.current = loadData;
  useEffect(() => {
    const handler = () => liveRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

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
        loadData();
      } catch {
        showToast(t('organisms.deleteError') || 'Failed to delete');
      }
    }, { danger: true });
  }, [showToast, loadData]);

  const toggleExpand = useCallback((id) => {
    setExpanded(prev => prev === id ? null : id);
  }, []);

  const startEdit = useCallback((org) => {
    setEditing(org.id);
    setEditForm({
      name: org.name,
      description: org.description || '',
      type: org.type,
      join_policy: org.joinPolicy,
      visibility: org.visibility,
      interests: (org.interests || []).join(', '),
    });
  }, []);

  const cancelEdit = useCallback(() => {
    setEditing(null);
    setEditForm({});
  }, []);

  const handleUpdate = useCallback(async (id) => {
    if (!editForm.name?.trim()) {
      showToast(t('organisms.nameRequired') || 'Name is required');
      return;
    }
    setSaving(true);
    try {
      const interests = editForm.interests.split(',').map(s => s.trim()).filter(Boolean);
      const result = await orgService.updateOrganism(id, {
        name: editForm.name.trim(),
        description: editForm.description.trim(),
        type: editForm.type,
        join_policy: editForm.join_policy,
        visibility: editForm.visibility,
        interests,
      });
      if (result?.ok !== false) {
        showToast(t('organisms.updated') || 'Organism updated');
        setEditing(null);
        setEditForm({});
        loadData();
      } else {
        showToast(result?.error?.message || (t('organisms.updateError') || 'Failed to update'));
      }
    } catch {
      showToast(t('organisms.updateError') || 'Failed to update');
    } finally { setSaving(false); }
  }, [editForm, showToast, loadData]);

  const renderEditForm = (org) => html`
    <div class="card-detail" onClick=${(e) => e.stopPropagation()}>
      <div class="flex-col">
        <input type="text" value=${editForm.name} onInput=${(e) => setEditForm(f => ({ ...f, name: e.target.value }))}
          placeholder=${t('organisms.namePlaceholder') || 'Name'} class="input-field input-sm" />
        <textarea value=${editForm.description} onInput=${(e) => setEditForm(f => ({ ...f, description: e.target.value }))} rows="2"
          placeholder=${t('organisms.descPlaceholder') || 'Description'} class="input-field input-sm" />
        <input type="text" value=${editForm.interests} onInput=${(e) => setEditForm(f => ({ ...f, interests: e.target.value }))}
          placeholder=${t('organisms.interestsPlaceholder') || 'Interests (comma separated)'} class="input-field input-sm" />
        <div class="flex-row-wrap">
          <select value=${editForm.type} onChange=${(e) => setEditForm(f => ({ ...f, type: e.target.value }))} class="input-field input-sm">
            <option value="community">${t('organisms.types.community') || 'Community'}</option>
            <option value="team">${t('organisms.types.team') || 'Team'}</option>
            <option value="club">${t('organisms.types.club') || 'Club'}</option>
            <option value="cooperative">${t('organisms.types.cooperative') || 'Cooperative'}</option>
            <option value="project">${t('organisms.types.project') || 'Project'}</option>
          </select>
          <select value=${editForm.join_policy} onChange=${(e) => setEditForm(f => ({ ...f, join_policy: e.target.value }))} class="input-field input-sm">
            <option value="open">${t('organisms.policyOpen') || 'Open (anyone can join)'}</option>
            <option value="approval_required">${t('organisms.policyApproval') || 'Approval required'}</option>
            <option value="invite_only">${t('organisms.policyInvite') || 'Invite only'}</option>
          </select>
          <select value=${editForm.visibility} onChange=${(e) => setEditForm(f => ({ ...f, visibility: e.target.value }))} class="input-field input-sm">
            <option value="public">${t('organisms.visPublic') || 'Public'}</option>
            <option value="listed">${t('organisms.visListed') || 'Listed'}</option>
            <option value="private">${t('organisms.visPrivate') || 'Private'}</option>
          </select>
        </div>
        <div class="flex-row-wrap">
          <button class="btn-primary btn-sm" onClick=${() => handleUpdate(org.id)} disabled=${saving}>
            ${saving ? '...' : (t('organisms.save') || 'Save')}
          </button>
          <button class="btn-ghost btn-sm" onClick=${cancelEdit}>
            ${t('organisms.cancel') || 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  `;

  const renderOrgCard = (org, isMine) => {
    const isExpanded = expanded === org.id;
    const isEditing = editing === org.id;
    const isCreator = org.creatorGhii === ghii;
    const isAdmin = org.admins?.includes(ghii);
    const isMember = org.members?.includes(ghii);
    const canEdit = isCreator || isAdmin;
    const policyLabel = {
      open: t('organisms.policyOpen') || 'Open',
      approval_required: t('organisms.policyApproval') || 'Approval',
      invite_only: t('organisms.policyInvite') || 'Invite Only',
    }[org.joinPolicy] || org.joinPolicy;
    const typeLabel = t(`organisms.types.${org.type}`) || org.type;

    return html`
      <div class="card ${isExpanded ? 'card-expanded' : ''}" key=${org.id}>
        <div class="card-header card-clickable" onClick=${() => toggleExpand(org.id)}>
          <span class="expand-icon">${isExpanded ? '\u25BC' : '\u25B6'}</span>
          <div class="card-title">${escHtml(org.name)}</div>
          <span class="badge badge-info">${typeLabel}</span>
          <span class="badge ${org.visibility === 'public' ? 'badge-success' : 'badge-warn'}">${org.visibility}</span>
        </div>
        <div class="card-subtitle">
          ${org.description ? escHtml(org.description.slice(0, 100)) : ''}
          ${' \u2014 '}${(org.members || []).length} ${t('organisms.members') || 'members'}
          ${' \u2014 '}${policyLabel}
        </div>

        ${(org.interests || []).length > 0 && html`
          <div class="flex-row-wrap" >
            ${org.interests.map(tag => html`<span class="file-tag" key=${tag}>${escHtml(tag)}</span>`)}
          </div>
        `}

        ${isExpanded && !isEditing && html`
          <div class="card-detail">
            <div class="detail-grid">
              <div class="detail-item">
                <span class="detail-label">${t('organisms.creator') || 'Creator'}</span>
                <span class="detail-value">${escHtml(org.creatorGhii)}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">${t('organisms.admins') || 'Admins'}</span>
                <span class="detail-value">${(org.admins || []).join(', ') || '-'}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">${t('organisms.memberCount') || 'Members'}</span>
                <span class="detail-value">${(org.members || []).length} / ${org.maxMembers || 500}</span>
              </div>
              ${org.boardId ? html`
                <div class="detail-item">
                  <span class="detail-label">${t('organisms.board') || 'Board'}</span>
                  <span class="detail-value mono">${escHtml(org.boardId)}</span>
                </div>
              ` : null}
              ${org.createdAt ? html`
                <div class="detail-item">
                  <span class="detail-label">${t('organisms.createdAt') || 'Created'}</span>
                  <span class="detail-value">${new Date(org.createdAt).toLocaleDateString()}</span>
                </div>
              ` : null}
            </div>

            <div class="card-actions">
              ${(isMine || isMember) ? html`
                <button class="btn-primary btn-sm" onClick=${(e) => { e.stopPropagation(); setOpenWs(null); setOpenId(org.id); }}>
                  ${t('organisms.openWorkspace') || 'Open workspace'}
                </button>
              ` : null}
              ${canEdit ? html`
                <button class="btn-outline btn-sm" onClick=${(e) => { e.stopPropagation(); startEdit(org); }}>
                  ${t('organisms.edit') || 'Edit'}
                </button>
              ` : null}
              ${isMine && !isCreator ? html`
                <button class="btn-danger-solid btn-sm" onClick=${(e) => { e.stopPropagation(); handleLeave(org.id, org.name); }}>
                  ${t('organisms.leave') || 'Leave'}
                </button>
              ` : null}
              ${isCreator ? html`
                <button class="btn-danger-solid btn-sm" onClick=${(e) => { e.stopPropagation(); handleDelete(org.id, org.name); }}>
                  ${t('organisms.delete') || 'Delete'}
                </button>
              ` : null}
              ${!isMember ? html`
                <button class="btn-primary btn-sm" onClick=${(e) => { e.stopPropagation(); handleJoin(org.id); }}>
                  ${t('organisms.join') || 'Join'}
                </button>
              ` : null}
            </div>
          </div>
        `}

        ${isExpanded && isEditing && renderEditForm(org)}
      </div>
    `;
  };

  if (openId) {
    const org = [...(myOrganisms || []), ...publicOrganisms].find(o => o.id === openId) || { id: openId };
    // openWs chosen → that workspace; otherwise the organism's workspace LIST.
    if (openWs) {
      return html`<${Workspace} org=${org} wsId=${openWs} session=${session} showToast=${showToast}
        onBack=${() => { setOpenWs(null); }} />`;
    }
    return html`<${WorkspaceList} org=${org} showToast=${showToast}
      onOpen=${(wsId) => setOpenWs(wsId)} onBack=${() => { setOpenId(null); loadData(); }} />`;
  }

  if (!myOrganisms) return html`<${Spinner} text=${t('organisms.loading') || 'Loading organisms...'} />`;

  return html`
    <div class="section-title">${t('organisms.title') || 'Organisms'}</div>
    <div class="section-desc">${t('organisms.desc') || 'Organisms are groups — communities, teams, clubs, or projects. Create one or join existing ones to share knowledge, coordinate work, and build together.'}</div>

    <!-- Create button / form -->
    <div class="mb-1">
      ${!showCreate ? html`
        <button class="btn-primary" onClick=${() => setShowCreate(true)}>
          ${t('organisms.createNew') || 'Create Organism'}
        </button>
      ` : html`
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

    <!-- My Organisms -->
    <div class="section-title">${t('organisms.myOrganisms') || 'My Organisms'}</div>
    ${myOrganisms.length === 0
      ? html`<div class="empty">${t('organisms.empty') || 'You are not part of any organisms yet.'}</div>`
      : myOrganisms.map(org => renderOrgCard(org, true))
    }

    <!-- Discover -->
    ${publicOrganisms.length > 0 && html`
      <div class="section-title section-title-spaced">${t('organisms.discover') || 'Discover'}</div>
      ${publicOrganisms.map(org => renderOrgCard(org, false))}
    `}
    <${ConfirmUI} />
  `;
}

/* ───────────────── Organism workspace (manifest-driven) ─────────────────
 * Any organism can have a governed workspace. If it has no manifest yet, offer
 * "Set up workspace" (applies the project template). Otherwise render the
 * manifest's object types with the draft → publish → version loop, the publish
 * gate, the approval inbox, and the decision log. */

const PRIMARY_FIELD = { goal: 'title', plan: 'approach', deliverable: 'title', resource: 'label', decision: 'summary' };

/* Workspace list — an organism contains many workspaces (each an independent manifest + data set,
 * namespaced under organism.{id}.w.{wsId}.*). Lists the registry (organism.{id}.meta.workspaces),
 * lets the user create a new one (→ opens its setup/generate screen) or open/delete an existing one. */
function WorkspaceList({ org, showToast, onOpen, onBack }) {
  const orgId = org.id;
  const { confirm, ConfirmUI } = useConfirm();
  const [list, setList] = useState(null);   // null = loading
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [overview, setOverview] = useState('');           // organism dependency-overview chart (mermaid)
  const [showOverview, setShowOverview] = useState(true);

  const load = useCallback(async () => { setList(await orgService.listWorkspaces(orgId)); }, [orgId]);
  useEffect(() => { load(); }, [load]);
  // Rebuild the overview whenever the workspace set changes (deterministic — aggregates members,
  // agents, workspaces + their structure, and knowledge packages).
  useEffect(() => {
    let cancelled = false;
    orgService.buildOrganismOverviewMermaid(orgId).then(c => { if (!cancelled) setOverview(c); }).catch(() => {});
    return () => { cancelled = true; };
  }, [orgId, list]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener('aimeat-live-update', h);
    return () => window.removeEventListener('aimeat-live-update', h);
  }, [load]);

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

  return html`
    <div class="pj-ws">
      <${ConfirmUI} />
      <button class="btn-ghost btn-sm" onClick=${onBack}>${'← '}${t('organisms.allOrganisms') || 'All organisms'}</button>
      <div class="section-title">${escHtml(org.name || 'Organism')}</div>
      <div class="section-desc">${t('organisms.workspacesDesc') || 'Workspaces in this organism — each is an independent space with its own documents, records and history.'}</div>

      ${overview ? html`
        <div class="pj-chart">
          <div class="pj-chart-head">
            <span class="pj-chart-title">${'🔗 '}${t('organisms.overview') || 'Overview — who & what uses this organism'}</span>
            <button class="btn-ghost btn-sm" onClick=${() => setShowOverview(s => !s)}>${showOverview ? (t('organisms.hide') || 'Hide') : (t('organisms.show') || 'Show')}</button>
          </div>
          ${showOverview ? html`<${Mermaid} chart=${overview} />` : null}
        </div>` : null}

      <div class="pj-ws-bar">
        ${creating ? html`
          <input class="input-field input-sm pj-ws-name-input" autofocus placeholder=${t('organisms.workspaceName') || 'Workspace name'}
            value=${newName} onInput=${e => setNewName(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') create(); }} />
          <button class="btn-primary btn-sm" onClick=${create} disabled=${busy || !newName.trim()}>${t('organisms.create') || 'Create'}</button>
          <button class="btn-ghost btn-sm" onClick=${() => { setCreating(false); setNewName(''); }}>${t('organisms.cancel') || 'Cancel'}</button>
        ` : html`
          <button class="btn-primary btn-sm" onClick=${() => setCreating(true)}>${'+ '}${t('organisms.newWorkspace') || 'New workspace'}</button>`}
      </div>

      ${list === null ? html`<${Spinner} />`
        : list.length === 0 ? html`<${EmptyState} icon="🗂️" text=${t('organisms.noWorkspaces') || 'No workspaces yet — create one to get started.'} />`
        : html`<div class="pj-ws-list">
          ${list.map(w => html`
            <div class="pj-ws-card" key=${w.id}>
              <button class="pj-ws-open" onClick=${() => onOpen(w.id)}>
                <span class="pj-ws-card-name">${escHtml(w.name || w.id)}</span>
                ${w.createdAt ? html`<span class="pj-ws-card-meta">${dt(w.createdAt)}</span>` : null}
              </button>
              <button class="pj-icon-btn" title=${t('organisms.delete') || 'Delete'} disabled=${busy} onClick=${() => remove(w.id, w.name || w.id)}>✕</button>
            </div>`)}
        </div>`}
    </div>`;
}

function Workspace({ org, wsId, showToast, onBack }) {
  const orgId = org.id;
  const { confirm, ConfirmUI } = useConfirm();
  const [ws, setWs] = useState(undefined); // undefined=loading, null=no manifest, object=workspace
  const [approvals, setApprovals] = useState([]);
  const [gateOn, setGateOn] = useState(false);
  const [adding, setAdding] = useState(null);          // objectType name being added
  const [addingSchema, setAddingSchema] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sName, setSName] = useState('');
  const [sSummary, setSSummary] = useState('');
  const [sAutonomy, setSAutonomy] = useState('L3');
  const [genDesc, setGenDesc] = useState('');
  const [genBusy, setGenBusy] = useState(false);     // AI "Generate" in flight
  const [applyBusy, setApplyBusy] = useState(false); // "Validate & apply" (pasted JSON) in flight
  const [hasAiKey, setHasAiKey] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [genErrors, setGenErrors] = useState([]);   // validation errors (JSON present, fixable)
  const [genFail, setGenFail] = useState('');        // generation failure (AI call timed out / errored)
  // { type, mode:'view'|'edit', page } for document-mode types. Restored from sessionStorage on F5
  // so the user returns to the document they were on (only the id is kept; renderDocSpace re-resolves
  // it to the live entry once the workspace loads).
  const docKey = 'aimeat.ws.' + orgId + '.' + wsId + '.activeDoc';
  const [activeDoc, setActiveDoc] = useState(() => {
    try {
      const raw = sessionStorage.getItem(docKey);
      if (raw) { const v = JSON.parse(raw); if (v && v.type && v.id) return { type: v.type, mode: v.mode === 'edit' ? 'edit' : 'view', page: { id: v.id } }; }
    } catch (e) { /* noop */ }
    return null;
  });
  const [sectionsByType, setSectionsByType] = useState({});  // { typeName: [{id,name,parentId,documents:[docId]}] }
  const [editingSec, setEditingSec] = useState(null);        // section id currently being renamed inline
  const draggedDoc = useRef(null);                            // { type, id } of the doc being dragged
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [delConfirm, setDelConfirm] = useState('');   // typed-name confirmation for delete
  const [newSpaceName, setNewSpaceName] = useState('');
  const [newSpaceMode, setNewSpaceMode] = useState('document');
  const [addingInitial, setAddingInitial] = useState(null);   // record being edited (null = new draft)
  const [addingId, setAddingId] = useState(null);             // its id, preserved so save overwrites
  const [expandedRec, setExpandedRec] = useState({});         // { "type:id": true } — records expanded to view fields
  const [showSpaces, setShowSpaces] = useState(false);        // inline add-space form at the workspace top
  const [showFlow, setShowFlow] = useState(true);             // the manifest-defined edit-flow chart (first item)

  const load = useCallback(async () => {
    const w = await orgService.getWorkspace(orgId, wsId).catch(() => null);
    if (w && w.manifest) {
      const [ap, cfg, secs] = await Promise.all([
        orgService.listApprovals(orgId, 'pending').catch(() => []),
        orgService.getConfig(orgId).catch(() => ({})),
        orgService.getAllSections(orgId, wsId).catch(() => ({})),
      ]);
      setApprovals(ap); setGateOn(!!(cfg?.gates?.publish?.enabled)); setSectionsByType(secs);
    }
    setWs(w && w.manifest ? w : null);
  }, [orgId, wsId]);

  useEffect(() => { load(); }, [load]);

  // Persist the open document (id only) so an F5 returns to it. Skip unsaved new docs (no id yet).
  useEffect(() => {
    try {
      if (activeDoc?.type && activeDoc.page?.id) sessionStorage.setItem(docKey, JSON.stringify({ type: activeDoc.type, id: activeDoc.page.id, mode: activeDoc.mode }));
      else sessionStorage.removeItem(docKey);
    } catch (e) { /* noop */ }
  }, [activeDoc, docKey]);

  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => {
    const handler = () => liveRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  const setup = useCallback(async () => {
    setBusy(true);
    try {
      await orgService.applyProjectTemplate(orgId, wsId, org.name || 'Project', org.description || '');
      showToast(t('organisms.workspaceReady') || 'Workspace ready');
      await load();
    } catch (e) { showToast((e && e.message) || (t('organisms.setupError') || 'Failed to set up workspace')); }
    finally { setBusy(false); }
  }, [orgId, org, showToast, load]);

  // Validate the JSON first; save only if clean. On errors, surface them (+ a fix prompt for the AI).
  const validateAndApply = useCallback(async (jsonText, fromGenerator) => {
    setGenErrors([]); setGenFail('');
    let generated;
    try { generated = orgService.parseGenerated(jsonText); }
    catch (e) { setGenErrors([(e && e.message) || 'Invalid JSON']); return; }
    const errs = orgService.validateGenerated(generated);
    if (errs.length) { setGenErrors(errs); return; }
    // The Generate flow owns genBusy; a direct paste-apply spins its own button only.
    const setBusyFn = fromGenerator ? setGenBusy : setApplyBusy;
    setBusyFn(true);
    try {
      await orgService.applyGeneratedWorkspace(orgId, wsId, generated);
      showToast(t('organisms.workspaceReady') || 'Workspace ready');
      if (fromGenerator) setShowSettings(true);   // open settings so the user can tweak the generated workspace
      await load();
    } catch (e) { setGenErrors([(e && e.message) || (t('organisms.applyError') || 'Could not apply — check the JSON.')]); }
    finally { setBusyFn(false); }
  }, [orgId, showToast, load]);

  const generate = useCallback(async () => {
    if (!genDesc.trim()) return;
    setGenBusy(true); setGenErrors([]); setGenFail('');
    try {
      const raw = await orgService.generateRaw(genDesc.trim(), showRegenerate ? ws?.manifest : null);
      setPasteText(raw);                  // show the generated JSON in the box
      await validateAndApply(raw, true);
    } catch (e) {
      setGenFail(e?.code === 'NO_API_KEY'
        ? (t('organisms.noAiKey') || 'Set up your OpenRouter key above, or copy the prompt to your own AI chat.')
        : ((e && e.message) || (t('organisms.generateError') || 'Generation failed')));
    } finally { setGenBusy(false); }
  }, [genDesc, validateAndApply, showRegenerate, ws]);

  const copyPrompt = useCallback(async () => {
    try {
      await copyToClipboard(await orgService.buildGeneratorPrompt(genDesc.trim(), showRegenerate ? ws?.manifest : null));
      showToast(t('organisms.promptCopied') || 'Prompt copied — paste it into any AI chat, then paste the JSON it returns below.');
    } catch (e) { showToast((e && e.message) || 'Failed to copy'); }
  }, [genDesc, showToast, showRegenerate, ws]);

  const applyPasted = useCallback(() => { if (pasteText.trim()) validateAndApply(pasteText, false); }, [pasteText, validateAndApply]);

  const copyFixPrompt = useCallback(async () => {
    try {
      await copyToClipboard(orgService.buildFixPrompt(pasteText, genErrors));
      showToast(t('organisms.fixPromptCopied') || 'Fix prompt copied — paste it back to your AI, then paste the corrected JSON.');
    } catch (e) { showToast((e && e.message) || 'Failed to copy'); }
  }, [pasteText, genErrors, showToast]);

  const startAdd = useCallback(async (ot) => {
    setAddingInitial(null); setAddingId(null);
    setAdding(ot.name); setAddingSchema(null);
    const s = await orgService.getObjectSchema(orgId, wsId, ot.namespace);
    setAddingSchema(s || { properties: { id: { type: 'string' }, title: { type: 'string' } }, required: ['title'] });
  }, [orgId, wsId]);

  // Open the same schema form pre-filled with an existing draft — so a record can be reviewed/edited
  // (not just published blind). Saving overwrites the same draft id.
  const startEdit = useCallback(async (ot, rec) => {
    setAddingInitial(rec); setAddingId(rec.id);
    setAdding(ot.name); setAddingSchema(null);
    const s = await orgService.getObjectSchema(orgId, wsId, ot.namespace);
    setAddingSchema(s || { properties: { id: { type: 'string' }, title: { type: 'string' } }, required: ['title'] });
  }, [orgId, wsId]);
  const cancelForm = () => { setAdding(null); setAddingSchema(null); setAddingInitial(null); setAddingId(null); };
  const toggleExpand = (ot, id) => setExpandedRec(s => ({ ...s, [ot.name + ':' + id]: !s[ot.name + ':' + id] }));
  // Read-only field view for a record (skips the underscore-prefixed metadata the read attaches).
  const recordFields = (rec) => {
    const rows = Object.entries(rec || {}).filter(([k, v]) =>
      !k.startsWith('_') && v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0));
    if (!rows.length) return html`<div class="pj-muted pj-rec-empty">${t('organisms.noFields') || 'No fields'}</div>`;
    return rows.map(([k, v]) => html`<${KeyValueRow} key=${k} label=${k}
      value=${Array.isArray(v) ? v.join(', ') : (typeof v === 'object' ? JSON.stringify(v) : String(v))} />`);
  };

  const saveDraft = useCallback(async (ot, value) => {
    const id = (String(value.id || '').trim() || `${ot.name}-${Date.now().toString(36)}`).replace(/[^a-zA-Z0-9_-]/g, '-');
    setBusy(true);
    try {
      const r = await orgService.writeDraft(orgId, wsId, ot.namespace, id, { ...value, id });
      if (r?.ok === false) { showToast(r?.error?.message || 'Draft rejected'); }
      else { showToast(t('organisms.draftSaved') || 'Draft saved'); setAdding(null); setAddingSchema(null); await load(); }
    } catch (e) { showToast((e && e.message) || 'Failed to save draft'); }
    finally { setBusy(false); }
  }, [orgId, showToast, load]);

  // Documents are free-form markdown records ({id,title,markdown}) — same draft/publish path.
  // When created from a section, file the new id into that section's documents[].
  const savePage = useCallback(async (ot, page, sectionId) => {
    const id = (String(page.id || '').trim() || `doc-${Date.now().toString(36)}`).replace(/[^a-zA-Z0-9_-]/g, '-');
    setBusy(true);
    try {
      const r = await orgService.writeDraft(orgId, wsId, ot.namespace, id, { id, title: page.title, markdown: page.markdown });
      if (r?.ok === false) { showToast(r?.error?.message || 'Document rejected'); }
      else {
        if (sectionId) {
          const secs = (sectionsByType[ot.name] || []).map(s => s.id === sectionId
            ? { ...s, documents: [...(s.documents || []).filter(d => d !== id), id] } : s);
          await orgService.saveSections(orgId, wsId, ot.name, secs).catch(() => {});
        }
        // Reload, then open the just-saved document (view mode). renderDocSpace re-resolves the id
        // to the fresh merged entry, so the new draft shows with its badge instead of the empty state.
        showToast(t('organisms.pageSaved') || 'Document saved'); await load(); setActiveDoc({ type: ot.name, mode: 'view', page: { id } });
      }
    } catch (e) { showToast((e && e.message) || 'Failed to save document'); }
    finally { setBusy(false); }
  }, [orgId, sectionsByType, showToast, load]);

  // ── Section index ops (persist organism.{id}.meta.sections.{typeName}) ──
  const updateSections = useCallback(async (typeName, sections) => {
    setSectionsByType(s => ({ ...s, [typeName]: sections }));
    await orgService.saveSections(orgId, wsId, typeName, sections).catch(e => showToast((e && e.message) || 'Failed to save sections'));
  }, [orgId, showToast]);
  const addSection = (typeName, parentId) => {
    const id = 'sec-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    updateSections(typeName, [...(sectionsByType[typeName] || []), { id, name: '', parentId: parentId || null, documents: [] }]);
    setEditingSec(id);   // open the new section in rename mode; it becomes plain text once named/blurred
  };
  const renameSection = (typeName, secId, name) =>
    updateSections(typeName, (sectionsByType[typeName] || []).map(s => s.id === secId ? { ...s, name } : s));
  const removeSection = (typeName, secId, secName) => {
    confirm(
      (t('organisms.confirmRemoveSection') || 'Remove the section “{name}”? Its documents move to Unsorted — they are not deleted.').replace('{name}', secName || '…'),
      () => updateSections(typeName, (sectionsByType[typeName] || []).filter(s => s.id !== secId).map(s => s.parentId === secId ? { ...s, parentId: null } : s)),
      { danger: true, title: t('organisms.removeSection') || 'Remove section' },
    );
  };
  const moveDocToSection = (typeName, docId, targetSecId) => {
    const secs = (sectionsByType[typeName] || []).map(s => ({ ...s, documents: (s.documents || []).filter(d => d !== docId) }));
    if (targetSecId) { const i = secs.findIndex(s => s.id === targetSecId); if (i >= 0) secs[i] = { ...secs[i], documents: [...secs[i].documents, docId] }; }
    updateSections(typeName, secs);
  };
  // Inline rename: update the name locally per keystroke, persist once on blur (no write storm).
  const sectionsRef = useRef(sectionsByType); sectionsRef.current = sectionsByType;
  const setSecName = (typeName, secId, name) =>
    setSectionsByType(s => ({ ...s, [typeName]: (s[typeName] || []).map(x => x.id === secId ? { ...x, name } : x) }));
  const commitSecName = (typeName) => { setEditingSec(null); orgService.saveSections(orgId, wsId, typeName, sectionsRef.current[typeName] || []).catch(() => {}); };

  const publish = useCallback(async (ot, instanceId) => {
    setBusy(true);
    try {
      const r = await orgService.publishDraft(orgId, wsId, ot.namespace, instanceId);
      if (r?.data?.gated) showToast(t('organisms.publishGated') || 'Sent for review (publish gate is on)');
      else showToast((t('organisms.published') || 'Published') + (r?.data?.version ? ` v${r.data.version}` : ''));
      await load();
    } catch (e) { showToast((e && e.message) || 'Failed to publish'); }
    finally { setBusy(false); }
  }, [orgId, showToast, load]);

  const resolve = useCallback(async (aid, decision) => {
    setBusy(true);
    try { await orgService.resolveApproval(orgId, aid, decision); showToast(decision === 'approve' ? (t('organisms.approved') || 'Approved') : (t('organisms.rejected') || 'Rejected')); await load(); }
    catch (e) { showToast((e && e.message) || 'Failed to resolve'); }
    finally { setBusy(false); }
  }, [orgId, showToast, load]);

  const toggleGate = useCallback(async () => {
    setBusy(true);
    try { await orgService.setPublishGate(orgId, !gateOn); setGateOn(!gateOn); showToast(t('organisms.gateToggled') || 'Publish gate updated'); }
    catch (e) { showToast((e && e.message) || 'Failed to update gate'); }
    finally { setBusy(false); }
  }, [orgId, gateOn, showToast]);

  // Populate the settings fields from the manifest whenever the panel opens (incl. after generation).
  useEffect(() => {
    if (showSettings && ws?.manifest) {
      setSName(ws.manifest.name || '');
      setSSummary(ws.manifest.summary || '');
      setSAutonomy(ws.manifest.policy?.agentAutonomy || 'L3');
    }
  }, [showSettings, ws]);

  const saveSettings = useCallback(async () => {
    setBusy(true);
    try {
      const m = {
        ...ws.manifest,
        name: sName.trim() || ws.manifest.name,
        summary: sSummary.trim(),
        policy: { ...(ws.manifest.policy || {}), agentAutonomy: sAutonomy },
        updatedAt: new Date().toISOString(),
      };
      await orgService.saveManifest(orgId, wsId, m);
      showToast(t('organisms.settingsSaved') || 'Settings saved');
      setShowSettings(false);
      await load();
    } catch (e) { showToast((e && e.message) || 'Failed to save settings'); }
    finally { setBusy(false); }
  }, [ws, sName, sSummary, sAutonomy, orgId, showToast, load]);

  // Wipe the workspace entirely (all data + schemas). The organism stays → back to "no workspace".
  // The typed-name field already gates the button; this adds a final "are you sure?" dialog.
  const delWorkspace = useCallback(() => {
    confirm(
      t('organisms.confirmDeleteWorkspace') || 'Are you sure you want to delete this workspace? All its documents, records and version history are permanently removed. This cannot be undone.',
      async () => {
        setBusy(true);
        try {
          const r = await orgService.deleteWorkspace(orgId, wsId);
          if (r?.ok === false) { showToast(r?.error?.message || 'Failed to delete'); }
          else {
            showToast(t('organisms.workspaceDeleted') || 'Workspace deleted');
            setShowSettings(false); setDelConfirm(''); setShowRegenerate(false);
            onBack();   // the workspace is gone — return to the organism's workspace list
          }
        } catch (e) { showToast((e && e.message) || 'Failed to delete workspace'); }
        finally { setBusy(false); }
      },
      { danger: true, title: t('organisms.deleteWorkspace') || 'Delete workspace' },
    );
  }, [orgId, confirm, showToast, load]);

  // Manual add / remove of object spaces (also doable by agents via the memory API).
  const addSpaceHandler = useCallback(async () => {
    if (!newSpaceName.trim() || !ws?.manifest) return;
    setBusy(true);
    try {
      await orgService.addSpace(orgId, wsId, ws.manifest, newSpaceName.trim(), newSpaceMode);
      showToast(t('organisms.spaceAdded') || 'Space added');
      setNewSpaceName(''); setShowSpaces(false);
      await load();
    } catch (e) { showToast((e && e.message) || 'Failed to add space'); }
    finally { setBusy(false); }
  }, [newSpaceName, newSpaceMode, ws, wsId, orgId, showToast, load]);

  const removeSpaceHandler = useCallback((typeName) => {
    confirm(
      (t('organisms.confirmRemoveSpace') || 'Remove "{name}" from this workspace? Its data is kept in memory (orphaned) but the section disappears.').replace('{name}', typeName),
      async () => {
        setBusy(true);
        try {
          await orgService.removeSpace(orgId, wsId, ws.manifest, typeName);
          showToast(t('organisms.spaceRemoved') || 'Space removed');
          await load();
        } catch (e) { showToast((e && e.message) || 'Failed to remove space'); }
        finally { setBusy(false); }
      },
      { danger: true, title: t('organisms.removeSpace') || 'Remove space' },
    );
  }, [ws, orgId, confirm, showToast, load]);

  // Copy a ready prompt that teaches an AI/agent how to access + use THIS workspace (the MCP gap
  // bridge). 'human' = paste into a chat; 'agent' = imperative, assumes tool access.
  const copyAccessPrompt = useCallback(async (variant) => {
    try {
      const text = await orgService.buildAccessPrompt(orgId, org.name, wsId, ws, variant);
      await copyToClipboard(text);
      showToast(t('organisms.promptCopied') || 'Access prompt copied — paste it to your AI.');
    } catch (e) { showToast((e && e.message) || 'Failed to build prompt'); }
  }, [orgId, org, wsId, ws, showToast]);

  // The AI / paste generator — reused for a fresh workspace AND for "restructure" (where, via
  // showRegenerate, generate/copyPrompt pass the current manifest so the AI EXTENDS it additively).
  const renderGenerator = () => html`
    <div class="pj-section">
      <div class="pj-section-title">${showRegenerate ? (t('organisms.restructureTitle') || 'Restructure / add types with AI') : (t('organisms.generateTitle') || 'Or generate a custom workspace with AI')}</div>
      <div class="section-desc">${showRegenerate
        ? (t('organisms.restructureDesc') || 'Describe what to add or change. Existing types and their data are kept — the AI extends the current structure. (To start completely fresh, delete the workspace below first.)')
        : (t('organisms.generateDesc') || 'Describe what you want to track — the AI designs the object types. Use your OpenRouter key for one-click generation, or copy the prompt into any AI chat (free) and paste the result back.')}</div>

      <textarea class="input-field input-sm" rows="3"
        placeholder=${t('organisms.generatePlaceholder') || 'e.g. A research study tracking hypotheses, experiments and validated findings'}
        value=${genDesc} onInput=${e => setGenDesc(e.target.value)}></textarea>

      <${OpenRouterSettings} onSettingsChange=${s => setHasAiKey(!!(s && s.hasApiKey))} />

      <div class="form-actions">
        ${hasAiKey ? html`
          <button class="btn-primary btn-sm" onClick=${generate} disabled=${genBusy || !genDesc.trim()}>
            ${genBusy ? html`<span class="spinner"></span> ${t('organisms.generating') || 'Generating…'}` : (t('organisms.generate') || 'Generate with AI')}
          </button>
        ` : null}
        <button class="btn-outline btn-sm" onClick=${copyPrompt} disabled=${!genDesc.trim()}>${t('organisms.copyPrompt') || 'Copy prompt'}</button>
      </div>

      <div class="section-desc">${t('organisms.pasteHelp') || 'No key? Copy the prompt above into any AI chat, then paste the JSON it returns here:'}</div>
      <textarea class="input-field input-sm" rows="4"
        placeholder=${t('organisms.pastePlaceholder') || 'Paste the AI JSON response here'}
        value=${pasteText} onInput=${e => setPasteText(e.target.value)}></textarea>

      ${genFail && html`
        <div class="pj-errors">
          <div class="pj-errors-title">${t('organisms.genFailed') || 'Generation failed — try again'}</div>
          <div class="pj-error-line">${escHtml(genFail)}</div>
        </div>
      `}

      ${genErrors.length > 0 && html`
        <div class="pj-errors">
          <div class="pj-errors-title">${t('organisms.fixNeeded') || 'This needs fixing before it can be saved:'}</div>
          ${genErrors.map((e, i) => html`<div class="pj-error-line" key=${i}>${escHtml(e)}</div>`)}
          <div class="form-actions">
            <button class="btn-outline btn-sm" onClick=${copyFixPrompt}>${t('organisms.copyFixPrompt') || 'Copy fix prompt for the AI'}</button>
          </div>
        </div>
      `}

      <div class="form-actions">
        <button class="btn-primary btn-sm" onClick=${applyPasted} disabled=${applyBusy || !pasteText.trim()}>
          ${applyBusy ? html`<span class="spinner"></span> ` : ''}${t('organisms.applyPasted') || 'Validate & apply'}
        </button>
      </div>
    </div>
  `;

  const back = html`<div class="card-actions mb-half"><button class="btn-ghost btn-sm" onClick=${onBack}>${'← '}${t('organisms.backToWorkspaces') || 'Workspaces'}</button></div>`;

  if (ws === undefined) return html`<div>${back}<${Spinner} text=${t('organisms.loading') || 'Loading...'} /></div>`;

  if (ws === null) {
    return html`
      <div class="pj-ws">
        ${back}
        <div class="section-title">${escHtml(org.name || 'Organism')}</div>
        <div class="section-desc">${t('organisms.noWorkspace') || 'This organism has no workspace yet. Set one up to track goals, plans, deliverables and decisions — versioned on publish.'}</div>
        <button class="btn-primary" onClick=${setup} disabled=${busy || genBusy}>${busy ? '...' : (t('organisms.setupWorkspace') || 'Set up workspace (project template)')}</button>
        ${renderGenerator()}
      </div>
    `;
  }

  const types = (ws.manifest?.objectTypes || []).filter(ot => ot.backing === 'memory');
  const draftsFor = (name) => (ws.drafts && ws.drafts[name]) || [];
  const objectsFor = (name) => (ws.objects && ws.objects[name]) || [];

  // A document-space: left index (section tree + documents, with an Unsorted group) + a main
  // area showing the active document (view/edit). Sections nest via parentId; documents are
  // tied to a section's documents[] (or unsorted). Edits to the tree persist immediately.
  const renderDocSpace = (ot) => {
    const secs = sectionsByType[ot.name] || [];
    // One entry per document id. A draft (working copy) takes precedence over its published
    // version, so the index shows the draft badge even when a published `.latest` also exists.
    // (Without this, keying docById by id let the published entry overwrite the draft and the
    // "draft" badge silently disappeared whenever a doc had both versions.)
    const byId = new Map();
    for (const d of objectsFor(ot.name)) byId.set(d.id, { ...d, _draft: false, _published: true });
    for (const d of draftsFor(ot.name)) {
      const pub = byId.get(d.id);   // the published version, if one exists — kept on `_pub` for the view's Draft/Published toggle
      byId.set(d.id, { ...d, _draft: true, _published: !!pub, _pub: pub || null });
    }
    const docs = [...byId.values()];
    const docById = {}; docs.forEach(d => { docById[d.id] = d; });
    const used = new Set(); secs.forEach(s => (s.documents || []).forEach(id => used.add(id)));
    const unsorted = docs.filter(d => !used.has(d.id));
    const childrenOf = (pid) => secs.filter(s => (s.parentId || null) === (pid || null));
    const isActive = (d) => activeDoc?.type === ot.name && activeDoc.page?.id === d.id;

    const docItem = (d) => html`
      <div class="pj-doc-item ${isActive(d) ? 'active' : ''}" key=${'di' + d.id}
        draggable=${true}
        onDragStart=${(e) => { draggedDoc.current = { type: ot.name, id: d.id }; if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', d.id); } catch (x) { /* noop */ } } }}
        onDragEnd=${() => { draggedDoc.current = null; }}>
        <span class="pj-grip" title=${t('organisms.dragHint') || 'Drag into a section'}>⠿</span>
        <button class="pj-doc-link" onClick=${() => setActiveDoc({ type: ot.name, mode: 'view', page: d })}>
          ${d._draft ? html`<span class="badge badge-warn pj-mini">${t('organisms.draft') || 'draft'}</span> ` : ''}${escHtml(d.title || d.id)}
        </button>
      </div>`;

    // A section is a drop target — dragging a document onto it (or its header) files it here.
    const dropOn = (secId) => (e) => { e.preventDefault(); e.stopPropagation(); if (draggedDoc.current?.type === ot.name) { moveDocToSection(ot.name, draggedDoc.current.id, secId); draggedDoc.current = null; } };
    const allowDrop = (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; };

    const renderSection = (sec) => html`
      <div class="pj-sec" key=${sec.id} onDragOver=${allowDrop} onDrop=${dropOn(sec.id)}>
        <div class="pj-sec-head">
          ${editingSec === sec.id
            ? html`<input class="input-field input-xs pj-sec-name" autofocus placeholder=${t('organisms.sectionName') || 'Section name'}
                value=${sec.name} onInput=${e => setSecName(ot.name, sec.id, e.target.value)}
                onBlur=${() => commitSecName(ot.name)} onKeyDown=${e => { if (e.key === 'Enter') e.target.blur(); }} />`
            : html`<span class="pj-sec-name-text" onDblClick=${() => setEditingSec(sec.id)}>${escHtml(sec.name || t('organisms.unnamed') || '(unnamed)')}</span>`}
          <button class="pj-icon-btn" title=${t('organisms.rename') || 'Rename'} onClick=${() => setEditingSec(sec.id)}>✎</button>
          <button class="pj-icon-btn" title=${t('organisms.newDocHere') || 'New document here'} onClick=${() => setActiveDoc({ type: ot.name, mode: 'edit', page: { id: '', title: '', markdown: '' }, sectionId: sec.id })}>+</button>
          <button class="pj-icon-btn" title=${t('organisms.addSubsection') || 'Sub-section'} onClick=${() => addSection(ot.name, sec.id)}>⊕</button>
          <button class="pj-icon-btn" title=${t('organisms.remove') || 'Remove'} onClick=${() => removeSection(ot.name, sec.id, sec.name)}>✕</button>
        </div>
        ${(sec.documents || []).map(id => docById[id]).filter(Boolean).map(docItem)}
        ${childrenOf(sec.id).map(renderSection)}
      </div>`;

    return html`
      <div class="pj-section" key=${ot.name}>
        <div class="pj-section-head">
          <span class="pj-section-title">${escHtml(ot.name)}<span class="pj-doc-tag">${t('organisms.docs') || 'docs'}</span></span>
          <button class="btn-outline btn-sm" onClick=${() => addSection(ot.name, null)}>${'+ '}${t('organisms.section') || 'Section'}</button>
          <button class="btn-outline btn-sm" onClick=${() => setActiveDoc({ type: ot.name, mode: 'edit', page: { id: '', title: '', markdown: '' } })}>${'+ '}${t('organisms.newPage') || 'New document'}</button>
        </div>
        <div class="pj-docspace">
          <div class="pj-doc-index">
            ${childrenOf(null).map(renderSection)}
            ${unsorted.length > 0 ? html`
              <div class="pj-sec" onDragOver=${allowDrop} onDrop=${dropOn(null)}><div class="pj-sec-head"><span class="pj-sec-name pj-muted">${t('organisms.unsorted') || 'Unsorted'}</span></div>${unsorted.map(docItem)}</div>` : null}
            ${docs.length === 0 && secs.length === 0 ? html`<${EmptyState} text=${t('organisms.noneYet') || 'none yet'} />` : null}
          </div>
          <div class="pj-doc-main">
            ${(() => {
              if (activeDoc?.type !== ot.name) return html`<${EmptyState} icon="📄" text=${t('organisms.selectDoc') || 'Select a document, or create one.'} />`;
              // Re-resolve the open document against the freshly-loaded list by id, so after a save (or
              // a live-update / F5 restore that only kept the id) the view shows the current draft —
              // with its correct draft badge, published copy, and Draft/Published toggle.
              const livePage = (activeDoc.page && activeDoc.page.id && docById[activeDoc.page.id]) || activeDoc.page;
              if (activeDoc.mode === 'edit') return html`
                <${DocumentEditor} key=${'ed-' + (livePage.id || 'new')} orgId=${orgId} page=${livePage} busy=${busy} onSave=${(p) => savePage(ot, p, activeDoc.sectionId)} onCancel=${() => setActiveDoc(null)} />`;
              return html`
                <${DocumentView} key=${'view-' + livePage.id} page=${livePage} busy=${busy}
                  onEdit=${() => setActiveDoc({ type: ot.name, mode: 'edit', page: livePage })}
                  onPublish=${() => publish(ot, livePage.id)}
                  onWikiLink=${(content) => {
                    const [titlePart, headingPart] = String(content).split('#');
                    const title = titlePart.trim();
                    const anchor = (headingPart || '').trim();
                    const scrollToAnchor = () => { if (anchor) setTimeout(() => { const el = document.querySelector('.pj-doc-view [id="' + slugifyHeading(anchor) + '"]'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 80); };
                    if (!title) { scrollToAnchor(); return; }   // [[#Heading]] → jump within the current document
                    const target = docs.find(d => (d.title || '').toLowerCase() === title.toLowerCase());
                    if (target) { setActiveDoc({ type: ot.name, mode: 'view', page: target }); scrollToAnchor(); }
                    else showToast((t('organisms.docNotFound') || 'No document titled “{title}”').replace('{title}', title));
                  }} />`;
            })()}
          </div>
        </div>
      </div>`;
  };

  return html`
    <div class="pj-ws">
      <${ConfirmUI} />
      ${back}
      <div class="section-title">${escHtml(ws.manifest?.name || org.name || 'Workspace')}</div>
      <div class="section-desc">
        <span class="badge badge-success">${escHtml(ws.manifest?.status || 'active')}</span>
        ${ws.manifest?.summary ? html` ${escHtml(ws.manifest.summary)}` : null}
      </div>

      <div class="pj-gate">
        <button class="btn-outline btn-sm" onClick=${() => setShowSettings(s => !s)}>${'⚙ '}${t('organisms.settings') || 'Settings'}</button>
        <button class="btn-outline btn-sm" onClick=${() => setShowSpaces(s => !s)}>${'+ '}${t('organisms.addSpaceBtn') || 'Space'}</button>
        <span class="pj-ai-prompt">
          <span class="pj-ai-prompt-label">${'🤖 '}${t('organisms.aiPrompt') || 'AI access prompt:'}</span>
          <button class="btn-ghost btn-sm" onClick=${() => copyAccessPrompt('human')}>${t('organisms.aiPromptHuman') || 'For chat'}</button>
          <button class="btn-ghost btn-sm" onClick=${() => copyAccessPrompt('agent')}>${t('organisms.aiPromptAgent') || 'For coding agent'}</button>
        </span>
        <label class="pj-gate-label">
          <input type="checkbox" checked=${gateOn} onChange=${toggleGate} disabled=${busy} />
          ${' '}${t('organisms.publishGate') || 'Require review before publishing'}
        </label>
      </div>

      ${showSpaces && html`
        <div class="pj-inbox pj-spaces-add">
          <div class="card-h3">${t('organisms.addSpaceTitle') || 'Add a space'}</div>
          <div class="section-desc">${t('organisms.addSpaceDesc') || 'A document space is a free-form wiki (sections + markdown pages). A record space is a schema-locked list (forms). You can remove spaces in Settings.'}</div>
          <div class="pj-space-row">
            <input type="text" class="input-field input-sm" placeholder=${t('organisms.spaceName') || 'New space name'} value=${newSpaceName} onInput=${e => setNewSpaceName(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') addSpaceHandler(); }} />
            <select class="input-field input-sm" value=${newSpaceMode} onChange=${e => setNewSpaceMode(e.target.value)}>
              <option value="document">${t('organisms.modeDocument') || 'Document (wiki)'}</option>
              <option value="records">${t('organisms.modeRecords') || 'Records (form)'}</option>
            </select>
            <button class="btn-primary btn-sm" onClick=${addSpaceHandler} disabled=${busy || !newSpaceName.trim()}>${t('organisms.addSpace') || '+ Add'}</button>
            <button class="btn-ghost btn-sm" onClick=${() => setShowSpaces(false)}>${t('organisms.cancel') || 'Cancel'}</button>
          </div>
        </div>`}

      ${showSettings && html`
        <div class="pj-inbox">
          <div class="card-h3">${t('organisms.settings') || 'Workspace settings'}</div>
          <label class="pj-field"><span>${t('organisms.wsName') || 'Name'}</span>
            <input type="text" class="input-field input-sm" value=${sName} onInput=${e => setSName(e.target.value)} /></label>
          <label class="pj-field"><span>${t('organisms.wsSummary') || 'Summary'}</span>
            <textarea class="input-field input-sm" rows="2" value=${sSummary} onInput=${e => setSSummary(e.target.value)}></textarea></label>
          <label class="pj-field"><span>${t('organisms.autonomy') || 'AI autonomy (L1 cautious → L5 free)'}</span>
            <select class="input-field input-sm" value=${sAutonomy} onChange=${e => setSAutonomy(e.target.value)}>
              ${['L1', 'L2', 'L3', 'L4', 'L5'].map(l => html`<option value=${l} key=${l}>${l}</option>`)}
            </select></label>
          <div class="pj-empty">${t('organisms.template') || 'Template'}: ${escHtml(ws.manifest?.kind || '')}</div>
          <div class="form-actions">
            <button class="btn-primary btn-sm" onClick=${saveSettings} disabled=${busy}>${t('organisms.save') || 'Save'}</button>
            <button class="btn-ghost btn-sm" onClick=${() => setShowSettings(false)}>${t('organisms.cancel') || 'Cancel'}</button>
          </div>

          <div class="pj-divider"></div>
          <div class="card-h3">${t('organisms.spaces') || 'Spaces'}</div>
          ${(ws.manifest?.objectTypes || []).map(ot => html`
            <div class="pj-doc-row" key=${'sp' + ot.name}>
              <span class="pj-space-name">${escHtml(ot.name)}<span class="pj-doc-tag">${ot.mode === 'document' ? (t('organisms.docs') || 'docs') : (t('organisms.recordsMode') || 'records')}</span></span>
              <button class="btn-ghost btn-sm" onClick=${() => removeSpaceHandler(ot.name)} disabled=${busy}>${t('organisms.remove') || 'Remove'}</button>
            </div>
          `)}
          <div class="form-actions">
            <input type="text" class="input-field input-sm" placeholder=${t('organisms.spaceName') || 'New space name'} value=${newSpaceName} onInput=${e => setNewSpaceName(e.target.value)} />
            <select class="input-field input-sm" value=${newSpaceMode} onChange=${e => setNewSpaceMode(e.target.value)}>
              <option value="document">${t('organisms.docsSpace') || 'document space'}</option>
              <option value="records">${t('organisms.recordsSpace') || 'records type'}</option>
            </select>
            <button class="btn-outline btn-sm" onClick=${addSpaceHandler} disabled=${busy || !newSpaceName.trim()}>${t('organisms.addSpace') || '+ Add'}</button>
          </div>

          <div class="pj-divider"></div>
          <button class="btn-outline btn-sm" onClick=${() => setShowRegenerate(s => !s)}>
            ${showRegenerate ? (t('organisms.cancel') || 'Cancel') : (t('organisms.restructure') || '✨ Restructure / add types with AI')}
          </button>
          ${showRegenerate && renderGenerator()}

          <div class="pj-danger">
            <div class="pj-danger-title">${t('organisms.dangerZone') || 'Danger zone'}</div>
            <div class="section-desc">${t('organisms.deleteWarn') || 'Deleting the workspace removes the manifest and ALL its data — drafts, published records, version history — and its schemas. The organism stays. This cannot be undone.'}</div>
            <label class="pj-field"><span>${(t('organisms.deleteConfirmLabel') || 'Type the workspace name to confirm') + ': ' + (ws.manifest?.name || '')}</span>
              <input type="text" class="input-field input-sm" value=${delConfirm} onInput=${e => setDelConfirm(e.target.value)} placeholder=${ws.manifest?.name || ''} /></label>
            <button class="btn-danger btn-sm" onClick=${delWorkspace}
              disabled=${busy || delConfirm.trim() !== (ws.manifest?.name || '').trim()}>${t('organisms.deleteWorkspace') || 'Delete workspace'}</button>
          </div>
        </div>
      `}

      ${approvals.length > 0 && html`
        <div class="pj-inbox">
          <div class="card-h3">${t('organisms.needsDecision') || 'Needs your decision'} (${approvals.length})</div>
          ${approvals.map(a => html`
            <div class="pj-approval" key=${a.id}>
              <div class="pj-approval-text">${escHtml(a.prompt || a.action)}</div>
              <div class="card-actions">
                <button class="btn-success btn-sm" onClick=${() => resolve(a.id, 'approve')} disabled=${busy}>${t('organisms.approve') || 'Approve'}</button>
                <button class="btn-danger btn-sm" onClick=${() => resolve(a.id, 'reject')} disabled=${busy}>${t('organisms.reject') || 'Reject'}</button>
              </div>
            </div>
          `)}
        </div>
      `}

      ${ws.manifest ? html`
        <div class="pj-chart">
          <div class="pj-chart-head">
            <span class="pj-chart-title">${'🔄 '}${t('organisms.editFlow') || 'How editing works here'}</span>
            <button class="btn-ghost btn-sm" onClick=${() => setShowFlow(s => !s)}>${showFlow ? (t('organisms.hide') || 'Hide') : (t('organisms.show') || 'Show')}</button>
          </div>
          ${showFlow ? html`<${Mermaid} chart=${orgService.buildEditFlowMermaid(ws.manifest, gateOn)} />` : null}
        </div>` : null}

      ${types.map(ot => ot.mode === 'document' ? renderDocSpace(ot) : html`
        <div class="pj-section" key=${ot.name}>
          <div class="pj-section-head">
            <span class="pj-section-title">${escHtml(ot.name)}</span>
            ${ot.append ? null : html`<button class="btn-outline btn-sm" onClick=${() => startAdd(ot)}>${'+ '}${t('organisms.addDraft') || 'Add draft'}</button>`}
          </div>

          ${adding === ot.name && (addingSchema
            ? html`<${SchemaForm} key=${'sf-' + (addingId || 'new')} schema=${addingSchema} busy=${busy} initial=${addingInitial}
                onSave=${(v) => saveDraft(ot, addingId ? { ...v, id: addingId } : v)} onCancel=${cancelForm} />`
            : html`<${Spinner} />`)}

          ${draftsFor(ot.name).map((d, i) => html`
            <div class="pj-rec" key=${'d' + i}>
              <div class="pj-item pj-item-draft">
                <span class="badge badge-warn">${t('organisms.draft') || 'draft'}</span>
                <button class="pj-rec-title" onClick=${() => toggleExpand(ot, d.id)}>${escHtml(String(d[PRIMARY_FIELD[ot.name] || 'title'] || d.id || ''))}</button>
                <button class="btn-ghost btn-sm" onClick=${() => startEdit(ot, d)} disabled=${busy}>${t('organisms.edit') || 'Edit'}</button>
                <button class="btn-primary btn-sm" onClick=${() => publish(ot, d.id)} disabled=${busy}>${t('organisms.publish') || 'Publish'}</button>
              </div>
              ${expandedRec[ot.name + ':' + d.id] ? html`<div class="pj-rec-fields">${recordFields(d)}</div>` : null}
            </div>
          `)}

          ${objectsFor(ot.name).length === 0 && draftsFor(ot.name).length === 0
            ? html`<${EmptyState} text=${t('organisms.noneYet') || 'none yet'} />`
            : objectsFor(ot.name).map((o, i) => html`
              <div class="pj-rec" key=${'o' + i}>
                <div class="pj-item">
                  <button class="pj-rec-title" onClick=${() => toggleExpand(ot, o.id)}>${escHtml(String(o[PRIMARY_FIELD[ot.name] || 'title'] || o.summary || o.id || ''))}</button>
                  ${o.status ? html`<span class="badge badge-info">${escHtml(o.status)}</span>` : null}
                </div>
                ${expandedRec[ot.name + ':' + o.id] ? html`<div class="pj-rec-fields">${recordFields(o)}</div>` : null}
              </div>
            `)
          }
        </div>
      `)}

      <${SourcesPanel} orgId=${orgId} wsId=${wsId} showToast=${showToast} />

      ${(ws.decisions || []).length > 0 && html`
        <div class="pj-section">
          <div class="pj-section-title">${t('organisms.decisions') || 'Recent decisions'}</div>
          ${ws.decisions.slice(-8).reverse().map((d, i) => html`
            <div class="pj-item pj-decision" key=${'dec' + i}><span class="pj-item-text">${escHtml(String(d.summary || ''))}</span></div>
          `)}
        </div>
      `}
    </div>
  `;
}

/* Sources: references the workspace draws on — memory entries, storage files, and knowledge
 * packages (own, or external/read-only). Pointers ONLY: nothing is copied or moved; the referenced
 * data stays where it lives (organism.{id}.meta.sources holds just the pointers). Attach via a
 * picker with Memory / Storage / Knowledge tabs (Mine, or Discover for memory + knowledge). */
const SRC_ICON = { memory: '🧠', storage: '📎', knowledge: '📚' };
function SourcesPanel({ orgId, wsId, showToast }) {
  const [sources, setSources] = useState([]);
  const [picking, setPicking] = useState(false);
  const [tab, setTab] = useState('knowledge');   // memory | storage | knowledge
  const [scope, setScope] = useState('mine');     // mine | discover (storage has no discover)
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { setSources(await orgService.getWorkspaceSources(orgId, wsId)); }, [orgId, wsId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener('aimeat-live-update', h);
    return () => window.removeEventListener('aimeat-live-update', h);
  }, [load]);

  const persist = async (next) => {
    setSources(next);
    const r = await orgService.saveWorkspaceSources(orgId, wsId, next).catch(() => ({ ok: false }));
    if (r?.ok === false) showToast(t('organisms.sourcesSaveError') || 'Failed to save sources');
  };

  const doSearch = async () => {
    setLoading(true);
    const ql = q.trim().toLowerCase();
    try {
      if (tab === 'memory') {
        if (scope === 'mine') {
          const items = await memoryService.listMemories();
          setResults(items.filter(i => !ql || String(i.key).toLowerCase().includes(ql)).slice(0, 100));
        } else {
          const d = await memoryService.discoverPublicMemories({ q: q.trim(), limit: 50 });
          setResults(d.items || []);
        }
      } else if (tab === 'storage') {
        const files = await orgService.listOwnStorageFiles();
        setResults(files.filter(f => !ql || String(f.key).toLowerCase().includes(ql)));
      } else if (scope === 'mine') {
        const pkgs = await knowledgeService.listMyPackages();
        setResults(pkgs.filter(p => { const n = String(p.value?.name || p.key || ''); return !ql || n.toLowerCase().includes(ql); }));
      } else {
        const r = await knowledgeService.discoverPackages({ limit: 50, sort: 'recent' });
        setResults((r?.data?.packages || []).filter(p => !ql || String(p.name || '').toLowerCase().includes(ql)));
      }
    } catch (e) { setResults([]); }
    finally { setLoading(false); }
  };
  const searchRef = useRef(doSearch); searchRef.current = doSearch;
  // Auto-search when the picker opens or the tab/scope changes — but NOT on every keystroke
  // (typing only updates q; Enter or the Search button runs it).
  useEffect(() => { if (picking) searchRef.current(); }, [picking, tab, scope]);
  // storage has no cross-owner discovery — force 'mine' there
  useEffect(() => { if (tab === 'storage' && scope !== 'mine') setScope('mine'); }, [tab, scope]);

  const keyOf = (s) => `${s.type}:${s.packageId || (s.ownerGaii || '') + '|' + (s.key || '')}`;
  const attach = async (item) => {
    setBusy(true);
    try {
      const base = { id: 's-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), addedAt: new Date().toISOString() };
      let src;
      if (tab === 'memory') {
        src = { ...base, type: 'memory', key: item.key, ownerGaii: item.owner_gaii || orgService.currentGhii(), label: item.key, external: scope === 'discover' };
      } else if (tab === 'storage') {
        src = { ...base, type: 'storage', key: item.key, ownerGaii: orgService.currentGhii(), label: item.key, mime: item.mime_type, external: false };
      } else {
        const pid = scope === 'mine' ? ((String(item.key).match(/packages\/([^/]+)\/manifest/) || [])[1] || item.key) : item.package_id;
        const name = scope === 'mine' ? (item.value?.name || pid) : (item.name || pid);
        src = { ...base, type: 'knowledge', packageId: pid, label: name, external: scope === 'discover' };
      }
      if (sources.some(s => keyOf(s) === keyOf(src))) { showToast(t('organisms.sourceExists') || 'Already added'); return; }
      await persist([...sources, src]);
      showToast(t('organisms.sourceAdded') || 'Source added');
    } finally { setBusy(false); }
  };
  const removeSource = (id) => persist(sources.filter(s => s.id !== id));

  const resultRow = (item, i) => {
    let label, meta;
    if (tab === 'memory') { label = item.key; meta = (scope === 'discover' ? (item.owner_gaii + ' · ') : '') + (item.visibility || ''); }
    else if (tab === 'storage') { label = item.key; meta = (item.mime_type || '') + ' · ' + fmtBytes(item.size || 0); }
    else { label = scope === 'mine' ? (item.value?.name || item.key) : (item.name || item.package_id); meta = (scope === 'mine' ? (item.value?.entries?.length || 0) : (item.entries_count || 0)) + ' ' + (t('organisms.entries') || 'entries'); }
    return html`
      <div class="pj-src-result" key=${'r' + i}>
        <span class="pj-src-result-label" title=${String(label)}>${escHtml(String(label))}</span>
        <span class="pj-src-result-meta">${escHtml(String(meta))}</span>
        <button class="btn-ghost btn-sm" disabled=${busy} onClick=${() => attach(item)}>${t('organisms.attach') || 'Attach'}</button>
      </div>`;
  };

  return html`
    <div class="pj-section pj-sources">
      <div class="pj-section-head">
        <span class="pj-section-title">${t('organisms.sources') || 'Sources'}<span class="pj-doc-tag">${sources.length}</span></span>
        <button class="btn-outline btn-sm" onClick=${() => setPicking(p => !p)}>
          ${picking ? (t('organisms.close') || 'Close') : ('+ ' + (t('organisms.addSource') || 'Add source'))}
        </button>
      </div>
      <div class="section-desc pj-sources-desc">${t('organisms.sourcesDesc') || 'References this workspace draws on — memory, files, and knowledge packages. Pointers only; the originals stay where they live.'}</div>

      ${picking ? html`
        <div class="pj-src-picker">
          <div class="seg" role="tablist">
            ${['memory', 'storage', 'knowledge'].map(tk => html`<button class="seg-btn ${tab === tk ? 'active' : ''}" key=${tk} onClick=${() => setTab(tk)}>${SRC_ICON[tk]} ${t('organisms.src_' + tk) || tk}</button>`)}
          </div>
          <div class="pj-src-controls">
            ${tab !== 'storage' ? html`
              <div class="seg">
                <button class="seg-btn ${scope === 'mine' ? 'active' : ''}" onClick=${() => setScope('mine')}>${t('organisms.mine') || 'Mine'}</button>
                <button class="seg-btn ${scope === 'discover' ? 'active' : ''}" onClick=${() => setScope('discover')}>${t('organisms.discover') || 'Discover'}</button>
              </div>` : null}
            <div class="pj-src-search"><${SearchBar} value=${q} onInput=${e => setQ(e.target.value)} onSubmit=${() => doSearch()} placeholder=${t('organisms.searchSources') || 'Search…'} /></div>
            <button class="btn-ghost btn-sm" onClick=${doSearch} disabled=${loading}>${t('organisms.search') || 'Search'}</button>
          </div>
          <div class="pj-src-results">
            ${loading ? html`<${EmptyState} text=${t('organisms.loading') || 'Loading…'} />`
              : results.length === 0 ? html`<${EmptyState} text=${t('organisms.noResults') || 'No results'} />`
              : results.slice(0, 100).map(resultRow)}
          </div>
        </div>` : null}

      ${sources.length === 0 ? html`<${EmptyState} text=${t('organisms.noSources') || 'No sources yet'} />`
        : html`<div class="pj-src-list">
          ${sources.map(s => html`
            <div class="pj-src-item" key=${s.id}>
              <span class="pj-src-icon">${SRC_ICON[s.type] || '•'}</span>
              <span class="pj-src-label" title=${s.key || s.packageId || ''}>${escHtml(String(s.label || s.key || s.packageId || ''))}</span>
              ${s.external ? html`<span class="badge badge-muted pj-mini">${t('organisms.external') || 'external'}</span>` : null}
              <span class="badge badge-info pj-mini">${t('organisms.src_' + s.type) || s.type}</span>
              <button class="pj-icon-btn" title=${t('organisms.remove') || 'Remove'} onClick=${() => removeSource(s.id)}>✕</button>
            </div>`)}
        </div>`}
    </div>`;
}

/* A form rendered from a JSON Schema — typed inputs (enum→select, integer→number,
 * array→lines, boolean→checkbox, else text). Works for any objectType, including ones a
 * generated manifest declares. `id` is auto-generated when blank, so it's never required here. */
function SchemaForm({ schema, busy, onSave, onCancel, initial }) {
  const props = (schema && schema.properties) || {};
  const required = new Set(((schema && schema.required) || []).filter(k => k !== 'id'));
  const fieldNames = Object.keys(props);
  // Seed from an existing record when editing (arrays → newline text for the textarea inputs).
  const [vals, setVals] = useState(() => {
    const out = {};
    for (const [k, def] of Object.entries(props)) {
      const v = initial && initial[k];
      if (v === undefined || v === null) continue;
      out[k] = Array.isArray(v) ? v.join('\n') : (def.type === 'boolean' ? !!v : String(v));
    }
    return out;
  });
  const set = (k, v) => setVals(s => ({ ...s, [k]: v }));

  const buildValue = () => {
    const out = {};
    for (const [k, def] of Object.entries(props)) {
      const raw = vals[k];
      if (raw === undefined || raw === '') continue;
      if (def.type === 'integer' || def.type === 'number') out[k] = Number(raw);
      else if (def.type === 'boolean') out[k] = !!raw;
      else if (def.type === 'array') out[k] = String(raw).split('\n').map(s => s.trim()).filter(Boolean);
      else out[k] = raw;
    }
    return out;
  };

  const canSave = [...required].every(k => vals[k] !== undefined && String(vals[k]).trim() !== '');

  const field = (k, def) => {
    const label = k + (required.has(k) ? ' *' : '');
    if (def.type === 'string' && Array.isArray(def.enum)) {
      return html`<label class="pj-field" key=${k}><span>${label}</span>
        <select class="input-field input-sm" value=${vals[k] ?? ''} onChange=${e => set(k, e.target.value)}>
          <option value="">—</option>${def.enum.map(o => html`<option value=${o} key=${o}>${o}</option>`)}
        </select></label>`;
    }
    // Date / datetime fields → native pickers (by schema format, or a name ending in _date).
    if (def.format === 'date-time') {
      return html`<label class="pj-field" key=${k}><span>${label}</span>
        <input type="datetime-local" class="input-field input-sm" value=${vals[k] ?? ''} onInput=${e => set(k, e.target.value)} /></label>`;
    }
    if (def.format === 'date' || (def.type === 'string' && !def.enum && /(_date$|^date$)/i.test(k))) {
      return html`<label class="pj-field" key=${k}><span>${label}</span>
        <input type="date" class="input-field input-sm" value=${vals[k] ?? ''} onInput=${e => set(k, e.target.value)} /></label>`;
    }
    if (def.type === 'integer' || def.type === 'number') {
      return html`<label class="pj-field" key=${k}><span>${label}</span>
        <input type="number" class="input-field input-sm" value=${vals[k] ?? ''} onInput=${e => set(k, e.target.value)} /></label>`;
    }
    if (def.type === 'boolean') {
      return html`<label class="pj-field pj-field-inline" key=${k}><input type="checkbox" checked=${!!vals[k]} onChange=${e => set(k, e.target.checked)} /><span>${label}</span></label>`;
    }
    if (def.type === 'array') {
      return html`<label class="pj-field" key=${k}><span>${label} ${'(' + (t('organisms.onePerLine') || 'one per line') + ')'}</span>
        <textarea class="input-field input-sm" rows="2" value=${vals[k] ?? ''} onInput=${e => set(k, e.target.value)}></textarea></label>`;
    }
    return html`<label class="pj-field" key=${k}><span>${label}</span>
      <input type="text" class="input-field input-sm" value=${vals[k] ?? ''} onInput=${e => set(k, e.target.value)} /></label>`;
  };

  return html`
    <div class="create-form pj-draft-form">
      <div class="flex-col">
        ${fieldNames.length === 0
          ? html`<div class="pj-empty">${t('organisms.loading') || 'Loading...'}</div>`
          : fieldNames.map(k => field(k, props[k]))}
        <div class="form-actions">
          <button class="btn-primary btn-sm" onClick=${() => onSave(buildValue())} disabled=${busy || !canSave}>${t('organisms.saveDraft') || 'Save draft'}</button>
          <button class="btn-ghost btn-sm" onClick=${onCancel}>${t('organisms.cancel') || 'Cancel'}</button>
        </div>
      </div>
    </div>
  `;
}

/* Free-form markdown page editor for document-mode object types: a title + a markdown textarea
 * with a live preview (reusing the safe Markdown renderer). Saves as a draft, versioned on publish. */
// Lazy-load the vendored Toast UI Editor (MIT, /lib/toastui/) only when a document is edited —
// it's ~520KB, so it stays out of the main bundle. Resolves window.toastui.Editor.
let _tuiPromise = null;
function loadToastUI() {
  if (window.toastui && window.toastui.Editor) return Promise.resolve(window.toastui.Editor);
  if (_tuiPromise) return _tuiPromise;
  _tuiPromise = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = '/lib/toastui/toastui-editor.min.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = '/lib/toastui/toastui-editor-all.min.js';
    s.onload = () => (window.toastui && window.toastui.Editor) ? resolve(window.toastui.Editor) : reject(new Error('editor missing'));
    s.onerror = () => reject(new Error('failed to load editor'));
    document.head.appendChild(s);
  });
  return _tuiPromise;
}

/* Read-only document view. Renders the markdown, resolves private /v1/storage images (the GET needs
 * the session token, so a plain <img> would break), and — when the document has BOTH an unpublished
 * draft and a published version — offers a Draft/Published toggle so the two can be compared. The
 * parent passes the merged `page` (the draft, carrying the published copy on `page._pub`). Remounted
 * per document via `key`, so the toggle resets to "Draft" each time a document is opened. */
function DocumentView({ page, busy, onEdit, onPublish, onWikiLink }) {
  const hasBoth = page._draft && page._pub;
  const [tab, setTab] = useState('draft');
  const shown = (hasBoth && tab === 'published') ? page._pub : page;
  const [rendered, setRendered] = useState(shown.markdown || '');

  // Resolve private /v1/storage images to auth'd blob: URLs IN THE MARKDOWN TEXT (declarative), then
  // render that. Doing it in the text — instead of mutating <img src> after render — means a
  // re-render (toggling Draft/Published, a live-update refresh) can never leave a stale or revoked
  // object URL on a reused <img> node, which previously showed a broken image. Re-runs per version.
  useEffect(() => {
    let cancelled = false; const created = [];
    const raw = shown.markdown || '';
    setRendered(raw);   // show text/structure at once; images swap in a moment later
    (async () => {
      const urls = [...new Set(raw.match(/\/v1\/storage\/[^\s)\]"'>]+/g) || [])];
      if (!urls.length) return;
      let out = raw;
      for (const su of urls) {
        try { const bu = await orgService.fetchStorageObjectUrl(su); created.push(bu); out = out.split(su).join(bu); }
        catch (e) { /* leave the storage URL — renders broken but never throws */ }
      }
      if (!cancelled) setRendered(out);
    })();
    return () => { cancelled = true; created.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) { /* noop */ } }); };
  }, [shown.markdown]);

  // created/saved/published timestamps come from the workspace read (record metadata on the value).
  const created = page._createdAt || page._pub?._createdAt;
  const savedAt = page._draft ? page._updatedAt : null;          // draft = working copy → "last saved"
  const publishedAt = page._pub?._updatedAt || (!page._draft && page._published ? page._updatedAt : null);

  return html`
    <div class="pj-doc-toolbar">
      <span class="pj-doc-vtitle">${escHtml(shown.title || shown.id || page.id)}</span>
      ${hasBoth ? html`
        <div class="seg" role="tablist">
          <button class="seg-btn ${tab === 'draft' ? 'active' : ''}" onClick=${() => setTab('draft')}>${t('organisms.draftVersion') || 'Draft'}</button>
          <button class="seg-btn ${tab === 'published' ? 'active' : ''}" onClick=${() => setTab('published')}>${t('organisms.publishedVersion') || 'Published'}</button>
        </div>` : null}
      <button class="btn-ghost btn-sm" onClick=${onEdit}>${t('organisms.edit') || 'Edit'}</button>
      ${page._draft ? html`<button class="btn-primary btn-sm" onClick=${onPublish} disabled=${busy}>${t('organisms.publish') || 'Publish'}</button>` : null}
    </div>
    ${(created || savedAt || publishedAt) ? html`
      <div class="pj-doc-meta">
        ${created ? html`<${KeyValueRow} label=${t('organisms.createdAt') || 'Created'} value=${dt(created)} />` : null}
        ${savedAt ? html`<${KeyValueRow} label=${t('organisms.lastSaved') || 'Last saved'} value=${dt(savedAt)} />` : null}
        ${publishedAt ? html`<${KeyValueRow} label=${t('organisms.publishedAt') || 'Published'} value=${dt(publishedAt)} />` : null}
      </div>` : null}
    <div class="pj-doc-view"><${Markdown} text=${rendered} onWikiLink=${onWikiLink} /></div>`;
}

/* Document editor: a Toast UI Editor (WYSIWYG, with its own built-in Markdown⇄WYSIWYG toggle, so
 * non-technical users type like a document). Falls back to a plain markdown textarea + live preview
 * if the editor can't load. Title is a separate Preact-controlled field. */
function DocumentEditor({ orgId, page, busy, onSave, onCancel }) {
  const [title, setTitle] = useState((page && page.title) || '');
  const [mode, setMode] = useState('rich');               // 'rich' = Toast UI; 'markdown' = fallback textarea
  const [md, setMd] = useState((page && page.markdown) || '');
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const imageMap = useRef({});                             // data: URL (shown in editor) → /v1/storage URL (saved)
  const displayMap = useRef({});                           // blob: URL (shown in editor) → /v1/storage URL (saved) — for already-stored images
  const pending = useRef([]);                              // in-flight image uploads — save() awaits these
  const [saving, setSaving] = useState(false);
  const [images, setImages] = useState([]);                // embedded /v1/storage images: [{key, alt, visibility}]
  const [imgBusy, setImgBusy] = useState(false);

  // Load the visibility of the document's already-saved /v1/storage images, so the author can make
  // them public (a private image won't load for other viewers of a shared/published document).
  // Newly-pasted images appear here after the first save + reopen.
  useEffect(() => {
    let cancelled = false;
    const embedded = orgService.extractStorageImages((page && page.markdown) || '');
    if (!embedded.length) { setImages([]); return undefined; }
    orgService.listStorageVisibilities().then((vis) => {
      if (!cancelled) setImages(embedded.map(e => ({ ...e, visibility: vis[e.key] || 'private' })));
    }).catch(() => { if (!cancelled) setImages(embedded.map(e => ({ ...e, visibility: 'private' }))); });
    return () => { cancelled = true; };
  }, []);

  const changeImageVisibility = async (key, visibility) => {
    setImgBusy(true);
    try {
      const r = await orgService.setImageVisibility(key, visibility);
      if (r?.ok === false) throw new Error(r?.error?.message || 'Failed');
      setImages(imgs => imgs.map(i => i.key === key ? { ...i, visibility } : i));
    } catch (e) { /* leave as-is; a failed toggle just doesn't change the pill */ }
    finally { setImgBusy(false); }
  };
  const makeAllImagesPublic = async () => {
    setImgBusy(true);
    try {
      const targets = images.filter(i => i.visibility !== 'public');
      await Promise.all(targets.map(i => orgService.setImageVisibility(i.key, 'public').catch(() => {})));
      setImages(imgs => imgs.map(i => ({ ...i, visibility: 'public' })));
    } finally { setImgBusy(false); }
  };

  // Show the image instantly via a data URL, upload to storage in the background, and remember the
  // mapping so save() rewrites the data URL to the storage URL. If the upload fails, the image stays
  // inline (still renders + saves, just larger) — so an image NEVER silently disappears.
  const uploadAndMap = (blob, dataUrl) => {
    pending.current.push(
      orgService.uploadImage(orgId, blob, blob.type || 'image/png')
        .then((url) => { imageMap.current[dataUrl] = url; })
        .catch(() => { /* keep the inline data URL */ }),
    );
  };
  const insertFromFile = async (file) => {
    if (!file) return;
    const dataUrl = await orgService.blobToDataUrl(file);
    if (mode === 'rich' && editorRef.current) editorRef.current.exec('addImage', { imageUrl: dataUrl, altText: file.name || 'image' });
    else setMd((m) => m + `\n\n![${file.name || 'image'}](${dataUrl})\n`);
    uploadAndMap(file, dataUrl);
  };

  useEffect(() => {
    if (mode !== 'rich') return undefined;
    let inst = null, cancelled = false; const blobUrls = [];
    (async () => {
      const Editor = await loadToastUI().catch(() => null);
      if (cancelled) return;
      if (!Editor) { setMode('markdown'); return; }
      // Already-stored images embed a private /v1/storage URL, which a plain <img> in the editor
      // can't load (the GET needs the session token). Fetch each with auth, show it as a blob: URL,
      // and remember blob→storage so save() rewrites it back to the canonical storage URL.
      let initial = (page && page.markdown) || '';
      const urls = [...new Set(initial.match(/\/v1\/storage\/[^\s)\]"'>]+/g) || [])];
      for (const su of urls) {
        try {
          const bu = await orgService.fetchStorageObjectUrl(su);
          displayMap.current[bu] = su; blobUrls.push(bu);
          initial = initial.split(su).join(bu);
        } catch (e) { /* leave the storage URL — it renders broken but saves intact */ }
      }
      if (cancelled || !containerRef.current) return;
      inst = new Editor({
        el: containerRef.current,
        height: '440px',
        initialEditType: 'wysiwyg',
        previewStyle: 'tab',
        initialValue: initial,
        usageStatistics: false,
        // Drop Toast UI's own image button — its file popup is unreliable; the "📷 Insert image"
        // button above is the image path (and paste/drag still work via the hook below).
        toolbarItems: [
          ['heading', 'bold', 'italic', 'strike'],
          ['hr', 'quote'],
          ['ul', 'ol', 'task', 'indent', 'outdent'],
          ['table', 'link'],
          ['code', 'codeblock'],
        ],
        hooks: {
          // Paste/drag an image → insert it as a data URL (shows at once) + upload in the background.
          addImageBlobHook: async (blob, callback) => {
            const dataUrl = await orgService.blobToDataUrl(blob);
            callback(dataUrl, '');
            uploadAndMap(blob, dataUrl);
          },
        },
      });
      editorRef.current = inst;
    })();
    return () => {
      cancelled = true;
      if (inst) { try { inst.destroy(); } catch (e) { /* noop */ } }
      editorRef.current = null;
      blobUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) { /* noop */ } });
    };
  }, [mode]);

  const save = async () => {
    setSaving(true);
    try {
      if (pending.current.length) { await Promise.all(pending.current); pending.current = []; }  // finish uploads first
      let markdown = (mode === 'rich' && editorRef.current) ? editorRef.current.getMarkdown() : md;
      for (const [dataUrl, storageUrl] of Object.entries(imageMap.current)) markdown = markdown.split(dataUrl).join(storageUrl);
      for (const [blobUrl, storageUrl] of Object.entries(displayMap.current)) markdown = markdown.split(blobUrl).join(storageUrl);
      // Point each image at the URL form its visibility needs: public → /v1/pub/<ghii>/<key> (loads
      // for any viewer), private → /v1/storage/<key> (owner-only). So a public document's images render.
      const visByKey = {}; for (const im of images) visByKey[im.key] = im.visibility;
      markdown = orgService.applyImageVisibilityUrls(markdown, visByKey, orgService.currentGhii());
      onSave({ ...page, title: title.trim(), markdown });
    } finally { setSaving(false); }
  };

  return html`
    <div class="pj-doc-editor">
      <input type="text" class="input-field input-sm" placeholder=${t('organisms.pageTitle') || 'Document title'}
        value=${title} onInput=${e => setTitle(e.target.value)} />
      <div class="pj-doc-imgbar">
        <label class="btn-outline btn-sm pj-file-btn">
          <span class="pj-file-btn-icon">📷</span> ${t('organisms.insertImage') || 'Upload image from file'}
          <input type="file" accept="image/*" hidden onChange=${e => { insertFromFile(e.target.files && e.target.files[0]); e.target.value = ''; }} />
        </label>
        <span class="pj-imgbar-hint">${t('organisms.orPaste') || '…or paste / drag an image into the editor'}</span>
      </div>
      ${images.length ? html`
        <div class="pj-img-vis">
          <div class="pj-img-vis-head">
            <span class="pj-img-vis-title">${t('organisms.fileVisibility') || 'File visibility'}</span>
            <span class="pj-img-vis-note">${t('organisms.fileVisibilityNote') || 'Private files only load for you — make them public to share the document.'}</span>
            ${images.some(i => i.visibility !== 'public') ? html`<button class="btn-ghost btn-sm" disabled=${imgBusy} onClick=${makeAllImagesPublic}>${t('organisms.makeAllPublic') || 'Make all public'}</button>` : null}
          </div>
          ${images.map(i => html`
            <div class="pj-img-vis-row" key=${i.key}>
              <span class="pj-img-vis-name" title=${i.key}>${escHtml(i.alt)}</span>
              <${VisibilityPill} visibility=${i.visibility} onClick=${() => { if (!imgBusy) changeImageVisibility(i.key, i.visibility === 'public' ? 'private' : 'public'); }} />
            </div>`)}
        </div>` : null}
      ${mode === 'rich'
        ? html`<div ref=${containerRef} class="pj-tui"></div>`
        : html`<div class="pj-doc-grid">
            <textarea class="input-field pj-doc-md" rows="14" placeholder=${t('organisms.writeMarkdown') || 'Write markdown…'}
              value=${md} onInput=${e => setMd(e.target.value)}></textarea>
            <div class="pj-doc-preview"><${Markdown} text=${md} /></div>
          </div>`}
      <div class="form-actions">
        <button class="btn-primary btn-sm" onClick=${save} disabled=${busy || saving || !title.trim()}>
          ${saving ? html`<span class="spinner"></span> ${t('organisms.saving') || 'Saving…'}` : (t('organisms.saveDraft') || 'Save draft')}
        </button>
        <button class="btn-ghost btn-sm" onClick=${onCancel}>${t('organisms.cancel') || 'Cancel'}</button>
      </div>
    </div>
  `;
}
