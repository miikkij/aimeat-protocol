/**
 * @file public/views/profile/memory-tab/components.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Standalone sub-components for the Memory tab — public-memory discovery preview,
 *   the collection cart tray (URL list / ZIP / send-to-workspace), the create-memory form, the
 *   universal file preview modal, the drag-and-drop upload form, and the edit-memory modal.
 *   Extracted from memory-tab.js to satisfy max-file-lines. Every part is a component of the kit
 *   that gets data; the file writes no class.
 * @version-history
 *   v2.1.0 -- 2026-10-02 -- The question mark that explains a record's visibility in MemoryForm and EditMemoryModal: memory.visibility (components/HelpTip.js). MemoryForm offers "My agents" (owner) where it offered "Shared", which the write route refuses (MemoryWriteSchema has no 'shared').
 *   v2.0.1 -- 2026-09-26 -- The collection folds from a click anywhere on its head again, as on main
 *     (Group wholeHead), and a discovered value scrolls after 300px as main's .mem-discover-preview
 *     did (Code scroll="medium"; fix pass).
 *   v2.0.0 -- 2026-09-26 -- On the component kit, class-free (page group G3): the discovered value is
 *     the Code block that scrolls (it had its own grey frame, now the opened row's panel holds it);
 *     the collection is a Box with the Group heading that folds (↓/→, the waiting Count beside its
 *     name, Clear at its end), its items the List (a mark, the name with the key as its tooltip, the
 *     remove mark) and its ways the Actions, the send line under a Split; the create form and the
 *     upload form are Fields (TextField, TextArea, Select, FormActions), the upload's drop area is
 *     FileDrop and its tags the TagInput (Enter, a comma or the + adds; small letters, as before);
 *     the file preview is components/FilePreview.js; the edit dialog's visibility is the Select
 *     with its row label and its value the TextArea whose message says the JSON is broken.
 *   v1.17.0 -- 2026-09-26 -- A discovered value's preview is the Code block (css/components/code-block.css), a unification: Jouni's decision "Code block".
 *   v1.16.0 -- 2026-09-26 -- A file's tag that takes itself off is the removable tag (.tag-removable) and its ✕ the Tag's remove mark (.poster-chip-x): grey, coral while the pointer is on the tag (a unification: Jouni's decision "Remove mark").
 *   v1.15.0 -- 2026-09-26 -- A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.14.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.13.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.12.0 -- 2026-09-25 -- The collection's items are the Listing (css/components/listing.css), a unification: the look most tabs use.
 *   v1.11.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.10.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.9.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.8.0 -- 2026-09-25 -- Every small number is the Count (.poster-count waiting or tally), a unification: Jouni's decision Count.
 *   v1.7.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.6.0 -- 2026-09-25 -- The line a form says after it acted is the Form message; a refusal is its error tone (UI consolidation phase 5, a unification).
 *   v1.5.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.4.0 — 2026-09-25 — A button that is a mark, not a word (a delete or close mark, a menu's dots,
 *     an arrow), is the library's small icon button, .poster-icon.poster-icon--small (Jouni's decision
 *     "Icon button").
 *   v1.3.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.2.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
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
import { Modal } from '/components/Modal.js';
import { FilePreview } from '/components/FilePreview.js';
import { Action, Loud, Icon, Actions } from '/components/Action.js';
import { Mark, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Tinted } from '/components/Figure.js';
import { Box } from '/components/Box.js';
import { List, Row, Name, Lead, Doors, Group } from '/components/List.js';
import { Row as Line, Stack, Split } from '/components/Layout.js';
import { Fields, FormActions } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { TagInput } from '/components/TagInput.js';
import { FileDrop } from '/components/FileDrop.js';
import { fileIcon, fileCategory, fileBytesUrl, fetchFileBytes, encKeyPath } from './file-helpers.js';
import { swallowed } from '/js/swallowed.js';

/** A public value, read on the spot: the opened row's panel holds it (browse-view.js). */
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

  if (loading) return html`<${Note} kind="meta" inline>...<//>`;
  if (err) return html`<${Note} kind="meta"><${Tinted} tone="danger">${err}<//><//>`;
  const text = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value || '');
  const truncated = text.length > 2000 ? text.slice(0, 2000) + '\n...' : text;
  return html`<${Code} block scroll="medium">${truncated}<//>`;
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

  const title = t('profile.memory.cartTitle') || 'Collection';
  const removeWords = t('profile.memory.cartRemove') || 'Remove from collection';
  const sendLine = (orgs || []).length === 0
    ? html`<${Note} kind="meta">${t('profile.memory.cartNoOrgs') || 'You are not in any organism workspaces yet.'}<//>`
    : html`<${Line} wrap>
        <${Select} fit value=${sendOrg} onChange=${pickOrg} placeholder=${t('profile.memory.cartPickOrg') || 'Choose organism…'}
          options=${(orgs || []).map(o => [o.id, o.name])} />
        <${Select} fit value=${sendWs} disabled=${!sendOrg} onChange=${setSendWs} placeholder=${t('profile.memory.cartPickWs') || 'Choose workspace…'}
          options=${workspaces.map(w => [w.id, w.name || w.id])} />
        <${Loud} control disabled=${!sendWs || sending} onClick=${sendToWorkspace}>${sending ? '…' : (t('profile.memory.cartSendBtn') || 'Add as sources')}<//>
      <//>`;

  return html`
    <${Box}>
      <${Group} title=${html`🛒 ${title} <${Mark} kind="count" tone="waiting">${cart.length}<//>`}
        onFold=${() => setOpen(o => !o)} folded=${!open} foldLabel=${title} wholeHead
        doors=${html`<${Action} small onClick=${onClear}>${t('profile.memory.cartClear') || 'Clear'}<//>`}>
        <${List} cols="mark-name-doors" keepCols scroll>
          ${cart.map(it => html`
            <${Row} key=${idOf(it)}>
              <${Lead}>${it.kind === 'file' ? '📎' : '🧠'}<//>
              <${Name} title=${it.key}>${it.label || it.key}<//>
              <${Doors}><${Icon} small label=${removeWords} onClick=${() => onRemove(idOf(it))}>✕<//><//>
            <//>`)}
        <//>
        <${Actions}>
          <${Action} small copy=${urlList} onCopied=${() => showToast(t('profile.memory.cartUrlsCopied') || 'URL list copied')}>${'📋 ' + (t('profile.memory.cartCopyUrls') || 'Copy URL list')}<//>
          <${Action} small onClick=${downloadText}>⬇ ${t('profile.memory.cartDownloadTxt') || 'URL list (.txt)'}<//>
          <${Action} small disabled=${zipping} onClick=${downloadZip}>${zipping ? '…' : '⬇ ' + (t('profile.memory.cartDownloadZip') || 'Download ZIP')}<//>
          <${Action} small expanded=${sendOpen} onClick=${() => setSendOpen(s => !s)}>→ ${t('profile.memory.cartSend') || 'Send to workspace'}<//>
        <//>
        ${sendOpen ? html`<${Split}>${sendLine}<//>` : null}
      <//>
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
    ['private', t('profile.memory.visPrivate')],
    ['owner', t('knowledge.visibility.owner')],
    ['members', t('knowledge.visibility.members')],
    ['public', t('profile.memory.visPublic')],
  ];
  return html`
    <${Fields}>
      <${TextField} label=${t('profile.memory.keyLabel')} placeholder=${t('profile.memory.keyPlaceholder')} value=${key} onInput=${setKey} />
      <${TextArea} label=${t('profile.memory.valueLabel')} rows=${3} placeholder=${t('profile.memory.valuePlaceholder')} value=${value} onInput=${setValue} />
      <${Select} label=${t('profile.memory.visLabel')} help="memory.visibility" value=${vis} onChange=${setVis} options=${visOptions} />
      <${TextField} label=${t('profile.memory.tagsLabel')} placeholder=${t('profile.memory.tagsPlaceholder')} value=${tags} onInput=${setTags} />
      <${FormActions}>
        <${Loud} onClick=${() => { if (!key || !value) return; onSave(key, value, vis, tags, undefined); }}>${t('profile.memory.saveBtn')}<//>
        <${Action} small onClick=${onCancel}>${t('profile.memory.cancelBtn')}<//>
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

  return html`
    <${FilePreview} title=${fKey} kind=${cat} src=${objUrl} text=${text} loading=${loading} error=${err}
      loadingLabel=${t('profile.files.previewLoading') || 'Loading preview…'}
      errorLabel=${t('profile.files.previewError') || 'Couldn’t load this file'}
      noneLabel=${t('profile.files.noPreview') || 'No preview for this file type — download it instead'}
      onClose=${onClose}
      doors=${html`
        <${Action} onClick=${openInTab}>${t('profile.files.openInTab') || 'Open in new tab'} ↗<//>
        <${Action} onClick=${() => onDownload(file)}>${t('profile.files.download')}<//>`} />`;
}

export function FileUploadForm({ onUpload, onCancel }) {
  const [fileItems, setFileItems] = useState([]);
  const [vis, setVis] = useState('private');
  const [fileTags, setFileTags] = useState([]);
  const [uploading, setUploading] = useState(false);

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

  const handleSubmit = async () => {
    if (fileItems.length === 0 || uploading) return;
    setUploading(true);
    await onUpload(fileItems, vis, fileTags);
    setUploading(false);
  };

  const visOptions = [
    ['private', t('profile.files.visPrivate')],
    ['owner', t('profile.files.visOwner')],
    ['group', 'Group'],
    ['public', t('profile.files.visPublic')],
  ];
  return html`
    <${Fields}>
      <${FileDrop} multiple items=${fileItems} onFiles=${addFiles} onRename=${updateKey} onRemove=${removeFile}
        iconOf=${(f) => fileIcon(f.type)} />
      <${Select} label=${t('profile.files.visLabel')} value=${vis} onChange=${setVis} options=${visOptions} />
      <${TagInput} label=${t('profile.files.tagsLabel') || 'Tags'} lowercase adder whole tags=${fileTags} onChange=${setFileTags}
        placeholder=${t('profile.files.tagsPlaceholder') || 'Add tag and press Enter'} />
      <${FormActions}>
        <${Loud} control disabled=${fileItems.length === 0 || uploading} onClick=${handleSubmit}>
          ${uploading ? '...' : fileItems.length > 1 ? `${t('profile.files.uploadSaveBtn')} (${fileItems.length})` : t('profile.files.uploadSaveBtn')}
        <//>
        <${Action} small onClick=${onCancel}>${t('profile.files.cancelBtn')}<//>
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

  // Same as the create form: a group is an audience, not a visibility. Sharing a key space with one
  // is done from the row's share panel or the Access tab.
  const visOptions = ['private', 'owner', 'members', 'public'].map(v => [v, t('knowledge.visibility.' + v)]);
  // The value's field keeps its label, so it stays one field (and keeps the focus) while its message
  // about broken JSON comes and goes.
  return html`
    <${Modal} open=${true} onClose=${onCancel} title=${`${t('profile.memory.editTitle')}: ${memKey}`} size="lg"
      footer=${html`
        <${Action} onClick=${onCancel}>${t('profile.cancel')}<//>
        <${Loud} control disabled=${!canSave} onClick=${() => onSave(value, vis, initialVersion, undefined)}>${t('profile.save')}<//>`}>
      <${Stack}>
        <${Select} label=${t('profile.memory.visLabel')} help="memory.visibility" fit value=${vis} onChange=${setVis} options=${visOptions} />
        <${TextArea} label=${t('profile.memory.valueLabel')} rows=${14} value=${value} onInput=${setValue}
          message=${jsonError ? { text: `${t('profile.memory.invalidJson')} — ${jsonError}`, error: true } : null} />
      <//>
    <//>`;
}
