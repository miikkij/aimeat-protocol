/**
 * @file memory-tab.js
 * @description Profile tab for memory entries and file management — CRUD, search,
 *   visibility cycling, tag editing, sharing rules, and file upload with drag-and-drop.
 * @version-history
 *   v1.0.0 — 2026-03-17 — Refactor: replace inline styles with CSS utility classes
 *   v1.1.0 — 2026-03-18 — Fix: use AuthImage for thumbnails and authenticated download to avoid 401
 *   v1.2.0 — 2026-05-22 — Add Browse Home / Browse Remote panels for federation memory sync
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
import TagCloud from '/js/components/tag-cloud.js';
import TagEditor from '/js/components/tag-editor.js';
import { useConfirm } from '/components/Modal.js';

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
  const [togglingFed, setTogglingFed] = useState(null);
  const [groups, setGroups] = useState([]);
  const [groupPickerFor, setGroupPickerFor] = useState(null);
  const [browseMode, setBrowseMode] = useState(null); // 'home' | 'remote' | null
  const [remoteEntries, setRemoteEntries] = useState(null);
  const [remotePeers, setRemotePeers] = useState([]);
  const [selectedPeer, setSelectedPeer] = useState('');
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState(null);
  const [pullingKeys, setPullingKeys] = useState(new Set());

  useEffect(() => {
    if (session) { loadAgents(); loadMemories(); loadFiles(); loadFedConsents(); loadGroups(); }
  }, [session]);

  useEffect(() => {
    if (session) { loadMemories(); }
  }, [selectedAgent]);

  async function loadFedConsents() {
    try {
      const allConsents = await listConsents();
      const map = {};
      for (const c of allConsents) {
        if (c.scope === 'federation') {
          const pat = c.data_pattern || c.pattern || '';
          // Direct key match (no wildcard) or exact pattern
          if (pat && !pat.includes('*')) {
            map[pat] = c.id || c.consent_id;
          }
        }
      }
      setFedConsents(map);
    } catch { /* ignore */ }
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
    const body = { value, visibility, version };
    if (visibility === 'group' && groupId) body.group_id = groupId;
    const resp = await memoryService.updateMemoryFull(key, body);
    if (resp.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
    showToast(t('profile.memory.updated'));
    setEditModal(null);
    loadMemories();
  }

  async function handleSearch(query) {
    if (!query) { loadMemories(); return; }
    try {
      const agentGaii = selectedAgent || undefined;
      const list = await memoryService.searchMemory(query, agentGaii);
      setMemories(Array.isArray(list) ? list : []);
    } catch { showToast(t('profile.memory.searchFailed'), true); }
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

  /* ── Cycle visibility: private → owner → group → public → private ── */
  const cycleVis = ['private', 'owner', 'group', 'public'];
  const visColor = { private: '#c084fc', owner: '#60a5fa', group: '#10b981', public: '#4ade80' };
  const visBg = { private: 'rgba(150,100,200,.2)', owner: 'rgba(100,150,255,.2)', group: 'rgba(16,185,129,.2)', public: 'rgba(0,200,100,.2)' };

  async function handleUpdateVisibility(key, newVis, version, groupId) {
    // Optimistic update — change locally first, then persist
    setMemories(prev => prev.map(m => m.key === key ? { ...m, visibility: newVis, version: (m.version || 1) + 1 } : m));
    const resp = await memoryService.updateMemoryVisibility(key, newVis, version, groupId);
    if (resp.ok === false) {
      showToast(resp.error?.message || t('profile.error'), true);
      loadMemories(); // Revert on error
    }
  }

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

  const renderEntries = () => {
    const searchRef = useRef(null);
    if (!memories) return html`<${Spinner} text=${t('profile.memory.loading')} />`;

    // Collect all unique tags across memories
    const allMemTags = new Set();
    for (const m of memories) {
      if (m.tags) for (const tag of m.tags) allMemTags.add(tag);
    }

    // Filter by selected tags
    const filtered = memTagFilter.size === 0 ? memories : memories.filter(m =>
      m.tags && [...memTagFilter].every(tag => m.tags.includes(tag))
    );

    const toggleMemTag = (tag) => {
      setMemTagFilter(prev => {
        const next = new Set(prev);
        if (next.has(tag)) next.delete(tag); else next.add(tag);
        return next;
      });
    };

    return html`
      <div class="action-bar">
        <div class="search-bar">
          <input type="text" ref=${searchRef} class="input-field" placeholder=${t('profile.memory.search')} onKeyDown=${e => e.key === 'Enter' && handleSearch(e.target.value)} />
          <button class="btn-sm" onClick=${() => handleSearch(searchRef.current?.value)}>${t('profile.memory.searchBtn')}</button>
          <button class="btn-outline btn-sm" onClick=${() => { if (searchRef.current) searchRef.current.value = ''; loadMemories(); }}>${t('profile.memory.clearBtn')}</button>
        </div>
        <button class="btn-primary" onClick=${() => setShowMemForm(!showMemForm)}>${t('profile.memory.newBtn')}</button>
      </div>
      <${TagCloud} tags=${[...allMemTags]} selected=${memTagFilter} onToggle=${toggleMemTag} onClear=${() => setMemTagFilter(new Set())} />
      ${showMemForm && html`<${MemoryForm} onSave=${handleCreateMemory} onCancel=${() => setShowMemForm(false)} groups=${groups} />`}
      ${filtered.length === 0
        ? html`<div class="empty">${memories.length > 0 ? (t('tags.noMatch') || 'No items match selected tags') : t('profile.memory.empty')}</div>`
        : filtered.map(m => html`
          <div>
            <div class="mem-item" onClick=${() => setExpandedMem(expandedMem === m.key ? null : m.key)}>
              <span class="mem-key">${escHtml(m.key)}</span>
              ${(() => {
                const vis = m.visibility || 'private';
                const nextVis = cycleVis[(cycleVis.indexOf(vis) + 1) % cycleVis.length];
                return html`<button class="kpkg-vis-pill"
                  onClick=${(e) => { e.stopPropagation(); if (nextVis === 'group') { setGroupPickerFor(m.key); } else { handleUpdateVisibility(m.key, nextVis, m.version); } }}
                  title="${t('knowledge.visibility.' + vis)} → ${t('knowledge.visibility.' + nextVis)}"
                  style="background:${visBg[vis]};color:${visColor[vis]};border-color:${visColor[vis]}"
                >${t('knowledge.visibility.' + vis)} ▾</button>`;
              })()}
              <span class="shield-icon" title=${t('permissions.sharingRules')} onClick=${(e) => { e.stopPropagation(); loadKeyPerms(m.key); }}>\u{1F6E1}\uFE0F</span>
              ${fedConsents[m.key] && html`<span class="badge badge-success pf-fed-badge">${t('profile.memory.syncedToFederation')}</span>`}
            </div>
            ${groupPickerFor === m.key && html`
              <div class="agd-group-picker" onClick=${(e) => e.stopPropagation()}>
                <div class="text-caption mb-xs">${t('profile.memory.selectGroup')}</div>
                ${groups.length === 0
                  ? html`<div class="text-meta-sm">${t('profile.memory.noGroups')}</div>`
                  : groups.map(g => html`
                    <button class="btn-ghost agd-group-option" onClick=${() => {
                      handleUpdateVisibility(m.key, 'group', m.version, g.id);
                      setGroupPickerFor(null);
                    }}>${g.name} (${g.members?.length || 0} ${t('profile.access.sharingGroups.members')})</button>
                  `)
                }
                <button class="btn-outline btn-sm mt-xs" onClick=${() => { setGroupPickerFor(null); }}>${t('profile.memory.cancelBtn')}</button>
              </div>
            `}
            ${expandedMem === m.key && html`
              <div class="mem-detail">
                <pre>${typeof m.value === 'object' ? JSON.stringify(m.value, null, 2) : String(m.value || '')}</pre>
                <div class="mb-half">
                  <button class="btn-outline btn-sm" onClick=${(e) => { e.stopPropagation(); setEditingMemTags(editingMemTags === m.key ? null : m.key); }}>
                    ${t('tags.editTags') || 'Edit tags'}
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
                      <strong class="text-caption">\u{1F6E1}\uFE0F ${t('permissions.sharingRules')}</strong>
                      <button class="btn-outline btn-sm" onClick=${() => setKeyRulesPopover(null)}>\u2715</button>
                    </div>
                    <div class="text-meta-sm mb-half">Visibility: ${keyRulesPopover.visibility}</div>
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
                  <button class="btn-sm" onClick=${() => setEditModal({ key: m.key, value: typeof m.value === 'object' ? JSON.stringify(m.value, null, 2) : String(m.value || ''), visibility: m.visibility || 'private', version: m.version })}>${t('profile.memory.editBtn')}</button>
                  <button class="btn-danger" onClick=${() => handleDeleteMemory(m.key)}>${t('profile.memory.deleteBtn')}</button>
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
                </div>
              </div>
            `}
          </div>
        `)
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

    const copyFileUrls = () => {
      const urls = filtered.map(f => `${NODE_URL}/v1/memory/files/${encodeURIComponent(f.key || f.name)}`).join('\n');
      navigator.clipboard.writeText(urls).then(() => showToast(t('profile.files.urlsCopied') || `${filtered.length} URLs copied`));
    };

    return html`
      <div class="action-bar">
        <button class="btn-primary" onClick=${() => setShowFileForm(!showFileForm)}>${t('profile.files.uploadBtn')}</button>
        ${filtered.length > 0 && html`<button class="btn-outline btn-sm" onClick=${copyFileUrls} title="Copy file URLs">\u{1F4CB} ${t('profile.files.copyUrls') || 'Copy URLs'} (${filtered.length})</button>`}
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
              const nextVis = cycleVis[(cycleVis.indexOf(vis) + 1) % cycleVis.length];
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
                      <button class="kpkg-vis-pill"
                        onClick=${(e) => { e.stopPropagation(); handleUpdateFileVisibility(fKey, nextVis); }}
                        title="${t('knowledge.visibility.' + vis)} → ${t('knowledge.visibility.' + nextVis)}"
                        style="background:${visBg[vis]};color:${visColor[vis]};border-color:${visColor[vis]}"
                      >${t('knowledge.visibility.' + vis)} ▾</button>
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

  function closeBrowse() {
    setBrowseMode(null);
    setRemoteEntries(null);
    setSelectedPeer('');
  }

  const renderBrowsePanel = () => {
    if (!browseMode) return null;
    const isHome = browseMode === 'home';
    const title = isHome ? t('profile.memory.browseHome') : t('profile.memory.browseRemote');
    const desc = isHome ? t('profile.memory.browseHomeDesc') : t('profile.memory.browseRemoteDesc');

    return html`
      <div class="mem-browse-panel">
        <div class="mem-browse-header">
          <div>
            <div class="section-title">${title}</div>
            <div class="section-desc">${desc}</div>
          </div>
          <button class="btn-outline btn-sm" onClick=${closeBrowse}>${t('profile.memory.cancelBtn')}</button>
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
                    <button class="btn-primary btn-sm"
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

  return html`
    <div class="section-title">${t('profile.memory.title')}</div>
    <div class="section-desc">${t('profile.memory.desc')}</div>

    ${session.federated && html`
      <div class="alert alert-info">
        <span class="alert-msg">${t('profile.memory.federatedSession')}</span>
      </div>
      <div class="mb-1">
        <button class="btn-primary btn-sm" onClick=${loadBrowseHome}>
          ${t('profile.memory.browseHome')}
        </button>
      </div>
    `}

    ${!session.federated && html`
      <div class="mb-1">
        <button class="btn-outline btn-sm" onClick=${initBrowseRemote}>
          ${t('profile.memory.browseRemote')}
        </button>
      </div>
    `}

    ${renderBrowsePanel()}

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

    ${editModal && html`<${EditMemoryModal}
      memKey=${editModal.key}
      initialValue=${editModal.value}
      initialVisibility=${editModal.visibility}
      initialVersion=${editModal.version}
      groups=${groups}
      onSave=${(v, vis, ver, gId) => handleSaveEdit(editModal.key, v, vis, ver, gId)}
      onCancel=${() => setEditModal(null)} />`}
    <${ConfirmUI} />
  `;
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
          <option value="group">Group</option>
          <option value="public">${t('profile.memory.visPublic')}</option>
        </select>
      </div>
      ${vis === 'group' && html`
        <div class="form-row"><label>${t('profile.memory.selectGroup')}</label>
          <select class="input-field" value=${groupId} onChange=${e => setGroupId(e.target.value)}>
            <option value="">-- ${t('profile.memory.selectGroup')} --</option>
            ${(groups || []).map(g => html`<option value=${g.id}>${g.name}</option>`)}
          </select>
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

function EditMemoryModal({ memKey, initialValue, initialVisibility, initialVersion, onSave, onCancel, groups }) {
  const [value, setValue] = useState(initialValue);
  const [vis, setVis] = useState(initialVisibility || 'private');
  const [groupId, setGroupId] = useState('');
  const [showGroupSelect, setShowGroupSelect] = useState(false);
  const cycleVis = ['private', 'owner', 'group', 'public'];
  const visColor = { private: '#c084fc', owner: '#60a5fa', group: '#10b981', public: '#4ade80' };
  const visBg = { private: 'rgba(150,100,200,.2)', owner: 'rgba(100,150,255,.2)', group: 'rgba(16,185,129,.2)', public: 'rgba(0,200,100,.2)' };
  const nextVis = cycleVis[(cycleVis.indexOf(vis) + 1) % cycleVis.length];
  const handleVisCycle = () => {
    if (nextVis === 'group') {
      setShowGroupSelect(true);
    } else {
      setVis(nextVis);
      setShowGroupSelect(false);
      setGroupId('');
    }
  };
  return html`
    <div class="modal-overlay" onClick=${e => { if (e.target.className.includes('modal-overlay')) onCancel(); }}>
      <div class="modal">
        <h3>${t('profile.memory.editTitle')}: ${escHtml(memKey)}</h3>
        <div class="form-row flex-row mb-half">
          <label class="pf-label-inline">${t('profile.memory.visLabel')}</label>
          <button class="kpkg-vis-pill"
            onClick=${handleVisCycle}
            title="${t('knowledge.visibility.' + vis)} → ${t('knowledge.visibility.' + nextVis)}"
            style="background:${visBg[vis]};color:${visColor[vis]};border-color:${visColor[vis]}"
          >${t('knowledge.visibility.' + vis)} ▾</button>
        </div>
        ${showGroupSelect && html`
          <div class="form-row mb-half">
            <label>${t('profile.memory.selectGroup')}</label>
            <select class="input-field" value=${groupId} onChange=${e => {
              setGroupId(e.target.value);
              if (e.target.value) { setVis('group'); setShowGroupSelect(false); }
            }}>
              <option value="">-- ${t('profile.memory.selectGroup')} --</option>
              ${(groups || []).map(g => html`<option value=${g.id}>${g.name}</option>`)}
            </select>
            ${(groups || []).length === 0 && html`<div class="text-meta-sm">${t('profile.memory.noGroups')}</div>`}
            <button class="btn-outline btn-sm mt-xs" onClick=${() => setShowGroupSelect(false)}>${t('profile.memory.cancelBtn')}</button>
          </div>
        `}
        <textarea class="input-field" rows="6" value=${value} onInput=${e => setValue(e.target.value)}></textarea>
        <div class="form-actions mt-1">
          <button class="btn-primary" onClick=${() => onSave(value, vis, initialVersion, vis === 'group' ? groupId : undefined)}>${t('profile.save')}</button>
          <button class="btn-outline" onClick=${onCancel}>${t('profile.cancel')}</button>
        </div>
      </div>
    </div>`;
}
