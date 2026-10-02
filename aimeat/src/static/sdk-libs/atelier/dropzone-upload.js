/**
 * @file atelier/dropzone-upload.js
 * @description The upload half of the dropzone (parts.js), used only when the app passes
 *   `upload: {...}` and the page loads aimeat-storage.js. Two apps wrote pick, upload and status by
 *   hand (LÄHETIN with an in-flight counter that blocks Publish, KOTILO with a queue and a progress
 *   line); this is that code once.
 *
 *   WHAT IT DOES. Each accepted file gets a row under the zone: waiting, uploading (a bar; with
 *   numbers when the file is over `chunkedOver` and goes up in chunks), then saved with its key and,
 *   for a public file, an Open link through AIMEAT.storage.viewUrl, or the failure in words. Files go
 *   up one at a time, in the order they came. `pending()` counts the waiting and the running, so
 *   an app can hold its own submit until it is 0.
 *
 *   WHAT FETCHES. Nothing here fetches itself: AIMEAT.storage.upload, uploadChunked and viewUrl do,
 *   over the signed-in session. Signed out, the storage library refuses and the row says so.
 * @structure storageLib() · uploader({ zone, upload, lib, onUploaded, onUploadError })
 * @parts dropzone root · label · hint · error · input · files · file · name · state · bar · open
 * @usage
 *   AIMEAT.atelier.dropzone({ target, accept: ['image/*'], upload: { visibility: 'public', chunkedOver: 4e6 },
 *     onUploaded(file, answer) { photos.push(answer.key); } });
 * @version-history
 *   v0.63.0 — 2026-10-02 — The @parts line names the zone's own parts too (root, label, hint, error,
 *     input), which parts.js now marks with data-ak-part.
 *   v0.62.0 — 2026-10-01 — Initial: dropzone uploads through AIMEAT.storage.
 */
import { el, resolve } from './dom.js';
import { tu } from './copy-upload-i18n.js';

/**
 * What the app asks for when it passes `upload` to dropzone.
 * @typedef {{
 *   key?: (file: File) => string,
 *   visibility?: 'private'|'owner'|'group'|'public'|'workspace',
 *   workspaceRef?: string,
 *   chunkedOver?: number,
 *   target?: string|Element,
 * }} DropzoneUpload
 */

/**
 * What AIMEAT.storage.upload and uploadChunked answer (POST /v1/storage, the chunked complete).
 * @typedef {{ key: string, owner_gaii?: string, size?: number, mime_type?: string, visibility?: string,
 *   embed_url?: string, versioned_url?: string }} UploadAnswer
 */

/**
 * The storage library on the page, or null when aimeat-storage.js is not loaded.
 * @returns {any|null}
 */
export function storageLib() {
  const ns = typeof window !== 'undefined' ? window.AIMEAT : null;
  const lib = ns && ns.storage;
  return lib && typeof lib.upload === 'function' ? lib : null;
}

/**
 * The upload queue and its rows.
 * @param {{ zone: HTMLElement, upload: DropzoneUpload, lib: any,
 *   onUploaded?: (file: File, answer: UploadAnswer) => void,
 *   onUploadError?: (file: File, err: any) => void }} o
 * @returns {{ add: (files: File[]) => void, pending: () => number, destroy: () => void }}
 */
