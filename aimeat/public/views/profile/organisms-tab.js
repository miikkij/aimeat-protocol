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
import { OpenRouterSettings } from './generator-settings.js';
import { copyToClipboard } from '/js/utils.js';
import { Markdown, slugifyHeading } from '/components/Markdown.js';

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
  const [genBusy, setGenBusy] = useState(false);
  const [hasAiKey, setHasAiKey] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [genErrors, setGenErrors] = useState([]);   // validation errors (JSON present, fixable)
  const [genFail, setGenFail] = useState('');        // generation failure (AI call timed out / errored)
  const [activeDoc, setActiveDoc] = useState(null);  // { type, mode:'view'|'edit', page } for document-mode types
  const [sectionsByType, setSectionsByType] = useState({});  // { typeName: [{id,name,parentId,documents:[docId]}] }
  const [editingSec, setEditingSec] = useState(null);        // section id currently being renamed inline
  const draggedDoc = useRef(null);                            // { type, id } of the doc being dragged
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [delConfirm, setDelConfirm] = useState('');   // typed-name confirmation for delete
  const [newSpaceName, setNewSpaceName] = useState('');
  const [newSpaceMode, setNewSpaceMode] = useState('document');

  const load = useCallback(async () => {
    const w = await orgService.getWorkspace(orgId).catch(() => null);
    if (w && w.manifest) {
      const [ap, cfg, secs] = await Promise.all([
        orgService.listApprovals(orgId, 'pending').catch(() => []),
        orgService.getConfig(orgId).catch(() => ({})),
        orgService.getAllSections(orgId).catch(() => ({})),
      ]);
      setApprovals(ap); setGateOn(!!(cfg?.gates?.publish?.enabled)); setSectionsByType(secs);
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

  // Storage images in a viewed document can't load via a plain <img> (GET /v1/storage needs auth),
  // so fetch each with the session token and swap in an object URL.
  useEffect(() => {
    if (activeDoc?.mode !== 'view') return undefined;
    let revoked = false; const created = [];
    const id = setTimeout(() => {
      document.querySelectorAll('.pj-doc-view img').forEach((img) => {
        const src = img.getAttribute('src') || '';
        if (!src.includes('/v1/storage/') || img.dataset.resolved) return;
        img.dataset.resolved = '1';
        orgService.fetchStorageObjectUrl(src).then((u) => { if (!revoked) { created.push(u); img.src = u; } }).catch(() => {});
      });
    }, 50);
    return () => { revoked = true; clearTimeout(id); created.forEach(u => URL.revokeObjectURL(u)); };
  }, [activeDoc]);

  const setup = useCallback(async () => {
    setBusy(true);
    try {
      await orgService.applyProjectTemplate(orgId, org.name || 'Project', org.description || '');
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
    setGenBusy(true);
    try {
      await orgService.applyGeneratedWorkspace(orgId, generated);
      showToast(t('organisms.workspaceReady') || 'Workspace ready');
      if (fromGenerator) setShowSettings(true);   // open settings so the user can tweak the generated workspace
      await load();
    } catch (e) { setGenErrors([(e && e.message) || (t('organisms.applyError') || 'Could not apply — check the JSON.')]); }
    finally { setGenBusy(false); }
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

  // Documents are free-form markdown records ({id,title,markdown}) — same draft/publish path.
  // When created from a section, file the new id into that section's documents[].
  const savePage = useCallback(async (ot, page, sectionId) => {
    const id = (String(page.id || '').trim() || `doc-${Date.now().toString(36)}`).replace(/[^a-zA-Z0-9_-]/g, '-');
    setBusy(true);
    try {
      const r = await orgService.writeDraft(orgId, ot.namespace, id, { id, title: page.title, markdown: page.markdown });
      if (r?.ok === false) { showToast(r?.error?.message || 'Document rejected'); }
      else {
        if (sectionId) {
          const secs = (sectionsByType[ot.name] || []).map(s => s.id === sectionId
            ? { ...s, documents: [...(s.documents || []).filter(d => d !== id), id] } : s);
          await orgService.saveSections(orgId, ot.name, secs).catch(() => {});
        }
        showToast(t('organisms.pageSaved') || 'Document saved'); setActiveDoc(null); await load();
      }
    } catch (e) { showToast((e && e.message) || 'Failed to save document'); }
    finally { setBusy(false); }
  }, [orgId, sectionsByType, showToast, load]);

  // ── Section index ops (persist organism.{id}.meta.sections.{typeName}) ──
  const updateSections = useCallback(async (typeName, sections) => {
    setSectionsByType(s => ({ ...s, [typeName]: sections }));
    await orgService.saveSections(orgId, typeName, sections).catch(e => showToast((e && e.message) || 'Failed to save sections'));
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
  const commitSecName = (typeName) => { setEditingSec(null); orgService.saveSections(orgId, typeName, sectionsRef.current[typeName] || []).catch(() => {}); };

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
      await orgService.saveManifest(orgId, m);
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
          const r = await orgService.deleteWorkspace(orgId);
          if (r?.ok === false) { showToast(r?.error?.message || 'Failed to delete'); }
          else {
            showToast(t('organisms.workspaceDeleted') || 'Workspace deleted');
            setShowSettings(false); setDelConfirm(''); setShowRegenerate(false);
            await load();
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
      await orgService.addSpace(orgId, ws.manifest, newSpaceName.trim(), newSpaceMode);
      showToast(t('organisms.spaceAdded') || 'Space added');
      setNewSpaceName('');
      await load();
    } catch (e) { showToast((e && e.message) || 'Failed to add space'); }
    finally { setBusy(false); }
  }, [newSpaceName, newSpaceMode, ws, orgId, showToast, load]);

  const removeSpaceHandler = useCallback((typeName) => {
    confirm(
      (t('organisms.confirmRemoveSpace') || 'Remove "{name}" from this workspace? Its data is kept in memory (orphaned) but the section disappears.').replace('{name}', typeName),
      async () => {
        setBusy(true);
        try {
          await orgService.removeSpace(orgId, ws.manifest, typeName);
          showToast(t('organisms.spaceRemoved') || 'Space removed');
          await load();
        } catch (e) { showToast((e && e.message) || 'Failed to remove space'); }
        finally { setBusy(false); }
      },
      { danger: true, title: t('organisms.removeSpace') || 'Remove space' },
    );
  }, [ws, orgId, confirm, showToast, load]);

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
        <button class="btn-primary btn-sm" onClick=${applyPasted} disabled=${genBusy || !pasteText.trim()}>
          ${genBusy ? html`<span class="spinner"></span> ` : ''}${t('organisms.applyPasted') || 'Validate & apply'}
        </button>
      </div>
    </div>
  `;

  const back = html`<div class="card-actions mb-half"><button class="btn-ghost btn-sm" onClick=${onBack}>${'← '}${t('organisms.backToList') || 'All organisms'}</button></div>`;

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
    const docs = [...draftsFor(ot.name).map(d => ({ ...d, _draft: true })), ...objectsFor(ot.name)];
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
        <select class="input-field input-xs pj-move" onChange=${e => { const v = e.target.value; e.target.value = ''; if (!v) return; moveDocToSection(ot.name, d.id, v === '__unsorted' ? null : v); }}>
          <option value="">${t('organisms.moveTo') || 'move…'}</option>
          <option value="__unsorted">${t('organisms.unsorted') || 'Unsorted'}</option>
          ${secs.map(s => html`<option value=${s.id} key=${s.id}>${escHtml(s.name || '(unnamed)')}</option>`)}
        </select>
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
            ${docs.length === 0 && secs.length === 0 ? html`<div class="pj-empty">${t('organisms.noneYet') || 'none yet'}</div>` : null}
          </div>
          <div class="pj-doc-main">
            ${activeDoc?.type === ot.name && activeDoc.mode === 'edit' ? html`
              <${DocumentEditor} key=${'ed-' + (activeDoc.page.id || 'new')} orgId=${orgId} page=${activeDoc.page} busy=${busy} onSave=${(p) => savePage(ot, p, activeDoc.sectionId)} onCancel=${() => setActiveDoc(null)} />
            ` : activeDoc?.type === ot.name && activeDoc.mode === 'view' ? html`
              <div class="pj-doc-toolbar">
                <span class="pj-doc-vtitle">${escHtml(activeDoc.page.title || activeDoc.page.id)}</span>
                <button class="btn-ghost btn-sm" onClick=${() => setActiveDoc({ type: ot.name, mode: 'edit', page: activeDoc.page })}>${t('organisms.edit') || 'Edit'}</button>
                ${activeDoc.page._draft ? html`<button class="btn-primary btn-sm" onClick=${() => publish(ot, activeDoc.page.id)} disabled=${busy}>${t('organisms.publish') || 'Publish'}</button>` : null}
              </div>
              <div class="pj-doc-view"><${Markdown} text=${activeDoc.page.markdown || ''}
                onWikiLink=${(content) => {
                  const [titlePart, headingPart] = String(content).split('#');
                  const title = titlePart.trim();
                  const anchor = (headingPart || '').trim();
                  const scrollToAnchor = () => { if (anchor) setTimeout(() => { const el = document.querySelector('.pj-doc-view [id="' + slugifyHeading(anchor) + '"]'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 80); };
                  if (!title) { scrollToAnchor(); return; }   // [[#Heading]] → jump within the current document
                  const target = docs.find(d => (d.title || '').toLowerCase() === title.toLowerCase());
                  if (target) { setActiveDoc({ type: ot.name, mode: 'view', page: target }); scrollToAnchor(); }
                  else showToast((t('organisms.docNotFound') || 'No document titled “{title}”').replace('{title}', title));
                }} /></div>
            ` : html`<div class="pj-empty">${t('organisms.selectDoc') || 'Select a document, or create one.'}</div>`}
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

      ${types.map(ot => ot.mode === 'document' ? renderDocSpace(ot) : html`
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

/* Document editor: a Toast UI Editor (WYSIWYG, with its own built-in Markdown⇄WYSIWYG toggle, so
 * non-technical users type like a document). Falls back to a plain markdown textarea + live preview
 * if the editor can't load. Title is a separate Preact-controlled field. */
function DocumentEditor({ orgId, page, busy, onSave, onCancel }) {
  const [title, setTitle] = useState((page && page.title) || '');
  const [mode, setMode] = useState('rich');               // 'rich' = Toast UI; 'markdown' = fallback textarea
  const [md, setMd] = useState((page && page.markdown) || '');
  const containerRef = useRef(null);
  const editorRef = useRef(null);

  useEffect(() => {
    if (mode !== 'rich') return undefined;
    let inst = null, cancelled = false;
    loadToastUI().then((Editor) => {
      if (cancelled || !containerRef.current) return;
      inst = new Editor({
        el: containerRef.current,
        height: '440px',
        initialEditType: 'wysiwyg',
        previewStyle: 'tab',
        initialValue: (page && page.markdown) || '',
        usageStatistics: false,
        hooks: {
          // Drag/paste/insert an image → upload it to the organism's private storage and embed
          // the /v1/storage URL. (It shows in the saved document VIEW, which fetches it with the
          // session token; the editor preview can't auth, so it shows a placeholder until saved.)
          addImageBlobHook: async (blob, callback) => {
            try { callback(await orgService.uploadImage(orgId, blob, blob.type || 'image/png'), ''); }
            catch (e) { callback('', (e && e.message) || 'upload failed'); }
          },
        },
      });
      editorRef.current = inst;
    }).catch(() => { if (!cancelled) setMode('markdown'); });
    return () => { cancelled = true; if (inst) { try { inst.destroy(); } catch (e) { /* noop */ } } editorRef.current = null; };
  }, [mode]);

  const save = () => onSave({
    ...page, title: title.trim(),
    markdown: (mode === 'rich' && editorRef.current) ? editorRef.current.getMarkdown() : md,
  });

  return html`
    <div class="pj-doc-editor">
      <input type="text" class="input-field input-sm" placeholder=${t('organisms.pageTitle') || 'Document title'}
        value=${title} onInput=${e => setTitle(e.target.value)} />
      ${mode === 'rich'
        ? html`<div ref=${containerRef} class="pj-tui"></div>`
        : html`<div class="pj-doc-grid">
            <textarea class="input-field pj-doc-md" rows="14" placeholder=${t('organisms.writeMarkdown') || 'Write markdown…'}
              value=${md} onInput=${e => setMd(e.target.value)}></textarea>
            <div class="pj-doc-preview"><${Markdown} text=${md} /></div>
          </div>`}
      <div class="form-actions">
        <button class="btn-primary btn-sm" onClick=${save} disabled=${busy || !title.trim()}>${t('organisms.saveDraft') || 'Save draft'}</button>
        <button class="btn-ghost btn-sm" onClick=${onCancel}>${t('organisms.cancel') || 'Cancel'}</button>
      </div>
    </div>
  `;
}
