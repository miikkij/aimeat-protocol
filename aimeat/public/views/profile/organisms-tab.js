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
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Spinner } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import * as orgService from '/js/services/organisms.js';

export default function OrganismsTab({ session, showToast, onStats }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [myOrganisms, setMyOrganisms] = useState(null);
  const [publicOrganisms, setPublicOrganisms] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [openId, setOpenId] = useState(null);   // organism whose workspace is open
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
                <button class="btn-primary btn-sm" onClick=${(e) => { e.stopPropagation(); setOpenId(org.id); }}>
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
    return html`<${Workspace} org=${org} session=${session} showToast=${showToast} onBack=${() => { setOpenId(null); loadData(); }} />`;
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

function Workspace({ org, showToast, onBack }) {
  const orgId = org.id;
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

  const load = useCallback(async () => {
    const w = await orgService.getWorkspace(orgId).catch(() => null);
    if (w && w.manifest) {
      const [ap, cfg] = await Promise.all([
        orgService.listApprovals(orgId, 'pending').catch(() => []),
        orgService.getConfig(orgId).catch(() => ({})),
      ]);
      setApprovals(ap); setGateOn(!!(cfg?.gates?.publish?.enabled));
    }
    setWs(w && w.manifest ? w : null);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);
  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => {
    const handler = () => liveRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  const setup = useCallback(async () => {
    setBusy(true);
    try {
      await orgService.applyProjectTemplate(orgId, org.name || 'Project', org.description || '');
      showToast(t('organisms.workspaceReady') || 'Workspace ready');
      await load();
    } catch (e) { showToast((e && e.message) || (t('organisms.setupError') || 'Failed to set up workspace')); }
    finally { setBusy(false); }
  }, [orgId, org, showToast, load]);

  const startAdd = useCallback(async (ot) => {
    setAdding(ot.name); setAddingSchema(null);
    const s = await orgService.getObjectSchema(orgId, ot.namespace);
    setAddingSchema(s || { properties: { id: { type: 'string' }, title: { type: 'string' } }, required: ['title'] });
  }, [orgId]);

  const saveDraft = useCallback(async (ot, value) => {
    const id = (String(value.id || '').trim() || `${ot.name}-${Date.now().toString(36)}`).replace(/[^a-zA-Z0-9_-]/g, '-');
    setBusy(true);
    try {
      const r = await orgService.writeDraft(orgId, ot.namespace, id, { ...value, id });
      if (r?.ok === false) { showToast(r?.error?.message || 'Draft rejected'); }
      else { showToast(t('organisms.draftSaved') || 'Draft saved'); setAdding(null); setAddingSchema(null); await load(); }
    } catch (e) { showToast((e && e.message) || 'Failed to save draft'); }
    finally { setBusy(false); }
  }, [orgId, showToast, load]);

  const publish = useCallback(async (ot, instanceId) => {
    setBusy(true);
    try {
      const r = await orgService.publishDraft(orgId, ot.namespace, instanceId);
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

  const openSettings = () => {
    setSName(ws?.manifest?.name || '');
    setSSummary(ws?.manifest?.summary || '');
    setSAutonomy(ws?.manifest?.policy?.agentAutonomy || 'L3');
    setShowSettings(true);
  };

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
      await orgService.saveManifest(orgId, m);
      showToast(t('organisms.settingsSaved') || 'Settings saved');
      setShowSettings(false);
      await load();
    } catch (e) { showToast((e && e.message) || 'Failed to save settings'); }
    finally { setBusy(false); }
  }, [ws, sName, sSummary, sAutonomy, orgId, showToast, load]);

  const back = html`<div class="card-actions mb-half"><button class="btn-ghost btn-sm" onClick=${onBack}>${'← '}${t('organisms.backToList') || 'All organisms'}</button></div>`;

  if (ws === undefined) return html`<div>${back}<${Spinner} text=${t('organisms.loading') || 'Loading...'} /></div>`;

  if (ws === null) {
    return html`
      <div class="pj-ws">
        ${back}
        <div class="section-title">${escHtml(org.name || 'Organism')}</div>
        <div class="section-desc">${t('organisms.noWorkspace') || 'This organism has no workspace yet. Set one up to track goals, plans, deliverables and decisions — versioned on publish.'}</div>
        <button class="btn-primary" onClick=${setup} disabled=${busy}>${busy ? '...' : (t('organisms.setupWorkspace') || 'Set up workspace')}</button>
      </div>
    `;
  }

  const types = (ws.manifest?.objectTypes || []).filter(ot => ot.backing === 'memory');
  const draftsFor = (name) => (ws.drafts && ws.drafts[name]) || [];
  const objectsFor = (name) => (ws.objects && ws.objects[name]) || [];

  return html`
    <div class="pj-ws">
      ${back}
      <div class="section-title">${escHtml(ws.manifest?.name || org.name || 'Workspace')}</div>
      <div class="section-desc">
        <span class="badge badge-success">${escHtml(ws.manifest?.status || 'active')}</span>
        ${ws.manifest?.summary ? html` ${escHtml(ws.manifest.summary)}` : null}
      </div>

      <div class="pj-gate">
        <button class="btn-outline btn-sm" onClick=${() => showSettings ? setShowSettings(false) : openSettings()}>${'⚙ '}${t('organisms.settings') || 'Settings'}</button>
        <label class="pj-gate-label">
          <input type="checkbox" checked=${gateOn} onChange=${toggleGate} disabled=${busy} />
          ${' '}${t('organisms.publishGate') || 'Require review before publishing'}
        </label>
      </div>

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
          <div class="pj-empty">${t('organisms.template') || 'Template'}: ${escHtml(ws.manifest?.kind || '')} — ${escHtml((ws.manifest?.objectTypes || []).map(o => o.name).join(', '))}</div>
          <div class="form-actions">
            <button class="btn-primary btn-sm" onClick=${saveSettings} disabled=${busy}>${t('organisms.save') || 'Save'}</button>
            <button class="btn-ghost btn-sm" onClick=${() => setShowSettings(false)}>${t('organisms.cancel') || 'Cancel'}</button>
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

      ${types.map(ot => html`
        <div class="pj-section" key=${ot.name}>
          <div class="pj-section-head">
            <span class="pj-section-title">${escHtml(ot.name)}</span>
            ${ot.append ? null : html`<button class="btn-outline btn-sm" onClick=${() => startAdd(ot)}>${'+ '}${t('organisms.addDraft') || 'Add draft'}</button>`}
          </div>

          ${adding === ot.name && html`
            <${SchemaForm} schema=${addingSchema} busy=${busy}
              onSave=${(v) => saveDraft(ot, v)} onCancel=${() => { setAdding(null); setAddingSchema(null); }} />
          `}

          ${draftsFor(ot.name).map((d, i) => html`
            <div class="pj-item pj-item-draft" key=${'d' + i}>
              <span class="badge badge-warn">${t('organisms.draft') || 'draft'}</span>
              <span class="pj-item-text">${escHtml(String(d[PRIMARY_FIELD[ot.name] || 'title'] || d.id || ''))}</span>
              <button class="btn-primary btn-sm" onClick=${() => publish(ot, d.id)} disabled=${busy}>${t('organisms.publish') || 'Publish'}</button>
            </div>
          `)}

          ${objectsFor(ot.name).length === 0 && draftsFor(ot.name).length === 0
            ? html`<div class="pj-empty">${t('organisms.noneYet') || 'none yet'}</div>`
            : objectsFor(ot.name).map((o, i) => html`
              <div class="pj-item" key=${'o' + i}>
                <span class="pj-item-text">${escHtml(String(o[PRIMARY_FIELD[ot.name] || 'title'] || o.summary || o.id || ''))}</span>
                ${o.status ? html`<span class="badge badge-info">${escHtml(o.status)}</span>` : null}
              </div>
            `)
          }
        </div>
      `)}

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

/* A form rendered from a JSON Schema — typed inputs (enum→select, integer→number,
 * array→lines, boolean→checkbox, else text). Works for any objectType, including ones a
 * generated manifest declares. `id` is auto-generated when blank, so it's never required here. */
function SchemaForm({ schema, busy, onSave, onCancel }) {
  const props = (schema && schema.properties) || {};
  const required = new Set(((schema && schema.required) || []).filter(k => k !== 'id'));
  const fieldNames = Object.keys(props);
  const [vals, setVals] = useState({});
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
