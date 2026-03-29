/**
 * @file calibrator.js
 * @description API service layer for the Prompt Calibrator.
 * @structure
 *   - Project CRUD: listProjects, createProject, getProject, updateProject, deleteProject
 *   - Versions: listVersions, getVersion, createVersion
 *   - Batches: listBatches, getBatch, createBatch, updateBatch, deleteBatch
 *   - Templates: getTemplateDefaults
 * @version-history
 *   v1.0.0 — 2026-03-29 — Initial implementation
 *   v1.0.1 — 2026-03-29 — Fix: access resp.data (AIMEAT envelope)
 *   v2.0.0 — 2026-03-29 — V2: batch functions replace run functions, add template defaults
 */

import { apiGet, apiPost, apiPut, apiDelete } from '/js/api.js';

const BASE = '/v1/calibrator';

// ── Projects ──

export async function listProjects() {
  const resp = await apiGet(BASE);
  return resp.data?.projects || [];
}

export async function createProject(name) {
  const resp = await apiPost(BASE, { name });
  return resp.data?.project;
}

export async function getProject(id) {
  const resp = await apiGet(`${BASE}/${id}`);
  return resp.data || {};
}

export async function updateProject(id, updates) {
  const resp = await apiPut(`${BASE}/${id}`, updates);
  return resp.data?.project;
}

export async function deleteProject(id) {
  return apiDelete(`${BASE}/${id}`);
}

// ── Versions ──

export async function listVersions(projectId) {
  const resp = await apiGet(`${BASE}/${projectId}/versions`);
  return resp.data?.versions || [];
}

export async function getVersion(projectId, version) {
  const resp = await apiGet(`${BASE}/${projectId}/versions/${version}`);
  return resp.data?.version;
}

export async function createVersion(projectId, { prompt, targetOutput, changelog }) {
  const resp = await apiPost(`${BASE}/${projectId}/versions`, { prompt, targetOutput, changelog });
  return resp.data?.version;
}

// ── Templates ──

export async function getTemplateDefaults() {
  const resp = await apiGet('/v1/calibrator/templates');
  return resp.data || {};
}

// ── Batches ──

export async function listBatches(projectId, filters = {}) {
  let url = `${BASE}/${projectId}/batches`;
  const params = [];
  if (filters.version) params.push(`version=${filters.version}`);
  if (params.length) url += '?' + params.join('&');
  const resp = await apiGet(url);
  return resp.data?.batches || [];
}

export async function getBatch(projectId, batchId) {
  const resp = await apiGet(`${BASE}/${projectId}/batches/${batchId}`);
  return resp.data?.batch;
}

export async function createBatch(projectId, promptVersion) {
  const resp = await apiPost(`${BASE}/${projectId}/batches`, { promptVersion });
  return resp.data?.batch;
}

export async function updateBatch(projectId, batchId, data) {
  const resp = await apiPut(`${BASE}/${projectId}/batches/${batchId}`, data);
  return resp.data?.batch;
}

export async function deleteBatch(projectId, batchId) {
  return await apiDelete(`${BASE}/${projectId}/batches/${batchId}`);
}
