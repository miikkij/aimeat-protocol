/**
 * @file storage/index.js
 * @description The aimeat-storage library (SDK-libs migration Phase 2). Exposes AIMEAT.storage — the
 *   file upload/download SDK: upload (a File or Blob as raw bytes in one PUT, base64 inline; chunked
 *   on request), download/metadata,
 *   list/delete, publicUrl, and an enableDropZone() drag-&-drop helper. Over the AIMEAT.auth session,
 *   with direct NODE_URL fetches for binary GET/HEAD/chunk PUT. Componentized ESM source esbuild
 *   bundles to the IIFE served, unchanged, at /v1/libs/aimeat-storage.js. Ported verbatim from
 *   lib-storage.ts; NODE_URL now comes from _core/config.
 * @structure imports NODE_URL (config) + getSession/authFetch (session) + attach (namespace);
 *   levelOf · binding · uploadError · putFile; the `storage` object incl. uploadChunked +
 *   enableDropZone; attach('storage', …).
 * @usage <script src="/v1/libs/aimeat-auth.js"></script><script src="/v1/libs/aimeat-storage.js"></script>
 *   await AIMEAT.storage.upload(file); await AIMEAT.storage.download('key');
 * @version-history
 *   v1.6.0 — 2026-11-26 — upload(File|Blob) sends the raw bytes in one PUT to a presigned upload
 *     address instead of base64 in JSON: the JSON was a third larger, and past about 3.1 MB of file
 *     the node answered 500 (a 3.5 MB zip was lost). It answers the same fields as before. A failed
 *     upload throws the node's sentence with `code` and `status` on the error. opts.store names the
 *     store for the bytes. A base64 string still goes inline; uploadChunked is unchanged.
 *   v1.5.0 — 2026-10-18 — upload() and uploadChunked() take opts.nodeDefault: with no visibility named,
 *     they send visibility 'default' and the node applies its starting level for an app's upload (plan
 *     doc-mvcn6c7e4e5q, V5.2). Without it, an upload with no visibility is still sent as private.
 *   2026-10-16 — A failed abort after a failed chunked upload is logged, not swallowed (QA audit W25 ratchet).
 *   v1.4.0 — 2026-10-16 — uploadChunked aborts its upload on the node when a chunk or the complete
 *     fails, so the session and its bytes do not stay behind; the node now keeps at most four open
 *     uploads per account (QA audit F05b-02).
 *   v1.3.0 — 2026-09-29 — upload() and uploadChunked() send the group or workspace a file is shared
 *     with (group_id, workspace_ref, workspaceRefs). They sent only key, data, type and visibility,
 *     so a 'workspace' file was refused for naming no workspace and apps posted to /v1/storage
 *     themselves (aimeat-apps wish, LÄHETIN 4.8.0).
 *   v1.2.0 — 2026-09-13 — viewUrl() reads a `<gaii>/<key>` reference as an owner and a key, the way
 *     the server's parseFileRef does. It used to file the whole reference as a key under the
 *     signed-in person, so a picture an agent had uploaded answered 404 for its own owner.
 *   v1.1.0 — 2026-08-17 — viewUrl(): a URL that loads in an <img> for a file that is not public.
 *     A browser sends no Authorization header for an image, so a private picture drew a broken icon
 *     even for its owner. Answers a presigned handle instead, and hands a public file back as-is.
 *   v1.0.0 — 2026-07-19 — Migrated from src/routes/lib-storage.ts (SDK-libs migration Phase 2).
 */
import { NODE_URL } from '../_core/config.js';
import { makeSession } from '../_core/session.js';
const { getSession, authFetch } = makeSession('aimeat-storage.js');
import { attach } from '../_core/namespace.js';

/**
 * The group or workspace a file is shared with, in the node's field names. A 'group' file names its
 * group (opts.group_id), a 'workspace' file one or more workspaces as "<organismId>/<workspaceId>"
 * (opts.workspace_ref, a string, or opts.workspaceRefs, a list). Without them the node refuses a
 * 'workspace' file and stores a 'group' file bound to nobody.
 */
/**
 * The visibility an upload sends: the one the app named, else 'private'. With opts.nodeDefault true
 * and none named, it sends 'default', and the node applies its own starting level for an app's
 * upload (visibility.app_upload_default). AIMEAT.assets.upload uses that for a game's pictures and
 * sounds.
 * @param {any} opts
 * @returns {string}
 */
function levelOf(opts) {
  if (opts && opts.visibility) return opts.visibility;
  return opts && opts.nodeDefault === true ? 'default' : 'private';
}

