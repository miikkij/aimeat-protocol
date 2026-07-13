/**
 * @file document.js
 * @description Document-space editor + viewer for organism workspaces: a read-only DocumentView
 *   (markdown render, private-image resolution, Draft/Published compare toggle) and a DocumentEditor
 *   (Toast UI WYSIWYG with a markdown fallback, image upload + per-image visibility). Lazy-loads the
 *   vendored Toast UI Editor. Extracted from organisms-tab.js with no behaviour change.
 * @structure loadToastUI (internal), DocumentView, DocumentEditor
 * @usage import { DocumentView, DocumentEditor } from '/views/profile/organisms/document.js';
 * @version-history
 *   v1.0.0 — 2026-06-19 — Extracted from organisms-tab.js during the module split.
 *   v1.1.0 — 2026-07-05 — DocumentView private-image resolution now also covers /v1/memory/files/<key>
 *     and /v1/pub/<owner>/<key> refs (not just /v1/storage), so images DROP files into a doc render via
 *     an auth'd blob fetch — a plain <img> can't send the token. /v1/pub carries the file owner, so a
 *     WORKSPACE-visibility image renders for the author AND workspace members (gated by canReadWorkspace),
 *     never made public. (See the authed-image-embed / workspace-file-tier design.)
 *   v1.2.0 — 2026-07-05 — Only IMAGE embeds (![](…)) are eagerly blob-fetched; plain [file](/v1/…) LINKS
 *     (pdf etc.) keep their raw URL and are fetched ON CLICK (onDocClick) — fetch-with-token → open the
 *     blob in a new tab — so a private/workspace file opens without a big eager download and without a
 *     token-less navigation 401'ing.
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { VisibilityPill } from '/views/profile/shared.js';
import { KeyValueRow } from '/components/KeyValueRow.js';
import { Markdown } from '/components/Markdown.js';
import { dt } from '/js/format.js';
import * as orgService from '/js/services/organisms.js';

// Lazy-load the vendored Toast UI Editor (MIT, /lib/toastui/) only when a document is edited —
// it's ~520KB, so it stays out of the main bundle. Resolves window.toastui.Editor.
let _tuiPromise = null;
function loadToastUI() {
  if (window.toastui && window.toastui.Editor) return Promise.resolve(window.toastui.Editor);
  if (_tuiPromise) return _tuiPromise;
  _tuiPromise = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = '/lib/toastui/toastui-editor.min.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = '/lib/toastui/toastui-editor-all.min.js';
    s.onload = () => (window.toastui && window.toastui.Editor) ? resolve(window.toastui.Editor) : reject(new Error('editor missing'));
    s.onerror = () => reject(new Error('failed to load editor'));
    document.head.appendChild(s);
  });
  return _tuiPromise;
}

/* Read-only document view. Renders the markdown, resolves private /v1/storage images (the GET needs
 * the session token, so a plain <img> would break), and — when the document has BOTH an unpublished
 * draft and a published version — offers a Draft/Published toggle so the two can be compared. The
 * parent passes the merged `page` (the draft, carrying the published copy on `page._pub`). Remounted
 * per document via `key`, so the toggle resets to "Draft" each time a document is opened. */
