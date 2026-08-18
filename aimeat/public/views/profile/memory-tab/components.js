/**
 * @file public/views/profile/memory-tab/components.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Standalone sub-components for the Memory tab — public-memory discovery preview,
 *   the collection cart tray (URL list / ZIP / send-to-workspace), the create-memory form, the
 *   universal file preview modal, the drag-and-drop upload form, and the edit-memory modal.
 *   Extracted from memory-tab.js to satisfy max-file-lines.
 * @version-history
 *   v1.1.0 — 2026-08-11 — The create form and the edit modal no longer offer "group" as a
 *     visibility, and their group pickers are gone with it. A group is an audience, not a tier:
 *     give the record the visibility it has for everyone else, then share the key space.
 *   v1.0.0 — 2026-07-13 — Extracted from public/views/profile/memory-tab.js (max-file-lines)
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import * as memoryService from '/js/services/memory.js';
import { getNodeUrl } from '/js/services/auth.js';
import { listWorkspaces, getWorkspaceSources, saveWorkspaceSources } from '/js/services/organisms.js';
import { Modal } from '/components/Modal.js';
import { CopyButton } from '/components/CopyButton.js';
import { fileIcon, fileCategory, fileBytesUrl, fetchFileBytes, encKeyPath } from './file-helpers.js';
import { swallowed } from '/js/swallowed.js';

export function DiscoverPreview({ ownerGaii, memKey }) {
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

// Collection cart tray — lists gathered memory entries + files and exports them three ways:
// a copyable/downloadable URL list, a ZIP bundle (POST /v1/memory/bundle), or attaching them as
// pointer Sources on an organism workspace (reusing the Sources model — nothing is copied there).
export function CartTray({ cart, nodeUrl, orgs, onRemove, onClear, showToast }) {
  const [open, setOpen] = useState(true);
  const [zipping, setZipping] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendOrg, setSendOrg] = useState('');
  const [sendWs, setSendWs] = useState('');
  const [workspaces, setWorkspaces] = useState([]);
  const [sending, setSending] = useState(false);

  const idOf = (it) => `${it.kind}:${it.ownerGaii || ''}:${it.key}`;
  const urlOf = (it) => it.kind === 'file'
    ? `${nodeUrl}/v1/pub/${encodeURIComponent(it.ownerGaii)}/${encKeyPath(it.key)}`
    : `${nodeUrl}/v1/memory/${encodeURIComponent(it.ownerGaii)}/${encodeURIComponent(it.key)}`;
  const urlList = cart.map(urlOf).join('\n');

  const downloadBlob = (blob, name) => {
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(u);
  };
  const downloadText = () => downloadBlob(new Blob([urlList], { type: 'text/plain' }), 'aimeat-collection-urls.txt');
  const downloadZip = async () => {
    setZipping(true);
    try {
      const blob = await memoryService.bundleCollection(cart.map(it => ({ kind: it.kind, key: it.key, owner_gaii: it.ownerGaii })));
      downloadBlob(blob, 'aimeat-collection.zip');
      showToast(t('profile.memory.cartZipDone') || 'Collection downloaded');
    } catch (e) {
      showToast((t('profile.memory.cartZipError') || 'Bundle failed') + (e.message ? ': ' + e.message : ''), true);
    } finally { setZipping(false); }
  };

  const pickOrg = async (orgId) => {
    setSendOrg(orgId); setSendWs(''); setWorkspaces([]);
    if (!orgId) return;
    try { setWorkspaces(await listWorkspaces(orgId)); } catch (err) { swallowed('components', err); setWorkspaces([]); }
  };
  // Cart item → workspace Source pointer (files are type 'storage'; see sources-panel.js).
  const sourceOf = (it) => it.kind === 'file'
    ? { type: 'storage', key: it.key, ownerGaii: it.ownerGaii, label: it.label || it.key, mime: it.mime, external: false }
    : { type: 'memory', key: it.key, ownerGaii: it.ownerGaii, label: it.label || it.key, external: false };
  const srcKeyOf = (s) => `${s.type}:${s.ownerGaii || ''}|${s.key || ''}`;
  const sendToWorkspace = async () => {
    if (!sendOrg || !sendWs) return;
    setSending(true);
    try {
      const existing = await getWorkspaceSources(sendOrg, sendWs);
      const have = new Set(existing.map(srcKeyOf));
      const additions = [];
      for (const it of cart) {
        const src = sourceOf(it);
        if (have.has(srcKeyOf(src))) continue;
        have.add(srcKeyOf(src));
        additions.push({ id: 's-' + Math.random().toString(36).slice(2, 9), addedAt: new Date().toISOString(), ...src });
      }
      if (additions.length === 0) { showToast(t('profile.memory.cartSourcesExist') || 'All items already attached to that workspace'); return; }
      const r = await saveWorkspaceSources(sendOrg, sendWs, [...existing, ...additions]);
      if (r?.ok === false) { showToast(r.error?.message || t('profile.error'), true); return; }
      showToast((t('profile.memory.cartSourcesAdded') || 'Added {n} sources to the workspace').replace('{n}', String(additions.length)));
      setSendOpen(false);
    } catch (e) { showToast(e.message || t('profile.error'), true); }
    finally { setSending(false); }
  };

  return html`
    <div class="mem-cart">
      <div class="mem-cart-head" role="button" tabindex="0" onClick=${() => setOpen(o => !o)}>
        <span class="mem-cart-title">🛒 ${t('profile.memory.cartTitle') || 'Collection'} <span class="mem-cart-count">${cart.length}</span></span>
        <span class="mem-cart-head-actions">
          <span class="pf-chevron ${open ? 'pf-chevron-open' : ''}">▼</span>
          <button class="btn-ghost btn-sm" onClick=${(e) => { e.stopPropagation(); onClear(); }}>${t('profile.memory.cartClear') || 'Clear'}</button>
        </span>
      </div>
      ${open && html`
        <div class="mem-cart-body">
          <div class="mem-cart-list">
            ${cart.map(it => html`
              <div class="mem-cart-item" key=${idOf(it)}>
                <span class="mem-cart-item-icon">${it.kind === 'file' ? '📎' : '🧠'}</span>
                <span class="mem-cart-item-label" title=${it.key}>${it.label || it.key}</span>
                <button class="pj-icon-btn" title=${t('profile.memory.cartRemove') || 'Remove from collection'} onClick=${() => onRemove(idOf(it))}>✕</button>
              </div>`)}
          </div>
          <div class="mem-cart-actions">
            <${CopyButton} text=${urlList} label=${'📋 ' + (t('profile.memory.cartCopyUrls') || 'Copy URL list')}
              className="btn-outline btn-sm" onCopied=${() => showToast(t('profile.memory.cartUrlsCopied') || 'URL list copied')} />
            <button class="btn-outline btn-sm" onClick=${downloadText}>⬇ ${t('profile.memory.cartDownloadTxt') || 'URL list (.txt)'}</button>
            <button class="btn-outline btn-sm" disabled=${zipping} onClick=${downloadZip}>${zipping ? '…' : '⬇ ' + (t('profile.memory.cartDownloadZip') || 'Download ZIP')}</button>
            <button class="btn-outline btn-sm" onClick=${() => setSendOpen(s => !s)}>→ ${t('profile.memory.cartSend') || 'Send to workspace'}</button>
          </div>
          ${sendOpen && html`
            <div class="mem-cart-send">
              ${(orgs || []).length === 0
                ? html`<span class="text-meta-sm">${t('profile.memory.cartNoOrgs') || 'You are not in any organism workspaces yet.'}</span>`
                : html`
                  <select class="input-field mem-vis-select" value=${sendOrg} onChange=${e => pickOrg(e.target.value)}>
                    <option value="">${t('profile.memory.cartPickOrg') || 'Choose organism…'}</option>
                    ${(orgs || []).map(o => html`<option key=${o.id} value=${o.id}>${o.name}</option>`)}
                  </select>
                  <select class="input-field mem-vis-select" value=${sendWs} disabled=${!sendOrg} onChange=${e => setSendWs(e.target.value)}>
                    <option value="">${t('profile.memory.cartPickWs') || 'Choose workspace…'}</option>
                    ${workspaces.map(w => html`<option key=${w.id} value=${w.id}>${w.name || w.id}</option>`)}
                  </select>
                  <button class="btn-primary btn-sm" disabled=${!sendWs || sending} onClick=${sendToWorkspace}>${sending ? '…' : (t('profile.memory.cartSendBtn') || 'Add as sources')}</button>`}
            </div>`}
        </div>`}
    </div>`;
}

export function MemoryForm({ onSave, onCancel }) {
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
          ${/* No "group" option: a group is an audience, not a visibility. Create the record with
                the visibility it should have for everyone else, then share the key space with a
                group from the row or from Access — one share covers the keys written after it. */''}
          <option value="private">${t('profile.memory.visPrivate')}</option>
          <option value="shared">${t('profile.memory.visShared')}</option>
          <option value="members">${t('knowledge.visibility.members')}</option>
          <option value="public">${t('profile.memory.visPublic')}</option>
        </select>
      </div>
      <div class="form-row"><label>${t('profile.memory.tagsLabel')}</label><input class="input-field" placeholder=${t('profile.memory.tagsPlaceholder')} value=${tags} onInput=${e => setTags(e.target.value)} /></div>
      <div class="form-actions">
        <button class="btn-primary" onClick=${() => { if (!key || !value) return; onSave(key, value, vis, tags, undefined); }}>${t('profile.memory.saveBtn')}</button>
        <button class="btn-outline" onClick=${onCancel}>${t('profile.memory.cancelBtn')}</button>
      </div>
    </div>`;
}

// In-browser file preview lightbox. Blob-fetches the bytes (so PRIVATE files preview too) and
// renders the right element by category. "Open in new tab" uses the shareable /v1/pub URL for
// public files and a transient object URL for private ones (bare tab navigation can't send the JWT).
export function FilePreviewModal({ file, nodeUrl, onClose, onDownload, showToast }) {
  const fKey = file.key || file.name;
  const cat = fileCategory(file.mime_type, fKey);
  const [objUrl, setObjUrl] = useState(null);
  const [text, setText] = useState(null);
  const [err, setErr] = useState(false);
  const [loading, setLoading] = useState(cat !== 'other');
  const urlRef = useRef(null);

  useEffect(() => {
    if (cat === 'other') { setLoading(false); return; }
    let cancelled = false;
    setLoading(true); setErr(false); setObjUrl(null); setText(null);
    fetchFileBytes(file, nodeUrl)
      .then(async (blob) => {
        if (cancelled) return;
        if (cat === 'text') {
          const txt = await blob.text();
          if (!cancelled) setText(txt.length > 200_000 ? txt.slice(0, 200_000) + '\n…' : txt);
        } else {
          const u = URL.createObjectURL(blob);
          if (cancelled) { URL.revokeObjectURL(u); return; }
          urlRef.current = u;
          setObjUrl(u);
        }
      })
      .catch(() => { if (!cancelled) setErr(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    };
  }, [file, nodeUrl, cat]);

  // Public files → the shareable /v1/pub URL directly (bare tab nav, no JWT needed). Private / own
  // files → a fresh, transient object URL (revoked after a minute so the new tab has time to load;
  // the modal owns its own objUrl separately, so this one is independent).
  const openInTab = async () => {
    if (file.visibility === 'public' && file.owner_gaii) {
      window.open(fileBytesUrl(file, nodeUrl), '_blank', 'noopener');
      return;
    }
    try {
      const blob = await fetchFileBytes(file, nodeUrl);
      const u = URL.createObjectURL(blob);
      window.open(u, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(u), 60_000);
    } catch (err) { swallowed('components', err); showToast(t('profile.files.previewError') || 'Couldn’t load this file', true); }
  };

  return html`
    <${Modal} open=${true} onClose=${onClose} title=${fKey} className="pf-file-preview-modal">
      <div class="pf-file-preview-body">
        ${loading && html`<div class="pf-file-preview-status">${t('profile.files.previewLoading') || 'Loading preview…'}</div>`}
        ${err && html`<div class="pf-file-preview-status">${t('profile.files.previewError') || 'Couldn’t load this file'}</div>`}
        ${!loading && !err && cat === 'image' && objUrl && html`<img class="pf-file-preview-img" src=${objUrl} alt=${fKey} />`}
        ${!loading && !err && cat === 'pdf' && objUrl && html`<iframe class="pf-file-preview-frame" src=${objUrl} title=${fKey}></iframe>`}
        ${!loading && !err && cat === 'video' && objUrl && html`<video class="pf-file-preview-media" src=${objUrl} controls></video>`}
        ${!loading && !err && cat === 'audio' && objUrl && html`<audio class="pf-file-preview-media" src=${objUrl} controls></audio>`}
        ${!loading && !err && cat === 'text' && text !== null && html`<pre class="pf-file-preview-text">${text}</pre>`}
        ${!loading && !err && cat === 'other' && html`<div class="pf-file-preview-status">${t('profile.files.noPreview') || 'No preview for this file type — download it instead'}</div>`}
      </div>
      <div class="pf-file-preview-actions">
        <button class="btn-outline btn-sm" onClick=${openInTab}>${'↗'} ${t('profile.files.openInTab') || 'Open in new tab'}</button>
        <button class="btn-outline btn-sm" onClick=${() => onDownload(file)}>${t('profile.files.download')}</button>
      </div>
    <//>`;
}

