/**
 * @file tab-data-access.js
 * @description Data Access tab: shared tags, memory areas, knowledge packages,
 *   and effective scope summary.
 * @version-history
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 *   v1.1.0 -- 2026-05-24 -- Add area form (F12), link package (F13), doc count (F14), tags help (F15), scope footer (F16)
 *   v1.2.0 -- 2026-05-30 -- Live-update refresh also re-fetches the currently expanded memory entry's value (was: only the key list refreshed, the open entry stayed stale until the user closed + reopened it or switched tabs). Also stop showing the full-tab "Loading..." overlay on every live-update tick -- it now only shows on initial mount.
 *   v1.3.0 -- 2026-05-31 -- Make Stored Memory Keys editable (inline textarea + Save) and deletable; make Memory Areas editable (key prefix / description / access) and deletable. Stored-key list now carries `version` for optimistic-lock PUTs. Delete confirmations use the shared useConfirm dialog.
 *   v1.4.0 -- 2026-05-31 -- Add "+ Add key" button + create form to Stored Memory Keys. New entries are created under the AGENT's GAII (createMemory passes agent.gaii), not the owner's GHII, so they belong to the agent being viewed.
 */

import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet, apiPatch } from '/js/api.js';
import { getDirectives, upsertDirectives } from '/js/services/agent-directives.js';
import { updateMemoryFull, deleteMemory, createMemory } from '/js/services/memory.js';
import { useConfirm } from '/components/Modal.js';

const html = htm.bind(h);