export function DocumentView({ page, busy, onEdit, onPublish, onWikiLink, onPopOut }) {
  const hasBoth = page._draft && page._pub;
  const [tab, setTab] = useState('draft');
  const shown = (hasBoth && tab === 'published') ? page._pub : page;
  const [rendered, setRendered] = useState(shown.markdown || '');

  // Resolve private IMAGE embeds (/v1/storage, /v1/memory/files, /v1/pub) to auth'd blob: URLs IN THE
  // MARKDOWN TEXT (declarative), then render that. Doing it in the text — instead of mutating <img src>
  // after render — means a re-render (toggling Draft/Published, a live-update refresh) can never leave a
  // stale or revoked object URL on a reused <img> node, which previously showed a broken image. Re-runs
  // per version. Only ![](…) IMAGE URLs are eagerly fetched here — plain [file](…) LINKS (pdf etc.) keep
  // their raw URL and are fetched on click (onDocClick below), so a large file isn't downloaded on open.
  // A plain <img>/link can't send the token; /v1/pub carries the owner so a workspace-visibility file
  // renders/opens for the author AND workspace members (canReadWorkspace-gated), never public.
  useEffect(() => {
    let cancelled = false; const created = [];
    const raw = shown.markdown || '';
    setRendered(raw);   // show text/structure at once; images swap in a moment later
    (async () => {
      const urls = [...new Set([...raw.matchAll(/!\[[^\]]*\]\((\/v1\/(?:storage|memory\/files|pub)\/[^\s)]+)\)/g)].map(m => m[1]))];
      if (!urls.length) return;
      let out = raw;
      for (const su of urls) {
        try { const bu = await orgService.fetchStorageObjectUrl(su); created.push(bu); out = out.split(su).join(bu); }
        catch { /* leave the storage URL — renders broken but never throws */ }
      }
      if (!cancelled) setRendered(out);
    })();
    return () => { cancelled = true; created.forEach(u => { try { URL.revokeObjectURL(u); } catch { /* noop */ } }); };
  }, [shown.markdown]);

  // A [file](/v1/…) LINK (pdf etc.) can't carry the session token on a plain navigation, so intercept
  // the click: fetch the bytes with the token (owner-addressed /v1/pub → workspace-member-readable), then
  // point a new tab at the resulting blob. Open the tab synchronously in the click gesture so it isn't
  // popup-blocked, then set its location once the fetch resolves.
  const onDocClick = (e) => {
    const a = e.target?.closest?.('a');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (!/\/v1\/(?:storage|memory\/files|pub)\//.test(href) || href.startsWith('blob:')) return;
    e.preventDefault();
    const tab = window.open('', '_blank', 'noopener');
    orgService.fetchStorageObjectUrl(href).then(bu => {
      if (tab) tab.location.href = bu; else window.open(bu, '_blank', 'noopener');
      setTimeout(() => { try { URL.revokeObjectURL(bu); } catch { /* noop */ } }, 60_000);
    }).catch(() => { try { tab?.close(); } catch { /* noop */ } });
  };

  // created/saved/published timestamps come from the workspace read (record metadata on the value).
  const created = page._createdAt || page._pub?._createdAt;
  const savedAt = page._draft ? page._updatedAt : null;          // draft = working copy → "last saved"
  const publishedAt = page._pub?._updatedAt || (!page._draft && page._published ? page._updatedAt : null);

  return html`
    <div class="pj-doc-toolbar">
      <span class="pj-doc-vtitle">${shown.title || shown.id || page.id}</span>
      ${hasBoth ? html`
        <div class="seg" role="tablist">
          <button class="seg-btn ${tab === 'draft' ? 'active' : ''}" onClick=${() => setTab('draft')}>${t('organisms.draftVersion') || 'Draft'}</button>
          <button class="seg-btn ${tab === 'published' ? 'active' : ''}" onClick=${() => setTab('published')}>${t('organisms.publishedVersion') || 'Published'}</button>
        </div>` : null}
      <button class="btn-ghost btn-sm" onClick=${onEdit}>${t('organisms.edit') || 'Edit'}</button>
      ${page._draft ? html`<button class="btn-primary btn-sm" onClick=${onPublish} disabled=${busy}>${t('organisms.publish') || 'Publish'}</button>` : null}
      ${onPopOut ? html`<button class="btn-ghost btn-sm pj-doc-popout" title=${t('organisms.popOut') || 'Open in its own window'} onClick=${onPopOut}>${'⧉'}</button>` : null}
    </div>
    ${(created || savedAt || publishedAt) ? html`
      <div class="pj-doc-meta">
        ${created ? html`<${KeyValueRow} label=${t('organisms.createdAt') || 'Created'} value=${dt(created)} />` : null}
        ${savedAt ? html`<${KeyValueRow} label=${t('organisms.lastSaved') || 'Last saved'} value=${dt(savedAt)} />` : null}
        ${publishedAt ? html`<${KeyValueRow} label=${t('organisms.publishedAt') || 'Published'} value=${dt(publishedAt)} />` : null}
      </div>` : null}
    <div class="pj-doc-view" onClick=${onDocClick}><${Markdown} text=${rendered} onWikiLink=${onWikiLink} /></div>`;
}

/* Document editor: a Toast UI Editor (WYSIWYG, with its own built-in Markdown⇄WYSIWYG toggle, so
 * non-technical users type like a document). Falls back to a plain markdown textarea + live preview
 * if the editor can't load. Title is a separate Preact-controlled field. */