function binding(opts) {
  const o = opts || {};
  const refs = o.workspaceRefs || o.workspace_refs;
  return {
    group_id: o.group_id || o.groupId,
    workspace_ref: o.workspace_ref || o.workspaceRef,
    workspace_refs: Array.isArray(refs) ? refs : undefined,
  };
}

/**
 * An Error with the node's sentence as its message, and its code and HTTP status beside it.
 * @param {string} message
 * @param {string} [code]
 * @param {number} [status]
 * @returns {Error & { code?: string, status?: number }}
 */
function uploadError(message, code, status) {
  const err = /** @type {Error & { code?: string, status?: number }} */ (new Error(message));
  if (code) err.code = code;
  if (status) err.status = status;
  return err;
}

/**
 * Store a File or a Blob with ONE request that carries its bytes: the node mints an upload address
 * (POST /v1/storage with mode 'presigned', the same key, type, visibility, sharing and store the inline
 * upload sends), and the bytes go to it as they are in one PUT, up to the node's file limit.
 * Base64 in JSON made the body a third larger and, past about 3.1 MB of file, answered 500 on
 * aimeat.io. The answer is the one the inline upload gave: key, store, owner_gaii, size, mime_type,
 * visibility, federate, created_at, embed_url, embed_markdown, versioned_url, and ai_provenance,
 * warnings or publish_request when the node adds them.
 * @param {Blob} file
 * @param {any} opts
 */
async function putFile(file, opts) {
  // A bare Blob has no .name (only File does) — reading it yields undefined → the fallback.
  const named = /** @type {File} */ (file);
  const key = opts?.key || named.name || ('file-' + Date.now());
  const mime_type = opts?.mime_type || file.type || 'application/octet-stream';
  const minted = await authFetch('/v1/storage', {
    method: 'POST',
    body: JSON.stringify({
      key, mime_type, visibility: levelOf(opts), mode: 'presigned', ...binding(opts),
      ...(opts && typeof opts.store === 'string' && opts.store ? { store: opts.store } : {}),
    }),
  });
  if (!minted.ok) throw uploadError(minted.error?.message || 'Upload failed', minted.error?.code, minted.status);
  const target = minted.data || {};
  if (typeof target.max_size_bytes === 'number' && file.size > target.max_size_bytes) {
    throw uploadError('Upload exceeds limit of ' + target.max_size_bytes + ' bytes', 'FILE_TOO_LARGE', 413);
  }
  // The address carries its own permission (a one-use token), so no Authorization header goes with it.
  const r = await fetch(target.upload_url, {
    method: target.upload_method || 'PUT',
    headers: { 'Content-Type': target.content_type || mime_type },
    body: file,
  });
  const text = await r.text();
  /** @type {any} */
  let answer;
  try {
    answer = JSON.parse(text);
  } catch (parseErr) {
    throw uploadError('Upload failed: the node answered ' + r.status + ' with no JSON (' + String(parseErr) + ')', undefined, r.status);
  }
  if (!r.ok || !answer || answer.success === false) {
    throw uploadError((answer && answer.message) || ('Upload failed: ' + r.status), answer && answer.error, r.status);
  }
  // The PUT answers in its own shape ({ success, type, ...file }); hand back the inline one.
  const stored = { ...answer };
  delete stored.success;
  delete stored.type;
  if (stored.federate === undefined) stored.federate = false;
  if (!stored.warnings && Array.isArray(target.warnings) && target.warnings.length) stored.warnings = target.warnings;
  return stored;
}