export function uploader(o) {
  const up = o.upload || {};
  const list = el('ul', { class: 'ak-root ak-dropzone__files', 'data-ak-part': 'files', 'aria-live': 'polite' });
  /** @type {Array<{ file: File, row: ReturnType<typeof row> }>} */
  let queue = [];
  let running = 0;
  let gone = false;

  /** The rows go where the app said, else right after the zone. */
  function place() {
    if (list.parentNode) return;
    if (up.target) { resolve(up.target).appendChild(list); return; }
    if (o.zone.parentNode) o.zone.parentNode.insertBefore(list, o.zone.nextSibling);
  }

  function row(file) {
    const state = el('span', { class: 'ak-dropzone__hint', 'data-ak-part': 'state' }, tu('upload.waiting'));
    const bar = /** @type {HTMLProgressElement} */ (el('progress', { class: 'ak-dropzone__bar', 'data-ak-part': 'bar', max: '100', hidden: true }));
    const li = el('li', { class: 'ak-dropzone__file', 'data-ak-part': 'file', 'data-ak-state': 'waiting' }, [
      el('span', { class: 'ak-dropzone__name', 'data-ak-part': 'name' }, String(file.name || '')), ' ', state, bar,
    ]);
    list.appendChild(li);
    return { li: li, state: state, bar: bar };
  }

  /** The options AIMEAT.storage takes, in its own field names. */
  function optsFor(file) {
    /** @type {Record<string, any>} */
    const opts = {};
    if (typeof up.key === 'function') {
      const k = up.key(file);
      if (k) opts.key = String(k);
    }
    if (up.visibility) opts.visibility = up.visibility;
    if (up.workspaceRef) opts.workspace_ref = up.workspaceRef;
    return opts;
  }

  /** Saved: the key in words, and for a public file an Open link the browser can load. */
  function saved(r, answer) {
    r.li.setAttribute('data-ak-state', 'done');
    r.state.textContent = tu('upload.saved', { key: answer && answer.key });
    if (!answer || answer.visibility !== 'public' || typeof o.lib.viewUrl !== 'function') return;
    const ref = answer.owner_gaii ? answer.owner_gaii + '/' + answer.key : answer.key;
    Promise.resolve().then(function () { return o.lib.viewUrl(ref); }).then(function (url) {
      if (!url || gone) return;
      r.li.appendChild(document.createTextNode(' '));
      r.li.appendChild(el('a', { class: 'ak-dropzone__open', 'data-ak-part': 'open', href: String(url), target: '_blank', rel: 'noopener' }, tu('upload.open')));
    }, function () { /* the key is already said; a link that cannot be made is left out */ });
  }

  function failed(r, err) {
    r.li.setAttribute('data-ak-state', 'failed');
    r.state.className = 'ak-dropzone__err';
    r.state.textContent = tu('upload.failed', { why: String((err && err.message) || err || '?') });
  }

  async function send(job) {
    const r = job.row;
    const file = job.file;
    r.li.setAttribute('data-ak-state', 'uploading');
    r.state.textContent = tu('upload.sending');
    r.bar.hidden = false;
    const opts = optsFor(file);
    try {
      const chunked = Number(up.chunkedOver) > 0 && file.size > Number(up.chunkedOver) && typeof o.lib.uploadChunked === 'function';
      let answer;
      if (chunked) {
        opts.onProgress = function (p) {
          const n = Math.max(0, Math.min(100, Math.round((p && p.percent) || 0)));
          r.bar.value = n;
          r.state.textContent = tu('upload.percent', { n: n });
        };
        answer = await o.lib.uploadChunked(file, opts);
      } else {
        answer = await o.lib.upload(file, opts);
      }
      r.bar.hidden = true;
      saved(r, answer);
      if (o.onUploaded) {
        try { o.onUploaded(file, answer); } catch (e) { console.warn('[atelier] dropzone onUploaded threw:', e); }
      }
    } catch (err) {
      r.bar.hidden = true;
      failed(r, err);
      if (o.onUploadError) {
        try { o.onUploadError(file, err); } catch (e) { console.warn('[atelier] dropzone onUploadError threw:', e); }
      }
    }
  }

  /** One file at a time, in the order they came. */
  function pump() {
    if (running || gone) return;
    const job = queue.shift();
    if (!job) return;
    running = 1;
    send(job).then(function () { running = 0; pump(); });
  }

  return {
    add(files) {
      if (gone) return;
      place();
      (files || []).forEach(function (f) { queue.push({ file: f, row: row(f) }); });
      pump();
    },
    pending() { return queue.length + running; },
    destroy() {
      gone = true;
      queue = [];
      if (list.parentNode) list.parentNode.removeChild(list);
    },
  };
}
