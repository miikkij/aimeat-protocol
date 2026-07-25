/**
 * @file workcopy.js
 * @description The working-copy model behind the app-catalog edit loop. ONE persistent working copy
 *   per app — the server draft slot (PUT /v1/apps/:owner/:file/draft, TARGET-030) — plus a rolling
 *   history of CHECKPOINTS: the bytes each save replaced, kept as per-owner memory records via the
 *   generic /v1/memory API. Before this module the catalog's "Save" only overwrote a transient
 *   in-memory blob (db.js is server-only, no browser persistence): it survived neither a reload nor
 *   the next save, which is exactly why editing felt like editing the same version forever. Saving
 *   now (a) checkpoints the previous bytes and (b) persists the new bytes server-side, so nothing is
 *   lost, the work can be tested on a real origin, and publishing stays the separate, deliberate step.
 * @structure
 *   - slugFor(owner, filename)             → memory-key slug for one app
 *   - loadCheckpoints / getCheckpoints     → the app's checkpoint index (newest first)
 *   - saveWorkingCopy({...})               → checkpoint the replaced bytes + PUT the server draft
 *   - readCheckpoint / deleteCheckpoint    → restore or prune one checkpoint
 *   - discardWorkingCopy                   → drop the server draft slot
 * @usage import { saveWorkingCopy, loadCheckpoints, getCheckpoints, readCheckpoint } from './workcopy.js'
 * @version-history
 *   v1.0.0 — 2026-07-25 — Initial (TARGET-048): persistent working copy + checkpoint history, so
 *     local edits stop vanishing and "saved" stops meaning "kept only until you reload".
 */
import { loadConfig } from './config.js';
import { getCortexOwnerToken } from './cortex.js';

// How many checkpoints to keep per app. Each checkpoint is a full HTML snapshot in its OWN memory
// record (the node caps a single memory value at ~1 MB, so they must not share one document), and
// they count against the owner's memory quota — hence a small rolling window, oldest pruned first.
const MAX_CHECKPOINTS = 8;
const PREFIX = 'app-catalog.wc';

// slug -> checkpoint index array (newest first). Mirrors the server doc so the detail view can
// render synchronously between loads.
let cache = {};

function base() { return (loadConfig().aimeatUrl || '').replace(/\/+$/, ''); }
function tok() { return getCortexOwnerToken(); }

/** Stable, key-safe slug for one app's checkpoint records. */
export function slugFor(owner, filename) {
  return (String(owner || '') + '-' + String(filename || ''))
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80);
}
function indexKey(slug) { return PREFIX + '.' + slug; }
function bodyKey(slug, id) { return PREFIX + '.' + slug + '.b' + id; }

function memGet(key) {
  var b = base(), token = tok();
  if (!b || !token) return Promise.resolve(null);
  return fetch(b + '/v1/memory/' + encodeURIComponent(key), { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { return (j && j.data && j.data.value) || null; })
    .catch(function () { return null; });
}

function memPut(key, value) {
  var b = base(), token = tok();
  if (!b || !token) return Promise.reject(new Error('not signed in'));
  return fetch(b + '/v1/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ key: key, value: value, visibility: 'private' }),
  }).then(function (r) {
    return r.json().then(function (j) {
      if (!r.ok || (j && j.ok === false)) throw new Error((j && j.error && j.error.message) || ('HTTP ' + r.status));
      return j;
    });
  });
}

// Best-effort: a failed prune only leaves an orphan body record the index no longer points at.
function memDelete(key) {
  var b = base(), token = tok();
  if (!b || !token) return Promise.resolve();
  return fetch(b + '/v1/memory/' + encodeURIComponent(key), {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + token },
  }).catch(function () { /* orphan record is harmless */ });
}

/** The cached checkpoint index for an app (newest first). Empty until loadCheckpoints resolves. */
export function getCheckpoints(owner, filename) {
  return cache[slugFor(owner, filename)] || [];
}

/** Fetch the app's checkpoint index. Logged out / none yet → []. Never rejects. */
export function loadCheckpoints(owner, filename) {
  var slug = slugFor(owner, filename);
  return memGet(indexKey(slug)).then(function (v) {
    var items = (v && Array.isArray(v.items)) ? v.items : [];
    cache[slug] = items;
    return items;
  });
}

