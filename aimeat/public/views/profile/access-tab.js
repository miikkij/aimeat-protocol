/**
 * @file access-tab.js
 * @description Profile tab displaying session info, public key, owner key,
 *   MCP endpoint details, federation access management, sharing groups,
 *   and owner-level agent defaults.
 * @structure
 *   - AccessTab (default export) -- main tab component
 *   - SharingGroupsSection -- CRUD for sharing groups with expandable member lists
 *   - AgentDefaultsSection -- owner-level default rules and token budget for agents
 * @version-history
 *   v1.0.0 -- 2026-03-16 -- Initial access tab
 *   v1.1.0 -- 2026-03-17 -- Replace inline styles with CSS classes
 *   v1.2.0 -- 2026-05-21 -- Add Federation Access section for auth consent management
 *   v1.3.0 -- 2026-05-21 -- Add Sharing Groups and Agent Defaults sections
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, copyToClipboard } from '/js/utils.js';
import { getNodeUrl } from '/js/services/auth.js';
import { apiGet, apiPost, apiDelete } from '/js/api.js';
import { useConfirm } from '/components/Modal.js';
import { CopyButton } from '/components/CopyButton.js';
import * as groupsApi from '/js/services/sharing-groups.js';
import { getOwnerDefaults, upsertOwnerDefaults } from '/js/services/agent-directives.js';

/* ═══════════════════════════════════════════════════════════════════
   Sharing Groups Section
   ═══════════════════════════════════════════════════════════════════ */