const storage = {
  // Upload a file (File object, Blob, or base64 string). opts: key, mime_type, visibility
  // ('private' | 'owner' | 'group' | 'public' | 'workspace'), for a shared file group_id or
  // workspace_ref / workspaceRefs, and store ('own:<name>' or 'node:<name>'). A File or a Blob goes as
  // its raw bytes in one PUT (putFile above); a base64 string still goes inline as JSON.
  async upload(fileOrData, opts) {
    if (fileOrData instanceof Blob) return putFile(fileOrData, opts);
    if (typeof fileOrData !== 'string') throw new Error('upload() expects a File, Blob, or base64 string');

    const res = await authFetch('/v1/storage', {
      method: 'POST',
      body: JSON.stringify({
        key: opts?.key || ('file-' + Date.now()),
        data: fileOrData,
        mime_type: opts?.mime_type || 'application/octet-stream',
        visibility: levelOf(opts),
        ...binding(opts),
        ...(opts && typeof opts.store === 'string' && opts.store ? { store: opts.store } : {}),
      }),
    });
    if (!res.ok) throw uploadError(res.error?.message || 'Upload failed', res.error?.code, res.status);
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

  /**
   * A URL that will actually LOAD in an <img>, a <video> or a new tab, for a file that is not public.
   *
   * The problem this exists for: a browser does not send an Authorization header when it fetches an
   * image, so `<img src="/v1/pub/alice@node/receipt.jpg">` on a private file draws a broken icon
   * even for the person who owns it. The node answers `?mode=handle` with a presigned, short-lived
   * address that carries its own permission, and that one loads anywhere.
   *
   * Takes what a table actually holds: a full address, a `/v1/pub/...` path, a `<gaii>/<key>`
   * reference (what the platform's own file tools return, an agent's upload included), or a bare
   * key of the signed-in person's own. A public file is handed back unchanged, because it already
   * works and a presigned URL for it would only add an expiry it does not need.
   *
   * The URL expires. Fetch it when you are about to show the picture, not when you load the page.
   */
  async viewUrl(addressOrKey, opts) {
    const session = getSession();
    const value = String(addressOrKey || '').trim();
    if (!value) throw new Error('viewUrl() needs an address or a key');

    // The PATH decides, never the host. An address stored in a data package was written by the node
    // under its own canonical URL, while an app on its own subdomain reaches that same node through
    // a different origin — so comparing hosts calls the node's own file "somebody else's" and hands
    // back an address that draws a broken icon. Found in a browser on 2026-08-17, where every
    // thumbnail fell back to a bare link.
    let path;
    if (/^https?:\/\//i.test(value)) {
      try { path = new URL(value).pathname; } catch { return value; }
    } else if (value.startsWith('/v1/pub/')) {
      path = value;
    } else {
      // A `<gaii>/<key>` reference names its owner in the first segment: the shape ctx.files.write()
      // and the agent file tools return, read with the same test as the server's parseFileRef (an
      // `@`, or an `ext:` namespace). Anything else is a key of the signed-in person's own.
      const slash = value.indexOf('/');
      const head = slash > 0 ? value.slice(0, slash) : '';
      const named = head.indexOf('@') !== -1 || head.startsWith('ext:');
      const owner = named ? head : (session.ghii || session.owner || '');
      const key = named ? value.slice(slash + 1) : value;
      path = '/v1/pub/' + encodeURIComponent(owner) + '/' + key.split('/').map(encodeURIComponent).join('/');
    }

    // Not an AIMEAT file address at all: a picture on somebody's own site, left exactly as written.
    if (path.indexOf('/v1/pub/') !== 0) return value;

    // A file on ANOTHER AIMEAT node. Ours to link to, not ours to sign: this node has no such file
    // and would answer 404 for an address that works.
    const ownerGaii = decodeURIComponent(path.slice('/v1/pub/'.length).split('/')[0] || '');
    const ourNode = String(session.ghii || '').split('@')[1];
    if (ourNode && ownerGaii.indexOf('@') !== -1 && ownerGaii.split('@')[1] !== ourNode) return value;

    const url = NODE_URL + path;
    const r = await fetch(url + '?mode=handle', {
      headers: session.jwt ? { 'Authorization': 'Bearer ' + session.jwt } : {},
    });
    if (!r.ok) throw new Error('Could not open that file: ' + r.status);
    const body = await r.json();
    const data = body.data || body;
    if (data.visibility === 'public' && !(opts && opts.forceSigned)) return url;
    return data.download_url;
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
    const visibility = levelOf(opts);
    const totalChunks = Math.ceil(file.size / chunkSize);

    // Init
    const initRes = await authFetch('/v1/storage/upload/init', {
      method: 'POST',
      body: JSON.stringify({ key, mime_type, visibility, chunk_size: chunkSize, total_chunks: totalChunks, ...binding(opts) }),
    });
    if (!initRes.ok) throw new Error(initRes.error?.message || 'Chunked upload init failed');
    const uploadId = initRes.data.upload_id;

    // Upload chunks, then complete. A failure on the way aborts the upload on the node: the session
    // holds its chunks there for six hours otherwise, and counts against the four an account may have open.
    try {
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

      const completeRes = await authFetch('/v1/storage/upload/' + uploadId + '/complete', { method: 'POST' });
      if (!completeRes.ok) throw new Error(completeRes.error?.message || 'Chunked upload complete failed');
      return completeRes.data;
    } catch (err) {
      // Best effort: a node that already ended the session answers 404, which changes nothing here.
      // A failed abort is logged, because the session then holds one of the four open slots for six
      // hours; the upload's own error is what the caller gets.
      await authFetch('/v1/storage/upload/' + uploadId, { method: 'DELETE' })
        .catch((abortErr) => console.warn('[aimeat storage] could not abort upload ' + uploadId + ':', abortErr));
      throw err;
    }
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