export default function TabDataAccess({ agent, agentName, session, showToast, allAgents }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [tags, setTags] = useState(agent.tags ?? []);
  const [memoryAreas, setMemoryAreas] = useState([]);
  const [resources, setResources] = useState([]);
  const [addingTag, setAddingTag] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [addingArea, setAddingArea] = useState(false);
  const [newAreaKey, setNewAreaKey] = useState('');
  const [newAreaDesc, setNewAreaDesc] = useState('');
  const [newAreaPerm, setNewAreaPerm] = useState('read+write');
  // Memory-area inline editing (by index into memoryAreas).
  const [editingAreaIdx, setEditingAreaIdx] = useState(null);
  const [editAreaKey, setEditAreaKey] = useState('');
  const [editAreaDesc, setEditAreaDesc] = useState('');
  const [editAreaPerm, setEditAreaPerm] = useState('read+write');
  const [addingPackage, setAddingPackage] = useState(false);
  const [newPkgName, setNewPkgName] = useState('');
  const [newPkgDesc, setNewPkgDesc] = useState('');
  const [memoryKeys, setMemoryKeys] = useState([]);
  const [expandedKey, setExpandedKey] = useState(null);
  const [expandedValue, setExpandedValue] = useState(null);
  // Stored-key inline value editing.
  const [editingKey, setEditingKey] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  // Stored-key creation form.
  const [addingKey, setAddingKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [newKeyVis, setNewKeyVis] = useState('private');
  const [creatingKey, setCreatingKey] = useState(false);
  const [loading, setLoading] = useState(true);
  // Track which key's value is currently being shown so the live-update
  // refresher can re-fetch it without going through the click handler.
  const expandedKeyRef = useRef(null);
  expandedKeyRef.current = expandedKey;
  // Don't let a background live-update tick clobber the textarea while the
  // user is mid-edit.
  const editingKeyRef = useRef(null);
  editingKeyRef.current = editingKey;

  async function fetchMemoryValue(key) {
    const gaii = agent?.gaii || agentName;
    try {
      const resp = await apiGet(`/v1/memory/${encodeURIComponent(gaii)}/${encodeURIComponent(key)}`);
      const val = resp?.data?.value;
      return typeof val === 'string' ? val : JSON.stringify(val, null, 2);
    } catch {
      const resp2 = await apiGet(`/v1/memory?agent=${encodeURIComponent(gaii)}&prefix=${encodeURIComponent(key)}`);
      const items = resp2?.data?.items || resp2?.data || [];
      const found = Array.isArray(items) ? items.find(i => i.key === key) : null;
      return found ? (typeof found.value === 'string' ? found.value : JSON.stringify(found.value, null, 2)) : 'Could not load value';
    }
  }

  async function loadData({ showSpinner = true } = {}) {
    if (showSpinner) setLoading(true);
    try {
      const [dirResp, memResp] = await Promise.all([
        getDirectives(agentName).catch(() => null),
        apiGet(`/v1/memory?prefix=&per_page=100&agent=${encodeURIComponent(agent.gaii || agentName)}`).catch(() => null),
      ]);
      const data = dirResp?.data || {};
      setMemoryAreas(data.memory_areas || []);
      setResources(data.resources || []);
      const items = memResp?.data?.items || memResp?.data || [];
      const keys = (Array.isArray(items) ? items : [])
        .map(item => ({ key: item.key, visibility: item.visibility, version: item.version, updatedAt: item.updated_at ?? item.updatedAt }));
      setMemoryKeys(keys);

      // If the user has a memory entry expanded, re-fetch its value too so
      // the rendered body stays in sync with the latest server state. Without
      // this, the key list refreshes but the open entry shows stale content
      // until the user collapses + re-expands it. Skip the re-fetch while the
      // user is editing that entry so we don't overwrite their textarea.
      const currentKey = expandedKeyRef.current;
      if (currentKey) {
        const stillPresent = keys.some(k => k.key === currentKey);
        if (stillPresent) {
          if (editingKeyRef.current !== currentKey) {
            setExpandedValue(await fetchMemoryValue(currentKey));
          }
        } else {
          // Entry deleted server-side; collapse it.
          setExpandedKey(null);
          setExpandedValue(null);
          setEditingKey(null);
        }
      }
    } catch {
      setMemoryAreas([]);
      setResources([]);
      setMemoryKeys([]);
    }
    setTags(agent.tags ?? []);
    if (showSpinner) setLoading(false);
  }

  useEffect(() => { loadData(); }, [agentName]);

  const loadRef = useRef(loadData);
  loadRef.current = loadData;
  useEffect(() => {
    // Live-update tick: refresh in the background WITHOUT toggling the
    // full-tab "Loading..." overlay. Showing the spinner on every tick
    // (the SSE bus debounces to ~500ms but still fires often) made the
    // whole panel flash blank every time anything changed server-side.
    const handler = () => loadRef.current({ showSpinner: false });
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  async function handleAddTag() {
    const tag = newTag.trim().toLowerCase();
    if (!tag || tags.includes(tag)) return;
    try {
      const updated = [...tags, tag];
      await apiPatch(`/v1/agents/${encodeURIComponent(agentName)}/tags`, { tags: updated });
      setTags(updated);
      setNewTag('');
      setAddingTag(false);
      showToast(t('profile.agents.detail.data_access.tagAdded'));
    } catch (err) {
      showToast(err.message || t('profile.agents.detail.data_access.addTagError'), true);
    }
  }

  async function handleRemoveTag(tag) {
    try {
      const updated = tags.filter(t => t !== tag);
      await apiPatch(`/v1/agents/${encodeURIComponent(agentName)}/tags`, { tags: updated });
      setTags(updated);
      showToast(t('profile.agents.detail.data_access.tagRemoved'));
    } catch (err) {
      showToast(err.message || t('profile.agents.detail.data_access.removeTagError'), true);
    }
  }

  async function handleAddArea() {
    const key = newAreaKey.trim();
    if (!key) return;
    try {
      const updated = [...memoryAreas, { key_prefix: key, description: newAreaDesc.trim(), access: newAreaPerm }];
      await upsertDirectives(agentName, { memory_areas: updated });
      setMemoryAreas(updated);
      setNewAreaKey('');
      setNewAreaDesc('');
      setNewAreaPerm('read+write');
      setAddingArea(false);
      showToast(t('profile.agents.detail.data_access.areaAdded'));
    } catch (err) {
      showToast(err.message || t('profile.agents.detail.data_access.addAreaError'), true);
    }
  }

  function startEditArea(idx, area) {
    setEditingAreaIdx(idx);
    setEditAreaKey(area.key_prefix || area.key || area || '');
    setEditAreaDesc(area.description || '');
    setEditAreaPerm(area.access === 'read' ? 'read' : 'read+write');
  }

  function cancelEditArea() {
    setEditingAreaIdx(null);
  }

  async function handleSaveArea(idx) {
    const key = editAreaKey.trim();
    if (!key) return;
    try {
      const updated = memoryAreas.map((a, i) =>
        i === idx ? { key_prefix: key, description: editAreaDesc.trim(), access: editAreaPerm } : a);
      await upsertDirectives(agentName, { memory_areas: updated });
      setMemoryAreas(updated);
      setEditingAreaIdx(null);
      showToast(t('profile.agents.detail.data_access.areaUpdated'));
    } catch (err) {
      showToast(err.message || t('profile.agents.detail.data_access.updateAreaError'), true);
    }
  }

  function handleRemoveArea(idx) {
    confirm(t('profile.agents.detail.data_access.confirmDeleteArea'), async () => {
      try {
        const updated = memoryAreas.filter((_, i) => i !== idx);
        await upsertDirectives(agentName, { memory_areas: updated });
        setMemoryAreas(updated);
        if (editingAreaIdx === idx) setEditingAreaIdx(null);
        showToast(t('profile.agents.detail.data_access.areaRemoved'));
      } catch (err) {
        showToast(err.message || t('profile.agents.detail.data_access.removeAreaError'), true);
      }
    }, { danger: true });
  }

  async function handleLinkPackage() {
    const name = newPkgName.trim();
    if (!name) return;
    try {
      const updated = [...resources, { name, description: newPkgDesc.trim() }];
      await upsertDirectives(agentName, { resources: updated });
      setResources(updated);
      setNewPkgName('');
      setNewPkgDesc('');
      setAddingPackage(false);
      showToast(t('profile.agents.detail.data_access.packageLinked'));
    } catch (err) {
      showToast(err.message || t('profile.agents.detail.data_access.linkPackageError'), true);
    }
  }

  async function toggleExpandKey(mk) {
    if (expandedKey === mk.key) {
      setExpandedKey(null);
      setExpandedValue(null);
      setEditingKey(null);
      return;
    }
    setEditingKey(null);
    setExpandedKey(mk.key);
    setExpandedValue('...');
    setExpandedValue(await fetchMemoryValue(mk.key));
  }

  function startEditKey(mk) {
    setExpandedKey(mk.key);
    setEditingKey(mk.key);
    // expandedValue holds the freshly-fetched value text; seed the editor from it.
    setEditValue(typeof expandedValue === 'string' && expandedValue !== '...' ? expandedValue : '');
  }

  function cancelEditKey() {
    setEditingKey(null);
  }

  async function handleSaveKey(mk) {
    setSavingKey(true);
    try {
      // Preserve the original value type: if the editor text parses as JSON,
      // store the parsed value (object/array/number/etc.); otherwise store the
      // raw string.
      let parsed;
      try { parsed = JSON.parse(editValue); } catch { parsed = editValue; }
      await updateMemoryFull(mk.key, { value: parsed, version: mk.version });
      showToast(t('profile.agents.detail.data_access.valueSaved'));
      setEditingKey(null);
      await loadData({ showSpinner: false });
    } catch (err) {
      showToast(err.message || t('profile.agents.detail.data_access.saveValueError'), true);
    } finally {
      setSavingKey(false);
    }
  }

  function handleDeleteKey(mk) {
    confirm(t('profile.agents.detail.data_access.confirmDeleteKey', { key: mk.key }), async () => {
      try {
        await deleteMemory(mk.key);
        showToast(t('profile.agents.detail.data_access.keyDeleted'));
        if (expandedKey === mk.key) { setExpandedKey(null); setExpandedValue(null); }
        setEditingKey(null);
        await loadData({ showSpinner: false });
      } catch (err) {
        showToast(err.message || t('profile.agents.detail.data_access.deleteKeyError'), true);
      }
    }, { danger: true });
  }

  async function handleCreateKey() {
    const key = newKeyName.trim();
    if (!key || creatingKey) return;
    setCreatingKey(true);
    try {
      // Preserve value type: store parsed JSON when the text parses, else the
      // raw string.
      let parsed;
      try { parsed = JSON.parse(newKeyValue); } catch { parsed = newKeyValue; }
      // Store under the AGENT's GAII (not the owner GHII) so the entry belongs
      // to the agent being viewed.
      const gaii = agent?.gaii || agentName;
      await createMemory(key, parsed, newKeyVis, undefined, undefined, gaii);
      showToast(t('profile.agents.detail.data_access.keyCreated'));
      setAddingKey(false);
      setNewKeyName('');
      setNewKeyValue('');
      setNewKeyVis('private');
      await loadData({ showSpinner: false });
    } catch (err) {
      showToast(err.message || t('profile.agents.detail.data_access.createKeyError'), true);
    } finally {
      setCreatingKey(false);
    }
  }

  function getSharedWith(tag) {
    if (!allAgents) return [];
    return allAgents.filter(a => a.name !== agentName && (a.tags ?? []).includes(tag));
  }

  if (loading) {
    return html`<div class="pf-agd-empty">${t('profile.loading')}</div>`;
  }

  const hasTags = tags.length > 0;
  const hasAreas = memoryAreas.length > 0;
  const hasResources = resources.length > 0;
  const hasKeys = memoryKeys.length > 0;

  if (!hasTags && !hasAreas && !hasResources && !hasKeys && !addingTag && !addingArea && !addingPackage && !addingKey) {
    return html`
      <div>
        <div class="pf-agd-empty">${t('profile.agents.detail.empty.data_access')}</div>
        <div class="pf-agd-form-actions">
          <button class="btn-outline btn-sm" onClick=${() => setAddingTag(true)}>+ ${t('profile.agents.detail.data_access.addTag')}</button>
          <button class="btn-outline btn-sm" onClick=${() => setAddingArea(true)}>+ ${t('profile.agents.detail.data_access.addArea')}</button>
          <button class="btn-outline btn-sm" onClick=${() => setAddingPackage(true)}>+ ${t('profile.agents.detail.data_access.linkPackage')}</button>
          <button class="btn-outline btn-sm" onClick=${() => setAddingKey(true)}>+ ${t('profile.agents.detail.data_access.addKey')}</button>
        </div>
        <${ConfirmUI} />
      </div>
    `;
  }

  return html`
    <div>
      <!-- SHARED TAGS -->
      <div class="pf-agd-data-section">
        <div class="pf-agd-section-header">
          <span class="pf-agd-section-title">${t('profile.agents.detail.data_access.sharedTagsTitle')}</span>
          <button class="btn-outline btn-sm" onClick=${() => setAddingTag(!addingTag)}>+ ${t('profile.agents.detail.data_access.addTag')}</button>
        </div>
        ${addingTag && html`
          <div class="pf-agd-form-field pf-agd-tag-input-row">
            <input type="text" value=${newTag} onInput=${(e) => setNewTag(e.target.value)}
                   placeholder=${t('profile.agents.detail.data_access.tagPlaceholder')}
                   onKeyDown=${(e) => e.key === 'Enter' && handleAddTag()} />
            <button class="btn-primary btn-sm" onClick=${handleAddTag}>${t('common.add')}</button>
          </div>
        `}
        ${tags.map(tag => {
          const shared = getSharedWith(tag);
          return html`
            <div key=${tag} class="pf-agd-tag-row">
              <span class="pf-agd-tag-name">[${tag}]</span>
              <span class="pf-agd-tag-prefix">agents.tag.${tag}.*</span>
              <span class="pf-agd-tag-sharing">
                ${shared.length > 0
                  ? `${t('profile.agents.detail.data_access.with')}: ${shared.map(a => a.name).join(', ')}`
                  : t('profile.agents.detail.data_access.onlyYou')}
              </span>
              <button class="pf-agd-remove-btn" onClick=${() => handleRemoveTag(tag)}>x</button>
            </div>
          `;
        })}
        ${tags.length === 0 && !addingTag && html`
          <div class="pf-agd-empty">${t('profile.agents.detail.data_access.noTags')}</div>
        `}
        <div class="pf-agd-help-text">${t('profile.agents.detail.data_access.tagsHelp')}</div>
      </div>

      <!-- MEMORY AREAS -->
      <div class="pf-agd-data-section">
        <div class="pf-agd-section-header">
          <span class="pf-agd-section-title">${t('profile.agents.detail.data_access.memoryAreasTitle')}</span>
          <button class="btn-outline btn-sm" onClick=${() => setAddingArea(!addingArea)}>+ ${t('profile.agents.detail.data_access.addArea')}</button>
        </div>
        ${addingArea && html`
          <div class="pf-agd-area-form">
            <input type="text" value=${newAreaKey} onInput=${(e) => setNewAreaKey(e.target.value)}
                   placeholder=${t('profile.agents.detail.data_access.areaKeyPlaceholder')} />
            <input type="text" value=${newAreaDesc} onInput=${(e) => setNewAreaDesc(e.target.value)}
                   placeholder=${t('profile.agents.detail.data_access.areaDescPlaceholder')} />
            <select value=${newAreaPerm} onChange=${(e) => setNewAreaPerm(e.target.value)}>
              <option value="read+write">${t('profile.agents.detail.data_access.permReadWrite')}</option>
              <option value="read">${t('profile.agents.detail.data_access.permReadOnly')}</option>
            </select>
            <button class="btn-primary btn-sm" onClick=${handleAddArea}>${t('profile.agents.detail.data_access.addArea')}</button>
            <button class="btn-outline btn-sm" onClick=${() => setAddingArea(false)}>${t('common.cancel')}</button>
          </div>
        `}
        ${hasAreas ? memoryAreas.map((area, idx) => (
          editingAreaIdx === idx ? html`
            <div key=${'edit-' + idx} class="pf-agd-area-form">
              <input type="text" value=${editAreaKey} onInput=${(e) => setEditAreaKey(e.target.value)}
                     placeholder=${t('profile.agents.detail.data_access.areaKeyPlaceholder')} />
              <input type="text" value=${editAreaDesc} onInput=${(e) => setEditAreaDesc(e.target.value)}
                     placeholder=${t('profile.agents.detail.data_access.areaDescPlaceholder')} />
              <select value=${editAreaPerm} onChange=${(e) => setEditAreaPerm(e.target.value)}>
                <option value="read+write">${t('profile.agents.detail.data_access.permReadWrite')}</option>
                <option value="read">${t('profile.agents.detail.data_access.permReadOnly')}</option>
              </select>
              <button class="btn-primary btn-sm" onClick=${() => handleSaveArea(idx)}>${t('common.save')}</button>
              <button class="btn-outline btn-sm" onClick=${cancelEditArea}>${t('common.cancel')}</button>
            </div>
          ` : html`
            <div key=${area.key_prefix || area.key || idx} class="pf-agd-area-row">
              <span class="pf-agd-area-key">${area.key_prefix || area.key || area}</span>
              <span class="pf-agd-area-desc">${area.description || ''}</span>
              <span class="pf-agd-area-perm ${area.access === 'read' ? 'pf-agd-area-perm--ro' : 'pf-agd-area-perm--rw'}">
                ${area.access === 'read' ? t('profile.agents.detail.data_access.permReadOnly') : t('profile.agents.detail.data_access.permReadWrite')}
              </span>
              <span class="pf-agd-area-actions">
                <button class="btn-ghost btn-sm" onClick=${() => startEditArea(idx, area)}>${t('profile.agents.detail.data_access.edit')}</button>
                <button class="btn-ghost btn-sm pf-agd-action-danger" onClick=${() => handleRemoveArea(idx)}>${t('common.delete')}</button>
              </span>
            </div>
          `
        )) : !addingArea && html`
          <div class="pf-agd-empty">${t('profile.agents.detail.data_access.noAreas')}</div>
        `}
      </div>

      <!-- KNOWLEDGE PACKAGES -->
      <div class="pf-agd-data-section">
        <div class="pf-agd-section-header">
          <span class="pf-agd-section-title">${t('profile.agents.detail.data_access.knowledgeTitle')}</span>
          <button class="btn-outline btn-sm" onClick=${() => setAddingPackage(!addingPackage)}>+ ${t('profile.agents.detail.data_access.linkPackage')}</button>
        </div>
        ${addingPackage && html`
          <div class="pf-agd-area-form">
            <input type="text" value=${newPkgName} onInput=${(e) => setNewPkgName(e.target.value)}
                   placeholder=${t('profile.agents.detail.data_access.packageNamePlaceholder')} />
            <input type="text" value=${newPkgDesc} onInput=${(e) => setNewPkgDesc(e.target.value)}
                   placeholder=${t('profile.agents.detail.data_access.packageDescPlaceholder')} />
            <button class="btn-primary btn-sm" onClick=${handleLinkPackage}>${t('profile.agents.detail.data_access.linkPackage')}</button>
            <button class="btn-outline btn-sm" onClick=${() => setAddingPackage(false)}>${t('common.cancel')}</button>
          </div>
        `}
        ${hasResources ? resources.map(res => html`
          <div key=${res.url || res.name || res} class="pf-agd-area-row">
            <span class="pf-agd-area-key">${res.name || res.url || res}</span>
            <span class="pf-agd-area-desc">${res.description || ''}</span>
            ${(res.documentCount || res.count) ? html`<span class="pf-agd-package-count">${res.documentCount || res.count} ${t('profile.agents.detail.data_access.docCount')}</span>` : ''}
          </div>
        `) : !addingPackage && html`
          <div class="pf-agd-empty">${t('profile.agents.detail.data_access.noPackages')}</div>
        `}
      </div>

      <!-- STORED MEMORY KEYS -->
      <div class="pf-agd-data-section">
          <div class="pf-agd-section-header">
            <span class="pf-agd-section-title">${t('profile.agents.detail.data_access.storedKeysTitle')}</span>
            <button class="btn-outline btn-sm" onClick=${() => setAddingKey(!addingKey)}>+ ${t('profile.agents.detail.data_access.addKey')}</button>
          </div>
          ${addingKey && html`
            <div class="pf-agd-area-form pf-agd-keyadd-form">
              <input type="text" value=${newKeyName} onInput=${(e) => setNewKeyName(e.target.value)}
                     placeholder=${t('profile.agents.detail.data_access.keyNamePlaceholder')} />
              <select value=${newKeyVis} onChange=${(e) => setNewKeyVis(e.target.value)}>
                <option value="private">private</option>
                <option value="owner">owner</option>
                <option value="public">public</option>
              </select>
              <textarea class="pf-agd-memory-edit" value=${newKeyValue}
                        onInput=${(e) => setNewKeyValue(e.target.value)}
                        placeholder=${t('profile.agents.detail.data_access.keyValuePlaceholder')}
                        disabled=${creatingKey}></textarea>
              <div class="pf-agd-memory-actions">
                <button class="btn-primary btn-sm" disabled=${creatingKey || !newKeyName.trim()} onClick=${handleCreateKey}>
                  ${creatingKey ? t('profile.agents.detail.data_access.saving') : t('common.save')}
                </button>
                <button class="btn-outline btn-sm" disabled=${creatingKey} onClick=${() => setAddingKey(false)}>${t('common.cancel')}</button>
              </div>
            </div>
          `}
          ${memoryKeys.length === 0 && !addingKey && html`
            <div class="pf-agd-empty">${t('profile.agents.detail.data_access.noKeys')}</div>
          `}
          ${memoryKeys.map(mk => html`
            <div key=${mk.key}>
              <div class="pf-agd-area-row pf-agd-area-row--clickable" onClick=${() => toggleExpandKey(mk)}>
                <span class="pf-agd-expand-icon">${expandedKey === mk.key ? '▼' : '▶'}</span>
                <span class="pf-agd-area-key">${mk.key}</span>
                <span class="pf-agd-area-perm pf-agd-area-perm--${mk.visibility === 'public' ? 'rw' : 'ro'}">${mk.visibility}</span>
              </div>
              ${expandedKey === mk.key && html`
                <div class="pf-agd-memory-detail">
                  ${editingKey === mk.key ? html`
                    <textarea class="pf-agd-memory-edit" value=${editValue}
                              onInput=${(e) => setEditValue(e.target.value)}
                              disabled=${savingKey}></textarea>
                    <div class="pf-agd-memory-actions">
                      <button class="btn-primary btn-sm" disabled=${savingKey} onClick=${() => handleSaveKey(mk)}>
                        ${savingKey ? t('profile.agents.detail.data_access.saving') : t('common.save')}
                      </button>
                      <button class="btn-outline btn-sm" disabled=${savingKey} onClick=${cancelEditKey}>${t('common.cancel')}</button>
                    </div>
                  ` : html`
                    <pre class="pf-agd-memory-preview">${expandedValue}</pre>
                    <div class="pf-agd-memory-actions">
                      <button class="btn-ghost btn-sm" onClick=${() => startEditKey(mk)}>${t('profile.agents.detail.data_access.edit')}</button>
                      <button class="btn-ghost btn-sm pf-agd-action-danger" onClick=${() => handleDeleteKey(mk)}>${t('common.delete')}</button>
                    </div>
                  `}
                </div>
              `}
            </div>
          `)}
      </div>

      <!-- EFFECTIVE SCOPE SUMMARY -->
      <div class="pf-agd-scope-summary">
        ${t('profile.agents.detail.data_access.effectiveScope')}:\n${
          [...memoryAreas.map(a => a.key_prefix || a.key || a), ...tags.map(tag => `agents.tag.${tag}.*`), 'agents.shared.index'].join(', ')
        }${hasResources ? `\n${t('profile.agents.detail.data_access.knowledgeTitle')}: ${resources.map(r => r.name || r.url || r).join(', ')}` : ''}
        <div class="pf-agd-scope-footer">${t('profile.agents.detail.data_access.scopeFooter')}</div>
      </div>

      <${ConfirmUI} />
    </div>
  `;
}