export function DocumentEditor({ orgId, page, busy, onSave, onCancel }) {
  const [title, setTitle] = useState((page && page.title) || '');
  const [mode, setMode] = useState('rich');               // 'rich' = Toast UI; 'markdown' = fallback textarea
  const [md, setMd] = useState((page && page.markdown) || '');
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const imageMap = useRef({});                             // data: URL (shown in editor) → /v1/storage URL (saved)
  const displayMap = useRef({});                           // blob: URL (shown in editor) → /v1/storage URL (saved) — for already-stored images
  const pending = useRef([]);                              // in-flight image uploads — save() awaits these
  const [saving, setSaving] = useState(false);
  const [images, setImages] = useState([]);                // embedded /v1/storage images: [{key, alt, visibility}]
  const [imgBusy, setImgBusy] = useState(false);

  // Load the visibility of the document's already-saved /v1/storage images, so the author can make
  // them public (a private image won't load for other viewers of a shared/published document).
  // Newly-pasted images appear here after the first save + reopen.
  useEffect(() => {
    let cancelled = false;
    const embedded = orgService.extractStorageImages((page && page.markdown) || '');
    if (!embedded.length) { setImages([]); return undefined; }
    orgService.listStorageVisibilities().then((vis) => {
      if (!cancelled) setImages(embedded.map(e => ({ ...e, visibility: vis[e.key] || 'private' })));
    }).catch(() => { if (!cancelled) setImages(embedded.map(e => ({ ...e, visibility: 'private' }))); });
    return () => { cancelled = true; };
    // Runs once on mount from the initial `page` snapshot; the editor is remounted per document
    // via `key`, so re-running on `page` identity changes is unnecessary and would reset image state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeImageVisibility = async (key, visibility) => {
    setImgBusy(true);
    try {
      const r = await orgService.setImageVisibility(key, visibility);
      if (r?.ok === false) throw new Error(r?.error?.message || 'Failed');
      setImages(imgs => imgs.map(i => i.key === key ? { ...i, visibility } : i));
    } catch { /* leave as-is; a failed toggle just doesn't change the pill */ }
    finally { setImgBusy(false); }
  };
  const makeAllImagesPublic = async () => {
    setImgBusy(true);
    try {
      const targets = images.filter(i => i.visibility !== 'public');
      await Promise.all(targets.map(i => orgService.setImageVisibility(i.key, 'public').catch(() => {})));
      setImages(imgs => imgs.map(i => ({ ...i, visibility: 'public' })));
    } finally { setImgBusy(false); }
  };

  // Show the image instantly via a data URL, upload to storage in the background, and remember the
  // mapping so save() rewrites the data URL to the storage URL. If the upload fails, the image stays
  // inline (still renders + saves, just larger) — so an image NEVER silently disappears.
  const uploadAndMap = (blob, dataUrl) => {
    pending.current.push(
      orgService.uploadImage(orgId, blob, blob.type || 'image/png')
        .then((url) => { imageMap.current[dataUrl] = url; })
        .catch(() => { /* keep the inline data URL */ }),
    );
  };
  const insertFromFile = async (file) => {
    if (!file) return;
    const dataUrl = await orgService.blobToDataUrl(file);
    if (mode === 'rich' && editorRef.current) editorRef.current.exec('addImage', { imageUrl: dataUrl, altText: file.name || 'image' });
    else setMd((m) => m + `\n\n![${file.name || 'image'}](${dataUrl})\n`);
    uploadAndMap(file, dataUrl);
  };

  useEffect(() => {
    if (mode !== 'rich') return undefined;
    let inst = null, cancelled = false; const blobUrls = [];
    (async () => {
      const Editor = await loadToastUI().catch(() => null);
      if (cancelled) return;
      if (!Editor) { setMode('markdown'); return; }
      // Already-stored images embed a private /v1/storage URL, which a plain <img> in the editor
      // can't load (the GET needs the session token). Fetch each with auth, show it as a blob: URL,
      // and remember blob→storage so save() rewrites it back to the canonical storage URL.
      let initial = (page && page.markdown) || '';
      const urls = [...new Set(initial.match(/\/v1\/storage\/[^\s)\]"'>]+/g) || [])];
      for (const su of urls) {
        try {
          const bu = await orgService.fetchStorageObjectUrl(su);
          displayMap.current[bu] = su; blobUrls.push(bu);
          initial = initial.split(su).join(bu);
        } catch { /* leave the storage URL — it renders broken but saves intact */ }
      }
      if (cancelled || !containerRef.current) return;
      inst = new Editor({
        el: containerRef.current,
        height: '440px',
        initialEditType: 'wysiwyg',
        previewStyle: 'tab',
        initialValue: initial,
        usageStatistics: false,
        // Drop Toast UI's own image button — its file popup is unreliable; the "📷 Insert image"
        // button above is the image path (and paste/drag still work via the hook below).
        toolbarItems: [
          ['heading', 'bold', 'italic', 'strike'],
          ['hr', 'quote'],
          ['ul', 'ol', 'task', 'indent', 'outdent'],
          ['table', 'link'],
          ['code', 'codeblock'],
        ],
        hooks: {
          // Paste/drag an image → insert it as a data URL (shows at once) + upload in the background.
          addImageBlobHook: async (blob, callback) => {
            const dataUrl = await orgService.blobToDataUrl(blob);
            callback(dataUrl, '');
            uploadAndMap(blob, dataUrl);
          },
        },
      });
      editorRef.current = inst;
    })();
    return () => {
      cancelled = true;
      if (inst) { try { inst.destroy(); } catch { /* noop */ } }
      editorRef.current = null;
      blobUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch { /* noop */ } });
    };
    // Re-init the editor only on mode switch. `uploadAndMap` is recreated every render (adding it
    // would rebuild the editor on every render) and `page` is the initial content snapshot — both
    // are read intentionally via closure to keep the live editor instance stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const save = async () => {
    setSaving(true);
    try {
      if (pending.current.length) { await Promise.all(pending.current); pending.current = []; }  // finish uploads first
      let markdown = (mode === 'rich' && editorRef.current) ? editorRef.current.getMarkdown() : md;
      for (const [dataUrl, storageUrl] of Object.entries(imageMap.current)) markdown = markdown.split(dataUrl).join(storageUrl);
      for (const [blobUrl, storageUrl] of Object.entries(displayMap.current)) markdown = markdown.split(blobUrl).join(storageUrl);
      // Point each image at the URL form its visibility needs: public → /v1/pub/<ghii>/<key> (loads
      // for any viewer), private → /v1/storage/<key> (owner-only). So a public document's images render.
      const visByKey = {}; for (const im of images) visByKey[im.key] = im.visibility;
      markdown = orgService.applyImageVisibilityUrls(markdown, visByKey, orgService.currentGhii());
      onSave({ ...page, title: title.trim(), markdown });
    } finally { setSaving(false); }
  };

  return html`
    <div class="pj-doc-editor">
      <input type="text" class="input-field input-sm" placeholder=${t('organisms.pageTitle') || 'Document title'}
        value=${title} onInput=${e => setTitle(e.target.value)} />
      <div class="pj-doc-imgbar">
        <label class="btn-outline btn-sm pj-file-btn">
          <span class="pj-file-btn-icon">📷</span> ${t('organisms.insertImage') || 'Upload image from file'}
          <input type="file" accept="image/*" hidden onChange=${e => { insertFromFile(e.target.files && e.target.files[0]); e.target.value = ''; }} />
        </label>
        <span class="pj-imgbar-hint">${t('organisms.orPaste') || '…or paste / drag an image into the editor'}</span>
      </div>
      ${images.length ? html`
        <div class="pj-img-vis">
          <div class="pj-img-vis-head">
            <span class="pj-img-vis-title">${t('organisms.fileVisibility') || 'File visibility'}</span>
            <span class="pj-img-vis-note">${t('organisms.fileVisibilityNote') || 'Private files only load for you — make them public to share the document.'}</span>
            ${images.some(i => i.visibility !== 'public') ? html`<button class="btn-ghost btn-sm" disabled=${imgBusy} onClick=${makeAllImagesPublic}>${t('organisms.makeAllPublic') || 'Make all public'}</button>` : null}
          </div>
          ${images.map(i => html`
            <div class="pj-img-vis-row" key=${i.key}>
              <span class="pj-img-vis-name" title=${i.key}>${(i.alt)}</span>
              <${VisibilityPill} visibility=${i.visibility} onClick=${() => { if (!imgBusy) changeImageVisibility(i.key, i.visibility === 'public' ? 'private' : 'public'); }} />
            </div>`)}
        </div>` : null}
      ${mode === 'rich'
        ? html`<div ref=${containerRef} class="pj-tui"></div>`
        : html`<div class="pj-doc-grid">
            <textarea class="input-field pj-doc-md" rows="14" placeholder=${t('organisms.writeMarkdown') || 'Write markdown…'}
              value=${md} onInput=${e => setMd(e.target.value)}></textarea>
            <div class="pj-doc-preview"><${Markdown} text=${md} /></div>
          </div>`}
      <div class="form-actions">
        <button class="btn-primary btn-sm" onClick=${save} disabled=${busy || saving || !title.trim()}>
          ${saving ? html`<span class="spinner"></span> ${t('organisms.saving') || 'Saving…'}` : (t('organisms.saveDraft') || 'Save draft')}
        </button>
        <button class="btn-ghost btn-sm" onClick=${onCancel}>${t('organisms.cancel') || 'Cancel'}</button>
      </div>
    </div>
  `;
}
