/**
 * @file memory.js
 * @description AIMEAT Memory Service — key-value memory CRUD, search, file management.
 * @version-history
 *   v1.1.0 — 2026-06-10 — Add getMemory(key) single-entry read (GET /v1/memory/:key).
 *   v1.2.0 — 2026-06-21 — getMemory(key, { soft }) — optional ?soft=1 read returning 200/null
 *                          for keys that may not exist yet (kills browser-console 404 noise).
 *   v1.3.0 — 2026-06-22 — Scalable Memory tab helpers: listMemoriesMeta (include=meta, values omitted),
 *                          searchMemory prefix arg, exportMemory/importMemory/bulkDeleteMemory.
 */
import { api, apiGet, apiPost, apiDelete } from '/js/api.js';

/** List all memory entries. Returns array. Optional agentGaii to view another agent's memory. */
export async function listMemories(agentGaii, opts) {
  const p = new URLSearchParams();
  if (agentGaii) p.set('agent', agentGaii);
  if (opts?.archived === 'only') p.set('archived', 'only');
  else if (opts?.archived === 'include') p.set('include_archived', 'true');
  const url = '/v1/memory' + (p.toString() ? '?' + p.toString() : '');
  const data = await apiGet(url);
  const list = data?.data?.items || data?.data?.entries || [];
  return Array.isArray(list) ? list : [];
}

/**
 * List memory metadata only — keys/tags/visibility/timestamps + per-entry `bytes`, NO values
 * (include=meta). Fast for thousands of keys; values are fetched per-key on expand via getMemory().
 * Returns { items, quota } so the tab can render the storage-usage bar.
 */
export async function listMemoriesMeta(agentGaii, opts) {
  let url = '/v1/memory?include=meta';
  if (agentGaii) url += `&agent=${encodeURIComponent(agentGaii)}`;
  if (opts?.archived === 'only') url += '&archived=only';
  else if (opts?.archived === 'include') url += '&include_archived=true';
  const data = await apiGet(url);
  const list = data?.data?.items || data?.data?.entries || [];
  return { items: Array.isArray(list) ? list : [], quota: data?.data?.quota || null };
}

/** Cheap count of owner-scope memory entries (no values transferred). For stat displays. */
export async function countMemories() {
  const data = await apiGet('/v1/memory?count=true');
  return data?.data?.count ?? 0;
}

/**
 * Read a single memory entry. Returns the envelope ({ data: { key, value, version, ... } }).
 * By default throws/404s if missing. Pass { soft: true } for optional keys (UI prefs, config)
 * that may legitimately not exist yet: the server returns a 200 with { value: null, exists: false }
 * instead of a 404, avoiding browser-console 404 noise.
 */
export async function getMemory(key, opts) {
  const params = new URLSearchParams();
  if (opts && opts.soft) params.set('soft', '1');
  if (opts && opts.agent) params.set('agent', opts.agent);
  const q = params.toString();
  return apiGet(`/v1/memory/${encodeURIComponent(key)}${q ? '?' + q : ''}`);
}

/**
 * Search memory by query string (server-side: matches key, value, and tags). Returns array.
 * @param {string} [agentGaii] Owner-session: restrict to one agent's keyspace.
 * @param {string} [prefix] Scope the search to a namespace/group (keys beginning with prefix).
 */
export async function searchMemory(query, agentGaii, prefix) {
  let url = `/v1/memory/search?q=${encodeURIComponent(query)}`;
  if (agentGaii) url += `&agent=${encodeURIComponent(agentGaii)}`;
  if (prefix) url += `&prefix=${encodeURIComponent(prefix)}`;
  const data = await apiGet(url);
  const list = data?.data?.results || data?.data || [];
  return Array.isArray(list) ? list : [];
}

/**
 * Export all of the caller's memory entries (full values) as a JSON backup object
 * ({ exported_at, node_id, count, entries }). Optional agentGaii / prefix scope.
 */
export async function exportMemory(agentGaii, prefix) {
  const params = new URLSearchParams();
  if (agentGaii) params.set('agent', agentGaii);
  if (prefix) params.set('prefix', prefix);
  const qs = params.toString();
  const data = await apiGet('/v1/memory/export' + (qs ? '?' + qs : ''));
  return data?.data || { entries: [], count: 0 };
}

/**
 * Import (restore/merge) a backup's entries. mode = 'skip' | 'overwrite' | 'rename'.
 * Returns the summary envelope ({ data: { created, updated, skipped, failed } }).
 */
export async function importMemory(entries, mode, agentGaii) {
  const body = { entries, mode: mode || 'skip' };
  if (agentGaii) body.agent = agentGaii;
  return apiPost('/v1/memory/import', body);
}

/**
 * Download a ZIP bundle of selected memory entries + storage files (the "collection cart").
 * @param {Array<{ kind: 'memory'|'file', key: string, owner_gaii?: string }>} items
 * @returns {Promise<Blob>} the ZIP blob (throws on a non-2xx response).
 */
export async function bundleCollection(items) {
  const headers = { 'Content-Type': 'application/json' };
  if (window.AIMEAT?.auth?.hasSession) {
    const s = window.AIMEAT.auth.getSession();
    if (s?.jwt) headers['Authorization'] = 'Bearer ' + s.jwt;
  }
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  const resp = await fetch(`${base}/v1/memory/bundle`, { method: 'POST', headers, body: JSON.stringify({ items }) });
  if (!resp.ok) {
    let msg = String(resp.status);
    try { const j = await resp.json(); msg = j?.error?.message || msg; } catch { /* non-JSON */ }
    throw new Error(msg);
  }
  return resp.blob();
}