function SharingGroupsSection({ showToast }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [groups, setGroups] = useState(null);
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
    } catch {
      setGroups([]);
    }
  }, []);

  useEffect(() => { loadGroups(); }, [loadGroups]);

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
  }, [editName, editDesc, showToast, loadGroups]);

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
                  <input type="text" class="input-field input-sm"
                    placeholder=${'alice@node-id'}
                    value=${memberIdent} onInput=${e => setMemberIdent(e.target.value)}
                    onKeyDown=${e => e.key === 'Enter' && handleAddMember(group.id)} />
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
    <h3 class="card-h3 mt-section">\u{1F465} ${t('profile.access.sgTitle') || 'Sharing Groups'}</h3>
    <div class="section-desc">${t('profile.access.sgDesc') || 'Define groups of identities to share memory entries with. Assign a sharing group to memory keys to control who can read or write.'}</div>

    ${groups === null
      ? html`<div class="empty">${t('profile.access.sgLoading') || 'Loading...'}</div>`
      : groups.length === 0
        ? html`<div class="empty">${t('profile.access.sgEmpty') || 'No sharing groups yet.'}</div>`
        : groups.map(renderGroupCard)
    }

    ${!showCreate ? html`
      <div class="mb-1">
        <button class="btn-primary" onClick=${() => setShowCreate(true)}>
          ${t('profile.access.sgCreate') || 'New Group'}
        </button>
      </div>
    ` : html`
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

/* ═══════════════════════════════════════════════════════════════════
   Agent Defaults Section
   ═══════════════════════════════════════════════════════════════════ */

function AgentDefaultsSection({ showToast }) {
  const [defaults, setDefaults] = useState(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Edit state
  const [editRules, setEditRules] = useState([]);
  const [editBudget, setEditBudget] = useState('');
  const [newRule, setNewRule] = useState('');

  const loadDefaults = useCallback(async () => {
    try {
      const resp = await getOwnerDefaults();
      setDefaults(resp?.data?.defaults || null);
    } catch {
      setDefaults(null);
    }
  }, []);

  useEffect(() => { loadDefaults(); }, [loadDefaults]);

  // Live update listener
  const liveRef = useRef(loadDefaults);
  liveRef.current = loadDefaults;
  useEffect(() => {
    const handler = () => liveRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  const startEdit = useCallback(() => {
    const rules = defaults?.rules || [];
    const budget = defaults?.default_token_budget;
    setEditRules([...rules]);
    setEditBudget(budget != null ? String(budget) : '');
    setNewRule('');
    setEditing(true);
  }, [defaults]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const budgetVal = editBudget.trim() ? parseInt(editBudget, 10) : undefined;
      if (editBudget.trim() && (isNaN(budgetVal) || budgetVal < 0)) {
        showToast(t('profile.access.adInvalidBudget') || 'Token budget must be a non-negative number');
        setSaving(false);
        return;
      }
      await upsertOwnerDefaults({
        rules: editRules,
        default_token_budget: budgetVal,
        default_memory_areas: defaults?.default_memory_areas || [],
      });
      showToast(t('profile.access.adSaved') || 'Agent defaults saved');
      setEditing(false);
      loadDefaults();
    } catch (e) {
      showToast(e.message || (t('profile.access.adSaveError') || 'Failed to save defaults'));
    } finally {
      setSaving(false);
    }
  }, [editRules, editBudget, defaults, showToast, loadDefaults]);

  const addRule = useCallback(() => {
    if (!newRule.trim()) return;
    setEditRules(prev => [...prev, newRule.trim()]);
    setNewRule('');
  }, [newRule]);

  const removeRule = useCallback((idx) => {
    setEditRules(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const rules = defaults?.rules || [];
  const budget = defaults?.default_token_budget;

  return html`
    <h3 class="card-h3 mt-section">\u{1F916} ${t('profile.access.adTitle') || 'Agent Defaults'}</h3>
    <div class="section-desc">${t('profile.access.adDesc') || 'Owner-level defaults that apply to all your agents unless overridden by per-agent directives.'}</div>

    ${!editing ? html`
      <div class="card">
        <div class="flex-between mb-half">
          <div class="card-title">${t('profile.access.adRules') || 'Default Rules'}</div>
          <button class="btn-outline btn-sm" onClick=${startEdit}>
            ${t('profile.access.adEdit') || 'Edit'}
          </button>
        </div>

        ${rules.length === 0
          ? html`<div class="empty">${t('profile.access.adNoRules') || 'No default rules set.'}</div>`
          : rules.map((rule, i) => html`
              <div class="mem-item" key=${i}>
                <span class="mem-key">${escHtml(rule)}</span>
              </div>
            `)
        }

        <div class="mem-item">
          <span class="mem-key">${t('profile.access.adTokenBudget') || 'Token Budget'}</span>
          <span>${budget != null ? budget.toLocaleString() : (t('profile.access.adUnlimited') || 'Unlimited')}</span>
        </div>
      </div>
    ` : html`
      <div class="create-form">
        <h4 class="card-h3 mb-half">${t('profile.access.adEditTitle') || 'Edit Agent Defaults'}</h4>
        <div class="flex-col">
          <div class="form-row">
            <label>${t('profile.access.adRules') || 'Rules'}</label>
            ${editRules.map((rule, i) => html`
              <div class="mem-item" key=${i}>
                <span class="mem-key">${escHtml(rule)}</span>
                <button class="btn-ghost btn-danger btn-sm" onClick=${() => removeRule(i)}>
                  ${t('profile.access.adRemoveRule') || 'Remove'}
                </button>
              </div>
            `)}
            <div class="flex-row">
              <input type="text" class="input-field input-sm"
                placeholder=${t('profile.access.adRulePlaceholder') || 'Add a rule...'}
                value=${newRule} onInput=${e => setNewRule(e.target.value)}
                onKeyDown=${e => e.key === 'Enter' && addRule()} />
              <button class="btn-outline btn-sm" onClick=${addRule}>
                ${t('profile.access.adAddRule') || 'Add'}
              </button>
            </div>
          </div>

          <div class="form-row">
            <label>${t('profile.access.adTokenBudget') || 'Token Budget'}</label>
            <input type="number" class="input-field input-sm" min="0"
              placeholder=${t('profile.access.adBudgetPlaceholder') || 'Leave empty for unlimited'}
              value=${editBudget} onInput=${e => setEditBudget(e.target.value)} />
          </div>

          <div class="form-actions">
            <button class="btn-primary btn-sm" onClick=${handleSave} disabled=${saving}>
              ${saving ? '...' : (t('profile.access.adSave') || 'Save')}
            </button>
            <button class="btn-ghost btn-sm" onClick=${() => setEditing(false)}>
              ${t('profile.access.adCancel') || 'Cancel'}
            </button>
          </div>
        </div>
      </div>
    `}
  `;
}

/* ═══════════════════════════════════════════════════════════════════
   Agent Access Tokens Section
   ═══════════════════════════════════════════════════════════════════ */

// Mirrors the agent scope domains (agents-tab.js) — the same list agents are granted from.
const PAT_SCOPE_DOMAINS = [
  { key: 'memory', permissions: ['read', 'write', 'delete'] },
  { key: 'work', permissions: ['request', 'read', 'accept', 'publish'] },
  { key: 'social', permissions: ['read', 'write'] },
  { key: 'wallet', permissions: ['read'] },
  { key: 'consent', permissions: ['manage'] },
  { key: 'catalogue', permissions: ['read'] },
  { key: 'generator', permissions: ['read', 'write', 'execute'] },
  { key: 'task', permissions: ['read', 'write', 'manage'] },
  { key: 'cortex', permissions: ['write'] },
  { key: 'ext', permissions: ['write'] },
];

function buildPatAgentPrompt(tokenData) {
  const url = (typeof window !== 'undefined' ? window.location.origin : '');
  const level = tokenData.grant_operator ? 'operator (full node control)'
    : tokenData.grant_owner ? 'owner (acts as me)'
    : `scoped agent (${(tokenData.scopes || []).join(', ') || 'no scopes'})`;
  return `I'm giving you an AIMEAT access token so you can log in to my node (${url}) as ${level} and check that a web app works.

Use it by adding this HTTP header to your requests (and, for browser testing, set it as an extra header in your browser automation so every request the page makes carries it):

  Authorization: Bearer ${tokenData.token}

The server recognizes the token and treats every request as if I'm logged in — no extra login step. Open the app, click through it, read/write via it, and confirm it behaves correctly. Tell me what you find.`;
}