export function FileUploadForm({ onUpload, onCancel }) {
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
            <span class="pf-upload-icon">\u{2B06}️</span>
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
              <button class="btn-outline btn-sm pf-shrink-0" onClick=${() => removeFile(idx)}>✕</button>
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
                ${tag} ✕
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

export function EditMemoryModal({ memKey, initialValue, initialVisibility, initialVersion, isJson, onSave, onCancel }) {
  const [value, setValue] = useState(initialValue);
  const [vis, setVis] = useState(initialVisibility || 'private');

  // Broken JSON in a memory key crashes the agent that reads it — validate before save.
  // Validation applies when the stored value was an object, or the draft clearly is one.
  const looksJson = isJson || /^[[{]/.test(String(value || '').trim());
  let jsonError = null;
  if (looksJson) {
    try { JSON.parse(value); } catch (e) { jsonError = e.message; }
  }
  const canSave = !jsonError;

  return html`
    <${Modal} open=${true} onClose=${onCancel} title=${`${t('profile.memory.editTitle')}: ${memKey}`}>
        <div class="form-row flex-row mb-half">
          <label class="pf-label-inline">${t('profile.memory.visLabel')}</label>
          ${/* Same as the create form: a group is an audience, not a visibility. Sharing a key
                space with one is done from the row's share panel or the Access tab. */''}
          <select class="input-field mem-vis-select" value=${vis} onChange=${e => setVis(e.target.value)}>
            ${['private', 'owner', 'members', 'public'].map(v => html`<option key=${v} value=${v}>${t('knowledge.visibility.' + v)}</option>`)}
          </select>
        </div>
        <textarea class="input-field mem-edit-textarea ${jsonError ? 'mem-edit-textarea--error' : ''}" rows="14"
          value=${value} onInput=${e => setValue(e.target.value)}></textarea>
        ${jsonError && html`<div class="mem-json-error">${t('profile.memory.invalidJson')} — ${jsonError}</div>`}
        <div class="form-actions mt-1">
          <button class="btn-primary" disabled=${!canSave}
            onClick=${() => onSave(value, vis, initialVersion, undefined)}>${t('profile.save')}</button>
          <button class="btn-outline" onClick=${onCancel}>${t('profile.cancel')}</button>
        </div>
    <//>`;
}
