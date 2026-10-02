/**
 * @file views/profile/access-tab/sharing-groups.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sharing Groups section — CRUD for sharing groups with expandable
 *   member lists. Extracted from access-tab.js to satisfy max-file-lines.
 * @version-history
 *   v1.22.0 -- 2026-10-02 -- The question mark that explains a share pattern: memory.key_pattern (components/HelpTip.js).
 *   v1.21.1 -- 2026-09-28 -- No escHtml() on text preact renders: preact escapes text and attributes
 *     itself, so names with a quote or an ampersand showed as &quot; / &amp;.
 *   v1.21.0 -- 2026-09-26 -- Every part is a component that takes data, and the file writes no class
 *     (component plan, page group G3): a group is a List row that opens and closes as a whole (the
 *     ▶/▼ before its name), its opened Panel holds the Facts, the members and shares as dense Lists
 *     and the two forms as section Cards of the Field family; the create form is a section Card with
 *     its title. Put back from main as tones: a member's kind tag dim for a person and plain for an
 *     agent (main's muted and info badges, the 'gaii' test), the members count dim. `inRow` leaves
 *     out the heading and intro where the page's section says them (Access 06; .ac-kept hid them).
 *   v1.20.0 -- 2026-09-26 -- Read and Write beside their check boxes are the Check line (css/components/check-line.css); the edit row's labels leave the row label (a unification: Jouni's decision "Check line").
 *   v1.19.0 -- 2026-09-26 -- A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.18.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.17.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.16.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.15.0 -- 2026-09-25 -- The older tabs' remaining help lines are the Hint (.poster-hint); their own sizes and greys go, a place keeps its margin (a unification: the look most tabs use).
 *   v1.14.0 -- 2026-09-25 -- A list drawn as classic cards is the Listing (css/components/listing.css), a row that opens shows the Listing's open panel; the card, its header, arrow and detail rules go (a unification: the look most tabs use).
 *   v1.13.0 -- 2026-09-25 -- An opened group's details are the Facts (css/components/facts.css), a unification: the look most tabs use; the two tiles become two lines, the name on the left.
 *   v1.12.0 -- 2026-09-25 -- A group's members and its shares are the Listing (css/components/listing.css), a unification: the look most tabs use.
 *   v1.11.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.10.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.9.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.8.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.7.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.6.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.5.0 — 2026-09-25 — A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.4.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.3.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
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
import { useConfirm } from '/components/Modal.js';
import { ContactPicker } from '/components/ContactPicker.js';
import { List, Row, Name, Desc, Cell, Doors, Panel } from '/components/List.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Facts } from '/components/Facts.js';
import { Card } from '/components/Card.js';
import { SubHeading } from '/components/SubHeading.js';
import { Row as Line, Space } from '/components/Layout.js';
import { Field, Fields, FormActions } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Check } from '/components/Check.js';
import * as groupsApi from '/js/services/sharing-groups.js';
import * as sharesApi from '/js/services/shares.js';
import { swallowed } from '/js/swallowed.js';
import { date as fmtDate } from '/js/format.js';

/**
 * @param {{ showToast: Function, initial?: object, inRow?: boolean }} props `inRow`: the section stands
 *   inside a page section that already says its heading and intro (Access, 06), so it leaves out its own.
 */
