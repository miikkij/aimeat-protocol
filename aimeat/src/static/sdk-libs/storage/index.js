/**
 * @file storage/index.js
 * @description The aimeat-storage library (SDK-libs migration Phase 2). Exposes AIMEAT.storage — the
 *   file upload/download SDK: upload (File/Blob/base64, chunked for large files), download/metadata,
 *   list/delete, publicUrl, and an enableDropZone() drag-&-drop helper. Over the AIMEAT.auth session,
 *   with direct NODE_URL fetches for binary GET/HEAD/chunk PUT. Componentized ESM source esbuild
 *   bundles to the IIFE served, unchanged, at /v1/libs/aimeat-storage.js. Ported verbatim from
 *   lib-storage.ts; NODE_URL now comes from _core/config.
 * @structure imports NODE_URL (config) + getSession/authFetch (session) + attach (namespace); the
 *   `storage` object incl. uploadChunked + enableDropZone; attach('storage', …).
 * @usage <script src="/v1/libs/aimeat-auth.js"></script><script src="/v1/libs/aimeat-storage.js"></script>
 *   await AIMEAT.storage.upload(file); await AIMEAT.storage.download('key');
 * @version-history
 *   v1.0.0 — 2026-07-19 — Migrated from src/routes/lib-storage.ts (SDK-libs migration Phase 2).
 */
import { NODE_URL } from '../_core/config.js';
import { makeSession } from '../_core/session.js';
const { getSession, authFetch } = makeSession('aimeat-storage.js');
import { attach } from '../_core/namespace.js';

const storage = {
  // Upload a file (File object, Blob, or base64 string)
  async upload(fileOrData, opts) {
    let key, data, mime_type, visibility;

    if (fileOrData instanceof File || fileOrData instanceof Blob) {
      // A bare Blob has no .name (only File does) — reading it yields undefined → the fallback.
      const file = /** @type {File} */ (fileOrData);
      key = opts?.key || file.name || ('file-' + Date.now());
      mime_type = opts?.mime_type || file.type || 'application/octet-stream';
      visibility = opts?.visibility || 'private';
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
      }
      data = btoa(binary);
    } else if (typeof fileOrData === 'string') {
      // Assume base64
      key = opts?.key || ('file-' + Date.now());
      data = fileOrData;
      mime_type = opts?.mime_type || 'application/octet-stream';
      visibility = opts?.visibility || 'private';
    } else {
      throw new Error('upload() expects a File, Blob, or base64 string');
    }

    const res = await authFetch('/v1/storage', {
      method: 'POST',
      body: JSON.stringify({ key, data, mime_type, visibility }),
    });
    if (!res.ok) throw new Error(res.error?.message || 'Upload failed');
    return res.data;
  },

  // Download a file as Blob
  async download(key) {
    const session = getSession();
    const jwt = session.jwt;
    const r = await fetch(NODE_URL + '/v1/storage/' + encodeURIComponent(key), {
      headers: { 'Authorization': 'Bearer ' + jwt },
    });
    if (!r.ok) throw new Error('Download failed: ' + r.status);
    return r.blob();
  },

  // Get a direct URL for embedding (e.g. in <img src="">)
  // Note: requires auth header, so only works with public files or session.fetch
  publicUrl(key) {
    return NODE_URL + '/v1/storage/' + encodeURIComponent(key);
  },

  // List all files
  async list() {
    const res = await authFetch('/v1/storage');
    if (!res.ok) throw new Error(res.error?.message || 'Failed to list files');
    return res.data;
  },

  // Get file metadata (HEAD request)
  async metadata(key) {
    const session = getSession();
    const jwt = session.jwt;
    const r = await fetch(NODE_URL + '/v1/storage/' + encodeURIComponent(key), {
      method: 'HEAD',
      headers: { 'Authorization': 'Bearer ' + jwt },
    });
    if (!r.ok) throw new Error('Metadata fetch failed: ' + r.status);
    return {
      contentType: r.headers.get('Content-Type'),
      contentLength: parseInt(r.headers.get('Content-Length') || '0'),
      visibility: r.headers.get('X-AIMEAT-Visibility'),
      createdAt: r.headers.get('X-AIMEAT-Created'),
    };
  },

  // Delete a file
  async delete(key) {
    const res = await authFetch('/v1/storage/' + encodeURIComponent(key), { method: 'DELETE' });
    if (!res.ok) throw new Error(res.error?.message || 'Delete failed');
    return res.data;
  },

  // ── Chunked upload for large files ──
  async uploadChunked(file, opts) {
    const chunkSize = opts?.chunkSize || (1024 * 1024); // 1MB default
    const key = opts?.key || file.name || ('file-' + Date.now());
    const mime_type = opts?.mime_type || file.type || 'application/octet-stream';
    const visibility = opts?.visibility || 'private';
    const totalChunks = Math.ceil(file.size / chunkSize);

    // Init
    const initRes = await authFetch('/v1/storage/upload/init', {
      method: 'POST',
      body: JSON.stringify({ key, mime_type, visibility, chunk_size: chunkSize, total_chunks: totalChunks }),
    });
    if (!initRes.ok) throw new Error(initRes.error?.message || 'Chunked upload init failed');
    const uploadId = initRes.data.upload_id;

    // Upload chunks
    const session = getSession();
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);
      const buf = await chunk.arrayBuffer();

      const r = await fetch(NODE_URL + '/v1/storage/upload/' + uploadId + '/' + i, {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + session.jwt,
          'Content-Type': 'application/octet-stream',
        },
        body: buf,
      });
      if (!r.ok) throw new Error('Chunk ' + i + ' upload failed: ' + r.status);
      if (opts?.onProgress) opts.onProgress({ chunk: i, total: totalChunks, percent: Math.round(((i + 1) / totalChunks) * 100) });
    }

    // Complete
    const completeRes = await authFetch('/v1/storage/upload/' + uploadId + '/complete', { method: 'POST' });
    if (!completeRes.ok) throw new Error(completeRes.error?.message || 'Chunked upload complete failed');
    return completeRes.data;
  },

  // Abort a chunked upload
  async abortUpload(uploadId) {
    const res = await authFetch('/v1/storage/upload/' + uploadId, { method: 'DELETE' });
    if (!res.ok) throw new Error(res.error?.message || 'Abort failed');
    return res.data;
  },

  // ── Drag & Drop helper ──
  enableDropZone(selector, opts) {
    const el = /** @type {HTMLElement} */ (typeof selector === 'string' ? document.querySelector(selector) : selector);
    if (!el) throw new Error('Drop zone element not found: ' + selector);

    const accept = opts?.accept || '*/*';
    const maxSize = opts?.maxSize || (10 * 1024 * 1024);

    el.addEventListener('dragover', (e) => { e.preventDefault(); el.style.outline = '2px dashed #38bdf8'; });
    el.addEventListener('dragleave', () => { el.style.outline = ''; });
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      el.style.outline = '';
      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        if (accept !== '*/*' && !file.type.match(accept.replace('*', '.*'))) {
          if (opts?.onError) opts.onError(new Error('File type not accepted: ' + file.type));
          continue;
        }
        if (file.size > maxSize) {
          if (opts?.onError) opts.onError(new Error('File too large: ' + file.name + ' (' + file.size + ' bytes)'));
          continue;
        }
        try {
          const ref = await storage.upload(file, opts);
          if (opts?.onUpload) opts.onUpload(ref, file);
        } catch (err) {
          if (opts?.onError) opts.onError(err);
        }
      }
    });
  },
};

// ── Expose globally ──
attach('storage', storage);