// Store `b64` as a new checkpoint, newest first, pruning past MAX_CHECKPOINTS. The body goes in its
// own record so one snapshot never blows the per-value size cap.
function pushCheckpoint(slug, b64, note) {
  var id = String(Date.now());
  return memPut(bodyKey(slug, id), { html: b64 }).then(function () {
    var entry = {
      id: id,
      at: new Date().toISOString(),
      note: String(note || '').slice(0, 160),
      size: Math.round(b64.length * 0.75),
    };
    var all = [entry].concat(cache[slug] || []);
    var keep = all.slice(0, MAX_CHECKPOINTS);
    var prune = all.slice(MAX_CHECKPOINTS);
    cache[slug] = keep;
    return memPut(indexKey(slug), { version: 1, updatedAt: entry.at, items: keep })
      .then(function () {
        return Promise.all(prune.map(function (p) { return memDelete(bodyKey(slug, p.id)); }));
      })
      .then(function () { return entry; });
  });
}

/**
 * Read the saved working copy back (base64), or null when there is none. Essential after a reload:
 * without it the catalog can only re-fetch the LIVE bytes, and would then show the published app
 * while calling it your working copy — and overwrite the real one on the next save.
 */
export function getDraft(owner, filename) {
  var b = base(), token = tok();
  if (!b || !token) return Promise.resolve(null);
  return fetch(b + '/v1/apps/' + encodeURIComponent(owner) + '/' + encodeURIComponent(filename) + '/draft', {
    headers: { 'Authorization': 'Bearer ' + token },
  })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { return (j && j.data && typeof j.data.content === 'string') ? j.data : null; })
    .catch(function () { return null; });
}

/** PUT the bytes into the app's server draft slot (the persistent working copy). */
export function putDraft(owner, filename, b64) {
  var b = base(), token = tok();
  if (!b || !token) return Promise.reject(new Error('not signed in'));
  return fetch(b + '/v1/apps/' + encodeURIComponent(owner) + '/' + encodeURIComponent(filename) + '/draft', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ content: b64 }),
  }).then(function (r) {
    return r.json().then(function (j) {
      if (!j.ok) throw new Error((j.error && (j.error.message || j.error.code)) || ('HTTP ' + r.status));
      return j.data;
    });
  });
}

/** Discard the server draft slot (the live app is untouched). Idempotent. */
export function discardWorkingCopy(owner, filename) {
  var b = base(), token = tok();
  if (!b || !token) return Promise.resolve();
  return fetch(b + '/v1/apps/' + encodeURIComponent(owner) + '/' + encodeURIComponent(filename) + '/draft', {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + token },
  }).catch(function () { /* nothing to discard */ });
}

/**
 * Save new bytes as the app's working copy.
 * opts = { owner, filename, previousB64, nextB64, note }
 * The bytes being REPLACED (previousB64) become a checkpoint first — so the state you are leaving
 * is always recoverable — then the new bytes are persisted to the server draft slot.
 * Resolves to { checkpointed: bool, draft }.
 */
export function saveWorkingCopy(opts) {
  var owner = opts.owner, filename = opts.filename;
  var slug = slugFor(owner, filename);
  var shouldCheckpoint = !!opts.previousB64 && opts.previousB64 !== opts.nextB64;
  var chain = shouldCheckpoint
    ? pushCheckpoint(slug, opts.previousB64, opts.note).catch(function () { return null; })
    : Promise.resolve(null);
  return chain.then(function (entry) {
    return putDraft(owner, filename, opts.nextB64).then(function (draft) {
      return { checkpointed: !!entry, draft: draft };
    });
  });
}

/** Read one checkpoint's stored HTML (base64). Missing/expired → null. */
export function readCheckpoint(owner, filename, id) {
  return memGet(bodyKey(slugFor(owner, filename), id)).then(function (v) {
    return (v && typeof v.html === 'string') ? v.html : null;
  });
}

/** Remove one checkpoint from the index and delete its body record. */
export function deleteCheckpoint(owner, filename, id) {
  var slug = slugFor(owner, filename);
  var items = (cache[slug] || []).filter(function (c) { return c.id !== id; });
  cache[slug] = items;
  return memPut(indexKey(slug), { version: 1, updatedAt: new Date().toISOString(), items: items })
    .then(function () { return memDelete(bodyKey(slug, id)); });
}
