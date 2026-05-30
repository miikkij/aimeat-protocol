/**
 * AIMEAT Memory Service
 * Key-value memory CRUD, search, file management.
 */
import { api, apiGet, apiPost, apiDelete } from '/js/api.js';

/** List all memory entries. Returns array. Optional agentGaii to view another agent's memory. */
export async function listMemories(agentGaii) {
  const url = agentGaii ? `/v1/memory?agent=${encodeURIComponent(agentGaii)}` : '/v1/memory';
  const data = await apiGet(url);
  const list = data?.data?.items || data?.data?.entries || [];
  return Array.isArray(list) ? list : [];
}

/** Search memory by query string. Returns array. Optional agentGaii. */
export async function searchMemory(query, agentGaii) {
  let url = `/v1/memory/search?q=${encodeURIComponent(query)}`;
  if (agentGaii) url += `&agent=${encodeURIComponent(agentGaii)}`;
  const data = await apiGet(url);
  const list = data?.data?.results || data?.data || [];
  return Array.isArray(list) ? list : [];
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
