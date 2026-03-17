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

/** Create a new memory entry. */
export async function createMemory(key, value, visibility, tags) {
  const body = { key, value, visibility: visibility || 'private' };
  if (tags) body.tags = Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim()).filter(Boolean);
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
export async function updateMemoryVisibility(key, visibility, version) {
  return api(`/v1/memory/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ visibility, version }),
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
