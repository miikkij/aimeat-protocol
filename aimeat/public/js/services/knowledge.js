/**
 * @file public/js/services/knowledge.js
 * @description Frontend API service layer for knowledge packages — wraps the /v1/knowledge and
 *   related endpoints for import, CRUD, links, sharing, discovery, cloning, and reputation.
 *
 * @structure
 *   - importPackage / getPackage / deletePackage: package lifecycle over memory + admin endpoints
 *   - listLinks / createLink / deleteLink: inter-package relations
 *   - discoverPackages / listOrganismPackages / contributeToOrganism: catalogue + organism sharing
 *   - updateSharing / updateEntryVisibility / clonePackage: visibility and copy operations
 *   - getPackageReputation / getPackageReviews / getHumanPrompt / getAgentPrompt: reputation + templates
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { api, apiGet, apiPost, apiDelete } from '/js/api.js';

/* ── Package Import ── */

export async function importPackage(pkg, overrides = {}, entryData = null) {
  const body = { package: pkg, overrides };
  if (entryData) body.entry_data = entryData;
  return apiPost('/v1/knowledge/import', body);
}

/* ── Package CRUD (via memory API) ── */

export async function listMyPackages() {
  const data = await apiGet('/v1/memory?prefix=packages/&tags=knowledge-package');
  const items = data?.data?.items || data?.data?.entries || [];
  return Array.isArray(items) ? items : [];
}

export async function getPackage(packageId) {
  return apiGet(`/v1/knowledge/${encodeURIComponent(packageId)}`);
}

export async function deletePackage(ownerGaii, packageId) {
  // Use admin endpoint for cascade delete (manifest + all entries)
  return apiDelete(`/v1/admin/knowledge/${encodeURIComponent(packageId)}`);
}

/* ── Links ── */

export async function listLinks(packageId, direction = 'both') {
  return apiGet(`/v1/knowledge/${encodeURIComponent(packageId)}/links?direction=${direction}`);
}

export async function createLink(packageId, target, relation, description) {
  return apiPost(`/v1/knowledge/${encodeURIComponent(packageId)}/link`, { target, relation, description });
}

export async function deleteLink(packageId, target) {
  return apiDelete(`/v1/knowledge/${encodeURIComponent(packageId)}/link`, { target });
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
  return apiGet(`/v1/knowledge/${encodeURIComponent(packageId)}/export?format=${format}`);
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
  return api(`/v1/knowledge/${encodeURIComponent(packageId)}/sharing`, {
    method: 'PATCH',
    body: JSON.stringify(sharing),
  });
}

export async function updateEntryVisibility(packageId, entryKey, visibility) {
  return api(`/v1/knowledge/${encodeURIComponent(packageId)}/entries/${encodeURIComponent(entryKey)}/visibility`, {
    method: 'PATCH',
    body: JSON.stringify({ visibility }),
  });
}

/* ── Clone ── */

export async function clonePackage(packageId, targetPrefix, entries) {
  return apiPost(`/v1/knowledge/${encodeURIComponent(packageId)}/clone`, {
    target_prefix: targetPrefix,
    entries,
  });
}

/* ── Organism Knowledge ── */

export async function listOrganismPackages(organismId) {
  return apiGet(`/v1/knowledge/organism/${encodeURIComponent(organismId)}`);
}

export async function contributeToOrganism(packageId, organismId) {
  return apiPost(`/v1/knowledge/${encodeURIComponent(packageId)}/contribute`, { organism_id: organismId });
}

/* ── Reputation ── */

export async function getPackageReputation(packageId) {
  return apiGet(`/v1/knowledge/${encodeURIComponent(packageId)}/reputation`);
}

/* ── Reviews ── */

export async function getPackageReviews(packageId) {
  return apiGet(`/v1/knowledge/${encodeURIComponent(packageId)}/reviews`);
}
