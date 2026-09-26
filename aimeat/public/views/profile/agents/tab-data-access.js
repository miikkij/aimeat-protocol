/**
 * @file tab-data-access.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Data Access tab: shared tags, memory areas, knowledge packages,
 *   and effective scope summary.
 * @version-history
 *   v1.36.1 -- 2026-09-26 -- A stored value scrolls after 300px again, as main's
 *     .pf-agd-memory-preview did (Code scroll="medium"; fix pass).
 *   v1.36.0 -- 2026-09-26 -- Onto the components: the sections are the section Card in a CardGrid, the
 *     lists the List, the forms TextField / Select / TextArea with their actions, a stored key the
 *     FoldRow (its arrow → / ↓ where main drew ▶ / ▼, the kit's fold arrow: a unification), the value the
 *     scrolling Code block, the pictures the ImageStrip, the scope the Box. The file writes no class.
 *     Put back from main: an area's access and a key's visibility in their colours again (read and
 *     write, public: the fine status; read only, private, owner: the attention status; main's
 *     pf-agd-area-perm--rw / --ro), and a memory prefix or key in the typewriter face again.
 *   v1.35.0 -- 2026-09-26 -- A stored value is the Code block (css/components/code-block.css), a unification: Jouni's decision "Code block".
 *   v1.34.0 -- 2026-09-26 -- A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.33.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.32.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.31.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.30.0 -- 2026-09-26 -- The shared tags, memory areas, knowledge packages and skills are the Listing, a stored key the folded row (og-fold--event), a unification: the look most tabs use.
 *   v1.29.0 -- 2026-09-26 -- A crew member's and a task's place (agents[0], tasks[0]), a tool's id and a tag's memory prefix are the inline code (.code-inline), a unification: the look most tabs use for an identifier.
 *   v1.28.0 -- 2026-09-25 -- The pictures a stored value points at are the image thumbnails (css/components/image-deliverable.css), a unification: the look most tabs use.
 *   v1.27.0 -- 2026-09-25 -- Every row label is the Row label (.poster-label), a unification: Jouni's decision Row label.
 *   v1.26.0 -- 2026-09-25 -- Every mark button is the icon button (.poster-icon, its small cut), a unification: Jouni's decision Icon button.
 *   v1.25.0 -- 2026-09-25 -- Every small number is the Count (.poster-count tally, waiting at the limit), a unification: Jouni's decision Count.
 *   v1.24.0 -- 2026-09-25 -- Every time a thing happened or runs out is the Timestamp (.poster-time); a place keeps only its layout (a unification: Jouni's decision Timestamp).
 *   v1.23.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip), a unification: Jouni's decision Tag.
 *   v1.22.0 -- 2026-09-25 -- A line that says there is nothing (none, and the more under the running tasks) is the quiet sentence (.poster-quiet); a place keeps only its margin (a unification: Jouni's decision Empty line).
 *   v1.21.0 -- 2026-09-25 -- A grey line that explains is the Hint (poster-hint, css/components/hint.css); a place keeps only its margin (a unification: the look most tabs use).
 *   v1.20.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.19.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.18.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.17.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.16.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.15.0 — 2026-09-25 — A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.14.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.13.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
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
import { Card, CardGrid } from '/components/Card.js';
import { Box } from '/components/Box.js';
import { List, Row, Name, Desc, Cell, Doors, Panel } from '/components/List.js';
import { Folds, FoldRow } from '/components/Folds.js';
import { Action, Actions, Loud, Icon } from '/components/Action.js';
import { Mark, Label, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Fields, FormActions } from '/components/Field.js';
import { Row as Line, Space } from '/components/Layout.js';
import { ImageStrip } from '/components/ImageDeliverable.js';

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
    return html`<${Note} kind="loading">${t('profile.loading')}<//>`;
  }

  const hasTags = tags.length > 0;
  const hasAreas = memoryAreas.length > 0;
  const hasResources = resources.length > 0;
  const hasKeys = memoryKeys.length > 0;

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
      <div>
        <${Note} kind="quiet">${t('profile.agents.detail.empty.data_access')}<//>
        <${Actions}>
          <${Action} small onClick=${() => setAddingTag(true)}>+ ${t('profile.agents.detail.data_access.addTag')}<//>
          <${Action} small onClick=${() => setAddingArea(true)}>+ ${t('profile.agents.detail.data_access.addArea')}<//>
          <${Action} small onClick=${() => setAddingPackage(true)}>+ ${t('profile.agents.detail.data_access.linkPackage')}<//>
          <${Action} small onClick=${() => setAddingKey(true)}>+ ${t('profile.agents.detail.data_access.addKey')}<//>
        <//>
        <${ConfirmUI} />
      </div>
    `;
  }

  // "none" beside a section's name while it holds nothing (main v1.6.0: an empty section is one line).
  const none = (empty) => (empty ? html`<${Note} kind="quiet" inline>${t('profile.agents.detail.data_access.noneInline') || 'none'}<//>` : null);
  // The head of a section: "none" while empty, then its way to add.
  const headDoors = (empty, door) => html`<${Line} gap="medium" wrap>${none(empty)}${door}<//>`;
  // Read and write (and a public key) in the fine colour, read only (a private or owner key) in the
  // attention colour: main's pf-agd-area-perm--rw / --ro.
  const accessTone = (writable) => (writable ? 'fine' : 'attention');
  const permOptions = [
    ['read+write', t('profile.agents.detail.data_access.permReadWrite')],
    ['read', t('profile.agents.detail.data_access.permReadOnly')],
  ];
  // One memory area's form (add, or edit in place): the prefix, then its words, access and doors in one row.
  const areaForm = ({ key, setKey, desc, setDesc, perm, setPerm, onSave, saveLabel, onCancel }) => html`
    <${TextField} value=${key} onInput=${setKey} placeholder=${t('profile.agents.detail.data_access.areaKeyPlaceholder')}
      actions=${html`
        <${TextField} value=${desc} onInput=${setDesc} placeholder=${t('profile.agents.detail.data_access.areaDescPlaceholder')} />
        <${Select} fit value=${perm} onChange=${setPerm} options=${permOptions} />
        <${Loud} control onClick=${onSave}>${saveLabel}<//>
        <${Action} small onClick=${onCancel}>${t('common.cancel')}<//>`} />`;

  return html`
    <div>
    <${CardGrid} cols="sections">
      <!-- SHARED TAGS -->
      <${Card} tone="section" title=${t('profile.agents.detail.data_access.sharedTagsTitle')}
        aside=${headDoors(tags.length === 0 && !addingTag,
          html`<${Action} small onClick=${() => setAddingTag(!addingTag)}>+ ${t('profile.agents.detail.data_access.addTag')}<//>`)}>
        ${addingTag && html`<${Space} below="small">
          <${TextField} value=${newTag} onInput=${setNewTag} onEnter=${handleAddTag}
            placeholder=${t('profile.agents.detail.data_access.tagPlaceholder')}
            actions=${html`<${Loud} control onClick=${handleAddTag}>${t('common.add')}<//>`} />
        <//>`}
        ${tags.length > 0 && html`<${List} cols="name-desc-doors" keepCols>${tags.map(tag => {
          const shared = getSharedWith(tag);
          return html`
            <${Row} key=${tag}>
              <${Name}><${Mark}>[${tag}]<//><//>
              <${Desc}><${Code}>agents.tag.${tag}.*<//> ${shared.length > 0
                  ? `${t('profile.agents.detail.data_access.with')}: ${shared.map(a => a.name).join(', ')}`
                  : t('profile.agents.detail.data_access.onlyYou')}
              <//>
              <${Doors}><${Icon} small onClick=${() => handleRemoveTag(tag)}>x<//><//>
            <//>
          `;
        })}<//>`}
        ${(tags.length > 0 || addingTag) && html`<${Note}>${t('profile.agents.detail.data_access.tagsHelp')}<//>`}
      <//>


      <!-- MEMORY AREAS -->
      <${Card} tone="section" title=${t('profile.agents.detail.data_access.memoryAreasTitle')}
        aside=${headDoors(!hasAreas && !addingArea,
          html`<${Action} small onClick=${() => setAddingArea(!addingArea)}>+ ${t('profile.agents.detail.data_access.addArea')}<//>`)}>
        ${addingArea && html`<${Space} below="small">${areaForm({
          key: newAreaKey, setKey: setNewAreaKey, desc: newAreaDesc, setDesc: setNewAreaDesc,
          perm: newAreaPerm, setPerm: setNewAreaPerm, onSave: handleAddArea,
          saveLabel: t('profile.agents.detail.data_access.addArea'), onCancel: () => setAddingArea(false),
        })}<//>`}
        ${hasAreas ? html`<${List} cols="name-desc-state-doors" keepCols>${memoryAreas.map((area, idx) => (
          editingAreaIdx === idx ? html`
            <${Row} key=${'edit-' + idx} open><${Panel}>${areaForm({
              key: editAreaKey, setKey: setEditAreaKey, desc: editAreaDesc, setDesc: setEditAreaDesc,
              perm: editAreaPerm, setPerm: setEditAreaPerm, onSave: () => handleSaveArea(idx),
              saveLabel: t('common.save'), onCancel: cancelEditArea,
            })}<//><//>
          ` : html`
            <${Row} key=${area.key_prefix || area.key || idx}>
              <${Name} asKey>${area.key_prefix || area.key || area}<//>
              <${Desc}>${area.description || ''}<//>
              <${Cell}><${Mark} kind="status" tone=${accessTone(area.access !== 'read')}>
                ${area.access === 'read' ? t('profile.agents.detail.data_access.permReadOnly') : t('profile.agents.detail.data_access.permReadWrite')}
              <//><//>
              <${Doors}>
                <${Action} small row onClick=${() => startEditArea(idx, area)}>${t('profile.agents.detail.data_access.edit')}<//>
                <${Action} small row tone="danger" onClick=${() => handleRemoveArea(idx)}>${t('common.delete')}<//>
              <//>
            <//>
          `
        ))}<//>` : null}
      <//>

      <!-- KNOWLEDGE PACKAGES -->
      <${Card} tone="section" title=${t('profile.agents.detail.data_access.knowledgeTitle')}
        aside=${headDoors(!hasResources && !addingPackage,
          html`<${Action} small onClick=${() => setAddingPackage(!addingPackage)}>+ ${t('profile.agents.detail.data_access.linkPackage')}<//>`)}>
        ${addingPackage && html`<${Space} below="small">
          <${TextField} value=${newPkgName} onInput=${setNewPkgName} placeholder=${t('profile.agents.detail.data_access.packageNamePlaceholder')}
            actions=${html`
              <${TextField} value=${newPkgDesc} onInput=${setNewPkgDesc} placeholder=${t('profile.agents.detail.data_access.packageDescPlaceholder')} />
              <${Loud} control onClick=${handleLinkPackage}>${t('profile.agents.detail.data_access.linkPackage')}<//>
              <${Action} small onClick=${() => setAddingPackage(false)}>${t('common.cancel')}<//>`} />
        <//>`}
        ${hasResources ? html`<${List} cols="name-desc-doors" keepCols>${resources.map(res => html`
          <${Row} key=${res.url || res.name || res}>
            <${Name}>${res.name || res.url || res}<//>
            <${Desc}>${res.description || ''}<//>
            <${Doors}>${(res.documentCount || res.count) ? html`<${Mark} kind="count" tone="tally">${res.documentCount || res.count} ${t('profile.agents.detail.data_access.docCount')}<//>` : ''}<//>
          <//>
        `)}<//>` : null}
      <//>

      <!-- SKILLS (registry refs — distinct from knowledge packages) -->
      <${Card} tone="section" title=${t('profile.agents.detail.data_access.skillsTitle')}
        aside=${headDoors(skillLinks.length === 0 && !addingSkill,
          html`<${Action} small onClick=${openSkillPicker}>+ ${t('profile.agents.detail.data_access.linkSkill')}<//>`)}>
        ${addingSkill && html`<${Space} below="small"><${Line} wrap>
          ${skillLibrary === null ? html`<${Note} kind="loading" inline>${t('common.loading') || '...'}<//>` : html`
            <${Select} fit value=${selectedSkillRef} onChange=${setSelectedSkillRef}
              options=${[...(skillLibrary.user ?? []), ...(skillLibrary.node ?? []), ...(skillLibrary.workspace ?? [])]
                .filter(s => !skillLinks.some(l => l.ref === s.ref))
                .map(s => [s.ref, `${s.name} (${s.scope}) — ${s.description.slice(0, 60)}`])} />
            <${Loud} control disabled=${!selectedSkillRef} onClick=${handleLinkSkill}>${t('profile.agents.detail.data_access.linkSkill')}<//>
          `}
          <${Action} small onClick=${() => setAddingSkill(false)}>${t('common.cancel')}<//>
        <//><//>`}
        ${skillLinks.length > 0 && html`<${List} cols="name-desc-doors" keepCols>${skillLinks.map(link => html`
          <${Row} key=${link.ref}>
            <${Name}>${link.name}<//>
            <${Desc}>${link.description || link.ref}<//>
            <${Doors}>
              <${Action} small row tone="danger" onClick=${() => handleUnlinkSkill(link.ref)}>${t('profile.agents.detail.data_access.unlinkSkill')}<//>
            <//>
          <//>
        `)}<//>`}
        ${skillLinks.length > 0 && html`<${Note}>${t('profile.agents.detail.data_access.skillsHelp')}<//>`}
      <//>

      <!-- STORED MEMORY KEYS -->
      <${Card} tone="section" wide title=${t('profile.agents.detail.data_access.storedKeysTitle')}
        aside=${headDoors(!hasKeys && !addingKey, html`
          ${hasKeys && html`
            <${Label}>${t('profile.agents.detail.data_access.sortBy')}<//>
            <${Select} fit ariaLabel=${t('profile.agents.detail.data_access.sortBy')} value=${keySortField} onChange=${setKeySortField}
              options=${[['updated', t('profile.agents.detail.data_access.sortUpdated')], ['created', t('profile.agents.detail.data_access.sortCreated')]]} />
            <${Icon} small label=${keySortDir === 'desc' ? t('profile.agents.detail.data_access.sortNewestFirst') : t('profile.agents.detail.data_access.sortOldestFirst')}
                    onClick=${() => setKeySortDir(keySortDir === 'desc' ? 'asc' : 'desc')}>
              ${keySortDir === 'desc' ? '↓' : '↑'}
            <//>
          `}
          <${Action} small onClick=${() => setAddingKey(!addingKey)}>+ ${t('profile.agents.detail.data_access.addKey')}<//>`)}>
          ${addingKey && html`<${Space} below="small"><${Fields}>
            <${TextField} value=${newKeyName} onInput=${setNewKeyName}
              placeholder=${t('profile.agents.detail.data_access.keyNamePlaceholder')} />
            <${Select} value=${newKeyVis} onChange=${setNewKeyVis} options=${['private', 'owner', 'public']} />
            <${TextArea} rows=${5} value=${newKeyValue} onInput=${setNewKeyValue}
              placeholder=${t('profile.agents.detail.data_access.keyValuePlaceholder')}
              disabled=${creatingKey} />
            <${FormActions}>
              <${Loud} control disabled=${creatingKey || !newKeyName.trim()} onClick=${handleCreateKey}>
                ${creatingKey ? t('profile.agents.detail.data_access.saving') : t('common.save')}
              <//>
              <${Action} small disabled=${creatingKey} onClick=${() => setAddingKey(false)}>${t('common.cancel')}<//>
            <//>
          <//><//>`}
          <${Folds}>${sortedKeys.map(mk => html`
            <${FoldRow} key=${mk.key} name=${mk.key} isKey open=${expandedKey === mk.key} onClick=${() => toggleExpandKey(mk)}
              right=${html`${mk.createdAt ? html`<${Mark} kind="time" title=${fmtDateTime(mk.createdAt)}>${t('profile.agents.detail.data_access.created')}: ${timeAgo(mk.createdAt)}<//> ` : ''}${
                mk.updatedAt ? html`<${Mark} kind="time" title=${fmtDateTime(mk.updatedAt)}>${t('profile.agents.detail.data_access.updated')}: ${timeAgo(mk.updatedAt)}<//> ` : ''}${
                html`<${Mark} kind="status" tone=${accessTone(mk.visibility === 'public')}>${mk.visibility}<//>`}`}
              body=${expandedKey === mk.key ? html`
                <${Space} above="tight" below="small">
                  ${editingKey === mk.key ? html`
                    <${TextArea} rows=${5} value=${editValue} onInput=${setEditValue} disabled=${savingKey} />
                    <${FormActions}>
                      <${Loud} control disabled=${savingKey} onClick=${() => handleSaveKey(mk)}>
                        ${savingKey ? t('profile.agents.detail.data_access.saving') : t('common.save')}
                      <//>
                      <${Action} small disabled=${savingKey} onClick=${cancelEditKey}>${t('common.cancel')}<//>
                    <//>
                  ` : html`
                    <${ImageStrip} images=${extractImageUrls(expandedValue).map(u => ({
                      url: u,
                      alt: t('profile.agents.detail.data_access.imagePreviewAlt'),
                      title: t('profile.agents.detail.data_access.openImageFull'),
                    }))} />
                    <${Code} block scroll="medium">${expandedValue}<//>
                    <${FormActions}>
                      <${Action} small onClick=${() => startEditKey(mk)}>${t('profile.agents.detail.data_access.edit')}<//>
                      <${Action} small tone="danger" onClick=${() => handleDeleteKey(mk)}>${t('common.delete')}<//>
                    <//>
                  `}
                <//>
              ` : null} />
          `)}<//>
      <//>
    <//>

      <!-- EFFECTIVE SCOPE SUMMARY -->
      <${Box}>
        <${Code} block>${`${t('profile.agents.detail.data_access.effectiveScope')}:\n${
          [...memoryAreas.map(a => a.key_prefix || a.key || a), ...tags.map(tag => `agents.tag.${tag}.*`), 'agents.shared.index'].join(', ')
        }${hasResources ? `\n${t('profile.agents.detail.data_access.knowledgeTitle')}: ${resources.map(r => r.name || r.url || r).join(', ')}` : ''}`}<//>
        <${Note}>${t('profile.agents.detail.data_access.scopeFooter')}<//>
      <//>

      <${ConfirmUI} />
    </div>
  `;
}
