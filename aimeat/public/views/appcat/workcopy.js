/**
 * @file public/views/appcat/workcopy.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The working copy behind appcat's edit loop, on the node and nowhere else. One
 *   persistent working copy per app is the app's server draft slot (PUT /v1/apps/:owner/:file/draft);
 *   beside it a rolling history of checkpoints, the bytes each save replaced, kept as private memory
 *   records of the owner: the index `app-catalog.wc.{slug}` ({ version: 1, updatedAt, items: [{ id,
 *   at, note, size }] }, newest first, at most 8) and one body per checkpoint
 *   `app-catalog.wc.{slug}.b{id}` ({ html: base64 }). The keys and shapes are the old catalogue's
 *   (src/static/app-catalog/js/workcopy.js), so a checkpoint saved there is read here and back.
 *   Also the app's bytes themselves: the published bytes, the draft's, as base64 and as text.
 * @structure slugFor · getCheckpoints · loadCheckpoints · saveWorkingCopy · readCheckpoint ·
 *   deleteCheckpoint · getDraft · putDraft · discardWorkingCopy · draftCall · fetchAppBytes ·
 *   b64ToText · textToB64
 * @usage import { saveWorkingCopy, loadCheckpoints } from '/views/appcat/workcopy.js'
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial: the old catalogue's workcopy.js on the SPA's api(), same keys.
 */
import { api, apiGet, apiPost, apiPut, apiDelete } from '/js/api.js';
import { authHeaders } from '/js/services/auth.js';

// Each checkpoint is a whole HTML file in a record of its own (the node caps one memory value at
// about 1 MB), and they count against the owner's memory, so the window is small.
const MAX_CHECKPOINTS = 8;
const PREFIX = 'app-catalog.wc';

/** slug → the checkpoint index (newest first), so a list can draw between loads. */
const cache = {};

const appPath = (owner, filename) => '/v1/apps/' + encodeURIComponent(owner) + '/' + encodeURIComponent(filename);

/** A key-safe slug for one app's checkpoint records (the old catalogue's rule). */
export function slugFor(owner, filename) {
  return (String(owner || '') + '-' + String(filename || ''))
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80);
}
const indexKey = (slug) => PREFIX + '.' + slug;
const bodyKey = (slug, id) => PREFIX + '.' + slug + '.b' + id;

/** A memory value, or null when there is none (a missing record answers 404). */
async function memGet(key) {
  try {
    const j = await apiGet('/v1/memory/' + encodeURIComponent(key));
    return (j && j.data && j.data.value) || null;
  } catch (err) {
    void err;
    // eslint-disable-next-line aimeat/no-silent-catch -- no record, or signed out: the same answer, nothing stored (the old page's memGet)
    return null;
  }
}

const memPut = (key, value) => apiPost('/v1/memory', { key, value, visibility: 'private' });

/** Best effort: a failed prune leaves a body record the index no longer points at. */
async function memDelete(key) {
  try { await apiDelete('/v1/memory/' + encodeURIComponent(key)); } catch (err) { void err; /* an orphan record is harmless */ }
}

/** The cached checkpoint index of an app (newest first); empty until loadCheckpoints answers. */
export function getCheckpoints(owner, filename) {
  return cache[slugFor(owner, filename)] || [];
}

/** Read the app's checkpoint index. Signed out or none yet → []. Never rejects. */
export async function loadCheckpoints(owner, filename) {
  const slug = slugFor(owner, filename);
  const v = await memGet(indexKey(slug));
  cache[slug] = v && Array.isArray(v.items) ? v.items : [];
  return cache[slug];
}

/** Store `b64` as the newest checkpoint and prune past the window. The body goes in its own record. */
async function pushCheckpoint(slug, b64, note) {
  const id = String(Date.now());
  await memPut(bodyKey(slug, id), { html: b64 });
  const entry = { id, at: new Date().toISOString(), note: String(note || '').slice(0, 160), size: Math.round(b64.length * 0.75) };
  const all = [entry].concat(cache[slug] || []);
  const keep = all.slice(0, MAX_CHECKPOINTS);
  cache[slug] = keep;
  await memPut(indexKey(slug), { version: 1, updatedAt: entry.at, items: keep });
  await Promise.all(all.slice(MAX_CHECKPOINTS).map((p) => memDelete(bodyKey(slug, p.id))));
  return entry;
}

