/**
 * @file views/profile/access-tab/sharing-groups.js
 * @description Sharing Groups section — CRUD for sharing groups with expandable
 *   member lists. Extracted from access-tab.js to satisfy max-file-lines.
 * @version-history
 *   v1.1.0 — 2026-07-16 — Member-add identifier input is the shared ContactPicker (contacts +
 *     directory suggestions, full-id mode).
 *   v1.0.0 — 2026-07-13 — Extracted from access-tab.js (max-file-lines)
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { useConfirm } from '/components/Modal.js';
import { ContactPicker } from '/components/ContactPicker.js';
import * as groupsApi from '/js/services/sharing-groups.js';
import { swallowed } from '/js/swallowed.js';

export function SharingGroupsSection({ showToast, initial }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [groups, setGroups] = useState(initial?.groups ?? null);   // seeded from /v1/access/overview; else self-loads
  const [expandedId, setExpandedId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  // Create form
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');

  // Add-member form (per-group)
  const [addingTo, setAddingTo] = useState(null);
  const [memberIdent, setMemberIdent] = useState('');
  const [memberType, setMemberType] = useState('ghii');
  const [memberRead, setMemberRead] = useState(true);
  const [memberWrite, setMemberWrite] = useState(false);

  // Edit group (inline)
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editRead, setEditRead] = useState(true);
  const [editWrite, setEditWrite] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadGroups = useCallback(async () => {
    try {
      const resp = await groupsApi.listGroups();
      setGroups(resp?.data?.groups || []);
    } catch (err) {
      swallowed('sharing-groups: SharingGroupsSection', err);
      setGroups([]);
    }
  }, []);

  useEffect(() => { if (!initial) loadGroups(); }, [loadGroups]);   // eslint-disable-line react-hooks/exhaustive-deps -- seed once from `initial`; fetch only when unseeded

  // Deep link from the Memory tab's "Create a group →": scroll here and open the form.
  useEffect(() => {
    try {
      if (sessionStorage.getItem('aimeat.access.focus') === 'groups') {
        sessionStorage.removeItem('aimeat.access.focus');
        setShowCreate(true);
        setTimeout(() => document.getElementById('access-sharing-groups')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400);
      }
    // eslint-disable-next-line aimeat/no-silent-catch -- noop
    } catch { /* noop */ }
  }, []);

  // Live update listener
  const liveRef = useRef(loadGroups);
  liveRef.current = loadGroups;
  useEffect(() => {
    const handler = () => liveRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  const handleCreate = useCallback(async () => {
    if (!formName.trim()) {
      showToast(t('profile.access.sgNameRequired') || 'Group name is required');
      return;
    }
    setCreating(true);
    try {
      await groupsApi.createGroup({
        name: formName.trim(),
        description: formDesc.trim() || undefined,
        members: [],
        default_permissions: { read: true, write: false },
      });
      showToast(t('profile.access.sgCreated') || 'Sharing group created');
      setShowCreate(false);
      setFormName('');
      setFormDesc('');
      loadGroups();
    } catch (e) {
      showToast(e.message || (t('profile.access.sgCreateError') || 'Failed to create group'));
    } finally {
      setCreating(false);
    }
  }, [formName, formDesc, showToast, loadGroups]);

  const handleDelete = useCallback((id, name) => {
    confirm(
      (t('profile.access.sgConfirmDelete') || 'Delete group "{name}"? This cannot be undone.').replace('{name}', name),
      async () => {
        try {
          await groupsApi.deleteGroup(id);
          showToast(t('profile.access.sgDeleted') || 'Sharing group deleted');
          if (expandedId === id) setExpandedId(null);
          loadGroups();
        } catch (e) {
          showToast(e.message || (t('profile.access.sgDeleteError') || 'Failed to delete group'));
        }
      },
      { danger: true },
    );
  }, [confirm, showToast, loadGroups, expandedId]);

  const startEdit = useCallback((group) => {
    setEditingId(group.id);
    setEditName(group.name);
    setEditDesc(group.description || '');
    setEditRead(group.defaultPermissions?.read ?? true);
    setEditWrite(group.defaultPermissions?.write ?? false);
  }, []);

  const handleUpdate = useCallback(async (id) => {
    if (!editName.trim()) {
      showToast(t('profile.access.sgNameRequired') || 'Group name is required');
      return;
    }
    setSaving(true);
    try {
      await groupsApi.updateGroup(id, {
        name: editName.trim(),
        description: editDesc.trim() || undefined,
        default_permissions: { read: editRead, write: editWrite },
      });
      showToast(t('profile.access.sgUpdated') || 'Group updated');
      setEditingId(null);
      loadGroups();
    } catch (e) {
      showToast(e.message || (t('profile.access.sgUpdateError') || 'Failed to update group'));
    } finally {
      setSaving(false);
    }
  }, [editName, editDesc, editRead, editWrite, showToast, loadGroups]);

  const handleAddMember = useCallback(async (groupId) => {
    if (!memberIdent.trim()) {
      showToast(t('profile.access.sgMemberRequired') || 'Identifier is required');
      return;
    }
    try {
      await groupsApi.addMember(groupId, {
        identifier: memberIdent.trim(),
        identifier_type: memberType,
        permissions: { read: memberRead, write: memberWrite },
      });
      showToast(t('profile.access.sgMemberAdded') || 'Member added');
      setMemberIdent('');
      setAddingTo(null);
      loadGroups();
    } catch (e) {
      showToast(e.message || (t('profile.access.sgMemberAddError') || 'Failed to add member'));
    }
  }, [memberIdent, memberType, memberRead, memberWrite, showToast, loadGroups]);

  const handleRemoveMember = useCallback((groupId, identifier) => {
    confirm(
      (t('profile.access.sgConfirmRemoveMember') || 'Remove "{name}" from this group?').replace('{name}', identifier),
      async () => {
        try {
          await groupsApi.removeMember(groupId, identifier);
          showToast(t('profile.access.sgMemberRemoved') || 'Member removed');
          loadGroups();
        } catch (e) {
          showToast(e.message || (t('profile.access.sgMemberRemoveError') || 'Failed to remove member'));
        }
      },
      { danger: true },
    );
  }, [confirm, showToast, loadGroups]);

  const renderMemberRow = (groupId, member) => html`
    <div class="mem-item" key=${member.identifier}>
      <span class="mem-key">${escHtml(member.identifier)}</span>
      <span class="badge ${member.identifierType === 'gaii' ? 'badge-info' : 'badge-muted'}">${member.identifierType}</span>
      <span class="badge ${member.permissions?.read ? 'badge-success' : 'badge-muted'}">
        ${t('profile.access.sgRead') || 'read'}
      </span>
      <span class="badge ${member.permissions?.write ? 'badge-success' : 'badge-muted'}">
        ${t('profile.access.sgWrite') || 'write'}
      </span>
      <button class="btn-ghost btn-danger btn-sm" onClick=${(e) => { e.stopPropagation(); handleRemoveMember(groupId, member.identifier); }}>
        ${t('profile.access.sgRemove') || 'Remove'}
      </button>
    </div>
  `;

  const renderGroupCard = (group) => {
    const isExpanded = expandedId === group.id;
    const isEditing = editingId === group.id;
    const memberCount = (group.members || []).length;

    return html`
      <div class="card ${isExpanded ? 'card-expanded' : ''}" key=${group.id}>
        <div class="card-header card-clickable" onClick=${() => setExpandedId(isExpanded ? null : group.id)}>
          <span class="expand-icon">${isExpanded ? '▼' : '▶'}</span>
          <div class="card-title">${escHtml(group.name)}</div>
          <span class="badge badge-muted">${memberCount} ${t('profile.access.sgMembers') || 'members'}</span>
        </div>
        ${group.description && html`
          <div class="card-subtitle">${escHtml(group.description)}</div>
        `}

        ${isExpanded && !isEditing && html`
          <div class="card-detail">
            <div class="detail-grid">
              <div class="detail-item">
                <span class="detail-label">${t('profile.access.sgDefaultPerms') || 'Default permissions'}</span>
                <span class="detail-value">
                  ${group.defaultPermissions?.read ? (t('profile.access.sgRead') || 'read') : ''} ${group.defaultPermissions?.write ? (t('profile.access.sgWrite') || 'write') : ''}
                </span>
              </div>
              ${group.createdAt && html`
                <div class="detail-item">
                  <span class="detail-label">${t('profile.access.sgCreatedAt') || 'Created'}</span>
                  <span class="detail-value">${new Date(group.createdAt).toLocaleDateString()}</span>
                </div>
              `}
            </div>

            <h4 class="card-h3 mt-section">${t('profile.access.sgMemberList') || 'Members'}</h4>
            ${memberCount === 0
              ? html`<div class="empty">${t('profile.access.sgNoMembers') || 'No members yet'}</div>`
              : (group.members || []).map(m => renderMemberRow(group.id, m))
            }

            ${addingTo === group.id ? html`
              <div class="create-form">
                <div class="form-row">
                  <label>${t('profile.access.sgMemberIdentifier') || 'Identifier (GHII or GAII)'}</label>
                  <${ContactPicker} value=${memberIdent} onChange=${setMemberIdent} valueMode="full"
                    placeholder=${'alice@node-id'} onSubmit=${() => handleAddMember(group.id)} />
                </div>
                <div class="form-row">
                  <label>${t('profile.access.sgMemberType') || 'Type'}</label>
                  <select class="input-field input-sm" value=${memberType} onChange=${e => setMemberType(e.target.value)}>
                    <option value="ghii">GHII</option>
                    <option value="gaii">GAII</option>
                  </select>
                </div>
                <div class="flex-row-wrap">
                  <label class="flex-row">
                    <input type="checkbox" checked=${memberRead} onChange=${() => setMemberRead(!memberRead)} />
                    ${t('profile.access.sgRead') || 'Read'}
                  </label>
                  <label class="flex-row">
                    <input type="checkbox" checked=${memberWrite} onChange=${() => setMemberWrite(!memberWrite)} />
                    ${t('profile.access.sgWrite') || 'Write'}
                  </label>
                </div>
                <div class="form-actions">
                  <button class="btn-primary btn-sm" onClick=${() => handleAddMember(group.id)}>
                    ${t('profile.access.sgAddMember') || 'Add'}
                  </button>
                  <button class="btn-ghost btn-sm" onClick=${() => setAddingTo(null)}>
                    ${t('profile.access.sgCancel') || 'Cancel'}
                  </button>
                </div>
              </div>
            ` : html`
              <div class="card-actions">
                <button class="btn-outline btn-sm" onClick=${(e) => { e.stopPropagation(); setAddingTo(group.id); setMemberIdent(''); setMemberType('ghii'); setMemberRead(true); setMemberWrite(false); }}>
                  ${t('profile.access.sgAddMember') || 'Add Member'}
                </button>
                <button class="btn-outline btn-sm" onClick=${(e) => { e.stopPropagation(); startEdit(group); }}>
                  ${t('profile.access.sgEdit') || 'Edit'}
                </button>
                <button class="btn-danger-solid btn-sm" onClick=${(e) => { e.stopPropagation(); handleDelete(group.id, group.name); }}>
                  ${t('profile.access.sgDelete') || 'Delete'}
                </button>
              </div>
            `}
          </div>
        `}

        ${isExpanded && isEditing && html`
          <div class="card-detail" onClick=${(e) => e.stopPropagation()}>
            <div class="flex-col">
              <div class="form-row">
                <label>${t('profile.access.sgGroupName') || 'Group name'}</label>
                <input type="text" class="input-field input-sm"
                  value=${editName} onInput=${e => setEditName(e.target.value)} />
              </div>
              <div class="form-row">
                <label>${t('profile.access.sgDescription') || 'Description'}</label>
                <textarea class="input-field input-sm" rows="2"
                  value=${editDesc} onInput=${e => setEditDesc(e.target.value)} />
              </div>
              <div class="form-row">
                <label>${t('profile.access.sgDefaultPerms') || 'Default permissions'}</label>
                <div class="flex-row-wrap">
                  <label class="flex-row">
                    <input type="checkbox" checked=${editRead} onChange=${() => setEditRead(!editRead)} />
                    ${t('profile.access.sgRead') || 'Read'}
                  </label>
                  <label class="flex-row">
                    <input type="checkbox" checked=${editWrite} onChange=${() => setEditWrite(!editWrite)} />
                    ${t('profile.access.sgWrite') || 'Write'}
                  </label>
                </div>
              </div>
              <div class="form-actions">
                <button class="btn-primary btn-sm" onClick=${() => handleUpdate(group.id)} disabled=${saving}>
                  ${saving ? '...' : (t('profile.access.sgSave') || 'Save')}
                </button>
                <button class="btn-ghost btn-sm" onClick=${() => setEditingId(null)}>
                  ${t('profile.access.sgCancel') || 'Cancel'}
                </button>
              </div>
            </div>
          </div>
        `}
      </div>
    `;
  };

  return html`
    <h3 class="card-h3 access-h3 mt-section" id="access-sharing-groups">${t('profile.access.sgTitle') || 'Sharing Groups'}</h3>
    <div class="section-desc">${t('profile.access.sgDesc') || 'Define groups of identities to share memory entries with. Assign a sharing group to memory keys to control who can read or write.'}</div>

    ${groups === null
      ? html`<div class="empty">${t('profile.access.sgLoading') || 'Loading...'}</div>`
      : groups.length === 0
        ? (!showCreate && html`
            <div class="access-empty-row">
              <span class="text-meta-sm">${t('profile.access.sgEmpty') || 'No sharing groups yet.'}</span>
              <button class="btn-outline btn-sm" onClick=${() => setShowCreate(true)}>${t('profile.access.sgCreate') || 'New Group'}</button>
            </div>`)
        : groups.map(renderGroupCard)
    }

    ${!showCreate ? ((groups?.length || 0) > 0 && html`
      <div class="mb-1">
        <button class="btn-outline" onClick=${() => setShowCreate(true)}>
          ${t('profile.access.sgCreate') || 'New Group'}
        </button>
      </div>
    `) : html`
      <div class="create-form">
        <h4 class="card-h3 mb-half">${t('profile.access.sgCreateTitle') || 'Create Sharing Group'}</h4>
        <div class="flex-col">
          <div class="form-row">
            <label>${t('profile.access.sgGroupName') || 'Group name'}</label>
            <input type="text" class="input-field input-sm"
              placeholder=${t('profile.access.sgNamePlaceholder') || 'e.g. Team Alpha'}
              value=${formName} onInput=${e => setFormName(e.target.value)}
              onKeyDown=${e => e.key === 'Enter' && handleCreate()} />
          </div>
          <div class="form-row">
            <label>${t('profile.access.sgDescription') || 'Description (optional)'}</label>
            <textarea class="input-field input-sm" rows="2"
              placeholder=${t('profile.access.sgDescPlaceholder') || 'What is this group for?'}
              value=${formDesc} onInput=${e => setFormDesc(e.target.value)} />
          </div>
          <div class="form-actions">
            <button class="btn-primary btn-sm" onClick=${handleCreate} disabled=${creating}>
              ${creating ? '...' : (t('profile.access.sgCreateBtn') || 'Create')}
            </button>
            <button class="btn-ghost btn-sm" onClick=${() => setShowCreate(false)}>
              ${t('profile.access.sgCancel') || 'Cancel'}
            </button>
          </div>
        </div>
      </div>
    `}
    <${ConfirmUI} />
  `;
}
