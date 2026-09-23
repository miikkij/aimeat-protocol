/**
 * @file tab-data-access.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Data Access tab: shared tags, memory areas, knowledge packages,
 *   and effective scope summary.
 * @version-history
 *   2026-09-22 -- Delete, Unlink and a tag's remove carry the danger tone; the tag's remove is the ✗
 *     glyph with a spoken label instead of the letter x.
 *   2026-09-22 -- Composed from the shared component set: sections with the add action on the title row
 *     and "none" as the title's count, list rows (a stored key opens in its row), fields, chips and a
 *     code surface for a value and the scope summary; the sort direction is an SVG icon action.
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
 *   v1.12.0 — 2026-08-25 — The shared data map was added here and removed again the same day: it
 *     describes an app, and this panel already has the control the owner needs.
 *   v1.11.0 -- 2026-08-24 -- Live update also follows 'agent-directives', which is where the memory
 *     areas this panel edits actually live. routes/agent-directives.ts emits it from three places and
 *     nothing subscribed, so the panel never saw its own writes.
 *   v1.10.0 -- 2026-07-17 -- Card layout: tags/areas/knowledge/skills sections pair up in
 *     the shared pf-agd-card-grid; stored keys + scope summary span full width.
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 *   v1.1.0 -- 2026-05-24 -- Add area form (F12), link package (F13), doc count (F14), tags help (F15), scope footer (F16)
 *   v1.2.0 -- 2026-05-30 -- Live-update refresh also re-fetches the currently expanded memory entry's value (was: only the key list refreshed, the open entry stayed stale until the user closed + reopened it or switched tabs). Also stop showing the full-tab "Loading..." overlay on every live-update tick -- it now only shows on initial mount.
 *   v1.3.0 -- 2026-05-31 -- Make Stored Memory Keys editable (inline textarea + Save) and deletable; make Memory Areas editable (key prefix / description / access) and deletable. Stored-key list now carries `version` for optimistic-lock PUTs. Delete confirmations use the shared useConfirm dialog.
 *   v1.4.0 -- 2026-05-31 -- Add "+ Add key" button + create form to Stored Memory Keys. New entries are created under the AGENT's GAII (createMemory passes agent.gaii), not the owner's GHII, so they belong to the agent being viewed.
 *   v1.5.0 -- 2026-05-31 -- Stored Memory Keys: show per-key created + last-updated timestamps (relative, full date on hover) and add a sort control (by updated or created, newest/oldest toggle). List now carries createdAt.
 *   v1.6.0 -- 2026-06-10 -- Empty sections compact to one row (title + "none" + Add button on the
 *     same line) — section order unchanged; a section grows when content arrives.
 *   v1.7.0 -- 2026-07-05 -- Skills section: link/unlink registry skills (SkillRefs on
 *     agents.{name}.skills via /v1/agents/:name/skills) — distinct from knowledge packages.
 *   v1.8.0 -- 2026-07-07 -- Stored Memory Keys: expanded entries whose value contains image
 *     URLs (e.g. crews.<agent>.images.* records from the image-maker crew) now render the
 *     image(s) inline as a preview above the raw value, each linking to the full-size file.
 *   v1.9.0 -- 2026-07-16 -- Mount folds 3 reads into GET /v1/agents/:name/data-access/overview
 *     (getDataAccessOverview; memory keys metadata-only); individual fan-out kept as fallback.
 */

import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
import { t } from '/js/i18n.js';
import { apiGet, apiPatch } from '/js/api.js';
import { timeAgo } from '/js/utils.js';
import { getDirectives, getDataAccessOverview, upsertDirectives } from '/js/services/agent-directives.js';
import { updateMemoryFull, deleteMemory, createMemory } from '/js/services/memory.js';
import * as skillsService from '/js/services/skills.js';
import { useConfirm } from '/components/Modal.js';
import { swallowed } from '/js/swallowed.js';
import { dateTime as fmtDateTime } from '/js/format.js';
import { Stack, Section, Columns, ListRow, Field, Chip, Action, Surface, Text } from '/components/poster-parts.js';

const html = htm.bind(h);