function AccessTokensSection({ session, showToast }) {
  const { confirm, ConfirmUI } = useConfirm();
  const isOperator = (session.roles || []).includes('operator');

  const [tokens, setTokens] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(null); // { token, prompt }

  // Create form
  const [label, setLabel] = useState('');
  const [selScopes, setSelScopes] = useState({});
  const [grantOwner, setGrantOwner] = useState(false);
  const [grantOperator, setGrantOperator] = useState(false);
  const [readOwnerData, setReadOwnerData] = useState(false);
  const [expiry, setExpiry] = useState('');

  const fullLevel = grantOwner || grantOperator;

  const load = useCallback(async () => {
    try { const r = await apiGet('/v1/access/tokens'); setTokens(r.data?.tokens || []); }
    catch { setTokens([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const liveRef = useRef(load);
  liveRef.current = load;
  useEffect(() => {
    const handler = () => liveRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  const resetForm = () => {
    setShowCreate(false); setLabel(''); setSelScopes({});
    setGrantOwner(false); setGrantOperator(false); setReadOwnerData(false); setExpiry('');
  };

  const toggleScope = (s) => setSelScopes(prev => ({ ...prev, [s]: !prev[s] }));

  const handleCreate = useCallback(async () => {
    if (!label.trim()) { showToast(t('profile.access.patLabelRequired') || 'Give the token a name'); return; }
    const scopes = fullLevel ? [] : Object.keys(selScopes).filter(k => selScopes[k]);
    if (!fullLevel && scopes.length === 0) {
      showToast(t('profile.access.patScopeRequired') || 'Select at least one scope, or Full / Operator');
      return;
    }
    setCreating(true);
    try {
      const body = {
        label: label.trim(), scopes,
        grant_owner: grantOwner, grant_operator: grantOperator, read_owner_data: readOwnerData,
      };
      if (expiry) body.expires_in = parseInt(expiry, 10);
      const r = await apiPost('/v1/access/tokens', body);
      const data = r.data;
      setCreated({ token: data.token, prompt: buildPatAgentPrompt(data) });
      resetForm();
      load();
    } catch (e) {
      showToast(e.message || (t('profile.access.patCreateError') || 'Failed to create token'));
    } finally { setCreating(false); }
  }, [label, fullLevel, selScopes, grantOwner, grantOperator, readOwnerData, expiry, showToast, load]);

  const handleRevoke = useCallback((id, lbl) => {
    confirm(
      (t('profile.access.patConfirmRevoke') || 'Revoke token "{name}"? Agents using it lose access immediately.').replace('{name}', lbl),
      async () => {
        try {
          await apiDelete('/v1/access/tokens/' + id);
          showToast(t('profile.access.patRevoked') || 'Token revoked');
          load();
        } catch (e) { showToast(e.message); }
      },
      { danger: true },
    );
  }, [confirm, showToast, load]);

  const levelBadge = (tok) => {
    if (tok.grant_operator) return html`<span class="badge badge-danger">${t('profile.access.patOperator') || 'Operator'}</span>`;
    if (tok.grant_owner) return html`<span class="badge badge-warn">${t('profile.access.patFullOwner') || 'Full owner'}</span>`;
    return html`<span class="badge badge-info">${(tok.scopes || []).length} ${t('profile.access.patScopes') || 'scopes'}</span>`;
  };

  return html`
    <h3 class="card-h3 mt-section">\u{1F511} ${t('profile.access.patTitle') || 'Agent Access Tokens'}</h3>
    <div class="section-desc">${t('profile.access.patDesc') || 'Create a revocable token an agent can use (as a Bearer header) to log in and test your apps. One token can be shared across all your agents.'}</div>

    ${created && html`
      <div class="card access-card-warn">
        <div class="card-title">${t('profile.access.patCreatedTitle') || 'Token created — copy it now'}</div>
        <div class="access-warn-text">⚠ ${t('profile.access.patShownOnce') || 'This token is shown only once. Store it now; you cannot see it again.'}</div>
        <div class="mem-item">
          <div class="access-mono access-pat-token">${escHtml(created.token)}</div>
          <${CopyButton} text=${created.token} className="btn-sm"
            onCopied=${() => showToast(t('profile.access.patCopied') || 'Token copied')} />
        </div>
        <div class="mem-item access-pat-prompt-row">
          <span class="mem-key">${t('profile.access.patAgentPrompt') || 'Ready-made agent prompt'}</span>
          <${CopyButton} text=${created.prompt} className="btn-sm"
            onCopied=${() => showToast(t('profile.access.patPromptCopied') || 'Prompt copied')} />
        </div>
        <div class="form-actions">
          <button class="btn-ghost btn-sm" onClick=${() => setCreated(null)}>${t('profile.access.patDone') || 'Done'}</button>
        </div>
      </div>
    `}

    ${tokens === null
      ? html`<div class="empty">${t('profile.access.patLoading') || 'Loading...'}</div>`
      : tokens.length === 0
        ? html`<div class="empty">${t('profile.access.patEmpty') || 'No access tokens yet.'}</div>`
        : tokens.map(tok => html`
            <div class="card" key=${tok.id}>
              <div class="flex-between">
                <div class="card-title">${escHtml(tok.label)}</div>
                ${levelBadge(tok)}
              </div>
              <div class="detail-grid">
                <div class="detail-item"><span class="detail-label">${t('profile.access.patCreatedAt') || 'Created'}</span><span class="detail-value">${new Date(tok.created_at).toLocaleDateString()}</span></div>
                <div class="detail-item"><span class="detail-label">${t('profile.access.patLastUsed') || 'Last used'}</span><span class="detail-value">${tok.last_used_at ? new Date(tok.last_used_at).toLocaleString() : (t('profile.access.patNever') || 'never')}</span></div>
                <div class="detail-item"><span class="detail-label">${t('profile.access.patExpires') || 'Expires'}</span><span class="detail-value">${tok.expires_at ? new Date(tok.expires_at).toLocaleDateString() : (t('profile.access.patNoExpiry') || 'never')}</span></div>
              </div>
              ${!tok.grant_owner && !tok.grant_operator && (tok.scopes || []).length > 0 && html`
                <div class="flex-row-wrap mt-half">
                  ${tok.scopes.map(s => html`<span class="badge badge-muted" key=${s}>${s}</span>`)}
                </div>
              `}
              <div class="card-actions">
                <button class="btn-danger-solid btn-sm" onClick=${() => handleRevoke(tok.id, tok.label)}>${t('profile.access.patRevoke') || 'Revoke'}</button>
              </div>
            </div>
          `)
    }

    ${!showCreate ? html`
      <div class="mb-1"><button class="btn-primary" onClick=${() => setShowCreate(true)}>${t('profile.access.patCreate') || 'New Token'}</button></div>
    ` : html`
      <div class="create-form">
        <h4 class="card-h3 mb-half">${t('profile.access.patCreateTitle') || 'Create Access Token'}</h4>
        <div class="flex-col">
          <div class="form-row">
            <label>${t('profile.access.patLabel') || 'Name'}</label>
            <input type="text" class="input-field input-sm"
              placeholder=${t('profile.access.patLabelPlaceholder') || 'e.g. App tester'}
              value=${label} onInput=${e => setLabel(e.target.value)} />
          </div>

          <div class="form-row">
            <label>${t('profile.access.patLevel') || 'Permissions'}</label>
            <label class="flex-row">
              <input type="checkbox" checked=${grantOwner} disabled=${grantOperator}
                onChange=${() => setGrantOwner(v => !v)} />
              <strong>${t('profile.access.patFullOwner') || 'Full owner'}</strong> — ${t('profile.access.patFullOwnerHint') || 'acts as you; sees all apps & data'}
            </label>
            ${isOperator && html`
              <label class="flex-row">
                <input type="checkbox" checked=${grantOperator}
                  onChange=${() => setGrantOperator(v => !v)} />
                <strong>${t('profile.access.patOperator') || 'Operator'}</strong> — ${t('profile.access.patOperatorHint') || 'full node administration (master key)'}
              </label>
            `}
            ${fullLevel && html`<span class="badge badge-warn">⚠ ${t('profile.access.patMasterKeyWarn') || 'Master key — guard it like a password'}</span>`}
          </div>

          ${!fullLevel && html`
            <div class="form-row">
              <label>${t('profile.access.patSelectScopes') || 'Scopes'}</label>
              ${PAT_SCOPE_DOMAINS.map(dom => html`
                <div class="flex-row-wrap access-pat-scope-row" key=${dom.key}>
                  <span class="access-pat-scope-domain">${dom.key}</span>
                  ${dom.permissions.map(p => {
                    const s = `${dom.key}:${p}`;
                    return html`<label class="flex-row" key=${s}>
                      <input type="checkbox" checked=${!!selScopes[s]} onChange=${() => toggleScope(s)} /> ${p}
                    </label>`;
                  })}
                </div>
              `)}
              <label class="flex-row mt-half">
                <input type="checkbox" checked=${readOwnerData} onChange=${() => setReadOwnerData(v => !v)} />
                ${t('profile.access.patReadOwnerData') || 'Also read my data (otherwise a clean sandbox)'}
              </label>
            </div>
          `}

          <div class="form-row">
            <label>${t('profile.access.patExpiry') || 'Expiry'}</label>
            <select class="input-field input-sm" value=${expiry} onChange=${e => setExpiry(e.target.value)}>
              <option value="">${t('profile.access.patNoExpiry') || 'No expiry'}</option>
              <option value="86400">${t('profile.access.patExpiry1d') || '24 hours'}</option>
              <option value="604800">${t('profile.access.patExpiry7d') || '7 days'}</option>
              <option value="2592000">${t('profile.access.patExpiry30d') || '30 days'}</option>
            </select>
          </div>

          <div class="form-actions">
            <button class="btn-primary btn-sm" onClick=${handleCreate} disabled=${creating}>
              ${creating ? '...' : (t('profile.access.patCreateBtn') || 'Create Token')}
            </button>
            <button class="btn-ghost btn-sm" onClick=${resetForm}>${t('profile.access.patCancel') || 'Cancel'}</button>
          </div>
        </div>
      </div>
    `}
    <${ConfirmUI} />
  `;
}

/* ═══════════════════════════════════════════════════════════════════
   Main Access Tab
   ═══════════════════════════════════════════════════════════════════ */

export default function AccessTab({ session, showToast }) {
  const NODE_URL = getNodeUrl();
  const ownerKey = typeof localStorage !== 'undefined' ? localStorage.getItem('aimeat_owner_key') : null;
  const [keyBlurred, setKeyBlurred] = useState(true);
  const [authConsents, setAuthConsents] = useState([]);
  const [newNodeId, setNewNodeId] = useState('');
  const [fedLoading, setFedLoading] = useState(false);

  // Load auth consents on mount
  useEffect(() => {
    apiGet('/v1/consent').then(data => {
      const all = data.data?.consents || [];
      setAuthConsents(all.filter(c => c.scope === 'auth' && c.status === 'active'));
    }).catch(() => {});
  }, []);

  async function addAuthNode() {
    if (!newNodeId.trim()) return;
    setFedLoading(true);
    try {
      await apiPost('/v1/consent', {
        data_pattern: '_identity',
        recipient: 'node:' + newNodeId.trim(),
        scope: 'auth',
        purpose: 'federation_login',
      });
      setNewNodeId('');
      const data = await apiGet('/v1/consent');
      setAuthConsents((data.data?.consents || []).filter(c => c.scope === 'auth' && c.status === 'active'));
      showToast(t('profile.access.fedGranted'));
    } catch (e) {
      showToast(e.message);
    } finally {
      setFedLoading(false);
    }
  }

  async function removeAuthConsent(id) {
    try {
      await apiDelete('/v1/consent/' + id);
      setAuthConsents(prev => prev.filter(c => c.id !== id));
      showToast(t('profile.access.fedRevoked'));
    } catch (e) {
      showToast(e.message);
    }
  }

  async function toggleAllowAll() {
    const wildcard = authConsents.find(c => c.recipient === '*');
    if (wildcard) {
      await removeAuthConsent(wildcard.id);
    } else {
      try {
        await apiPost('/v1/consent', {
          data_pattern: '_identity',
          recipient: '*',
          scope: 'auth',
          purpose: 'federation_login_all',
        });
        const data = await apiGet('/v1/consent');
        setAuthConsents((data.data?.consents || []).filter(c => c.scope === 'auth' && c.status === 'active'));
      } catch (e) {
        showToast(e.message);
      }
    }
  }

  return html`
    <div class="section-title">${t('profile.access.title')}</div>
    <div class="section-desc">${t('profile.access.desc')}</div>

    <h3 class="card-h3">\u{1F4BB} ${t('profile.access.session')}</h3>
    <div class="card">
      <div class="mem-item"><span class="mem-key">${t('profile.access.owner')}</span><span>${escHtml(session.owner || '-')}</span></div>
      <div class="mem-item"><span class="mem-key">${t('profile.access.ghii')}</span><span>${escHtml(session.ghii || '-')}</span></div>
      <div class="mem-item"><span class="mem-key">${t('profile.access.agentGaii')}</span><span>${escHtml(session.gaii || '-')}</span></div>
      <div class="mem-item"><span class="mem-key">${t('profile.access.node')}</span><span>${escHtml(NODE_URL)}</span></div>
      <div class="mem-item"><span class="mem-key">${t('profile.access.jwtValid')}</span><span>${session.valid ? html`<span class="badge badge-success">${t('profile.access.yes')}</span>` : html`<span class="badge badge-danger">${t('profile.access.expired')}</span>`}</span></div>
    </div>

    <h3 class="card-h3 mt-section">\u{1F510} ${t('profile.access.publicKey')}</h3>
    <div class="card"><div class="access-mono">${escHtml(session.publicKey || 'N/A')}</div></div>

    ${ownerKey && html`
      <h3 class="card-h3 mt-section">\u{1F5DD}️ ${t('profile.access.ownerKey')}</h3>
      <div class="card access-card-warn" onClick=${() => copyToClipboard(ownerKey).then(() => showToast(t('profile.access.keyCopied')))}>
        <div class="flex-between">
          <div class="access-mono ${keyBlurred ? 'access-key-blur' : 'access-key-blur revealed'}"
            onMouseEnter=${() => setKeyBlurred(false)} onMouseLeave=${() => setKeyBlurred(true)}>
            ${escHtml(ownerKey)}
          </div>
          <div class="flex-row">
            <span class="badge badge-warn">${t('profile.access.hoverReveal')}</span>
            <span onClick=${(e) => e.stopPropagation()}>
              <${CopyButton} text=${ownerKey} className="btn-sm"
                onCopied=${() => showToast(t('profile.access.keyCopied'))} />
            </span>
          </div>
        </div>
        <div class="access-warn-text">⚠ ${t('profile.access.keepSafe')}</div>
      </div>
    `}

    <h3 class="card-h3 mt-section">\u{1F517} ${t('profile.access.mcpEndpoint')}</h3>
    <div class="card">
      <div class="access-mcp-url">${escHtml(NODE_URL + '/v1/mcp')}</div>
      <div class="access-mcp-desc">${t('profile.access.mcpDesc')}</div>
    </div>

    <h3 class="card-h3 mt-section">\u{1F310} ${t('profile.access.fedTitle')}</h3>
    <div class="section-desc">${t('profile.access.fedDesc')}</div>

    <div class="card">
      <div class="mem-item">
        <label class="flex-row">
          <input type="checkbox"
            checked=${authConsents.some(c => c.recipient === '*')}
            onChange=${toggleAllowAll} />
          ${t('profile.access.fedAllowAll')}
        </label>
        ${authConsents.some(c => c.recipient === '*') && html`
          <span class="badge badge-warn">${t('profile.access.fedAllowAllWarn')}</span>
        `}
      </div>

      ${authConsents.filter(c => c.recipient !== '*').length === 0 && !authConsents.some(c => c.recipient === '*') && html`
        <p class="adm-text-dim">${t('profile.access.fedNoConsents')}</p>
      `}
      ${authConsents.filter(c => c.recipient !== '*').map(c => html`
        <div class="mem-item">
          <span class="mem-key">${escHtml(c.recipient.replace('node:', ''))}</span>
          <span class="adm-text-dim" style="font-size:.85em">${c.granted_at ? new Date(c.granted_at).toLocaleDateString() : ''}</span>
          <button class="btn-ghost btn-danger" onClick=${() => removeAuthConsent(c.id)}>
            ${t('profile.access.fedRemove')}
          </button>
        </div>
      `)}

      <div class="mem-item access-fed-add">
        <input type="text" class="input-field input-sm" placeholder=${t('profile.access.fedNodeId')}
          value=${newNodeId} onInput=${e => setNewNodeId(e.target.value)}
          onKeyDown=${e => e.key === 'Enter' && addAuthNode()} />
        <button class="btn-primary" onClick=${addAuthNode} disabled=${fedLoading}>
          ${t('profile.access.fedAddNode')}
        </button>
      </div>
    </div>

    <${AccessTokensSection} session=${session} showToast=${showToast} />
    <${SharingGroupsSection} showToast=${showToast} />
    <${AgentDefaultsSection} showToast=${showToast} />
  `;
}
