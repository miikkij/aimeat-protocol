/**
 * @file public/views/profile/memory-tab/files-view.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Renderer for the Memory tab "files" sub-tab — upload button, copy-all URLs, name/tag/
 *   type search, tag cloud, and the file card grid with thumbnail/preview, visibility select, tag
 *   editing, cart toggle, per-file copy-URL, download, and delete. Extracted verbatim from
 *   memory-tab.js as a ctx-consuming plain render function (all state/handlers passed in via ctx).
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from public/views/profile/memory-tab.js (max-file-lines)
 *   v1.1.0 — 2026-08-08 — Copy labels now resolve from the shared common.copy / common.copied / common.copyPrompt /
 *       common.copyLink / common.copyUrl keys; the per-view copy label keys this file used were
 *       removed from both locales. Same words on screen.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Spinner } from '../shared.js';
import AuthImage from '/js/components/auth-image.js';
import TagCloud from '/js/components/tag-cloud.js';
import TagEditor from '/js/components/tag-editor.js';
import { CopyButton } from '/components/CopyButton.js';
import { VIS_OPTIONS } from './helpers.js';
import { fileCategory, categoryIcon, fileBytesUrl } from './file-helpers.js';
import { FileUploadForm } from './components.js';

export function renderFilesList(ctx) {
  const {
    files, NODE_URL, showFileForm, setShowFileForm, handleUploadFiles, fileFilterText,
    setFileFilterText, fileTagFilter, setFileTagFilter, editingFileTags, setEditingFileTags,
    handleUpdateFileTags, handleUpdateFileVisibility, inCart, fileCartItem, toggleCartItem,
    setPreviewFile, handleDownloadFile, handleDeleteFile, showToast, fileSizeLimitMb,
  } = ctx;

  // Public, no-auth file URL (mirrors memory's /v1/memory/:gaii/:key public read):
  // GET /v1/pub/:owner/:key serves the bytes when visibility==='public', so the copied link is
  // embeddable anywhere (<img src>, a new tab, a chat). Keeps slashes in keys literal for the
  // wildcard route; only encodes per-segment. Falls back to the legacy authenticated URL if the
  // list response predates owner_gaii (server needs a restart).
  const fileUrl = (f) => {
    const owner = f.owner_gaii;
    const keyPath = String(f.key || f.name).split('/').map(encodeURIComponent).join('/');
    return owner
      ? `${NODE_URL}/v1/pub/${encodeURIComponent(owner)}/${keyPath}`
      : `${NODE_URL}/v1/memory/files/${encodeURIComponent(f.key || f.name)}`;
  };

  if (!files) return html`<${Spinner} text=${t('profile.files.loading')} />`;

  // Collect all unique tags across files
  const allTags = new Set();
  for (const f of files) {
    if (f.tags) for (const tag of f.tags) allTags.add(tag);
  }

  // Filter by selected tags AND the live name/type search (filename, mime type, tags).
  const ftText = fileFilterText.trim().toLowerCase();
  const filtered = files.filter(f => {
    if (fileTagFilter.size > 0 && !(f.tags && [...fileTagFilter].every(tag => f.tags.includes(tag)))) return false;
    if (!ftText) return true;
    if (String(f.key || f.name || '').toLowerCase().includes(ftText)) return true;
    if (f.mime_type && f.mime_type.toLowerCase().includes(ftText)) return true;
    if (f.tags && f.tags.some(tag => tag.toLowerCase().includes(ftText))) return true;
    return false;
  });

  const toggleTag = (tag) => {
    setFileTagFilter(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  };

  const fileUrls = filtered.map(fileUrl).join('\n');

  return html`
    <div class="action-bar">
      <button class="btn-primary" onClick=${() => setShowFileForm(!showFileForm)}>${t('profile.files.uploadBtn')}</button>
      ${filtered.length > 0 && html`<${CopyButton}
        text=${fileUrls}
        label=${`\u{1F4CB} ${t('profile.files.copyUrls') || 'Copy URLs'} (${filtered.length})`}
        title="Copy file URLs"
        className="btn-outline btn-sm"
        onCopied=${() => showToast(t('profile.files.urlsCopied') || `${filtered.length} URLs copied`)} />`}
      <span class="text-meta-sm">${fileSizeLimitMb
        ? t('profile.files.sizeLimitMb', { mb: fileSizeLimitMb })
        : t('profile.files.sizeLimit')}</span>
    </div>
    <div class="search-bar mem-file-search mb-half">
      <input type="text" class="input-field" placeholder=${t('profile.files.searchPlaceholder') || 'Search files by name, tag, or type…'}
        value=${fileFilterText} onInput=${e => setFileFilterText(e.target.value)} />
      ${fileFilterText && html`<button class="btn-ghost btn-sm" onClick=${() => setFileFilterText('')}>✕</button>`}
    </div>
    <${TagCloud} tags=${[...allTags]} selected=${fileTagFilter} onToggle=${toggleTag} onClear=${() => setFileTagFilter(new Set())} />
    ${showFileForm && html`<${FileUploadForm} onUpload=${handleUploadFiles} onCancel=${() => setShowFileForm(false)} />`}
    ${filtered.length === 0
      ? html`<div class="empty">${files.length === 0 ? t('profile.files.empty') : (t('profile.files.noMatchSearch') || t('profile.files.noMatch') || 'No files match')}</div>`
      : html`<div class="file-grid">
          ${filtered.map(f => {
            const fKey = f.key || f.name;
            const isImage = f.mime_type?.startsWith('image');
            const cat = fileCategory(f.mime_type, fKey);
            const vis = f.visibility || 'private';
            return html`
              <div class="file-card">
                ${isImage
                  ? html`<${AuthImage} class="file-thumb pf-clickable" src=${fileBytesUrl(f, NODE_URL)} alt=${fKey} title=${t('profile.files.preview') || 'Preview'} onClick=${() => setPreviewFile(f)} />`
                  : html`<div class="file-icon pf-clickable" title=${t('profile.files.preview') || 'Preview'} onClick=${() => setPreviewFile(f)}>${categoryIcon(cat)}</div>`
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
                  <button class="btn-outline btn-sm ${inCart(fileCartItem(f)) ? 'mem-cart-btn--on' : ''}"
                    title=${inCart(fileCartItem(f)) ? (t('profile.memory.cartRemove') || 'Remove from collection') : (t('profile.memory.cartAdd') || 'Add to collection')}
                    onClick=${() => toggleCartItem(fileCartItem(f))}>🛒</button>
                  <button class="btn-outline btn-sm" title=${t('profile.files.preview') || 'Preview'} onClick=${() => setPreviewFile(f)}>${'\u{1F441}️'} ${t('profile.files.preview') || 'Preview'}</button>
                  <${CopyButton}
                    text=${fileUrl(f)}
                    label=${`\u{1F517} ${t('common.copyUrl') || 'Copy URL'}`}
                    title=${t('common.copyUrl') || 'Copy URL'}
                    className="btn-outline btn-sm"
                    onCopied=${() => showToast(t('profile.files.urlCopied') || 'URL copied to clipboard')} />
                  <button class="btn-outline btn-sm" onClick=${() => handleDownloadFile(f)}>${t('profile.files.download')}</button>
                  <button class="btn-danger-solid btn-sm" onClick=${() => handleDeleteFile(fKey)}>${t('profile.files.delete')}</button>
                </div>
              </div>`;
          })}
        </div>`
    }`;
}
