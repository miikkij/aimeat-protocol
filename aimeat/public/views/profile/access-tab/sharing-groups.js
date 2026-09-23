/**
 * @file views/profile/access-tab/sharing-groups.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sharing Groups section — CRUD for sharing groups with expandable
 *   member lists. Extracted from access-tab.js to satisfy max-file-lines.
 * @version-history
 *   2026-09-22 -- Composed from the shared component set: a group is a ListRow that opens, members
 *     and shares are compact rows with chips, the forms are Fields in a box; no own classes. The
 *     title and introduction the Access page hid are gone (its section says them); the deep-link id
 *     stays. The triangle glyphs are gone: the group's name opens it.
 *   2026-09-13 -- V2w: compose remaining profile section top rules from poster.css.
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
 *   v1.2.0 — 2026-08-11 — Key-space shares: each group shows what it can actually reach, with add
 *     and revoke, and a count on the collapsed header. The group was only ever half the answer —
 *     it says WHO, and until now nothing on this page said WHAT they get.
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
import { Stack, ListRow, KeyValue, Chip, Action, Field, Surface, Text } from '/components/poster-parts.js';
import * as groupsApi from '/js/services/sharing-groups.js';
import * as sharesApi from '/js/services/shares.js';
import { swallowed } from '/js/swallowed.js';
import { date as fmtDate } from '/js/format.js';

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

  // Key-space shares: what each group actually reaches. Loaded in ONE call for every group rather
  // than per expanded card, because the count belongs on the collapsed header — a group whose
  // shares you only see after opening it is a group you cannot audit at a glance, and "who can see
  // what of mine" is the question this whole page answers.
  const [shares, setShares] = useState([]);
  const [sharingIn, setSharingIn] = useState(null);
  const [sharePattern, setSharePattern] = useState('');
  const [shareNote, setShareNote] = useState('');
  const [sharingBusy, setSharingBusy] = useState(false);

  const loadShares = useCallback(async () => {
    try {
      const resp = await sharesApi.listOutgoing();
      setShares(resp?.data?.shares || []);
    } catch (err) {
      swallowed('sharing-groups: loadShares', err);
      setShares([]);
    }
  }, []);

  const loadGroups = useCallback(async () => {
    try {
      const resp = await groupsApi.listGroups();
      setGroups(resp?.data?.groups || []);
    } catch (err) {
      swallowed('sharing-groups: SharingGroupsSection', err);
      setGroups([]);
    }
    loadShares();
  }, [loadShares]);

  const sharesOf = useCallback((groupId) => shares.filter(s => s.group_id === groupId), [shares]);

  const handleCreateShare = useCallback(async (groupId) => {
    const pattern = sharePattern.trim();
    if (!pattern) return;
    setSharingBusy(true);
    try {
      await sharesApi.createShare(groupId, { key_pattern: pattern, note: shareNote.trim() || undefined });
      showToast(t('profile.access.shCreated'));
      setSharingIn(null);
      setSharePattern('');
      setShareNote('');
      loadShares();
    } catch (e) {
      showToast(e.message || t('profile.access.shCreateError'));
    } finally {
      setSharingBusy(false);
    }
  }, [sharePattern, shareNote, showToast, loadShares]);

  const handleRevokeShare = useCallback((share) => {
    confirm(
      t('profile.access.shConfirmRevoke').replace('{pattern}', share.key_pattern),
      async () => {
        try {
          await sharesApi.revokeShare(share.id);
          showToast(t('profile.access.shRevoked'));
          loadShares();
        } catch (e) {
          showToast(e.message || t('profile.access.shRevokeError'));
        }
      },
      { danger: true },
    );
  }, [confirm, showToast, loadShares]);

  useEffect(() => { if (!initial) loadGroups(); }, [loadGroups]);   // eslint-disable-line react-hooks/exhaustive-deps -- seed once from `initial`; fetch only when unseeded

  // Shares are fetched on mount WHATEVER the seed did. They are not in /v1/access/overview, so
  // hanging them off loadGroups() meant a seeded page never asked for them and every group showed
  // as sharing nothing — which is worse than showing nothing at all, because it reads as an answer.
  useEffect(() => { loadShares(); }, [loadShares]);

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
    <${ListRow} key=${member.identifier} density="compact" name=${escHtml(member.identifier)}
      value=${html`<${Stack} direction="wrap" density="compact">
        <${Chip} tone=${member.identifierType === 'gaii' ? 'plain' : 'muted'}>${member.identifierType}<//>
        <${Chip} tone=${member.permissions?.read ? 'success' : 'muted'}>${t('profile.access.sgRead') || 'read'}<//>
        <${Chip} tone=${member.permissions?.write ? 'success' : 'muted'}>${t('profile.access.sgWrite') || 'write'}<//>
      <//>`}
      actions=${html`<${Action} kind="text" tone="danger" onClick=${() => handleRemoveMember(groupId, member.identifier)}>${t('profile.access.sgRemove') || 'Remove'}<//>`} />
  `;

  const renderShareRow = (share) => html`
    <${ListRow} key=${share.id} density="compact" name=${escHtml(share.key_pattern)} nameTitle=${share.key_pattern}
      detail=${share.note ? escHtml(share.note) : undefined} detailKind="text"
      actions=${html`<${Action} kind="text" tone="danger" onClick=${() => handleRevokeShare(share)}>${t('profile.access.shRevoke')}<//>`} />
  `;

  /** The read and write switches of a permission pair, as the set's checkboxes. */
  const permFields = (read, setRead, write, setWrite) => html`<${Stack} direction="wrap" density="compact">
    <${Field} type="checkbox" label=${t('profile.access.sgRead') || 'Read'} value=${read} onChange=${() => setRead(!read)} />
    <${Field} type="checkbox" label=${t('profile.access.sgWrite') || 'Write'} value=${write} onChange=${() => setWrite(!write)} />
  <//>`;

  const renderGroupCard = (group) => {
    const isExpanded = expandedId === group.id;
    const isEditing = editingId === group.id;
    const memberCount = (group.members || []).length;
    const groupShares = sharesOf(group.id);

    const perms = [group.defaultPermissions?.read ? (t('profile.access.sgRead') || 'read') : '', group.defaultPermissions?.write ? (t('profile.access.sgWrite') || 'write') : ''].filter(Boolean).join(' ');

    return html`
      <${ListRow} key=${group.id} name=${escHtml(group.name)} onOpen=${() => setExpandedId(isExpanded ? null : group.id)}
        detail=${group.description ? escHtml(group.description) : undefined} detailKind="text"
        value=${html`<${Stack} direction="wrap" density="compact">
          <${Chip} tone="muted">${memberCount} ${t('profile.access.sgMembers') || 'members'}<//>
          ${groupShares.length > 0 && html`<${Chip}>${groupShares.length} ${t('profile.access.shTitle')}<//>`}
        <//>`}>

        ${isExpanded && !isEditing && html`<${Stack}>
          <${Stack} density="compact">
            <${KeyValue} label=${t('profile.access.sgDefaultPerms') || 'Default permissions'} value=${perms} />
            ${group.createdAt && html`<${KeyValue} label=${t('profile.access.sgCreatedAt') || 'Created'} value=${fmtDate(group.createdAt)} />`}
          <//>

          <${Stack} density="compact">
            <${Text} kind="label">${t('profile.access.sgMemberList') || 'Members'}<//>
            ${memberCount === 0
              ? html`<${Text} tone="muted">${t('profile.access.sgNoMembers') || 'No members yet'}<//>`
              : (group.members || []).map(m => renderMemberRow(group.id, m))}
          <//>

          <${Stack} density="compact">
            <${Text} kind="label">${t('profile.access.shTitle')}<//>
            ${groupShares.length === 0
              ? html`<${Text} tone="muted">${t('profile.access.shNone')}<//>`
              : groupShares.map(renderShareRow)}
          <//>
          ${sharingIn === group.id ? html`<${Surface} kind="box"><${Stack}>
            <${Field} label=${t('profile.access.shPattern')} placeholder="deliveries.abc.**"
              value=${sharePattern} onInput=${e => setSharePattern(e.target.value)}
              onKeyDown=${e => e.key === 'Enter' && handleCreateShare(group.id)} />
            <${Text} kind="caption" tone="muted">${t('profile.access.shPatternHelp')}<//>
            <${Field} label=${t('profile.access.shNote')} placeholder=${t('profile.access.shNotePlaceholder')}
              value=${shareNote} onInput=${e => setShareNote(e.target.value)} />
            <${Stack} direction="horizontal" align="start">
              <${Action} onClick=${() => handleCreateShare(group.id)} disabled=${sharingBusy}>${sharingBusy ? '...' : t('profile.access.shCreate')}<//>
              <${Action} kind="text" onClick=${() => setSharingIn(null)}>${t('profile.access.shCancel')}<//>
            <//>
          <//><//>` : html`<${Stack} direction="horizontal" align="start">
            <${Action} onClick=${() => { setSharingIn(group.id); setSharePattern(''); setShareNote(''); }}>${t('profile.access.shAdd')}<//>
          <//>`}

          ${addingTo === group.id ? html`<${Surface} kind="box"><${Stack}>
            <${Stack} density="compact">
              <${Text} kind="label">${t('profile.access.sgMemberIdentifier') || 'Identifier (GHII or GAII)'}<//>
              <${ContactPicker} value=${memberIdent} onChange=${setMemberIdent} valueMode="full"
                placeholder=${'alice@node-id'} onSubmit=${() => handleAddMember(group.id)} />
            <//>
            <${Field} type="select" label=${t('profile.access.sgMemberType') || 'Type'} value=${memberType} onChange=${e => setMemberType(e.target.value)}
              options=${[{ value: 'ghii', label: 'GHII' }, { value: 'gaii', label: 'GAII' }]} />
            ${permFields(memberRead, setMemberRead, memberWrite, setMemberWrite)}
            <${Stack} direction="horizontal" align="start">
              <${Action} onClick=${() => handleAddMember(group.id)}>${t('profile.access.sgAddMember') || 'Add'}<//>
              <${Action} kind="text" onClick=${() => setAddingTo(null)}>${t('profile.access.sgCancel') || 'Cancel'}<//>
            <//>
          <//><//>` : html`<${Stack} direction="wrap" density="compact">
            <${Action} onClick=${() => { setAddingTo(group.id); setMemberIdent(''); setMemberType('ghii'); setMemberRead(true); setMemberWrite(false); }}>${t('profile.access.sgAddMember') || 'Add Member'}<//>
            <${Action} onClick=${() => startEdit(group)}>${t('profile.access.sgEdit') || 'Edit'}<//>
            <${Action} tone="danger" onClick=${() => handleDelete(group.id, group.name)}>${t('profile.access.sgDelete') || 'Delete'}<//>
          <//>`}
        <//>`}

        ${isExpanded && isEditing && html`<${Stack}>
          <${Field} label=${t('profile.access.sgGroupName') || 'Group name'} value=${editName} onInput=${e => setEditName(e.target.value)} />
          <${Field} type="textarea" rows="2" label=${t('profile.access.sgDescription') || 'Description'} value=${editDesc} onInput=${e => setEditDesc(e.target.value)} />
          <${Stack} density="compact">
            <${Text} kind="label">${t('profile.access.sgDefaultPerms') || 'Default permissions'}<//>
            ${permFields(editRead, setEditRead, editWrite, setEditWrite)}
          <//>
          <${Stack} direction="horizontal" align="start">
            <${Action} kind="primary" onClick=${() => handleUpdate(group.id)} disabled=${saving}>${saving ? '...' : (t('profile.access.sgSave') || 'Save')}<//>
            <${Action} kind="text" onClick=${() => setEditingId(null)}>${t('profile.access.sgCancel') || 'Cancel'}<//>
          <//>
        <//>`}
      <//>
    `;
  };

  // The Access page's section carries the title and the introduction; this is its body. The id
  // stays: the Memory tab's "Create a group" deep link scrolls to it.
  return html`<${Stack} id="access-sharing-groups">
    ${groups === null
      ? html`<${Text} tone="muted">${t('profile.access.sgLoading') || 'Loading...'}<//>`
      : groups.length === 0
        ? (!showCreate && html`<${Stack} direction="wrap" density="compact" align="center">
            <${Text} kind="caption" tone="muted">${t('profile.access.sgEmpty') || 'No sharing groups yet.'}<//>
            <${Action} onClick=${() => setShowCreate(true)}>${t('profile.access.sgCreate') || 'New Group'}<//>
          <//>`)
        : html`<${Stack} density="compact">${groups.map(renderGroupCard)}<//>`
    }

    ${!showCreate ? ((groups?.length || 0) > 0 && html`<${Stack} direction="horizontal" align="start">
      <${Action} onClick=${() => setShowCreate(true)}>${t('profile.access.sgCreate') || 'New Group'}<//>
    <//>`) : html`<${Surface} kind="box"><${Stack}>
      <${Text} kind="heading" size="small">${t('profile.access.sgCreateTitle') || 'Create Sharing Group'}<//>
      <${Field} label=${t('profile.access.sgGroupName') || 'Group name'}
        placeholder=${t('profile.access.sgNamePlaceholder') || 'e.g. Team Alpha'}
        value=${formName} onInput=${e => setFormName(e.target.value)}
        onKeyDown=${e => e.key === 'Enter' && handleCreate()} />
      <${Field} type="textarea" rows="2" label=${t('profile.access.sgDescription') || 'Description (optional)'}
        placeholder=${t('profile.access.sgDescPlaceholder') || 'What is this group for?'}
        value=${formDesc} onInput=${e => setFormDesc(e.target.value)} />
      <${Stack} direction="horizontal" align="start">
        <${Action} kind="primary" onClick=${handleCreate} disabled=${creating}>${creating ? '...' : (t('profile.access.sgCreateBtn') || 'Create')}<//>
        <${Action} kind="text" onClick=${() => setShowCreate(false)}>${t('profile.access.sgCancel') || 'Cancel'}<//>
      <//>
    <//><//>`}
    <${ConfirmUI} />
  <//>`;
}
