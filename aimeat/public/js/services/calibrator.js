/**
 * @file calibrator.js
 * @description API service layer for the Prompt Calibrator.
 * @structure
 *   - Project CRUD: listProjects, createProject, getProject, updateProject, deleteProject
 *   - Versions: listVersions, getVersion, createVersion
 *   - Runs: listRuns, getRun, createRun, updateRun
 * @version-history
 *   v1.0.0 — 2026-03-29 — Initial implementation
 */

import { apiGet, apiPost, apiPut, apiDelete } from '/js/api.js';

const BASE = '/v1/calibrator';

// ── Projects ──

export async function listProjects() {
  const resp = await apiGet(BASE);
  return resp.projects || [];
}

export async function createProject(name) {
  const resp = await apiPost(BASE, { name });
  return resp.project;
}

export async function getProject(id) {
  const resp = await apiGet(`${BASE}/${id}`);
  return resp;
}

export async function updateProject(id, updates) {
  const resp = await apiPut(`${BASE}/${id}`, updates);
  return resp.project;
}

export async function deleteProject(id) {
  return apiDelete(`${BASE}/${id}`);
}

// ── Versions ──

export async function listVersions(projectId) {
  const resp = await apiGet(`${BASE}/${projectId}/versions`);
  return resp.versions || [];
}

export async function getVersion(projectId, version) {
  const resp = await apiGet(`${BASE}/${projectId}/versions/${version}`);
  return resp.version;
}

export async function createVersion(projectId, { prompt, targetOutput, changelog }) {
  const resp = await apiPost(`${BASE}/${projectId}/versions`, { prompt, targetOutput, changelog });
  return resp.version;
}

// ── Runs ──

export async function listRuns(projectId, filters = {}) {
  let url = `${BASE}/${projectId}/runs`;
  const params = [];
  if (filters.version) params.push(`version=${filters.version}`);
  if (filters.model) params.push(`model=${encodeURIComponent(filters.model)}`);
  if (params.length) url += '?' + params.join('&');
  const resp = await apiGet(url);
  return resp.runs || [];
}

export async function getRun(projectId, runId) {
  const resp = await apiGet(`${BASE}/${projectId}/runs/${runId}`);
  return resp.run;
}

export async function createRun(projectId, data) {
  const resp = await apiPost(`${BASE}/${projectId}/runs`, data);
  return resp.run;
}

export async function updateRun(projectId, runId, data) {
  const resp = await apiPut(`${BASE}/${projectId}/runs/${runId}`, data);
  return resp.run;
}
