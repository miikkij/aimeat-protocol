/**
 * @file packages.js
 * @description API service layer for the AIMEAT packages, instances, and templates system.
 *   Provides functions for CRUD operations on packages, package versions, instances
 *   (install/update/remove), and template gallery listings including reviews and discussions.
 * @structure
 *   - Packages: listPackages, getPackage, getPackageVersions, createPackage, createVersion, updatePackage, archiveVersion
 *   - Instances: listInstances, getInstance, getInstanceStatus, installPackage, checkUpdate, getMigrationPrompt, applyMigration, removeInstance
 *   - Templates: listTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate, addReview, getReviews, addDiscussion, getDiscussions, toggleFeatured
 *   - ZIP Import/Export: exportPackageZip, importPackageZip
 *   - Template Proposals: proposeAsTemplate
 * @usage
 *   import * as pkgService from '/js/services/packages.js';
 *   const res = await pkgService.listPackages({ status: 'published' });
 * @version-history
 *   v1.0.0 — 2026-03-15 — initial implementation (Phase 6)
 *   v1.1.0 — 2026-03-20 — add exportPackageZip, importPackageZip, proposeAsTemplate
 *   v1.2.0 — 2026-03-20 — add syncFederationTemplates, listFederationTemplates
 */
import { apiGet, apiPost, apiPatch, apiDelete } from '/js/api.js';

// ── Packages ──
export const listPackages = (params) => apiGet('/v1/packages' + buildQuery(params));
export const getPackage = (groupId) => apiGet(`/v1/packages/${enc(groupId)}`);
export const getPackageVersions = (groupId) => apiGet(`/v1/packages/${enc(groupId)}/versions`);
export const createPackage = (data) => apiPost('/v1/packages', data);
export const createVersion = (groupId, data) => apiPost(`/v1/packages/${enc(groupId)}/versions`, data);
export const updatePackage = (groupId, data) => apiPatch(`/v1/packages/${enc(groupId)}`, data);
export const archiveVersion = (groupId, version) => apiDelete(`/v1/packages/${enc(groupId)}/versions/${enc(version)}`);

// ── Instances ──
export const listInstances = (params) => apiGet('/v1/instances' + buildQuery(params));
export const getInstance = (id) => apiGet(`/v1/instances/${enc(id)}`);
export const getInstanceStatus = (id) => apiGet(`/v1/instances/${enc(id)}/status`);
export const installPackage = (groupId, data) => apiPost(`/v1/packages/${enc(groupId)}/install`, data);
export const checkUpdate = (id) => apiGet(`/v1/instances/${enc(id)}/check-update`);
export const getMigrationPrompt = (id, data) => apiPost(`/v1/instances/${enc(id)}/migration-prompt`, data);
export const applyMigration = (id, data) => apiPost(`/v1/instances/${enc(id)}/apply-migration`, data);
export const removeInstance = (id, removeComponents) => apiDelete(`/v1/instances/${enc(id)}` + buildQuery({ removeComponents }));

// ── Templates ──
export const listTemplates = (params) => apiGet('/v1/templates' + buildQuery(params));
export const getTemplate = (id) => apiGet(`/v1/templates/${enc(id)}`);
export const createTemplate = (data) => apiPost('/v1/templates', data);
export const updateTemplate = (id, data) => apiPatch(`/v1/templates/${enc(id)}`, data);
export const deleteTemplate = (id) => apiDelete(`/v1/templates/${enc(id)}`);
export const addReview = (id, data) => apiPost(`/v1/templates/${enc(id)}/review`, data);
export const getReviews = (id, params) => apiGet(`/v1/templates/${enc(id)}/reviews` + buildQuery(params));
export const addDiscussion = (id, data) => apiPost(`/v1/templates/${enc(id)}/discussion`, data);
export const getDiscussions = (id, params) => apiGet(`/v1/templates/${enc(id)}/discussions` + buildQuery(params));
export const toggleFeatured = (id, featured) => apiPatch(`/v1/templates/${enc(id)}/featured`, { featured });

// ── ZIP Import/Export ──
export async function exportPackageZip(groupId) {
  const session = window.AIMEAT?.auth?.getSession?.();
  const headers = {};
  if (session?.jwt) headers['Authorization'] = `Bearer ${session.jwt}`;
  const res = await fetch(`/v1/packages/${enc(groupId)}/export`, { headers });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  return res.blob();
}

export async function importPackageZip(file) {
  const session = window.AIMEAT?.auth?.getSession?.();
  const formData = new FormData();
  formData.append('file', file);
  const headers = {};
  if (session?.jwt) headers['Authorization'] = `Bearer ${session.jwt}`;
  const res = await fetch('/v1/packages/import', {
    method: 'POST',
    headers,
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `Import failed: ${res.status}`);
  }
  return res.json();
}

// ── Template Proposals ──
export const proposeAsTemplate = (groupId) => apiPost(`/v1/packages/${enc(groupId)}/propose`, {});

// ── Federation Templates ──
export const syncFederationTemplates = () => apiPost('/v1/federation/templates/sync', {});
export const listFederationTemplates = (params) => apiGet('/v1/federation/templates' + buildQuery(params));

// ── Helpers ──
const enc = (s) => encodeURIComponent(s);
function buildQuery(params) {
  if (!params) return '';
  const qs = Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return qs ? `?${qs}` : '';
}
