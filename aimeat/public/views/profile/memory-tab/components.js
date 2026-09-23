/**
 * @file public/views/profile/memory-tab/components.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Standalone sub-components for the Memory tab — public-memory discovery preview,
 *   the collection cart tray (URL list / ZIP / send-to-workspace), the create-memory form, the
 *   universal file preview modal, the drag-and-drop upload form, and the edit-memory modal.
 *   Extracted from memory-tab.js to satisfy max-file-lines.
 * @version-history
 *   2026-09-22 -- Composed from the shared component set: the forms are Fields and Actions, the
 *     dialogs are Dialog, the collection is ListRows, the drop zone is the dashed aside. The emoji
 *     (cart, clip, brain, clipboard, arrows) are gone. PDF, video and audio previews keep their
 *     profile.css sizing classes: the set has no media part yet.
 *   2026-09-13 -- V2w: compose remaining profile section top rules from poster.css.
 *   v1.1.1 — 2026-09-13 — The file preview (extra large) and the edit dialog (large) keep their actions
 *     in the footer.
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
import { ImageView } from '/components/ImageDeliverable.js';
import { Dialog, ListRow, Action, CopyAction, Field, Surface, Text, Stack } from '/components/poster-parts.js';
import { fileCategory, fileBytesUrl, fetchFileBytes, encKeyPath } from './file-helpers.js';
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

  if (loading) return html`<${Text} kind="caption" tone="muted">...<//>`;
  if (err) return html`<${Text} kind="caption" tone="danger">${err}<//>`;
  const text = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value || '');
  const truncated = text.length > 2000 ? text.slice(0, 2000) + '\n...' : text;
  return html`<${Surface} kind="code">${truncated}<//>`;
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

  return html`<${Stack}>
    <${Stack} direction="horizontal" align="between">
      <${Action} kind="text" expanded=${open} onClick=${() => setOpen(o => !o)}>${t('profile.memory.cartTitle') || 'Collection'} ${cart.length}<//>
      <${Action} onClick=${onClear}>${t('profile.memory.cartClear') || 'Clear'}<//>
    <//>
    ${open && html`
      <${Stack} density="compact">${cart.map(it => html`
        <${ListRow} key=${idOf(it)} density="compact" name=${it.label || it.key} detail=${it.key}
          actions=${html`<${Action} kind="text" onClick=${() => onRemove(idOf(it))}>${t('profile.memory.cartRemove') || 'Remove from collection'}<//>`} />`)}<//>
      <${Stack} direction="wrap" align="center">
        <${CopyAction} text=${urlList} label=${t('profile.memory.cartCopyUrls') || 'Copy URL list'} onCopied=${() => showToast(t('profile.memory.cartUrlsCopied') || 'URL list copied')} />
        <${Action} onClick=${downloadText}>${t('profile.memory.cartDownloadTxt') || 'URL list (.txt)'}<//>
        <${Action} disabled=${zipping} onClick=${downloadZip}>${zipping ? '…' : (t('profile.memory.cartDownloadZip') || 'Download ZIP')}<//>
        <${Action} expanded=${sendOpen} onClick=${() => setSendOpen(s => !s)}>→ ${t('profile.memory.cartSend') || 'Send to workspace'}<//>
      <//>
      ${sendOpen && html`<${Surface} kind="box" density="compact">
        ${(orgs || []).length === 0
          ? html`<${Text} kind="caption" tone="muted">${t('profile.memory.cartNoOrgs') || 'You are not in any organism workspaces yet.'}<//>`
          : html`<${Stack} direction="wrap" align="end">
            <${Field} type="select" value=${sendOrg} onChange=${e => pickOrg(e.target.value)}
              options=${[{ value: '', label: t('profile.memory.cartPickOrg') || 'Choose organism…' }, ...(orgs || []).map(o => ({ value: o.id, label: o.name }))]} />
            <${Field} type="select" value=${sendWs} disabled=${!sendOrg} onChange=${e => setSendWs(e.target.value)}
              options=${[{ value: '', label: t('profile.memory.cartPickWs') || 'Choose workspace…' }, ...workspaces.map(w => ({ value: w.id, label: w.name || w.id }))]} />
            <${Action} kind="primary" disabled=${!sendWs || sending} onClick=${sendToWorkspace}>${sending ? '…' : (t('profile.memory.cartSendBtn') || 'Add as sources')}<//>
          <//>`}
      <//>`}`}
  <//>`;
}

export function MemoryForm({ onSave, onCancel }) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [vis, setVis] = useState('private');
  const [tags, setTags] = useState('');
  // No "group" option: a group is an audience, not a visibility. Create the record with the
  // visibility it should have for everyone else, then share the key space with a group from the
  // row or from Access — one share covers the keys written after it.
  const visOptions = [
    { value: 'private', label: t('profile.memory.visPrivate') },
    { value: 'shared', label: t('profile.memory.visShared') },
    { value: 'members', label: t('knowledge.visibility.members') },
    { value: 'public', label: t('profile.memory.visPublic') },
  ];
  return html`<${Stack}>
    <${Field} label=${t('profile.memory.keyLabel')} placeholder=${t('profile.memory.keyPlaceholder')} value=${key} onInput=${e => setKey(e.target.value)} />
    <${Field} type="textarea" rows=${3} label=${t('profile.memory.valueLabel')} placeholder=${t('profile.memory.valuePlaceholder')} value=${value} onInput=${e => setValue(e.target.value)} />
    <${Field} type="select" label=${t('profile.memory.visLabel')} value=${vis} onChange=${e => setVis(e.target.value)} options=${visOptions} />
    <${Field} label=${t('profile.memory.tagsLabel')} placeholder=${t('profile.memory.tagsPlaceholder')} value=${tags} onInput=${e => setTags(e.target.value)} />
    <${Stack} direction="wrap" align="center">
      <${Action} onClick=${() => { if (!key || !value) return; onSave(key, value, vis, tags, undefined); }}>${t('profile.memory.saveBtn')}<//>
      <${Action} onClick=${onCancel}>${t('profile.memory.cancelBtn')}<//>
    <//>
  <//>`;
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

  const status = (text) => html`<${Text} tone="muted">${text}<//>`;
  return html`
    <${Dialog} open=${true} onClose=${onClose} title=${fKey} size="large" guard=${false}
      actions=${html`
        <${Action} onClick=${openInTab}>${t('profile.files.openInTab') || 'Open in new tab'} →<//>
        <${Action} onClick=${() => onDownload(file)}>${t('profile.files.download')}<//>`}>
      ${loading && status(t('profile.files.previewLoading') || 'Loading preview…')}
      ${err && status(t('profile.files.previewError') || 'Couldn’t load this file')}
      ${!loading && !err && cat === 'image' && objUrl && html`<${ImageView} desc=${{ url: objUrl, alt: fKey }} />`}
      ${/* A PDF frame, a video and an audio player need a size the set has no part for yet
            (reported as a missing part); they keep their profile.css classes until it exists. */''}
      ${!loading && !err && cat === 'pdf' && objUrl && html`<iframe class="pf-file-preview-frame" src=${objUrl} title=${fKey}></iframe>`}
      ${!loading && !err && cat === 'video' && objUrl && html`<video class="pf-file-preview-media" src=${objUrl} controls></video>`}
      ${!loading && !err && cat === 'audio' && objUrl && html`<audio class="pf-file-preview-media" src=${objUrl} controls></audio>`}
      ${!loading && !err && cat === 'text' && text !== null && html`<${Surface} kind="code">${text}<//>`}
      ${!loading && !err && cat === 'other' && status(t('profile.files.noPreview') || 'No preview for this file type — download it instead')}
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

  return html`<${Stack}>
    ${/* The drop target is the dashed aside; it turns to the sun while a file is held over it. */''}
    <div onDragOver=${(e) => { e.preventDefault(); setDragover(true); }} onDragLeave=${() => setDragover(false)} onDrop=${handleDrop}>
      <${Surface} kind="aside" tone=${dragover ? 'sun' : 'plain'} onClick=${() => fileRef.current?.click()}>
        <input type="file" multiple ref=${fileRef} hidden
          onChange=${e => { addFiles(Array.from(e.target.files || [])); e.target.value = ''; }} />
        <${Stack} density="compact" align="center">
          <${Text}>${t('profile.files.dropHere')}<//>
          <${Text} kind="caption" tone="muted">${t('profile.files.orClick')}<//>
        <//>
      <//>
    </div>
    ${fileItems.length > 0 && html`<${Stack} density="compact">
      ${fileItems.map((item, idx) => html`
        <${Stack} key=${item.file.name + item.file.size} direction="horizontal" align="end">
          <${Field} value=${item.key} onInput=${e => updateKey(idx, e.target.value)} />
          <${Text} kind="mono" tone="muted">${Math.round(item.file.size / 1024)} KB<//>
          <${Action} kind="text" label=${t('profile.files.cancelBtn')} onClick=${() => removeFile(idx)}>✗<//>
        <//>`)}
    <//>`}
    <${Field} type="select" label=${t('profile.files.visLabel')} value=${vis} onChange=${e => setVis(e.target.value)}
      options=${[{ value: 'private', label: t('profile.files.visPrivate') }, { value: 'owner', label: t('profile.files.visOwner') }, { value: 'group', label: 'Group' }, { value: 'public', label: t('profile.files.visPublic') }]} />
    <${Stack} direction="wrap" align="end">
      <${Field} label=${t('profile.files.tagsLabel') || 'Tags'} placeholder=${t('profile.files.tagsPlaceholder') || 'Add tag and press Enter'}
        value=${tagInput} onInput=${e => setTagInput(e.target.value)}
        onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} />
      <${Action} onClick=${addTag}>+<//>
    <//>
    ${fileTags.length > 0 && html`<${Stack} direction="wrap" density="compact">
      ${fileTags.map(tag => html`<${Action} key=${tag} kind="tab" selected=${true} onClick=${() => removeTag(tag)}>${tag} ✗<//>`)}
    <//>`}
    <${Stack} direction="wrap" align="center">
      <${Action} disabled=${fileItems.length === 0 || uploading} onClick=${handleSubmit}>
        ${uploading ? '...' : fileItems.length > 1 ? `${t('profile.files.uploadSaveBtn')} (${fileItems.length})` : t('profile.files.uploadSaveBtn')}
      <//>
      <${Action} onClick=${onCancel}>${t('profile.files.cancelBtn')}<//>
    <//>
  <//>`;
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
    <${Dialog} open=${true} onClose=${onCancel} title=${`${t('profile.memory.editTitle')}: ${memKey}`} size="large"
      actions=${html`
        <${Action} onClick=${onCancel}>${t('profile.cancel')}<//>
        <${Action} kind="primary" disabled=${!canSave}
          onClick=${() => onSave(value, vis, initialVersion, undefined)}>${t('profile.save')}<//>`}>
      <${Stack}>
        ${/* Same as the create form: a group is an audience, not a visibility. Sharing a key
              space with one is done from the row's share panel or the Access tab. */''}
        <${Field} type="select" label=${t('profile.memory.visLabel')} value=${vis} onChange=${e => setVis(e.target.value)}
          options=${['private', 'owner', 'members', 'public'].map(v => ({ value: v, label: t('knowledge.visibility.' + v) }))} />
        <${Field} type="textarea" rows=${14} value=${value} onInput=${e => setValue(e.target.value)}
          error=${jsonError ? `${t('profile.memory.invalidJson')} — ${jsonError}` : undefined} />
      <//>
    <//>`;
}