export function SharingGroupsSection({ showToast, initial, inRow }) {
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

  // A member's kind: an agent (GAII) plain, a person (GHII) dim, as main's info and muted badges.
  const renderMemberRow = (groupId, member) => html`
    <${Row} key=${member.identifier}>
      <${Name} asKey>${member.identifier}<//>
      <${Cell}><${Mark} tone=${member.identifierType === 'gaii' ? undefined : 'dim'}>${member.identifierType}<//><//>
      <${Cell} line>
        <${Mark} kind="status" tone=${member.permissions?.read ? 'fine' : 'off'}>${t('profile.access.sgRead') || 'read'}<//>
        <${Mark} kind="status" tone=${member.permissions?.write ? 'fine' : 'off'}>${t('profile.access.sgWrite') || 'write'}<//>
      <//>
      <${Doors}>
        <${Action} small row tone="danger" onClick=${(e) => { e.stopPropagation(); handleRemoveMember(groupId, member.identifier); }}>
          ${t('profile.access.sgRemove') || 'Remove'}
        <//>
      <//>
    <//>
  `;

  const renderShareRow = (share) => html`
    <${Row} key=${share.id}>
      <${Name} asKey title=${share.key_pattern} meta=${share.note || null}>${share.key_pattern}<//>
      <${Doors}>
        <${Action} small row tone="danger" onClick=${(e) => { e.stopPropagation(); handleRevokeShare(share); }}>
          ${t('profile.access.shRevoke')}
        <//>
      <//>
    <//>
  `;

  const renderGroupCard = (group) => {
    const isExpanded = expandedId === group.id;
    const isEditing = editingId === group.id;
    const memberCount = (group.members || []).length;
    const groupShares = sharesOf(group.id);

    // The whole row opens and closes (a click anywhere but inside its panel, Enter on its name); the
    // ▶/▼ before the name says which it is, as main's expand icon did.
    return html`
      <${Row} key=${group.id} open=${isExpanded} onToggle=${() => setExpandedId(isExpanded ? null : group.id)}>
        <${Name} before=${html`<span aria-hidden="true">${isExpanded ? '▼' : '▶'}</span>`}>${group.name}<//>
        <${Desc}>${group.description || ''}<//>
        <${Doors}>
          <${Mark} tone="dim">${memberCount} ${t('profile.access.sgMembers') || 'members'}<//>
          ${groupShares.length > 0 && html`
            <${Mark}>${groupShares.length} ${t('profile.access.shTitle')}<//>
          `}
        <//>

        ${isExpanded && !isEditing && html`
          <${Panel} doors=${addingTo === group.id ? null : html`
            <${Action} small onClick=${(e) => { e.stopPropagation(); setAddingTo(group.id); setMemberIdent(''); setMemberType('ghii'); setMemberRead(true); setMemberWrite(false); }}>
              ${t('profile.access.sgAddMember') || 'Add Member'}
            <//>
            <${Action} small onClick=${(e) => { e.stopPropagation(); startEdit(group); }}>
              ${t('profile.access.sgEdit') || 'Edit'}
            <//>
            <${Action} small tone="danger" onClick=${(e) => { e.stopPropagation(); handleDelete(group.id, group.name); }}>
              ${t('profile.access.sgDelete') || 'Delete'}
            <//>`}>
            <${Facts} rows=${[
              { key: 'perms', k: t('profile.access.sgDefaultPerms') || 'Default permissions',
                v: `${group.defaultPermissions?.read ? (t('profile.access.sgRead') || 'read') : ''} ${group.defaultPermissions?.write ? (t('profile.access.sgWrite') || 'write') : ''}` },
              group.createdAt && { key: 'created', k: t('profile.access.sgCreatedAt') || 'Created', v: fmtDate(group.createdAt) },
            ]} />

            <${Space} above="section"><${SubHeading} level=${4}>${t('profile.access.sgMemberList') || 'Members'}<//><//>
            <${List} cols="name-kind-state-doors" keepCols dense empty=${t('profile.access.sgNoMembers') || 'No members yet'}>
              ${(group.members || []).map(m => renderMemberRow(group.id, m))}
            <//>

            <${Space} above="section"><${SubHeading} level=${4}>${t('profile.access.shTitle')}<//><//>
            <${List} cols="name-state" keepCols dense empty=${t('profile.access.shNone')}>
              ${groupShares.map(renderShareRow)}
            <//>
            ${sharingIn === group.id ? html`
              <${Card} tone="section">
                <${Fields}>
                  <${TextField} label=${t('profile.access.shPattern')} placeholder="deliveries.abc.**"
                    help="memory.key_pattern"
                    value=${sharePattern} onInput=${setSharePattern}
                    onEnter=${() => handleCreateShare(group.id)} />
                  <${TextField} label=${t('profile.access.shNote')}
                    placeholder=${t('profile.access.shNotePlaceholder')}
                    value=${shareNote} onInput=${setShareNote} />
                  <${FormActions}>
                    <${Loud} control onClick=${() => handleCreateShare(group.id)} disabled=${sharingBusy}>
                      ${sharingBusy ? '...' : t('profile.access.shCreate')}
                    <//>
                    <${Action} small onClick=${() => setSharingIn(null)}>
                      ${t('profile.access.shCancel')}
                    <//>
                  <//>
                <//>
              <//>
            ` : html`
              <${Actions}>
                <${Action} small onClick=${(e) => { e.stopPropagation(); setSharingIn(group.id); setSharePattern(''); setShareNote(''); }}>
                  ${t('profile.access.shAdd')}
                <//>
              <//>
            `}

            ${addingTo === group.id ? html`
              <${Card} tone="section">
                <${Fields}>
                  <${Field} label=${t('profile.access.sgMemberIdentifier') || 'Identifier (GHII or GAII)'}>
                    <${ContactPicker} value=${memberIdent} onChange=${setMemberIdent} valueMode="full"
                      placeholder=${'alice@node-id'} onSubmit=${() => handleAddMember(group.id)} />
                  <//>
                  <${Select} fit label=${t('profile.access.sgMemberType') || 'Type'} value=${memberType} onChange=${setMemberType}
                    options=${[['ghii', 'GHII'], ['gaii', 'GAII']]} />
                  <${Line} wrap gap="medium">
                    <${Check} inline checked=${memberRead} onChange=${setMemberRead}>${t('profile.access.sgRead') || 'Read'}<//>
                    <${Check} inline checked=${memberWrite} onChange=${setMemberWrite}>${t('profile.access.sgWrite') || 'Write'}<//>
                  <//>
                  <${FormActions}>
                    <${Loud} control onClick=${() => handleAddMember(group.id)}>
                      ${t('profile.access.sgAddMember') || 'Add'}
                    <//>
                    <${Action} small onClick=${() => setAddingTo(null)}>
                      ${t('profile.access.sgCancel') || 'Cancel'}
                    <//>
                  <//>
                <//>
              <//>
            ` : null}
          <//>
        `}

        ${isExpanded && isEditing && html`
          <${Panel}>
            <${Fields}>
              <${TextField} label=${t('profile.access.sgGroupName') || 'Group name'}
                value=${editName} onInput=${setEditName} />
              <${TextArea} label=${t('profile.access.sgDescription') || 'Description'} rows=${2}
                value=${editDesc} onInput=${setEditDesc} />
              <${Field} group label=${t('profile.access.sgDefaultPerms') || 'Default permissions'}>
                <${Line} wrap gap="medium">
                  <${Check} inline checked=${editRead} onChange=${setEditRead}>${t('profile.access.sgRead') || 'Read'}<//>
                  <${Check} inline checked=${editWrite} onChange=${setEditWrite}>${t('profile.access.sgWrite') || 'Write'}<//>
                <//>
              <//>
              <${FormActions}>
                <${Loud} control onClick=${() => handleUpdate(group.id)} disabled=${saving}>
                  ${saving ? '...' : (t('profile.access.sgSave') || 'Save')}
                <//>
                <${Action} small onClick=${() => setEditingId(null)}>
                  ${t('profile.access.sgCancel') || 'Cancel'}
                <//>
              <//>
            <//>
          <//>
        `}
      <//>
    `;
  };

  return html`
    ${inRow ? null : html`<${Space} above="section"><${SubHeading} level=${3} id="access-sharing-groups" desc=${t('profile.access.sgDesc')}>${t('profile.access.sgTitle') || 'Sharing Groups'}<//><//>`}

    ${groups === null
      ? html`<${List} loading=${t('profile.access.sgLoading') || 'Loading...'} />`
      : groups.length === 0
        ? (!showCreate && html`
            <${Line} gap="medium" below="large">
              <${Note} kind="quiet" inline>${t('profile.access.sgEmpty') || 'No sharing groups yet.'}<//>
              <${Action} small onClick=${() => setShowCreate(true)}>${t('profile.access.sgCreate') || 'New Group'}<//>
            <//>`)
        : html`<${List} cols="name-desc-doors">${groups.map(renderGroupCard)}<//>`
    }

    ${!showCreate ? ((groups?.length || 0) > 0 && html`
      <${Space} below="large">
        <${Actions}>
          <${Action} small onClick=${() => setShowCreate(true)}>
            ${t('profile.access.sgCreate') || 'New Group'}
          <//>
        <//>
      <//>
    `) : html`
      <${Card} tone="section" title=${t('profile.access.sgCreateTitle') || 'Create Sharing Group'}>
        <${Fields}>
          <${TextField} label=${t('profile.access.sgGroupName') || 'Group name'}
            placeholder=${t('profile.access.sgNamePlaceholder') || 'e.g. Team Alpha'}
            value=${formName} onInput=${setFormName}
            onEnter=${() => handleCreate()} />
          <${TextArea} label=${t('profile.access.sgDescription') || 'Description (optional)'} rows=${2}
            placeholder=${t('profile.access.sgDescPlaceholder') || 'What is this group for?'}
            value=${formDesc} onInput=${setFormDesc} />
          <${FormActions}>
            <${Loud} control onClick=${handleCreate} disabled=${creating}>
              ${creating ? '...' : (t('profile.access.sgCreateBtn') || 'Create')}
            <//>
            <${Action} small onClick=${() => setShowCreate(false)}>
              ${t('profile.access.sgCancel') || 'Cancel'}
            <//>
          <//>
        <//>
      <//>
    `}
    <${ConfirmUI} />
  `;
}