/** The saved working copy ({ content: base64, updated_at }), or null when there is none. */
export async function getDraft(owner, filename) {
  try {
    const j = await apiGet(appPath(owner, filename) + '/draft');
    return j && j.data && typeof j.data.content === 'string' ? j.data : null;
  } catch (err) {
    void err;
    // eslint-disable-next-line aimeat/no-silent-catch -- no draft slot: the published bytes stand (the old page's getDraft)
    return null;
  }
}

/** Put the bytes (base64) into the app's draft slot, the working copy that lasts. */
export async function putDraft(owner, filename, b64) {
  const j = await apiPut(appPath(owner, filename) + '/draft', { content: b64 });
  return j.data;
}

/** Drop the draft slot; the live app is untouched. Idempotent. */
export async function discardWorkingCopy(owner, filename) {
  try { await apiDelete(appPath(owner, filename) + '/draft'); } catch (err) { void err; /* nothing to discard */ }
}

/**
 * A POST on the draft slot's own doors: 'draft/preview-token' (a short-lived owner-only address for
 * the draft) or 'publish-draft' (the draft becomes the next version). Resolves to `data`.
 */
export async function draftCall(owner, filename, sub) {
  const j = await api(appPath(owner, filename) + '/' + sub, { method: 'POST' });
  return j.data;
}

/**
 * Save new bytes as the working copy. The bytes being replaced become a checkpoint first, so the
 * state being left is always there to go back to; a failed checkpoint does not stop the save.
 * @param {{ owner: string, filename: string, previousB64?: string|null, nextB64: string, note?: string }} opts
 */
export async function saveWorkingCopy({ owner, filename, previousB64, nextB64, note }) {
  const slug = slugFor(owner, filename);
  let entry = null;
  if (previousB64 && previousB64 !== nextB64) {
    try { entry = await pushCheckpoint(slug, previousB64, note); } catch (err) { void err; /* the save goes on without it */ }
  }
  const draft = await putDraft(owner, filename, nextB64);
  return { checkpointed: !!entry, draft };
}

/** One checkpoint's stored bytes (base64), or null when it is gone. */
export async function readCheckpoint(owner, filename, id) {
  const v = await memGet(bodyKey(slugFor(owner, filename), id));
  return v && typeof v.html === 'string' ? v.html : null;
}

/** Take one checkpoint out of the index and delete its body. */
export async function deleteCheckpoint(owner, filename, id) {
  const slug = slugFor(owner, filename);
  const items = (cache[slug] || []).filter((c) => c.id !== id);
  cache[slug] = items;
  await memPut(indexKey(slug), { version: 1, updatedAt: new Date().toISOString(), items });
  await memDelete(bodyKey(slug, id));
}

/** Bytes → base64, in chunks so a large app does not overflow the call stack. */
function bytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** An app's published bytes (or one version's) as base64, with the session when there is one. */
export async function fetchAppBytes(owner, filename, version) {
  const resp = await fetch(appPath(owner, filename) + (version ? '?version=' + version : ''), { headers: authHeaders() });
  if (!resp.ok) {
    const err = new Error('HTTP ' + resp.status);
    err.status = resp.status;
    throw err;
  }
  return bytesToB64(new Uint8Array(await resp.arrayBuffer()));
}

/** base64 → the text it holds (UTF-8), '' when it is not text. */
export function b64ToText(b64) {
  try {
    const bin = atob(b64 || '');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch (err) {
    void err;
    // eslint-disable-next-line aimeat/no-silent-catch -- not base64 is no text: the callers say "no source" in words
    return '';
  }
}

/** Text → base64 of its UTF-8 bytes. */
export function textToB64(text) {
  return bytesToB64(new TextEncoder().encode(String(text || '')));
}
