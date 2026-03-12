/**
 * AIMEAT Knowledge Service
 * Knowledge package import, CRUD, links, prompts, discovery.
 */
import { api, apiGet, apiPost, apiDelete } from '/js/api.js';

/* ── Package Import ── */

export async function importPackage(pkg, overrides = {}, entryData = null) {
  const body = { package: pkg, overrides };
  if (entryData) body.entry_data = entryData;
  return apiPost('/v1/packages/import', body);
}

/* ── Package CRUD (via memory API) ── */

export async function listMyPackages() {
  const data = await apiGet('/v1/memory?prefix=packages/&tags=knowledge-package');
  const items = data?.data?.items || data?.data?.entries || [];
  return Array.isArray(items) ? items : [];
}

export async function getPackage(packageId) {
  return apiGet(`/v1/packages/${encodeURIComponent(packageId)}`);
}

export async function deletePackage(ownerGaii, packageId) {
  // Use admin endpoint for cascade delete (manifest + all entries)
  return apiDelete(`/v1/admin/knowledge/${encodeURIComponent(packageId)}`);
}

/* ── Links ── */

export async function listLinks(packageId, direction = 'both') {
  return apiGet(`/v1/packages/${encodeURIComponent(packageId)}/links?direction=${direction}`);
}

export async function createLink(packageId, target, relation, description) {
  return apiPost(`/v1/packages/${encodeURIComponent(packageId)}/link`, { target, relation, description });
}

export async function deleteLink(packageId, target) {
  return apiDelete(`/v1/packages/${encodeURIComponent(packageId)}/link`, { target });
}

/* ── Prompt Templates ── */

export async function getHumanPrompt() {
  return apiGet('/v1/templates/knowledge-packager-human');
}

export async function getAgentPrompt() {
  return apiGet('/v1/templates/knowledge-packager-agent');
}

/* ── Export ── */

export async function exportPackage(packageId, format = 'json') {
  return apiGet(`/v1/packages/${encodeURIComponent(packageId)}/export?format=${format}`);
}

/* ── Catalogue / Discovery ── */

export async function discoverPackages(opts = {}) {
  const params = new URLSearchParams();
  if (opts.content_type) params.set('content_type', opts.content_type);
  if (opts.tags) params.set('tags', opts.tags);
  if (opts.language) params.set('language', opts.language);
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.page) params.set('page', String(opts.page));
  if (opts.limit) params.set('limit', String(opts.limit));
  return apiGet(`/v1/catalogue/knowledge?${params.toString()}`);
}

/* ── Sharing Settings ── */

export async function updateSharing(packageId, sharing) {
  return api(`/v1/packages/${encodeURIComponent(packageId)}/sharing`, {
    method: 'PATCH',
    body: JSON.stringify(sharing),
  });
}

export async function updateEntryVisibility(packageId, entryKey, visibility) {
  return api(`/v1/packages/${encodeURIComponent(packageId)}/entries/${encodeURIComponent(entryKey)}/visibility`, {
    method: 'PATCH',
    body: JSON.stringify({ visibility }),
  });
}

/* ── Clone ── */

export async function clonePackage(packageId, targetPrefix, entries) {
  return apiPost(`/v1/packages/${encodeURIComponent(packageId)}/clone`, {
    target_prefix: targetPrefix,
    entries,
  });
}

/* ── Organism Knowledge ── */

export async function listOrganismPackages(organismId) {
  return apiGet(`/v1/packages/organism/${encodeURIComponent(organismId)}`);
}

export async function contributeToOrganism(packageId, organismId) {
  return apiPost(`/v1/packages/${encodeURIComponent(packageId)}/contribute`, { organism_id: organismId });
}

/* ── Reputation ── */

export async function getPackageReputation(packageId) {
  return apiGet(`/v1/packages/${encodeURIComponent(packageId)}/reputation`);
}

/* ── Reviews ── */

export async function getPackageReviews(packageId) {
  return apiGet(`/v1/packages/${encodeURIComponent(packageId)}/reviews`);
}
