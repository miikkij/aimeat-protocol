/**
 * @file memory-tab.js
 * @description Profile tab for memory entries and file management — CRUD, search,
 *   visibility cycling, tag editing, sharing rules, and file upload with drag-and-drop.
 * @version-history
 *   v1.0.0 — 2026-03-17 — Refactor: replace inline styles with CSS utility classes
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Spinner, recipientBadge, VisibilityPill } from './shared.js';
import * as memoryService from '/js/services/memory.js';
import { listAgents } from '/js/services/agents.js';
import { getKeyPermissions } from '/js/services/consent.js';
import { getNodeUrl } from '/js/services/auth.js';
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

  useEffect(() => {
    if (session) { loadAgents(); loadMemories(); loadFiles(); }
  }, [session]);

  useEffect(() => {
    if (session) { loadMemories(); }
  }, [selectedAgent]);

  // Live update listener
  const liveRef = useRef(loadMemories);
  liveRef.current = loadMemories;
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

  async function handleCreateMemory(key, value, visibility, tags) {
    const resp = await memoryService.createMemory(key, value, visibility, tags);
    if (resp.ok !== false) { showToast(t('profile.memory.saved')); setShowMemForm(false); loadMemories(); }
    else showToast(t('profile.memory.saveFailed'), true);
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

  async function handleSaveEdit(key, value, visibility, version) {
    const resp = await memoryService.updateMemoryFull(key, { value, visibility, version });
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
        const resp = await memoryService.uploadFile(item.key, base64, item.file.type || 'application/octet-stream', visibility, tags);
        if (resp.ok !== false) ok++; else fail++;
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

  /* ── Cycle visibility: private → owner → public → private ── */
  const cycleVis = ['private', 'owner', 'public'];
  const visColor = { private: '#c084fc', owner: '#60a5fa', public: '#4ade80' };
  const visBg = { private: 'rgba(150,100,200,.2)', owner: 'rgba(100,150,255,.2)', public: 'rgba(0,200,100,.2)' };

  async function handleUpdateVisibility(key, newVis, version) {
    const resp = await memoryService.updateMemoryVisibility(key, newVis, version);
    if (resp.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
    loadMemories();
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
      ${showMemForm && html`<${MemoryForm} onSave=${handleCreateMemory} onCancel=${() => setShowMemForm(false)} />`}
      ${filtered.length === 0
        ? html`<div class="empty">${memories.length > 0 ? (t('tags.noMatch') || 'No items match selected tags') : t('profile.memory.empty')}</div>`
        : filtered.map(m => html`
          <div>
            <div class="mem-item" onClick=${() => setExpandedMem(expandedMem === m.key ? null : m.key)}>
              <span class="mem-key">${escHtml(m.key)}</span>
              ${(() => {
                const vis = m.visibility || 'private';
                const nextVis = cycleVis[(cycleVis.indexOf(vis) + 1) % 3];
                return html`<button class="kpkg-vis-pill"
                  onClick=${(e) => { e.stopPropagation(); handleUpdateVisibility(m.key, nextVis, m.version); }}
                  title="${t('knowledge.visibility.' + vis)} → ${t('knowledge.visibility.' + nextVis)}"
                  style="background:${visBg[vis]};color:${visColor[vis]};border-color:${visColor[vis]}"
                >${t('knowledge.visibility.' + vis)} ▾</button>`;
              })()}
              <span class="shield-icon" title=${t('permissions.sharingRules')} onClick=${(e) => { e.stopPropagation(); loadKeyPerms(m.key); }}>\u{1F6E1}\uFE0F</span>
            </div>
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
              const icon = f.mime_type?.startsWith('image') ? '\u{1F5BC}\uFE0F' : f.mime_type?.includes('pdf') ? '\u{1F4C4}' : '\u{1F4CE}';
              return html`
                <div class="file-card">
                  <div class="file-icon">${icon}</div>
                  <div class="file-info">
                    <div class="file-name">${escHtml(f.key || f.name)}</div>
                    <div class="file-meta">${f.size ? Math.round(f.size / 1024) + ' KB' : ''} \u2502 ${f.visibility || 'private'}</div>
                    ${editingFileTags === (f.key || f.name)
                      ? html`<${TagEditor} tags=${f.tags || []} onSave=${(tags) => handleUpdateFileTags(f.key || f.name, tags)} />`
                      : html`
                        ${f.tags?.length > 0 && html`<div class="file-tags">${f.tags.map(tag => html`<span class="file-tag" key=${tag}>${escHtml(tag)}</span>`)}</div>`}
                        <button class="btn-outline btn-sm mt-xs" onClick=${() => setEditingFileTags(f.key || f.name)}>
                          ${t('tags.editTags') || 'Edit tags'}
                        </button>
                      `}
                  </div>
                  <div class="file-actions">
                    <a class="btn-sm pf-no-underline" href="${NODE_URL}/v1/memory/files/${encodeURIComponent(f.key || f.name)}" target="_blank">${t('profile.files.download')}</a>
                    <button class="btn-danger" onClick=${() => handleDeleteFile(f.key || f.name)}>${t('profile.files.delete')}</button>
                  </div>
                </div>`;
            })}
          </div>`
      }`;
  };

  return html`
    <div class="section-title">${t('profile.memory.title')}</div>
    <div class="section-desc">${t('profile.memory.desc')}</div>

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
      onSave=${(v, vis, ver) => handleSaveEdit(editModal.key, v, vis, ver)}
      onCancel=${() => setEditModal(null)} />`}
    <${ConfirmUI} />
  `;
}

function MemoryForm({ onSave, onCancel }) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [vis, setVis] = useState('private');
  const [tags, setTags] = useState('');
  return html`
    <div class="create-form">
      <div class="form-row"><label>${t('profile.memory.keyLabel')}</label><input class="input-field" placeholder=${t('profile.memory.keyPlaceholder')} value=${key} onInput=${e => setKey(e.target.value)} /></div>
      <div class="form-row"><label>${t('profile.memory.valueLabel')}</label><textarea class="input-field" rows="3" placeholder=${t('profile.memory.valuePlaceholder')} value=${value} onInput=${e => setValue(e.target.value)}></textarea></div>
      <div class="form-row"><label>${t('profile.memory.visLabel')}</label>
        <select class="input-field" value=${vis} onChange=${e => setVis(e.target.value)}>
          <option value="private">${t('profile.memory.visPrivate')}</option>
          <option value="shared">${t('profile.memory.visShared')}</option>
          <option value="public">${t('profile.memory.visPublic')}</option>
        </select>
      </div>
      <div class="form-row"><label>${t('profile.memory.tagsLabel')}</label><input class="input-field" placeholder=${t('profile.memory.tagsPlaceholder')} value=${tags} onInput=${e => setTags(e.target.value)} /></div>
      <div class="form-actions">
        <button class="btn-primary" onClick=${() => { if (!key || !value) return; onSave(key, value, vis, tags); }}>${t('profile.memory.saveBtn')}</button>
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

function EditMemoryModal({ memKey, initialValue, initialVisibility, initialVersion, onSave, onCancel }) {
  const [value, setValue] = useState(initialValue);
  const [vis, setVis] = useState(initialVisibility || 'private');
  const cycleVis = ['private', 'owner', 'public'];
  const visColor = { private: '#c084fc', owner: '#60a5fa', public: '#4ade80' };
  const visBg = { private: 'rgba(150,100,200,.2)', owner: 'rgba(100,150,255,.2)', public: 'rgba(0,200,100,.2)' };
  const nextVis = cycleVis[(cycleVis.indexOf(vis) + 1) % 3];
  return html`
    <div class="modal-overlay" onClick=${e => { if (e.target.className.includes('modal-overlay')) onCancel(); }}>
      <div class="modal">
        <h3>${t('profile.memory.editTitle')}: ${escHtml(memKey)}</h3>
        <div class="form-row flex-row mb-half">
          <label class="pf-label-inline">${t('profile.memory.visLabel')}</label>
          <button class="kpkg-vis-pill"
            onClick=${() => setVis(nextVis)}
            title="${t('knowledge.visibility.' + vis)} → ${t('knowledge.visibility.' + nextVis)}"
            style="background:${visBg[vis]};color:${visColor[vis]};border-color:${visColor[vis]}"
          >${t('knowledge.visibility.' + vis)} ▾</button>
        </div>
        <textarea class="input-field" rows="6" value=${value} onInput=${e => setValue(e.target.value)}></textarea>
        <div class="form-actions mt-1">
          <button class="btn-primary" onClick=${() => onSave(value, vis, initialVersion)}>${t('profile.save')}</button>
          <button class="btn-outline" onClick=${onCancel}>${t('profile.cancel')}</button>
        </div>
      </div>
    </div>`;
}
