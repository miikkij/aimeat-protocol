import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Spinner } from './shared.js';
import * as orgService from '/js/services/organisms.js';

export default function OrganismsTab({ session, showToast, onStats }) {
  const [myOrganisms, setMyOrganisms] = useState(null);
  const [publicOrganisms, setPublicOrganisms] = useState([]);
  const [expanded, setExpanded] = useState(null);
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
    if (!confirm(t('organisms.confirmLeave')?.replace('{name}', name) || `Leave "${name}"?`)) return;
    try {
      await orgService.leaveOrganism(id);
      showToast(t('organisms.left') || 'Left organism');
      loadData();
    } catch {
      showToast(t('organisms.leaveError') || 'Failed to leave');
    }
  }, [showToast, loadData]);

  const handleDelete = useCallback(async (id, name) => {
    if (!confirm(t('organisms.confirmDelete')?.replace('{name}', name) || `Delete "${name}"? This cannot be undone.`)) return;
    try {
      await orgService.deleteOrganism(id);
      showToast(t('organisms.deleted') || 'Organism deleted');
      setExpanded(null);
      loadData();
    } catch {
      showToast(t('organisms.deleteError') || 'Failed to delete');
    }
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

  const inputStyle = 'padding:.4rem .6rem;border-radius:6px;border:1px solid var(--border,rgba(232,86,74,.15));background:transparent;color:var(--text,#1a1a2e);font-size:.85rem';
  const selectStyle = 'padding:.4rem .6rem;border-radius:6px;border:1px solid var(--border,rgba(232,86,74,.15));background:var(--bg2,#F5F5F3);color:var(--text,#1a1a2e);font-size:.8rem';

  const renderEditForm = (org) => html`
    <div class="card-detail" onClick=${(e) => e.stopPropagation()}>
      <div style="display:flex;flex-direction:column;gap:.5rem;padding:.25rem 0">
        <input type="text" value=${editForm.name} onInput=${(e) => setEditForm(f => ({ ...f, name: e.target.value }))}
          placeholder=${t('organisms.namePlaceholder') || 'Name'} style=${inputStyle} />
        <textarea value=${editForm.description} onInput=${(e) => setEditForm(f => ({ ...f, description: e.target.value }))} rows="2"
          placeholder=${t('organisms.descPlaceholder') || 'Description'} style=${inputStyle + ';resize:vertical'} />
        <input type="text" value=${editForm.interests} onInput=${(e) => setEditForm(f => ({ ...f, interests: e.target.value }))}
          placeholder=${t('organisms.interestsPlaceholder') || 'Interests (comma separated)'} style=${inputStyle} />
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          <select value=${editForm.type} onChange=${(e) => setEditForm(f => ({ ...f, type: e.target.value }))} style=${selectStyle}>
            <option value="community">${t('organisms.types.community') || 'Community'}</option>
            <option value="team">${t('organisms.types.team') || 'Team'}</option>
            <option value="club">${t('organisms.types.club') || 'Club'}</option>
            <option value="cooperative">${t('organisms.types.cooperative') || 'Cooperative'}</option>
            <option value="project">${t('organisms.types.project') || 'Project'}</option>
          </select>
          <select value=${editForm.join_policy} onChange=${(e) => setEditForm(f => ({ ...f, join_policy: e.target.value }))} style=${selectStyle}>
            <option value="open">${t('organisms.policyOpen') || 'Open (anyone can join)'}</option>
            <option value="approval_required">${t('organisms.policyApproval') || 'Approval required'}</option>
            <option value="invite_only">${t('organisms.policyInvite') || 'Invite only'}</option>
          </select>
          <select value=${editForm.visibility} onChange=${(e) => setEditForm(f => ({ ...f, visibility: e.target.value }))} style=${selectStyle}>
            <option value="public">${t('organisms.visPublic') || 'Public'}</option>
            <option value="listed">${t('organisms.visListed') || 'Listed'}</option>
            <option value="private">${t('organisms.visPrivate') || 'Private'}</option>
          </select>
        </div>
        <div style="display:flex;gap:.5rem">
          <button class="btn-sm btn-copy" onClick=${() => handleUpdate(org.id)} disabled=${saving}>
            ${saving ? '...' : (t('organisms.save') || 'Save')}
          </button>
          <button class="btn-sm" onClick=${cancelEdit} style="opacity:.7">
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
          <div style="display:flex;flex-wrap:wrap;gap:.25rem;padding:0 1rem .25rem">
            ${org.interests.map(tag => html`<span class="badge" style="font-size:.65rem;padding:1px 6px;border-radius:8px;background:rgba(232,86,74,.06);color:var(--love1,#E8564A)" key=${tag}>${escHtml(tag)}</span>`)}
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

            <div class="card-actions" style="margin-top:.75rem">
              ${canEdit ? html`
                <button class="btn-sm btn-copy" onClick=${(e) => { e.stopPropagation(); startEdit(org); }}>
                  ${t('organisms.edit') || 'Edit'}
                </button>
              ` : null}
              ${isMine && !isCreator ? html`
                <button class="btn-sm btn-danger" onClick=${(e) => { e.stopPropagation(); handleLeave(org.id, org.name); }}>
                  ${t('organisms.leave') || 'Leave'}
                </button>
              ` : null}
              ${isCreator ? html`
                <button class="btn-sm btn-danger" onClick=${(e) => { e.stopPropagation(); handleDelete(org.id, org.name); }}>
                  ${t('organisms.delete') || 'Delete'}
                </button>
              ` : null}
              ${!isMember ? html`
                <button class="btn-sm btn-copy" onClick=${(e) => { e.stopPropagation(); handleJoin(org.id); }}>
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

  if (!myOrganisms) return html`<${Spinner} text=${t('organisms.loading') || 'Loading organisms...'} />`;

  return html`
    <div class="section-title">${t('organisms.title') || 'Organisms'}</div>
    <div class="section-desc">${t('organisms.desc') || 'Organisms are groups — communities, teams, clubs, or projects. Create one or join existing ones to share knowledge, coordinate work, and build together.'}</div>

    <!-- Create button / form -->
    <div style="margin-bottom:1rem">
      ${!showCreate ? html`
        <button class="btn-sm btn-copy" onClick=${() => setShowCreate(true)}>
          ${t('organisms.createNew') || 'Create Organism'}
        </button>
      ` : html`
        <div class="card" style="padding:.75rem 1rem">
          <h4 style="margin:0 0 .5rem">${t('organisms.createTitle') || 'Create New Organism'}</h4>
          <div style="display:flex;flex-direction:column;gap:.5rem">
            <input type="text" placeholder=${t('organisms.namePlaceholder') || 'Name'} value=${formName} onInput=${(e) => setFormName(e.target.value)}
              style="padding:.4rem .6rem;border-radius:6px;border:1px solid var(--border,rgba(232,86,74,.15));background:transparent;color:var(--text,#1a1a2e);font-size:.85rem" />
            <textarea placeholder=${t('organisms.descPlaceholder') || 'Description'} value=${formDesc} onInput=${(e) => setFormDesc(e.target.value)} rows="2"
              style="padding:.4rem .6rem;border-radius:6px;border:1px solid var(--border,rgba(232,86,74,.15));background:transparent;color:var(--text,#1a1a2e);font-size:.85rem;resize:vertical" />
            <input type="text" placeholder=${t('organisms.interestsPlaceholder') || 'Interests (comma separated)'} value=${formInterests} onInput=${(e) => setFormInterests(e.target.value)}
              style="padding:.4rem .6rem;border-radius:6px;border:1px solid var(--border,rgba(232,86,74,.15));background:transparent;color:var(--text,#1a1a2e);font-size:.85rem" />
            <div style="display:flex;gap:.5rem;flex-wrap:wrap">
              <select value=${formType} onChange=${(e) => setFormType(e.target.value)}
                style="padding:.4rem .6rem;border-radius:6px;border:1px solid var(--border,rgba(232,86,74,.15));background:var(--bg2,#F5F5F3);color:var(--text,#1a1a2e);font-size:.8rem">
                <option value="community">${t('organisms.types.community') || 'Community'}</option>
                <option value="team">${t('organisms.types.team') || 'Team'}</option>
                <option value="club">${t('organisms.types.club') || 'Club'}</option>
                <option value="cooperative">${t('organisms.types.cooperative') || 'Cooperative'}</option>
                <option value="project">${t('organisms.types.project') || 'Project'}</option>
              </select>
              <select value=${formPolicy} onChange=${(e) => setFormPolicy(e.target.value)}
                style="padding:.4rem .6rem;border-radius:6px;border:1px solid var(--border,rgba(232,86,74,.15));background:var(--bg2,#F5F5F3);color:var(--text,#1a1a2e);font-size:.8rem">
                <option value="open">${t('organisms.policyOpen') || 'Open (anyone can join)'}</option>
                <option value="approval_required">${t('organisms.policyApproval') || 'Approval required'}</option>
                <option value="invite_only">${t('organisms.policyInvite') || 'Invite only'}</option>
              </select>
              <select value=${formVisibility} onChange=${(e) => setFormVisibility(e.target.value)}
                style="padding:.4rem .6rem;border-radius:6px;border:1px solid var(--border,rgba(232,86,74,.15));background:var(--bg2,#F5F5F3);color:var(--text,#1a1a2e);font-size:.8rem">
                <option value="public">${t('organisms.visPublic') || 'Public'}</option>
                <option value="listed">${t('organisms.visListed') || 'Listed'}</option>
                <option value="private">${t('organisms.visPrivate') || 'Private'}</option>
              </select>
            </div>
            <div style="display:flex;gap:.5rem">
              <button class="btn-sm btn-copy" onClick=${handleCreate} disabled=${creating}>
                ${creating ? '...' : (t('organisms.create') || 'Create')}
              </button>
              <button class="btn-sm" onClick=${() => setShowCreate(false)} style="opacity:.7">
                ${t('organisms.cancel') || 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      `}
    </div>

    <!-- My Organisms -->
    <div class="section-title" style="font-size:.9rem">${t('organisms.myOrganisms') || 'My Organisms'}</div>
    ${myOrganisms.length === 0
      ? html`<div class="empty">${t('organisms.empty') || 'You are not part of any organisms yet.'}</div>`
      : myOrganisms.map(org => renderOrgCard(org, true))
    }

    <!-- Discover -->
    ${publicOrganisms.length > 0 && html`
      <div class="section-title" style="font-size:.9rem;margin-top:1rem">${t('organisms.discover') || 'Discover'}</div>
      ${publicOrganisms.map(org => renderOrgCard(org, false))}
    `}
  `;
}