/**
 * Bulk-delete memory entries by prefix and/or an explicit key list. Returns envelope ({ data: { deleted } }).
 * @param {{ prefix?: string, keys?: string[], agentGaii?: string }} [opts]
 */
export async function bulkDeleteMemory({ prefix, keys, agentGaii } = {}) {
  const body = {};
  if (prefix) body.prefix = prefix;
  if (keys && keys.length) body.keys = keys;
  if (agentGaii) body.agent = agentGaii;
  return apiPost('/v1/memory/bulk-delete', body);
}

/**
 * Librarian full-text search across all of the caller's content (GET /v1/librarian/search).
 * Returns the ranked hits array (each: { key, title, snippet, score, organismId, workspaceId, ... }).
 */
export async function librarianSearch(query, limit, scope) {
  let url = `/v1/librarian/search?q=${encodeURIComponent(query)}`;
  if (limit) url += `&limit=${encodeURIComponent(limit)}`;
  if (scope) url += `&scope=${encodeURIComponent(scope)}`;
  const data = await apiGet(url);
  const hits = data?.data?.hits || [];
  return Array.isArray(hits) ? hits : [];
}

/**
 * Create a new memory entry.
 * @param {string} [agentGaii] Owner-session only — store the entry under one of
 *   the owner's own agents (the agent's GAII) instead of the owner's GHII.
 */
export async function createMemory(key, value, visibility, tags, groupId, agentGaii) {
  const body = { key, value, visibility: visibility || 'private' };
  if (tags) body.tags = Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim()).filter(Boolean);
  if (visibility === 'group' && groupId) body.group_id = groupId;
  if (agentGaii) body.agent = agentGaii;
  return api('/v1/memory', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Update (PUT) a memory entry value. */
export async function updateMemory(key, value, version) {
  return api(`/v1/memory/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value, version }),
  });
}

/** Update multiple fields on a memory entry (must include version). */
export async function updateMemoryFull(key, fields) {
  return api(`/v1/memory/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify(fields),
  });
}

/** Update visibility on a memory entry. */
export async function updateMemoryVisibility(key, visibility, version, groupId) {
  const body = { visibility, version };
  if (visibility === 'group' && groupId) body.group_id = groupId;
  return api(`/v1/memory/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

/** Update tags on a memory entry. */
export async function updateMemoryTags(key, tags, version) {
  return api(`/v1/memory/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ tags, version }),
  });
}

/** Update tags on a file. */
export async function updateFileTags(key, tags) {
  return api(`/v1/memory/files/${encodeURIComponent(key)}`, {
    method: 'PATCH',
    body: JSON.stringify({ tags }),
  });
}

/** Delete a memory entry. */
export async function deleteMemory(key) {
  return apiDelete(`/v1/memory/${encodeURIComponent(key)}`);
}

/** List files. Returns array. */
export async function listFiles() {
  const data = await apiGet('/v1/memory/files');
  const list = data?.data?.files || data?.data || [];
  return Array.isArray(list) ? list : [];
}

/** Cheap count of files (no metadata transferred). For stat displays. */
export async function countFiles() {
  const data = await apiGet('/v1/memory/files?count=true');
  return data?.data?.count ?? 0;
}

/** Upload a file (base64). */
export async function uploadFile(key, base64Content, mimeType, visibility, tags) {
  const body = {
    key,
    content: base64Content,
    mime_type: mimeType || 'application/octet-stream',
    visibility: visibility || 'private',
  };
  if (tags && tags.length > 0) body.tags = tags;
  return api('/v1/memory/files', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Update visibility on a file. */
export async function updateFileVisibility(key, visibility) {
  return api(`/v1/memory/files/${encodeURIComponent(key)}/visibility`, {
    method: 'PATCH',
    body: JSON.stringify({ visibility }),
  });
}

/** Delete a file. */
export async function deleteFile(key) {
  return apiDelete(`/v1/memory/files/${encodeURIComponent(key)}`);
}

/** Pull (copy) a memory entry from the home node to this node (federated sessions). */
export async function pullFromHome(key) {
  return apiPost('/v1/memory/pull', { key });
}

/** Push (save) a local memory entry to the home node (federated sessions). */
export async function pushToHome(key) {
  return apiPost('/v1/memory/push-home', { key });
}

/** List memory entries on the home node (federated sessions). */
export async function listHomeMemories() {
  const resp = await apiPost('/v1/memory/list-home', {});
  return resp?.data?.entries || [];
}

/** List memory entries on a remote peer node (home sessions). */
export async function listRemoteMemories(peerNodeId) {
  const resp = await apiPost('/v1/memory/list-remote', { peer_node_id: peerNodeId });
  return resp?.data?.entries || [];
}

/** Pull a memory entry from a remote peer node (home sessions). */
export async function pullFromRemote(peerNodeId, key) {
  return apiPost('/v1/memory/pull-remote', { peer_node_id: peerNodeId, key });
}

/** Discover public memory entries from other users on this node. */
export async function discoverPublicMemories(opts = {}) {
  const params = new URLSearchParams();
  if (opts.prefix) params.set('prefix', opts.prefix);
  if (opts.owner) params.set('owner', opts.owner);
  if (opts.q) params.set('q', opts.q);
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.offset) params.set('offset', String(opts.offset));
  const qs = params.toString();
  const data = await apiGet('/v1/memory/discover' + (qs ? '?' + qs : ''));
  return data?.data || { items: [], total: 0 };
}

/** Copy a public memory entry from another user to your own memory. */
export async function copyPublicMemory(sourceGaii, key, visibility) {
  return apiPost('/v1/memory/copy', {
    source_gaii: sourceGaii,
    key,
    visibility: visibility || 'private',
  });
}
