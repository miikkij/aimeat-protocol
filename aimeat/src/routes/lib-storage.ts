import type { AimeatConfig } from '../config.js';

/**
 * aimeat-storage.js — File upload/download client library
 * Depends on AIMEAT.auth being loaded first.
 */
export function aimeatStorageLib(config: AimeatConfig): string {
    return `// aimeat-storage.js — AIMEAT Storage Library (File Upload & Download)
// Node: ${config.nodeId} | Generated: ${new Date().toISOString()}
// Requires: aimeat-auth.js loaded first
// Usage: await AIMEAT.storage.upload(file); await AIMEAT.storage.download('key');
(function(global) {
'use strict';

const NODE_URL = (function() {
  const meta = document.querySelector('meta[name="aimeat-node"]');
  if (meta) return meta.getAttribute('content').replace(/\\/$/, '');
  if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin;
  return '${config.baseUrl}';
})();

function getSession() {
  if (!global.AIMEAT || !global.AIMEAT.auth) {
    throw new Error('AIMEAT.auth is required. Include aimeat-auth.js before aimeat-storage.js');
  }
  const s = global.AIMEAT.auth.getSession();
  if (!s) throw new Error('Not logged in. Call AIMEAT.auth.login() first.');
  return s;
}

async function authFetch(path, opts) {
  const session = getSession();
  return session.fetch(path, opts);
}

const storage = {
  // Upload a file (File object, Blob, or base64 string)
  async upload(fileOrData, opts) {
    let key, data, mime_type, visibility;

    if (fileOrData instanceof File || fileOrData instanceof Blob) {
      const file = fileOrData;
      key = opts?.key || file.name || ('file-' + Date.now());
      mime_type = opts?.mime_type || file.type || 'application/octet-stream';
      visibility = opts?.visibility || 'private';
      const buf = await file.arrayBuffer();
      data = btoa(String.fromCharCode(...new Uint8Array(buf)));
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
      headers: { 'Authorization': 'Bearer ' + jwt }
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
      headers: { 'Authorization': 'Bearer ' + jwt }
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
    const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
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
        } catch(err) {
          if (opts?.onError) opts.onError(err);
        }
      }
    });
  },
};

// ── Expose globally ──
if (!global.AIMEAT) global.AIMEAT = {};
global.AIMEAT.storage = storage;

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
`;
}
