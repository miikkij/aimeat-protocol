/**
 * @file memory-tab.js
 * @description Profile tab for memory entries and file management — CRUD, search,
 *   visibility cycling, tag editing, sharing rules, and file upload with drag-and-drop.
 * @version-history
 *   v1.0.0 — 2026-03-17 — Refactor: replace inline styles with CSS utility classes
 *   v1.1.0 — 2026-03-18 — Fix: use AuthImage for thumbnails and authenticated download to avoid 401
 *   v1.2.0 — 2026-05-22 — Add Browse Home / Browse Remote panels for federation memory sync
 *   v1.3.0 — 2026-05-22 — Add timestamps, sort controls, fix group picker rotation bug
 *   v1.4.0 — 2026-06-02 — Component unification (#2): edit modal uses the canonical
 *     <Modal> component (Escape/backdrop close + header ✕).
 *   v1.5.0 — 2026-06-02 — Component unification (#1): "Copy URLs" button uses canonical
 *     <CopyButton> (toast preserved via onCopied).
 *   v2.0.0 — 2026-06-10 — Structural rework: (1) keys render as COLLAPSIBLE GROUPS by first
 *     segment (organism.<uuid> groups resolve the uuid to the organism's name; remainders
 *     shortened with '›' + middle-ellipsis, full key in title + expanded detail); (2) the
 *     per-row click-to-cycle visibility pill is GONE — list shows a static VisibilityPill,
 *     editing happens in the edit modal (entries) / an explicit select (files), and the
 *     "Skip → public" fallback was removed; (3) top-level tabs Mine · Public · Remote nodes
 *     replace the inline browse panels; (4) search is type-to-filter (client-side over
 *     key/tags/value); (5) tag cloud capped at top-10-by-use with "show all"; (6) shield
 *     icon only on rows that actually have sharing rules; rules popover shows localized
 *     visibility from the record's REAL owner (backend fix in permissions.ts); (7) edit
 *     modal: tall JSON editor + parse validation (invalid JSON can't save; valid JSON is
 *     stored parsed, not as a string); (8) "no sharing groups" dead end now offers a
 *     "Create a group →" jump to the Access tab; Delete separated to the row's far right;
 *     discover/pull copy buttons neutralized.
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Spinner, recipientBadge, VisibilityPill } from './shared.js';
import * as memoryService from '/js/services/memory.js';
import AuthImage from '/js/components/auth-image.js';
import { listAgents } from '/js/services/agents.js';
import { listPeers } from '/js/services/federation.js';
import { getKeyPermissions, listConsents, grantConsent, revokeConsent } from '/js/services/consent.js';
import { getNodeUrl } from '/js/services/auth.js';
import { listGroups } from '/js/services/sharing-groups.js';
import { listOrganisms } from '/js/services/organisms.js';
import TagCloud from '/js/components/tag-cloud.js';
import TagEditor from '/js/components/tag-editor.js';
import { Modal, useConfirm } from '/components/Modal.js';
import { CopyButton } from '/components/CopyButton.js';

export default function MemoryTab({ session, showToast, onStats }) {
  const { confirm, ConfirmUI } = useConfirm();
  const NODE_URL = getNodeUrl();
  const [memories, setMemories] = useState(null);
  const [files, setFiles] = useState(null);
  const [memSubTab, setMemSubTab] = useState('entries');
  const [showMemForm, setShowMemForm] = useState(false);
  const [showFileForm, setShowFileForm] = useState(false);
  const [expandedMem, setExpandedMem] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [keyRulesPopover, setKeyRulesPopover] = useState(null);
  const [memTagFilter, setMemTagFilter] = useState(new Set());
  const [editingMemTags, setEditingMemTags] = useState(null);
  const [editingFileTags, setEditingFileTags] = useState(null);
  const [agents, setAgents] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [fedConsents, setFedConsents] = useState({});   // { memoryKey: consentId }
  const [allConsents, setAllConsents] = useState([]);   // every active consent — drives the per-row shield
  const [togglingFed, setTogglingFed] = useState(null);
  const [groups, setGroups] = useState([]);
  // Top-level view: own list / public discovery / remote nodes (home node when federated).
  const [mainTab, setMainTab] = useState('own'); // 'own' | 'discover' | 'remote'
  const [browseMode, setBrowseMode] = useState(null); // 'home' | 'remote' | 'discover' | null
  const [filterText, setFilterText] = useState('');
  const [orgNames, setOrgNames] = useState({});         // organism uuid → display name
  const [collapsedGroups, setCollapsedGroups] = useState(() => {
    try { return new Set(JSON.parse(sessionStorage.getItem('aimeat.mem.groups.collapsed') || '[]')); } catch { return new Set(); }
  });
  const [remoteEntries, setRemoteEntries] = useState(null);
  const [remotePeers, setRemotePeers] = useState([]);
  const [selectedPeer, setSelectedPeer] = useState('');
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState(null);
  const [pullingKeys, setPullingKeys] = useState(new Set());
  const [sortBy, setSortBy] = useState('updated');
  const [discoverEntries, setDiscoverEntries] = useState(null);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState(null);
  const [discoverSearch, setDiscoverSearch] = useState('');
  const [copyingKeys, setCopyingKeys] = useState(new Set());
  const [expandedDiscover, setExpandedDiscover] = useState(null);

  useEffect(() => {
    if (session) { loadAgents(); loadMemories(); loadFiles(); loadFedConsents(); loadGroups(); loadOrgNames(); }
  }, [session]);

  // Resolve organism UUIDs to display names for the grouped key list — nobody
  // recognizes e97781a5… but everyone recognizes "Ultima-V Remake".
  async function loadOrgNames() {
    try {
      const resp = await listOrganisms({ member: session.owner });
      const map = {};
      for (const o of (resp?.data?.organisms || [])) map[o.id] = o.name;
      setOrgNames(map);
    } catch { /* names are a nicety — ids still render */ }
  }

  function toggleGroupCollapsed(id) {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { sessionStorage.setItem('aimeat.mem.groups.collapsed', JSON.stringify([...next])); } catch { /* noop */ }
      return next;
    });
  }

  useEffect(() => {
    if (session) { loadMemories(); }
  }, [selectedAgent]);

  async function loadFedConsents() {
    try {
      const consents = await listConsents();
      const map = {};
      for (const c of consents) {
        if (c.scope === 'federation') {
          const pat = c.data_pattern || c.pattern || '';
          // Direct key match (no wildcard) or exact pattern
          if (pat && !pat.includes('*')) {
            map[pat] = c.id || c.consent_id;
          }
        }
      }
      setFedConsents(map);
      setAllConsents(consents.filter(c => !c.status || c.status === 'active'));
    } catch { /* ignore */ }
  }

  // Does any active consent pattern cover this key? Drives the per-row shield:
  // shown only when rules exist, so its presence carries information.
  function keyHasRules(key) {
    return allConsents.some(c => {
      const pat = c.data_pattern || c.pattern || '';
      if (!pat) return false;
      if (pat === '*' || pat === key) return true;
      if (pat.endsWith('*')) return key.startsWith(pat.slice(0, -1));
      return false;
    });
  }

  async function handleShareToFederation(key) {
    setTogglingFed(key);
    try {
      await grantConsent({
        data_pattern: key,
        recipient: '*',
        scope: 'federation',
        purpose: 'federation_sharing',
      });
      showToast(t('profile.memory.shareSuccess'));
      await loadFedConsents();
    } catch (e) {
      showToast(e.message || t('profile.error'), true);
    } finally { setTogglingFed(null); }
  }

  async function handleStopSharing(key) {
    const consentId = fedConsents[key];
    if (!consentId) return;
    setTogglingFed(key);
    try {
      await revokeConsent(consentId);
      showToast(t('profile.memory.unshareSuccess'));
      await loadFedConsents();
    } catch (e) {
      showToast(e.message || t('profile.error'), true);
    } finally { setTogglingFed(null); }
  }

  // Live update listener — refresh both memories and files
  const liveRef = useRef(() => { loadMemories(); loadFiles(); loadFedConsents(); });
  liveRef.current = () => { loadMemories(); loadFiles(); loadFedConsents(); };
  useEffect(() => {
    const handler = () => liveRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  async function loadAgents() {
    try {
      const list = await listAgents();
      setAgents(Array.isArray(list) ? list : []);
    } catch { setAgents([]); }
  }

  async function loadGroups() {
    try {
      const resp = await listGroups();
      if (resp?.data?.groups) setGroups(resp.data.groups);
      else if (Array.isArray(resp?.data)) setGroups(resp.data);
    } catch { /* ignore */ }
  }

  async function loadMemories() {
    try {
      const agentGaii = selectedAgent || undefined;
      const list = await memoryService.listMemories(agentGaii);
      setMemories(Array.isArray(list) ? list : []);
      onStats?.({ memory: Array.isArray(list) ? list.length : 0 });
    } catch { setMemories([]); }
  }

  async function loadFiles() {
    try {
      const list = await memoryService.listFiles();
      setFiles(Array.isArray(list) ? list : []);
      onStats?.({ files: Array.isArray(list) ? list.length : 0 });
    } catch { setFiles([]); }
  }

  async function handleCreateMemory(key, value, visibility, tags, groupId) {
    try {
      await memoryService.createMemory(key, value, visibility, tags, groupId);
      showToast(t('profile.memory.saved'));
      setShowMemForm(false);
      await loadMemories();
    } catch (e) {
      showToast(e.message || t('profile.memory.saveFailed'), true);
    }
  }

  async function handleDeleteMemory(key) {
    confirm(t('profile.memory.deleteConfirm') + ': ' + key + '?', async () => {
      const resp = await memoryService.deleteMemory(key);
      if (resp.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
      showToast(t('profile.memory.deleted'));
      setExpandedMem(null);
      loadMemories();
    }, { danger: true });
  }

  async function handleSaveEdit(key, value, visibility, version, groupId) {
    // The editor works on text; a value that parses as JSON is stored as the parsed
    // object (not a string of JSON) so readers get back what the writer stored.
    let v = value;
    const s = String(value || '').trim();
    if (/^[[{]/.test(s)) { try { v = JSON.parse(s); } catch { /* modal validates; keep raw as fallback */ } }
    const body = { value: v, visibility, version };
    if (visibility === 'group' && groupId) body.group_id = groupId;
    const resp = await memoryService.updateMemoryFull(key, body);
    if (resp.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
    showToast(t('profile.memory.updated'));
    setEditModal(null);
    loadMemories();
  }

  async function handleUploadFiles(fileItems, visibility, tags) {
    if (!fileItems || fileItems.length === 0) return;
    let ok = 0, fail = 0;
    for (const item of fileItems) {
      try {
        const base64 = await readFileAsBase64(item.file);
        await memoryService.uploadFile(item.key, base64, item.file.type || 'application/octet-stream', visibility, tags);
        ok++;
      } catch { fail++; }
    }
    if (ok > 0) showToast(ok === 1 ? t('profile.files.uploaded') : `${ok} ${t('profile.files.filesUploaded')}`);
    if (fail > 0) showToast(`${fail} ${t('profile.files.uploadFailed')}`, true);
    if (ok > 0) { setShowFileForm(false); loadFiles(); }
  }

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleDownloadFile(key) {
    try {
      const headers = {};
      if (window.AIMEAT?.auth?.hasSession) {
        const session = window.AIMEAT.auth.getSession();
        if (session?.jwt) headers['Authorization'] = 'Bearer ' + session.jwt;
      }
      const resp = await fetch(`${NODE_URL}/v1/memory/files/${encodeURIComponent(key)}`, { headers });
      if (!resp.ok) throw new Error(resp.status);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = key;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      showToast(e.message || t('profile.error'), true);
    }
  }

  async function handleDeleteFile(key) {
    confirm(t('profile.files.deleteConfirm'), async () => {
      const resp = await memoryService.deleteFile(key);
      if (resp.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
      showToast(t('profile.files.deleted'));
      loadFiles();
    }, { danger: true });
  }

  async function loadKeyPerms(key) {
    try {
      const result = await getKeyPermissions(key);
      setKeyRulesPopover({ key, rules: result.rules, visibility: result.visibility });
    } catch { setKeyRulesPopover(null); }
  }

  /* Visibility is edited inside the edit modal (entries) or via an explicit select
     (files) — the old per-row click-to-cycle pill meant one stray click in the list
     could publish a memory. The list shows a static badge only. */
  const VIS_OPTIONS = ['private', 'owner', 'group', 'public'];

  async function handleUpdateMemoryTags(key, tags, version) {
    const resp = await memoryService.updateMemoryTags(key, tags, version);
    if (resp.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
    loadMemories();
  }

  async function handleUpdateFileTags(key, tags) {
    const resp = await memoryService.updateFileTags(key, tags);
    if (resp.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
    loadFiles();
  }

  async function handleUpdateFileVisibility(key, newVis) {
    // Optimistic update
    setFiles(prev => prev?.map(f => (f.key || f.name) === key ? { ...f, visibility: newVis } : f));
    const resp = await memoryService.updateFileVisibility(key, newVis);
    if (resp.ok === false) {
      showToast(resp.error?.message || t('profile.error'), true);
      loadFiles(); // Revert on error
    }
  }

  function formatRelativeTime(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    const now = Date.now();
    const diff = now - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('profile.memory.timeJustNow');
    if (mins < 60) return t('profile.memory.timeMinsAgo').replace('{n}', mins);
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t('profile.memory.timeHoursAgo').replace('{n}', hrs);
    const days = Math.floor(hrs / 24);
    if (days < 30) return t('profile.memory.timeDaysAgo').replace('{n}', days);
    return d.toLocaleDateString();
  }

  function sortEntries(entries) {
    const sorted = [...entries];
    switch (sortBy) {
      case 'updated':
        return sorted.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
      case 'created':
        return sorted.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      case 'alpha':
        return sorted.sort((a, b) => a.key.localeCompare(b.key));
      default:
        return sorted;
    }
  }

  /* ── Key grouping helpers: keys are already hierarchical (agents.*, organism.<uuid>.*,
     notif.*) — render collapsible groups instead of a flat list of near-identical rows. */
  const shortTok = (tok) => (tok.length >= 18 ? tok.slice(0, 4) + '…' + tok.slice(-5) : tok);

  function groupOfKey(key) {
    if (key.startsWith('organism.')) {
      const uuid = key.split('.')[1] || '';
      return { id: 'organism.' + uuid, kind: 'organism', uuid };
    }
    const dot = key.indexOf('.');
    if (dot < 0) return { id: '_other', kind: 'other' };
    return { id: key.slice(0, dot), kind: 'plain' };
  }

  function groupLabel(g) {
    if (g.kind === 'organism') return 'organism: ' + (orgNames[g.uuid] || shortTok(g.uuid));
    if (g.kind === 'other') return t('profile.memory.groupOther');
    return g.id;
  }

  // Shortened remainder inside a group: strip the group prefix, drop the 'w.' workspace
  // marker, middle-ellipsize uuid-ish tokens, split the leading container with '›'.
  // The full key stays in the row's title attribute (and in the expanded detail).
  function displayRemainder(key, g) {
    let rest = g.kind === 'organism' ? key.slice(('organism.' + g.uuid + '.').length)
      : g.kind === 'plain' ? key.slice(g.id.length + 1)
      : key;
    if (rest.startsWith('w.')) rest = rest.slice(2);
    const toks = rest.split('.').map(shortTok);
    if (toks.length > 1 && toks[0].startsWith('ws-')) return toks[0] + ' › ' + toks.slice(1).join('.');
    if (toks.length > 1 && toks[toks.length - 1].includes('…')) return toks.slice(0, -1).join('.') + ' › ' + toks[toks.length - 1];
    return toks.join('.');
  }

  const renderEntries = () => {
    if (!memories) return html`<${Spinner} text=${t('profile.memory.loading')} />`;

    // Tag counts across memories — the cloud shows the most-used first, capped at 10.
    const tagCounts = new Map();
    for (const m of memories) {
      if (m.tags) for (const tag of m.tags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
    const tagsByFreq = [...tagCounts.keys()].sort((a, b) => (tagCounts.get(b) - tagCounts.get(a)) || a.localeCompare(b));

    // Filter: selected tags AND the live type-to-filter text (key, tags, value).
    const ft = filterText.trim().toLowerCase();
    const filtered = sortEntries(memories.filter(m => {
      if (memTagFilter.size > 0 && !(m.tags && [...memTagFilter].every(tag => m.tags.includes(tag)))) return false;
      if (!ft) return true;
      if (m.key.toLowerCase().includes(ft)) return true;
      if (m.tags && m.tags.some(tag => tag.toLowerCase().includes(ft))) return true;
      try { return JSON.stringify(m.value).toLowerCase().includes(ft); } catch { return false; }
    }));

    const toggleMemTag = (tag) => {
      setMemTagFilter(prev => {
        const next = new Set(prev);
        if (next.has(tag)) next.delete(tag); else next.add(tag);
        return next;
      });
    };

    // Group in sorted order (group order = first appearance, so sort semantics hold).
    const groupsOrdered = [];
    const byId = new Map();
    for (const m of filtered) {
      const g = groupOfKey(m.key);
      let entry = byId.get(g.id);
      if (!entry) { entry = { ...g, items: [] }; byId.set(g.id, entry); groupsOrdered.push(entry); }
      entry.items.push(m);
    }
    // An active filter force-expands all groups — a hit hidden in a collapsed group reads as "no hit".
    const filtering = !!ft || memTagFilter.size > 0;

    const renderRow = (m, g) => html`
      <div key=${m.key}>
        <div class="mem-item mem-item--grouped" onClick=${() => setExpandedMem(expandedMem === m.key ? null : m.key)}>
          <span class="mem-key" title=${m.key}>${escHtml(displayRemainder(m.key, g))}</span>
          <span class="mem-time" title="${m.created_at ? new Date(m.created_at).toLocaleString() : ''} / ${m.updated_at ? new Date(m.updated_at).toLocaleString() : ''}">
            ${formatRelativeTime(m.updated_at || m.created_at)}
          </span>
          <${VisibilityPill} visibility=${m.visibility || 'private'} />
          ${keyHasRules(m.key) && html`<span class="shield-icon" title=${t('permissions.sharingRules')} onClick=${(e) => { e.stopPropagation(); loadKeyPerms(m.key); }}>\u{1F6E1}️</span>`}
          ${fedConsents[m.key] && html`<span class="badge badge-success pf-fed-badge">${t('profile.memory.syncedToFederation')}</span>`}
        </div>
        ${expandedMem === m.key && html`
          <div class="mem-detail">
            <div class="mem-detail-key" title=${m.key}>${escHtml(m.key)}</div>
            <pre>${typeof m.value === 'object' ? JSON.stringify(m.value, null, 2) : String(m.value || '')}</pre>
            <div class="mb-half">
              <button class="btn-outline btn-sm" onClick=${(e) => { e.stopPropagation(); setEditingMemTags(editingMemTags === m.key ? null : m.key); }}>
                ${t('tags.editTags') || 'Edit tags'}
              </button>
              <button class="btn-outline btn-sm" onClick=${(e) => { e.stopPropagation(); if (keyRulesPopover?.key === m.key) setKeyRulesPopover(null); else loadKeyPerms(m.key); }}>
                \u{1F6E1}️ ${t('permissions.sharingRules')}
              </button>
            </div>
            ${editingMemTags === m.key && html`
              <div class="mb-half">
                <${TagEditor} tags=${m.tags || []} onSave=${(tags) => handleUpdateMemoryTags(m.key, tags, m.version)} />
              </div>
            `}
            ${editingMemTags !== m.key && m.tags?.length > 0 && html`<div class="text-meta-sm mb-half">${m.tags.join(', ')}</div>`}
            ${keyRulesPopover && keyRulesPopover.key === m.key && html`
              <div class="key-rules-box">
                <div class="flex-between mb-half">
                  <strong class="text-caption">\u{1F6E1}️ ${t('permissions.sharingRules')}</strong>
                  <button class="btn-outline btn-sm" onClick=${() => setKeyRulesPopover(null)}>✕</button>
                </div>
                <div class="text-meta-sm mb-half">${t('profile.memory.visLabel')} ${t('knowledge.visibility.' + keyRulesPopover.visibility) || keyRulesPopover.visibility}</div>
                ${keyRulesPopover.rules.length === 0
                  ? html`<div class="text-meta pf-italic">${t('permissions.noRules')}</div>`
                  : keyRulesPopover.rules.map(r => html`
                    <div class="pf-rule-row">
                      ${recipientBadge(r.recipient)}
                      <span class="text-code text-meta-sm">${escHtml(r.data_pattern)}</span>
                      <span class="text-meta-sm pf-ml-auto">${escHtml(r.scope || '-')}</span>
                    </div>`)
                }
              </div>
            `}
            <div class="mem-actions">
              <button class="btn-sm" onClick=${() => setEditModal({ key: m.key, value: typeof m.value === 'object' ? JSON.stringify(m.value, null, 2) : String(m.value || ''), visibility: m.visibility || 'private', version: m.version, isJson: typeof m.value === 'object' })}>${t('profile.memory.editBtn')}</button>
              ${fedConsents[m.key]
                ? html`<button class="btn-outline btn-sm" disabled=${togglingFed === m.key}
                    onClick=${() => handleStopSharing(m.key)}>
                    ${togglingFed === m.key ? '...' : t('profile.memory.stopSharing')}
                  </button>`
                : html`<button class="btn-ghost btn-sm" disabled=${togglingFed === m.key}
                    onClick=${() => handleShareToFederation(m.key)}>
                    ${togglingFed === m.key ? '...' : t('profile.memory.shareToFederation')}
                  </button>`
              }
              ${session.federated && html`
                <button class="btn-ghost" onClick=${() => doPull(m.key)} title=${t('profile.memory.pullFromHome')}>
                  ↓ ${t('profile.memory.pullFromHome')}
                </button>
                <button class="btn-ghost" onClick=${() => doPush(m.key)} title=${t('profile.memory.pushToHome')}>
                  ↑ ${t('profile.memory.pushToHome')}
                </button>
              `}
              <button class="btn-danger mem-delete-btn" onClick=${() => handleDeleteMemory(m.key)}>${t('profile.memory.deleteBtn')}</button>
            </div>
          </div>
        `}
      </div>
    `;

    return html`
      <div class="action-bar">
        <div class="search-bar">
          <input type="text" class="input-field" placeholder=${t('profile.memory.filterType')}
            value=${filterText} onInput=${e => setFilterText(e.target.value)} />
          ${filterText && html`<button class="btn-ghost btn-sm" onClick=${() => setFilterText('')}>✕</button>`}
        </div>
        <div class="mem-sort-bar">
          <label class="text-meta-sm">${t('profile.memory.sortLabel')}</label>
          <select class="input-field mem-sort-select" value=${sortBy} onChange=${e => setSortBy(e.target.value)}>
            <option value="updated">${t('profile.memory.sortUpdated')}</option>
            <option value="created">${t('profile.memory.sortCreated')}</option>
            <option value="alpha">${t('profile.memory.sortAlpha')}</option>
          </select>
        </div>
        <button class="btn-primary" onClick=${() => setShowMemForm(!showMemForm)}>${t('profile.memory.newBtn')}</button>
      </div>
      <${TagCloud} tags=${tagsByFreq} selected=${memTagFilter} onToggle=${toggleMemTag} onClear=${() => setMemTagFilter(new Set())} limit=${10} />
      ${showMemForm && html`<${MemoryForm} onSave=${handleCreateMemory} onCancel=${() => setShowMemForm(false)} groups=${groups} />`}
      ${filtered.length === 0
        ? html`<div class="empty">${memories.length > 0 ? (t('tags.noMatch') || 'No items match selected tags') : t('profile.memory.empty')}</div>`
        : groupsOrdered.map(g => {
            const collapsed = !filtering && collapsedGroups.has(g.id);
            return html`
              <div class="mem-group" key=${g.id}>
                <button class="mem-group-header" onClick=${() => toggleGroupCollapsed(g.id)}>
                  <span class="pf-chevron ${collapsed ? '' : 'pf-chevron-open'}">▼</span>
                  <span class="mem-group-name">${escHtml(groupLabel(g))}</span>
                  <span class="mem-group-count">${g.items.length === 1 ? (t('profile.memory.keysOne') || '1 key') : (t('profile.memory.keysCount') || '{n} keys').replace('{n}', String(g.items.length))}</span>
                  ${g.kind === 'organism' && orgNames[g.uuid] && html`<span class="mem-group-sub">${shortTok(g.uuid)}</span>`}
                </button>
                ${!collapsed && g.items.map(m => renderRow(m, g))}
              </div>
            `;
          })
      }`;
  };

  const [fileTagFilter, setFileTagFilter] = useState(new Set());

  const renderFilesList = () => {
    if (!files) return html`<${Spinner} text=${t('profile.files.loading')} />`;

    // Collect all unique tags across files
    const allTags = new Set();
    for (const f of files) {
      if (f.tags) for (const tag of f.tags) allTags.add(tag);
    }

    // Filter files by selected tags
    const filtered = fileTagFilter.size === 0 ? files : files.filter(f =>
      f.tags && [...fileTagFilter].every(tag => f.tags.includes(tag))
    );

    const toggleTag = (tag) => {
      setFileTagFilter(prev => {
        const next = new Set(prev);
        if (next.has(tag)) next.delete(tag); else next.add(tag);
        return next;
      });
    };

    const fileUrls = filtered.map(f => `${NODE_URL}/v1/memory/files/${encodeURIComponent(f.key || f.name)}`).join('\n');

    return html`
      <div class="action-bar">
        <button class="btn-primary" onClick=${() => setShowFileForm(!showFileForm)}>${t('profile.files.uploadBtn')}</button>
        ${filtered.length > 0 && html`<${CopyButton}
          text=${fileUrls}
          label=${`\u{1F4CB} ${t('profile.files.copyUrls') || 'Copy URLs'} (${filtered.length})`}
          title="Copy file URLs"
          className="btn-outline btn-sm"
          onCopied=${() => showToast(t('profile.files.urlsCopied') || `${filtered.length} URLs copied`)} />`}
        <span class="text-meta-sm">${t('profile.files.sizeLimit')}</span>
      </div>
      <${TagCloud} tags=${[...allTags]} selected=${fileTagFilter} onToggle=${toggleTag} onClear=${() => setFileTagFilter(new Set())} />
      ${showFileForm && html`<${FileUploadForm} onUpload=${handleUploadFiles} onCancel=${() => setShowFileForm(false)} />`}
      ${filtered.length === 0
        ? html`<div class="empty">${files.length > 0 ? (t('profile.files.noMatch') || 'No files match selected tags') : t('profile.files.empty')}</div>`
        : html`<div class="file-grid">
            ${filtered.map(f => {
              const fKey = f.key || f.name;
              const isImage = f.mime_type?.startsWith('image');
              const vis = f.visibility || 'private';
              return html`
                <div class="file-card">
                  ${isImage
                    ? html`<${AuthImage} class="file-thumb" src="${NODE_URL}/v1/memory/files/${encodeURIComponent(fKey)}" alt=${escHtml(fKey)} />`
                    : html`<div class="file-icon">${f.mime_type?.includes('pdf') ? '\u{1F4C4}' : '\u{1F4CE}'}</div>`
                  }
                  <div class="file-info">
                    <div class="file-name">${escHtml(fKey)}</div>
                    <div class="file-meta">
                      ${f.size ? Math.round(f.size / 1024) + ' KB' : ''}
                      <select class="input-field mem-vis-select" value=${vis} title=${t('profile.files.visLabel')}
                        onClick=${(e) => e.stopPropagation()}
                        onChange=${(e) => handleUpdateFileVisibility(fKey, e.target.value)}>
                        ${VIS_OPTIONS.map(v => html`<option key=${v} value=${v}>${t('knowledge.visibility.' + v)}</option>`)}
                      </select>
                    </div>
                    ${editingFileTags === fKey
                      ? html`<${TagEditor} tags=${f.tags || []} onSave=${(tags) => handleUpdateFileTags(fKey, tags)} />`
                      : html`
                        ${f.tags?.length > 0 && html`<div class="file-tags">${f.tags.map(tag => html`<span class="file-tag" key=${tag}>${escHtml(tag)}</span>`)}</div>`}
                        <button class="btn-outline btn-sm mt-xs" onClick=${() => setEditingFileTags(fKey)}>
                          ${t('tags.editTags') || 'Edit tags'}
                        </button>
                      `}
                  </div>
                  <div class="file-actions">
                    <button class="btn-outline btn-sm" onClick=${() => handleDownloadFile(fKey)}>${t('profile.files.download')}</button>
                    <button class="btn-danger-solid btn-sm" onClick=${() => handleDeleteFile(fKey)}>${t('profile.files.delete')}</button>
                  </div>
                </div>`;
            })}
          </div>`
      }`;
  };

  async function doPull(key) {
    try {
      await memoryService.pullFromHome(key);
      showToast(t('profile.memory.pullSuccess'));
      loadMemories();
    } catch (e) { showToast(e.message, true); }
  }

  async function doPush(key) {
    try {
      await memoryService.pushToHome(key);
      showToast(t('profile.memory.pushSuccess'));
    } catch (e) { showToast(e.message, true); }
  }

  function browseErrorMessage(e) {
    const code = e.code || '';
    const msg = e.message || '';
    if (code === 'FEDERATION_PROXY_ERROR' || msg.includes('Localhost not allowed') || msg.includes('ocalhost'))
      return t('profile.memory.errorLocalhost');
    if (code === 'PEER_NOT_FOUND' || msg.includes('not found'))
      return t('profile.memory.errorPeerNotFound');
    if (code === 'ROUTE_NOT_FOUND' || e.status === 404)
      return t('profile.memory.errorPeerUnsupported');
    return msg;
  }

  async function loadBrowseHome() {
    setBrowseMode('home');
    setBrowseLoading(true);
    setBrowseError(null);
    setRemoteEntries(null);
    try {
      const entries = await memoryService.listHomeMemories();
      setRemoteEntries(entries);
    } catch (e) {
      setBrowseError(browseErrorMessage(e));
      setRemoteEntries([]);
    } finally { setBrowseLoading(false); }
  }

  async function loadBrowseRemote(peerNodeId) {
    if (!peerNodeId) return;
    setSelectedPeer(peerNodeId);
    setBrowseMode('remote');
    setBrowseLoading(true);
    setBrowseError(null);
    setRemoteEntries(null);
    try {
      const entries = await memoryService.listRemoteMemories(peerNodeId);
      setRemoteEntries(entries);
    } catch (e) {
      setBrowseError(browseErrorMessage(e));
      setRemoteEntries([]);
    } finally { setBrowseLoading(false); }
  }

  async function initBrowseRemote() {
    setBrowseMode('remote');
    setRemoteEntries(null);
    setSelectedPeer('');
    try {
      const peers = await listPeers();
      setRemotePeers(Array.isArray(peers) ? peers.filter(p => p.status === 'active' || p.status === 'healthy') : []);
    } catch { setRemotePeers([]); }
  }

  async function handlePullRemoteEntry(key, peerNodeId) {
    const nodeId = peerNodeId || selectedPeer;
    setPullingKeys(prev => new Set([...prev, key]));
    try {
      if (session?.federated) {
        await memoryService.pullFromHome(key);
      } else {
        await memoryService.pullFromRemote(nodeId, key);
      }
      showToast(t('profile.memory.pullSuccess'));
      loadMemories();
    } catch (e) {
      showToast(e.message, true);
    } finally {
      setPullingKeys(prev => { const n = new Set(prev); n.delete(key); return n; });
    }
  }

  async function handlePullAll() {
    if (!remoteEntries?.length) return;
    const node = session?.federated ? (session.homeNode || 'home') : selectedPeer;
    const msg = t('profile.memory.pullAllConfirm').replace('{count}', remoteEntries.length).replace('{node}', node);
    confirm(msg, async () => {
      let pulled = 0;
      for (const entry of remoteEntries) {
        try {
          if (session?.federated) {
            await memoryService.pullFromHome(entry.key);
          } else {
            await memoryService.pullFromRemote(selectedPeer, entry.key);
          }
          pulled++;
        } catch { /* skip failed entries */ }
      }
      showToast(t('profile.memory.pullAllSuccess').replace('{count}', pulled));
      loadMemories();
    });
  }

  async function loadDiscoverEntries(query) {
    setDiscoverLoading(true);
    setDiscoverError(null);
    setDiscoverEntries(null);
    setExpandedDiscover(null);
    try {
      const result = await memoryService.discoverPublicMemories({ q: query || undefined, limit: 100 });
      setDiscoverEntries(result.items || []);
    } catch (e) {
      setDiscoverError(e.message || t('profile.error'));
      setDiscoverEntries([]);
    } finally { setDiscoverLoading(false); }
  }

  function initDiscover() {
    setBrowseMode('discover');
    loadDiscoverEntries('');
  }

  async function handleCopyEntry(ownerGaii, key) {
    setCopyingKeys(prev => new Set([...prev, key]));
    try {
      const resp = await memoryService.copyPublicMemory(ownerGaii, key, 'private');
      if (resp.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
      showToast(t('profile.memory.discoverCopied'));
      loadMemories();
    } catch (e) {
      showToast(e.message || t('profile.error'), true);
    } finally {
      setCopyingKeys(prev => { const n = new Set(prev); n.delete(key); return n; });
    }
  }

  function closeBrowse() {
    setBrowseMode(null);
    setRemoteEntries(null);
    setSelectedPeer('');
    setDiscoverEntries(null);
    setDiscoverSearch('');
    setExpandedDiscover(null);
  }

  const renderBrowsePanel = () => {
    if (!browseMode) return null;

    if (browseMode === 'discover') {
      return html`
        <div class="mem-browse-panel">
          <div class="mem-browse-header">
            <div>
              <div class="section-desc">${t('profile.memory.discoverDesc')}</div>
            </div>
          </div>
          <div class="mem-discover-search mb-half">
            <input type="text" class="input-field" placeholder=${t('profile.memory.discoverSearchPlaceholder')}
              value=${discoverSearch}
              onInput=${e => setDiscoverSearch(e.target.value)}
              onKeyDown=${e => e.key === 'Enter' && loadDiscoverEntries(discoverSearch)} />
            <button class="btn-sm" onClick=${() => loadDiscoverEntries(discoverSearch)}>${t('profile.memory.searchBtn')}</button>
          </div>

          ${discoverLoading && html`<${Spinner} text=${t('profile.memory.discoverLoading')} />`}

          ${discoverError && !discoverLoading && html`
            <div class="alert alert-warning"><span class="alert-msg">${discoverError}</span></div>
          `}

          ${discoverEntries && !discoverLoading && !discoverError && html`
            <div class="mb-half text-meta">
              ${t('profile.memory.discoverCount').replace('{count}', discoverEntries.length)}
            </div>
            ${discoverEntries.length === 0
              ? html`<div class="empty">${t('profile.memory.discoverEmpty')}</div>`
              : html`<div class="mem-browse-list">
                  ${discoverEntries.map(entry => {
                    const ownerShort = entry.owner_gaii?.split('@')[0] || entry.owner_gaii;
                    const isExpanded = expandedDiscover === entry.owner_gaii + '/' + entry.key;
                    return html`
                      <div key=${entry.owner_gaii + '/' + entry.key} class="mem-discover-item">
                        <div class="mem-discover-row" onClick=${() => setExpandedDiscover(isExpanded ? null : entry.owner_gaii + '/' + entry.key)}>
                          <div class="mem-discover-info">
                            <div class="mem-browse-key" title=${entry.key}>${escHtml(entry.key)}</div>
                            <div class="mem-discover-owner">${escHtml(ownerShort)}</div>
                          </div>
                          <div class="mem-browse-meta">
                            ${entry.tags?.length > 0 && html`<span class="text-meta-sm mem-browse-tags" title=${entry.tags.join(', ')}>${entry.tags.join(', ')}</span>`}
                            <span class="mem-time">${formatRelativeTime(entry.updated_at || entry.created_at)}</span>
                          </div>
                          <button class="btn-outline btn-sm"
                            disabled=${copyingKeys.has(entry.key)}
                            onClick=${(e) => { e.stopPropagation(); handleCopyEntry(entry.owner_gaii, entry.key); }}>
                            ${copyingKeys.has(entry.key) ? '...' : t('profile.memory.discoverCopy')}
                          </button>
                        </div>
                        ${isExpanded && html`
                          <${DiscoverPreview} ownerGaii=${entry.owner_gaii} memKey=${entry.key} />
                        `}
                      </div>
                    `;
                  })}
                </div>`
            }
          `}
        </div>
      `;
    }

    const isHome = browseMode === 'home';
    const desc = isHome ? t('profile.memory.browseHomeDesc') : t('profile.memory.browseRemoteDesc');

    return html`
      <div class="mem-browse-panel">
        <div class="mem-browse-header">
          <div>
            <div class="section-desc">${desc}</div>
          </div>
        </div>

        ${!isHome && !selectedPeer && html`
          <div class="mb-1">
            ${remotePeers.length === 0
              ? html`<div class="empty">${t('profile.memory.noPeers')}</div>`
              : html`
                <select class="input-field" onChange=${e => loadBrowseRemote(e.target.value)}>
                  <option value="">${t('profile.memory.browseRemoteSelect')}</option>
                  ${remotePeers.map(p => html`<option key=${p.node_id} value=${p.node_id}>${escHtml(p.node_id)} (${escHtml(p.url || '')})</option>`)}
                </select>
              `}
          </div>
        `}

        ${browseLoading && html`<${Spinner} text=${isHome ? t('profile.memory.loadingHome') : t('profile.memory.loadingRemote')} />`}

        ${browseError && !browseLoading && html`
          <div class="alert alert-warning">
            <span class="alert-msg">${browseError}</span>
          </div>
        `}

        ${remoteEntries && !browseLoading && !browseError && html`
          <div class="mb-half text-meta">
            ${isHome
              ? t('profile.memory.homeEntries').replace('{count}', remoteEntries.length)
              : t('profile.memory.remoteEntries').replace('{count}', remoteEntries.length).replace('{node}', selectedPeer)}
            ${remoteEntries.length > 0 && html`
              <button class="btn-ghost btn-sm pf-ml-half" onClick=${handlePullAll}>${t('profile.memory.pullAllBtn')}</button>
            `}
          </div>
          ${remoteEntries.length === 0
            ? html`<div class="empty">${isHome ? t('profile.memory.noHomeEntries') : t('profile.memory.noRemoteEntries')}</div>`
            : html`<div class="mem-browse-list">
                ${remoteEntries.map(entry => html`
                  <div key=${entry.key} class="mem-browse-item">
                    <div class="mem-browse-key" title=${entry.key}>${escHtml(entry.key)}</div>
                    <div class="mem-browse-meta">
                      <${VisibilityPill} visibility=${entry.visibility} />
                      ${entry.tags?.length > 0 && html`<span class="text-meta-sm mem-browse-tags" title=${entry.tags.join(', ')}>${entry.tags.join(', ')}</span>`}
                    </div>
                    <button class="btn-outline btn-sm"
                      disabled=${pullingKeys.has(entry.key)}
                      onClick=${() => handlePullRemoteEntry(entry.key)}>
                      ${pullingKeys.has(entry.key) ? '...' : t('profile.memory.pullEntry')}
                    </button>
                  </div>
                `)}
              </div>`
          }
        `}
      </div>
    `;
  };

  // Three states of the same list = tabs, not inline panels with their own Cancel buttons.
  const pickMainTab = (id) => {
    setMainTab(id);
    if (id === 'discover') initDiscover();
    else if (id === 'remote') { if (session.federated) loadBrowseHome(); else initBrowseRemote(); }
    else closeBrowse();
  };

  return html`
    <div class="section-title">${t('profile.memory.title')}</div>
    <div class="section-desc">${t('profile.memory.desc')}</div>

    <div class="sub-tabs">
      <button class="sub-tab ${mainTab === 'own' ? 'active' : ''}" onClick=${() => pickMainTab('own')}>${t('profile.memory.tabOwn')}</button>
      <button class="sub-tab ${mainTab === 'discover' ? 'active' : ''}" onClick=${() => pickMainTab('discover')}>${t('profile.memory.tabPublic')}</button>
      <button class="sub-tab ${mainTab === 'remote' ? 'active' : ''}" onClick=${() => pickMainTab('remote')}>${session.federated ? t('profile.memory.browseHome') : t('profile.memory.tabRemote')}</button>
    </div>

    ${session.federated && html`
      <div class="alert alert-info mb-half">
        <span class="alert-msg">${t('profile.memory.federatedSession')}</span>
      </div>
    `}

    ${mainTab !== 'own' ? renderBrowsePanel() : html`
      ${agents.length > 1 && html`
        <div class="agent-selector mb-half">
          <label class="text-meta pf-mr-half">${t('profile.memory.agent') || 'Agent'}:</label>
          <select class="input-field pf-select-inline"
            value=${selectedAgent} onChange=${e => { setSelectedAgent(e.target.value); setExpandedMem(null); setMemTagFilter(new Set()); }}>
            <option value="">${t('profile.memory.defaultAgent') || 'Default agent'}</option>
            ${agents.map(a => html`<option key=${a.gaii} value=${a.gaii}>${escHtml(a.name || a.gaii)}${a.display_name ? ` — ${escHtml(a.display_name)}` : ''}</option>`)}
          </select>
        </div>
      `}

      <div class="sub-tabs">
        <button class="sub-tab ${memSubTab === 'entries' ? 'active' : ''}" onClick=${() => setMemSubTab('entries')}>${t('profile.memory.entries')}</button>
        <button class="sub-tab ${memSubTab === 'files' ? 'active' : ''}" onClick=${() => setMemSubTab('files')}>${t('profile.memory.files')}</button>
      </div>
      ${memSubTab === 'entries' ? renderEntries() : renderFilesList()}
    `}

    ${editModal && html`<${EditMemoryModal}
      memKey=${editModal.key}
      initialValue=${editModal.value}
      initialVisibility=${editModal.visibility}
      initialVersion=${editModal.version}
      isJson=${editModal.isJson}
      groups=${groups}
      onSave=${(v, vis, ver, gId) => handleSaveEdit(editModal.key, v, vis, ver, gId)}
      onCancel=${() => setEditModal(null)} />`}
    <${ConfirmUI} />
  `;
}

function DiscoverPreview({ ownerGaii, memKey }) {
  const [value, setValue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  useEffect(() => {
    setLoading(true);
    const url = getNodeUrl() + '/v1/memory/' + encodeURIComponent(ownerGaii) + '/' + encodeURIComponent(memKey);
    fetch(url).then(r => r.json()).then(res => {
      if (res.ok) setValue(res.data.value);
      else setErr(res.error?.message || 'Not found');
    }).catch(e => setErr(e.message)).finally(() => setLoading(false));
  }, [ownerGaii, memKey]);

  if (loading) return html`<div class="mem-discover-preview"><span class="text-meta-sm">...</span></div>`;
  if (err) return html`<div class="mem-discover-preview"><span class="text-meta-sm" style="color:var(--danger)">${err}</span></div>`;
  const text = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value || '');
  const truncated = text.length > 2000 ? text.slice(0, 2000) + '\n...' : text;
  return html`<div class="mem-discover-preview"><pre>${truncated}</pre></div>`;
}

function MemoryForm({ onSave, onCancel, groups }) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [vis, setVis] = useState('private');
  const [tags, setTags] = useState('');
  const [groupId, setGroupId] = useState('');
  return html`
    <div class="create-form">
      <div class="form-row"><label>${t('profile.memory.keyLabel')}</label><input class="input-field" placeholder=${t('profile.memory.keyPlaceholder')} value=${key} onInput=${e => setKey(e.target.value)} /></div>
      <div class="form-row"><label>${t('profile.memory.valueLabel')}</label><textarea class="input-field" rows="3" placeholder=${t('profile.memory.valuePlaceholder')} value=${value} onInput=${e => setValue(e.target.value)}></textarea></div>
      <div class="form-row"><label>${t('profile.memory.visLabel')}</label>
        <select class="input-field" value=${vis} onChange=${e => setVis(e.target.value)}>
          <option value="private">${t('profile.memory.visPrivate')}</option>
          <option value="shared">${t('profile.memory.visShared')}</option>
          <option value="group">${t('knowledge.visibility.group')}</option>
          <option value="public">${t('profile.memory.visPublic')}</option>
        </select>
      </div>
      ${vis === 'group' && html`
        <div class="form-row"><label>${t('profile.memory.selectGroup')}</label>
          ${(groups || []).length === 0
            ? html`
              <div class="text-meta-sm mb-xs">${t('profile.memory.noGroups')}</div>
              <button type="button" class="btn-outline btn-sm" onClick=${() => {
                window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'access' } }));
              }}>${t('profile.memory.createGroupBtn')}</button>`
            : html`
              <select class="input-field" value=${groupId} onChange=${e => setGroupId(e.target.value)}>
                <option value="">-- ${t('profile.memory.selectGroup')} --</option>
                ${(groups || []).map(g => html`<option value=${g.id}>${g.name}</option>`)}
              </select>`}
        </div>
      `}
      <div class="form-row"><label>${t('profile.memory.tagsLabel')}</label><input class="input-field" placeholder=${t('profile.memory.tagsPlaceholder')} value=${tags} onInput=${e => setTags(e.target.value)} /></div>
      <div class="form-actions">
        <button class="btn-primary" onClick=${() => { if (!key || !value) return; onSave(key, value, vis, tags, vis === 'group' ? groupId : undefined); }}>${t('profile.memory.saveBtn')}</button>
        <button class="btn-outline" onClick=${onCancel}>${t('profile.memory.cancelBtn')}</button>
      </div>
    </div>`;
}

function fileIcon(type) {
  if (type?.startsWith('image')) return '\u{1F5BC}\uFE0F';
  if (type?.includes('pdf')) return '\u{1F4C4}';
  return '\u{1F4CE}';
}

function FileUploadForm({ onUpload, onCancel }) {
  const [fileItems, setFileItems] = useState([]);
  const [vis, setVis] = useState('private');
  const [tagInput, setTagInput] = useState('');
  const [fileTags, setFileTags] = useState([]);
  const [dragover, setDragover] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !fileTags.includes(tag)) {
      setFileTags(prev => [...prev, tag]);
    }
    setTagInput('');
  };
  const removeTag = (tag) => setFileTags(prev => prev.filter(t => t !== tag));

  const addFiles = (newFiles) => {
    if (!newFiles || newFiles.length === 0) return;
    const existing = new Set(fileItems.map(i => i.file.name + i.file.size));
    const additions = [];
    for (const f of newFiles) {
      if (!existing.has(f.name + f.size)) {
        additions.push({ file: f, key: f.name });
      }
    }
    if (additions.length > 0) setFileItems(prev => [...prev, ...additions]);
  };

  const removeFile = (idx) => {
    setFileItems(prev => prev.filter((_, i) => i !== idx));
  };

  const updateKey = (idx, newKey) => {
    setFileItems(prev => prev.map((item, i) => i === idx ? { ...item, key: newKey } : item));
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragover(false);
    addFiles(Array.from(e.dataTransfer?.files || []));
  };

  const handleSubmit = async () => {
    if (fileItems.length === 0 || uploading) return;
    setUploading(true);
    await onUpload(fileItems, vis, fileTags);
    setUploading(false);
  };

  return html`
    <div class="create-form">
      <div class="form-row">
        <div class="file-dropzone ${dragover ? 'dragover' : ''} ${fileItems.length > 0 ? 'has-file' : ''}"
          onClick=${() => fileRef.current?.click()}
          onDragOver=${(e) => { e.preventDefault(); setDragover(true); }}
          onDragLeave=${() => setDragover(false)}
          onDrop=${handleDrop}>
          <input type="file" multiple ref=${fileRef} class="pf-hidden"
            onChange=${e => { addFiles(Array.from(e.target.files || [])); e.target.value = ''; }} />
          <div class="file-dropzone-empty">
            <span class="pf-upload-icon">\u{2B06}\uFE0F</span>
            <span>${t('profile.files.dropHere')}</span>
            <span class="text-meta">${t('profile.files.orClick')}</span>
          </div>
        </div>
      </div>
      ${fileItems.length > 0 && html`
        <div class="file-upload-list">
          ${fileItems.map((item, idx) => html`
            <div class="file-upload-item" key=${item.file.name + item.file.size}>
              <span class="pf-file-icon">${fileIcon(item.file.type)}</span>
              <input class="input-field pf-flex-fill" value=${item.key}
                onInput=${e => updateKey(idx, e.target.value)}
                onClick=${e => e.stopPropagation()} />
              <span class="text-meta pf-nowrap pf-shrink-0">${Math.round(item.file.size / 1024)} KB</span>
              <button class="btn-outline btn-sm pf-shrink-0" onClick=${() => removeFile(idx)}>\u2715</button>
            </div>
          `)}
        </div>
      `}
      <div class="form-row"><label>${t('profile.files.visLabel')}</label>
        <select class="input-field" value=${vis} onChange=${e => setVis(e.target.value)}>
          <option value="private">${t('profile.files.visPrivate')}</option>
          <option value="owner">${t('profile.files.visOwner')}</option>
          <option value="group">Group</option>
          <option value="public">${t('profile.files.visPublic')}</option>
        </select>
      </div>
      <div class="form-row"><label>${t('profile.files.tagsLabel') || 'Tags'}</label>
        <div class="flex-row">
          <input class="input-field pf-flex-fill" placeholder=${t('profile.files.tagsPlaceholder') || 'Add tag and press Enter'}
            value=${tagInput} onInput=${e => setTagInput(e.target.value)}
            onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} />
          <button type="button" class="btn-sm" onClick=${addTag}>+</button>
        </div>
        ${fileTags.length > 0 && html`
          <div class="file-tag-cloud mb-half">
            ${fileTags.map(tag => html`
              <span class="file-tag-btn active" key=${tag} onClick=${() => removeTag(tag)}>
                ${tag} \u2715
              </span>
            `)}
          </div>
        `}
      </div>
      <div class="form-actions">
        <button class="btn-primary" disabled=${fileItems.length === 0 || uploading}
          onClick=${handleSubmit}>
          ${uploading ? '...' : fileItems.length > 1 ? `${t('profile.files.uploadSaveBtn')} (${fileItems.length})` : t('profile.files.uploadSaveBtn')}
        </button>
        <button class="btn-outline" onClick=${onCancel}>${t('profile.files.cancelBtn')}</button>
      </div>
    </div>`;
}

function EditMemoryModal({ memKey, initialValue, initialVisibility, initialVersion, isJson, onSave, onCancel, groups }) {
  const [value, setValue] = useState(initialValue);
  const [vis, setVis] = useState(initialVisibility || 'private');
  const [groupId, setGroupId] = useState('');

  // Broken JSON in a memory key crashes the agent that reads it — validate before save.
  // Validation applies when the stored value was an object, or the draft clearly is one.
  const looksJson = isJson || /^[[{]/.test(String(value || '').trim());
  let jsonError = null;
  if (looksJson) {
    try { JSON.parse(value); } catch (e) { jsonError = e.message; }
  }
  const groupMissing = vis === 'group' && !groupId && (groups || []).length === 0;
  const canSave = !jsonError && !(vis === 'group' && !groupId);

  return html`
    <${Modal} open=${true} onClose=${onCancel} title=${`${t('profile.memory.editTitle')}: ${memKey}`}>
        <div class="form-row flex-row mb-half">
          <label class="pf-label-inline">${t('profile.memory.visLabel')}</label>
          <select class="input-field mem-vis-select" value=${vis}
            onChange=${e => { setVis(e.target.value); if (e.target.value !== 'group') setGroupId(''); }}>
            ${['private', 'owner', 'group', 'public'].map(v => html`<option key=${v} value=${v}>${t('knowledge.visibility.' + v)}</option>`)}
          </select>
        </div>
        ${vis === 'group' && html`
          <div class="form-row mb-half">
            <label>${t('profile.memory.selectGroup')}</label>
            ${(groups || []).length === 0
              ? html`
                <div class="text-meta-sm mb-xs">${t('profile.memory.noGroups')}</div>
                <button class="btn-outline btn-sm" onClick=${() => {
                  onCancel();
                  try { sessionStorage.setItem('aimeat.access.focus', 'groups'); } catch { /* noop */ }
                  window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'access' } }));
                }}>${t('profile.memory.createGroupBtn')}</button>`
              : html`
                <select class="input-field" value=${groupId} onChange=${e => setGroupId(e.target.value)}>
                  <option value="">-- ${t('profile.memory.selectGroup')} --</option>
                  ${(groups || []).map(g => html`<option value=${g.id}>${g.name}</option>`)}
                </select>`}
          </div>
        `}
        <textarea class="input-field mem-edit-textarea ${jsonError ? 'mem-edit-textarea--error' : ''}" rows="14"
          value=${value} onInput=${e => setValue(e.target.value)}></textarea>
        ${jsonError && html`<div class="mem-json-error">${t('profile.memory.invalidJson')} — ${jsonError}</div>`}
        <div class="form-actions mt-1">
          <button class="btn-primary" disabled=${!canSave || groupMissing}
            onClick=${() => onSave(value, vis, initialVersion, vis === 'group' ? groupId : undefined)}>${t('profile.save')}</button>
          <button class="btn-outline" onClick=${onCancel}>${t('profile.cancel')}</button>
        </div>
    <//>`;
}