// Image URLs embedded in a memory value — e.g. the crews.<agent>.images.* records the
// image-maker crew writes ({ prompt, url, mime, bytes }). We render these inline so the
// operator sees the actual picture from the entry, not just the URL as text. Matches http(s)
// URLs ending in a common image extension (with an optional query string).
const IMG_URL_RE = /https?:\/\/[^\s"'<>()]+?\.(?:jpg|jpeg|png|webp|gif|svg|avif)(?:\?[^\s"'<>()]*)?/gi;
function extractImageUrls(valueText) {
  if (typeof valueText !== 'string' || valueText === '...') return [];
  const seen = new Set();
  const out = [];
  IMG_URL_RE.lastIndex = 0;
  let m;
  while ((m = IMG_URL_RE.exec(valueText)) !== null) {
    const url = m[0];
    if (!seen.has(url)) { seen.add(url); out.push(url); }
  }
  return out;
}


export default function TabDataAccess({ agent, agentName, showToast, allAgents }) {
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
  // Skills registry links (SkillRefs on agents.{name}.skills — NOT directives resources).
  const [skillLinks, setSkillLinks] = useState([]);
  const [addingSkill, setAddingSkill] = useState(false);
  const [skillLibrary, setSkillLibrary] = useState(null);   // null until the picker opens
  const [selectedSkillRef, setSelectedSkillRef] = useState('');
  const [memoryKeys, setMemoryKeys] = useState([]);
  // Stored-key sorting: field (updated|created) + direction (desc=newest first).
  const [keySortField, setKeySortField] = useState('updated');
  const [keySortDir, setKeySortDir] = useState('desc');
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
      // Mount fold: ONE composite (directives memory areas + resources + agent memory metadata + skill
      // links). On failure, fall back to the individual three-request fan-out. The composite returns
      // memory keys already in the rendered shape (metadata only — no values loaded).
      const ov = await getDataAccessOverview(agentName);
      let keys;
      if (ov) {
        setMemoryAreas(ov.directives?.memory_areas || []);
        setResources(ov.directives?.resources || []);
        setSkillLinks(ov.skill_links || []);
        keys = (ov.memory_keys || []).map(k => ({ key: k.key, visibility: k.visibility, version: k.version, createdAt: k.created_at, updatedAt: k.updated_at }));
      } else {
        const [dirResp, memResp, links] = await Promise.all([
          getDirectives(agentName).catch(err => { swallowed('tab-data-access: loadData', err); return null; }),
          apiGet(`/v1/memory?prefix=&per_page=100&agent=${encodeURIComponent(agent.gaii || agentName)}`).catch(err => { swallowed('tab-data-access: loadData', err); return null; }),
          skillsService.getAgentSkillLinks(agentName).catch(err => { swallowed('tab-data-access: loadData', err); return []; }),
        ]);
        const data = dirResp?.data || {};
        setMemoryAreas(data.memory_areas || []);
        setResources(data.resources || []);
        setSkillLinks(links);
        const items = memResp?.data?.items || memResp?.data || [];
        keys = (Array.isArray(items) ? items : [])
          .map(item => ({ key: item.key, visibility: item.visibility, version: item.version, createdAt: item.created_at ?? item.createdAt, updatedAt: item.updated_at ?? item.updatedAt }));
      }
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
    } catch (err) {
      swallowed('tab-data-access: loadData', err);
      setMemoryAreas([]);
      setResources([]);
      setMemoryKeys([]);
    }
    setTags(agent.tags ?? []);
    if (showSpinner) setLoading(false);
  }

  // loadData reads agent/agentName; the effect intentionally re-runs only when the
  // viewed agent changes (live-update refreshes go through loadRef below, not here).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadData(); }, [agentName]);

  const loadRef = useRef(loadData);
  loadRef.current = loadData;
  useEffect(() => {
    // Live-update tick: refresh in the background WITHOUT toggling the
    // full-tab "Loading..." overlay. Showing the spinner on every tick
    // (the SSE bus debounces to ~500ms but still fires often) made the
    // whole panel flash blank every time anything changed server-side.
    // 'agent-directives' is where the memory areas actually live, and routes/agent-directives.ts
    // emits it from three places. Nothing subscribed to it, so this panel never saw its own writes.
    return onLiveUpdate(['memory', 'agents', 'skills', 'agent-directives'], () => loadRef.current({ showSpinner: false }));
  }, []);

  async function openSkillPicker() {
    if (addingSkill) { setAddingSkill(false); return; }
    setAddingSkill(true);
    if (!skillLibrary) {
      try {
        const lib = await skillsService.getLibrary();
        setSkillLibrary(lib);
        const first = [...lib.user, ...lib.node].find(s => !skillLinks.some(l => l.ref === s.ref));
        setSelectedSkillRef(first?.ref ?? '');
      } catch (err) {
        swallowed('tab-data-access: openSkillPicker', err);
        setSkillLibrary({ node: [], user: [] });
      }
    }
  }

  async function handleLinkSkill() {
    if (!selectedSkillRef) return;
    try {
      const links = await skillsService.linkSkill(agentName, selectedSkillRef);
      setSkillLinks(links);
      setAddingSkill(false);
      showToast(t('profile.agents.detail.data_access.skillLinked'));
    } catch (err) {
      showToast(err.message || t('profile.agents.detail.data_access.skillLinkError'), true);
    }
  }

  async function handleUnlinkSkill(ref) {
    try {
      const links = await skillsService.unlinkSkill(agentName, ref);
      setSkillLinks(links);
      showToast(t('profile.agents.detail.data_access.skillUnlinked'));
    } catch (err) {
      showToast(err.message || t('profile.agents.detail.data_access.skillLinkError'), true);
    }
  }

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
      try { parsed = JSON.parse(editValue); } catch { parsed = editValue; }   // eslint-disable-line aimeat/no-silent-catch -- a browser API refusing here IS the answer
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
      try { parsed = JSON.parse(newKeyValue); } catch { parsed = newKeyValue; }   // eslint-disable-line aimeat/no-silent-catch -- a browser API refusing here IS the answer
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
    return html`<${Text} tone="muted">${t('profile.loading')}<//>`;
  }

  const hasTags = tags.length > 0;
  const hasAreas = memoryAreas.length > 0;
  const hasResources = resources.length > 0;
  const hasKeys = memoryKeys.length > 0;
  const none = t('profile.agents.detail.data_access.noneInline') || 'none';
  const permOptions = [
    { value: 'read+write', label: t('profile.agents.detail.data_access.permReadWrite') },
    { value: 'read', label: t('profile.agents.detail.data_access.permReadOnly') },
  ];

  // Sort the stored-key list by created/updated, newest- or oldest-first.
  // Sorting is purely a display concern; loadData order is not relied on.
  const sortedKeys = [...memoryKeys].sort((a, b) => {
    const field = keySortField === 'created' ? 'createdAt' : 'updatedAt';
    const ta = a[field] ? new Date(a[field]).getTime() : 0;
    const tb = b[field] ? new Date(b[field]).getTime() : 0;
    return keySortDir === 'asc' ? ta - tb : tb - ta;
  });

  if (!hasTags && !hasAreas && !hasResources && !hasKeys && !addingTag && !addingArea && !addingPackage && !addingKey) {
    return html`
      <${Stack}>
        <${Text} tone="muted">${t('profile.agents.detail.empty.data_access')}<//>
        <${Stack} direction="wrap" density="compact">
          <${Action} onClick=${() => setAddingTag(true)}>+ ${t('profile.agents.detail.data_access.addTag')}<//>
          <${Action} onClick=${() => setAddingArea(true)}>+ ${t('profile.agents.detail.data_access.addArea')}<//>
          <${Action} onClick=${() => setAddingPackage(true)}>+ ${t('profile.agents.detail.data_access.linkPackage')}<//>
          <${Action} onClick=${() => setAddingKey(true)}>+ ${t('profile.agents.detail.data_access.addKey')}<//>
        <//>
        <${ConfirmUI} />
      <//>
    `;
  }

  const sortDirTitle = keySortDir === 'desc' ? t('profile.agents.detail.data_access.sortNewestFirst') : t('profile.agents.detail.data_access.sortOldestFirst');

  return html`
    <${Stack}>
      <${Columns} layout="equal" collapse="900">
        <${Section} size="small" density="compact" title=${t('profile.agents.detail.data_access.sharedTagsTitle')}
          count=${tags.length === 0 && !addingTag ? none : undefined}
          actions=${html`<${Action} onClick=${() => setAddingTag(!addingTag)}>+ ${t('profile.agents.detail.data_access.addTag')}<//>`}>
          ${addingTag && html`
            <${Stack} direction="horizontal" align="end" density="compact">
              <${Field} value=${newTag} onInput=${(e) => setNewTag(e.target.value)}
                placeholder=${t('profile.agents.detail.data_access.tagPlaceholder')}
                onKeyDown=${(e) => e.key === 'Enter' && handleAddTag()} />
              <${Action} onClick=${handleAddTag}>${t('common.add')}<//>
            <//>
          `}
          ${tags.map(tag => {
            const shared = getSharedWith(tag);
            return html`
              <${ListRow} key=${tag} density="compact" name=${`[${tag}]`} detail=${`agents.tag.${tag}.*`}
                value=${html`<${Text} kind="caption" tone="muted">${shared.length > 0
                  ? `${t('profile.agents.detail.data_access.with')}: ${shared.map(a => a.name).join(', ')}`
                  : t('profile.agents.detail.data_access.onlyYou')}<//>`}
                actions=${html`<${Action} kind="text" tone="danger" label=${t('common.delete')} title=${t('common.delete')} onClick=${() => handleRemoveTag(tag)}>✗<//>`} />
            `;
          })}
          ${(tags.length > 0 || addingTag) && html`<${Text} kind="caption" tone="muted">${t('profile.agents.detail.data_access.tagsHelp')}<//>`}
        <//>

        <${Section} size="small" density="compact" title=${t('profile.agents.detail.data_access.memoryAreasTitle')}
          count=${!hasAreas && !addingArea ? none : undefined}
          actions=${html`<${Action} onClick=${() => setAddingArea(!addingArea)}>+ ${t('profile.agents.detail.data_access.addArea')}<//>`}>
          ${addingArea && html`
            <${Stack} direction="wrap" align="end" density="compact">
              <${Field} value=${newAreaKey} onInput=${(e) => setNewAreaKey(e.target.value)}
                placeholder=${t('profile.agents.detail.data_access.areaKeyPlaceholder')} />
              <${Field} value=${newAreaDesc} onInput=${(e) => setNewAreaDesc(e.target.value)}
                placeholder=${t('profile.agents.detail.data_access.areaDescPlaceholder')} />
              <${Field} type="select" value=${newAreaPerm} onChange=${(e) => setNewAreaPerm(e.target.value)} options=${permOptions} />
              <${Action} onClick=${handleAddArea}>${t('profile.agents.detail.data_access.addArea')}<//>
              <${Action} kind="text" onClick=${() => setAddingArea(false)}>${t('common.cancel')}<//>
            <//>
          `}
          ${hasAreas ? memoryAreas.map((area, idx) => (
            editingAreaIdx === idx ? html`
              <${Stack} key=${'edit-' + idx} direction="wrap" align="end" density="compact">
                <${Field} value=${editAreaKey} onInput=${(e) => setEditAreaKey(e.target.value)}
                  placeholder=${t('profile.agents.detail.data_access.areaKeyPlaceholder')} />
                <${Field} value=${editAreaDesc} onInput=${(e) => setEditAreaDesc(e.target.value)}
                  placeholder=${t('profile.agents.detail.data_access.areaDescPlaceholder')} />
                <${Field} type="select" value=${editAreaPerm} onChange=${(e) => setEditAreaPerm(e.target.value)} options=${permOptions} />
                <${Action} onClick=${() => handleSaveArea(idx)}>${t('common.save')}<//>
                <${Action} kind="text" onClick=${cancelEditArea}>${t('common.cancel')}<//>
              <//>
            ` : html`
              <${ListRow} key=${area.key_prefix || area.key || idx} density="compact"
                name=${area.key_prefix || area.key || area} detail=${area.description || ''} detailKind="text"
                value=${html`<${Chip} tone=${area.access === 'read' ? 'muted' : 'plain'}>${area.access === 'read' ? t('profile.agents.detail.data_access.permReadOnly') : t('profile.agents.detail.data_access.permReadWrite')}<//>`}
                actions=${html`
                  <${Action} kind="text" onClick=${() => startEditArea(idx, area)}>${t('profile.agents.detail.data_access.edit')}<//>
                  <${Action} kind="text" tone="danger" onClick=${() => handleRemoveArea(idx)}>${t('common.delete')}<//>`} />
            `
          )) : null}
        <//>

        <${Section} size="small" density="compact" title=${t('profile.agents.detail.data_access.knowledgeTitle')}
          count=${!hasResources && !addingPackage ? none : undefined}
          actions=${html`<${Action} onClick=${() => setAddingPackage(!addingPackage)}>+ ${t('profile.agents.detail.data_access.linkPackage')}<//>`}>
          ${addingPackage && html`
            <${Stack} direction="wrap" align="end" density="compact">
              <${Field} value=${newPkgName} onInput=${(e) => setNewPkgName(e.target.value)}
                placeholder=${t('profile.agents.detail.data_access.packageNamePlaceholder')} />
              <${Field} value=${newPkgDesc} onInput=${(e) => setNewPkgDesc(e.target.value)}
                placeholder=${t('profile.agents.detail.data_access.packageDescPlaceholder')} />
              <${Action} onClick=${handleLinkPackage}>${t('profile.agents.detail.data_access.linkPackage')}<//>
              <${Action} kind="text" onClick=${() => setAddingPackage(false)}>${t('common.cancel')}<//>
            <//>
          `}
          ${hasResources ? resources.map(res => html`
            <${ListRow} key=${res.url || res.name || res} density="compact"
              name=${res.name || res.url || res} detail=${res.description || ''} detailKind="text"
              value=${(res.documentCount || res.count) ? html`<${Chip} tone="muted">${res.documentCount || res.count} ${t('profile.agents.detail.data_access.docCount')}<//>` : null} />
          `) : null}
        <//>

        <${Section} size="small" density="compact" title=${t('profile.agents.detail.data_access.skillsTitle')}
          count=${skillLinks.length === 0 && !addingSkill ? none : undefined}
          actions=${html`<${Action} onClick=${openSkillPicker}>+ ${t('profile.agents.detail.data_access.linkSkill')}<//>`}>
          ${addingSkill && html`
            <${Stack} direction="wrap" align="end" density="compact">
              ${skillLibrary === null ? html`<${Text} tone="muted">${t('common.loading') || '...'}<//>` : html`
                <${Field} type="select" value=${selectedSkillRef} onChange=${(e) => setSelectedSkillRef(e.target.value)}
                  options=${[...(skillLibrary.user ?? []), ...(skillLibrary.node ?? []), ...(skillLibrary.workspace ?? [])]
                    .filter(s => !skillLinks.some(l => l.ref === s.ref))
                    .map(s => ({ value: s.ref, label: `${s.name} (${s.scope}) — ${s.description.slice(0, 60)}` }))} />
                <${Action} disabled=${!selectedSkillRef} onClick=${handleLinkSkill}>${t('profile.agents.detail.data_access.linkSkill')}<//>
              `}
              <${Action} kind="text" onClick=${() => setAddingSkill(false)}>${t('common.cancel')}<//>
            <//>
          `}
          ${skillLinks.map(link => html`
            <${ListRow} key=${link.ref} density="compact" name=${link.name} detail=${link.description || link.ref} detailKind="text"
              actions=${html`<${Action} kind="text" tone="danger" onClick=${() => handleUnlinkSkill(link.ref)}>${t('profile.agents.detail.data_access.unlinkSkill')}<//>`} />
          `)}
          ${skillLinks.length > 0 && html`<${Text} kind="caption" tone="muted">${t('profile.agents.detail.data_access.skillsHelp')}<//>`}
        <//>
      <//>

      <${Section} size="small" density="compact" title=${t('profile.agents.detail.data_access.storedKeysTitle')}
        count=${!hasKeys && !addingKey ? none : undefined}
        actions=${html`
          ${hasKeys && html`
            <${Field} type="select" label=${t('profile.agents.detail.data_access.sortBy')} value=${keySortField}
              onChange=${(e) => setKeySortField(e.target.value)} options=${[
                { value: 'updated', label: t('profile.agents.detail.data_access.sortUpdated') },
                { value: 'created', label: t('profile.agents.detail.data_access.sortCreated') },
              ]} />
            <${Action} kind="icon" title=${sortDirTitle} label=${sortDirTitle}
              onClick=${() => setKeySortDir(keySortDir === 'desc' ? 'asc' : 'desc')}>
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
                ${keySortDir === 'desc' ? html`<path d="M10 3v14M4 11l6 6 6-6" />` : html`<path d="M10 17V3M4 9l6-6 6 6" />`}
              </svg>
            <//>
          `}
          <${Action} onClick=${() => setAddingKey(!addingKey)}>+ ${t('profile.agents.detail.data_access.addKey')}<//>`}>
        ${addingKey && html`
          <${Stack} density="compact">
            <${Stack} direction="wrap" align="end" density="compact">
              <${Field} value=${newKeyName} onInput=${(e) => setNewKeyName(e.target.value)}
                placeholder=${t('profile.agents.detail.data_access.keyNamePlaceholder')} />
              <${Field} type="select" value=${newKeyVis} onChange=${(e) => setNewKeyVis(e.target.value)} options=${[
                { value: 'private', label: 'private' },
                { value: 'owner', label: 'owner' },
                { value: 'public', label: 'public' },
              ]} />
            <//>
            <${Field} type="textarea" value=${newKeyValue} onInput=${(e) => setNewKeyValue(e.target.value)}
              placeholder=${t('profile.agents.detail.data_access.keyValuePlaceholder')} disabled=${creatingKey} />
            <${Stack} direction="horizontal" density="compact">
              <${Action} disabled=${creatingKey || !newKeyName.trim()} onClick=${handleCreateKey}>
                ${creatingKey ? t('profile.agents.detail.data_access.saving') : t('common.save')}
              <//>
              <${Action} kind="text" disabled=${creatingKey} onClick=${() => setAddingKey(false)}>${t('common.cancel')}<//>
            <//>
          <//>
        `}
        ${sortedKeys.map(mk => html`
          <${ListRow} key=${mk.key} density="compact" name=${mk.key} onOpen=${() => toggleExpandKey(mk)}
            selected=${expandedKey === mk.key} arrow
            detail=${(mk.createdAt || mk.updatedAt) && html`
              ${mk.createdAt ? html`<span title=${fmtDateTime(mk.createdAt)}>${t('profile.agents.detail.data_access.created')}: ${timeAgo(mk.createdAt)}</span>` : ''}
              ${mk.createdAt && mk.updatedAt ? ' · ' : ''}
              ${mk.updatedAt ? html`<span title=${fmtDateTime(mk.updatedAt)}>${t('profile.agents.detail.data_access.updated')}: ${timeAgo(mk.updatedAt)}</span>` : ''}`}
            value=${html`<${Chip} tone=${mk.visibility === 'public' ? 'plain' : 'muted'}>${mk.visibility}<//>`}>
            ${expandedKey === mk.key && (editingKey === mk.key ? html`
              <${Stack} density="compact">
                <${Field} type="textarea" value=${editValue} onInput=${(e) => setEditValue(e.target.value)} disabled=${savingKey} />
                <${Stack} direction="horizontal" density="compact">
                  <${Action} disabled=${savingKey} onClick=${() => handleSaveKey(mk)}>
                    ${savingKey ? t('profile.agents.detail.data_access.saving') : t('common.save')}
                  <//>
                  <${Action} kind="text" disabled=${savingKey} onClick=${cancelEditKey}>${t('common.cancel')}<//>
                <//>
              <//>
            ` : html`
              <${Stack} density="compact">
                ${(() => {
                  const imgs = extractImageUrls(expandedValue);
                  return imgs.length ? html`
                    <${Stack} direction="wrap" density="compact">
                      ${imgs.map(u => html`
                        <a key=${u} href=${u} target="_blank" rel="noopener noreferrer"
                           title=${t('profile.agents.detail.data_access.openImageFull')}>
                          <img src=${u} loading="lazy" height="160"
                               alt=${t('profile.agents.detail.data_access.imagePreviewAlt')} />
                        </a>
                      `)}
                    <//>
                  ` : null;
                })()}
                <${Surface} kind="code">${expandedValue}<//>
                <${Stack} direction="horizontal" density="compact">
                  <${Action} kind="text" onClick=${() => startEditKey(mk)}>${t('profile.agents.detail.data_access.edit')}<//>
                  <${Action} kind="text" tone="danger" onClick=${() => handleDeleteKey(mk)}>${t('common.delete')}<//>
                <//>
              <//>
            `)}
          <//>
        `)}
      <//>

      <${Stack} density="compact">
        <${Surface} kind="code">${t('profile.agents.detail.data_access.effectiveScope')}:\n${
          [...memoryAreas.map(a => a.key_prefix || a.key || a), ...tags.map(tag => `agents.tag.${tag}.*`), 'agents.shared.index'].join(', ')
        }${hasResources ? `\n${t('profile.agents.detail.data_access.knowledgeTitle')}: ${resources.map(r => r.name || r.url || r).join(', ')}` : ''}<//>
        <${Text} kind="caption" tone="muted">${t('profile.agents.detail.data_access.scopeFooter')}<//>
      <//>

      <${ConfirmUI} />
    <//>
  `;
}
