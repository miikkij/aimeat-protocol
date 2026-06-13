/**
 * @file workflows.js
 * @description Frontend API service for Agent Workflows (Profile › Workflows tab). Wraps the
 *   /v1/workflows endpoints (list / get / blueprint / runs / run / health). All functions return
 *   the AIMEAT envelope; callers read `res.data`.
 * @usage import { listWorkflows, getBlueprint, runWorkflow } from '/js/services/workflows.js';
 * @version-history
 *   v1.0.0 -- 2026-06-13 -- Phase 9: initial workflows service for the profile tab.
 */
import { apiGet, apiPost } from '/js/api.js';

/** List the owner's workflow definitions: { workflows, count }. */
export async function listWorkflows() {
  return apiGet('/v1/workflows');
}

export async function getWorkflow(id) {
  return apiGet(`/v1/workflows/${encodeURIComponent(id)}`);
}

/** Derived structural graph: { workflowId, nodes, edges }. */
export async function getBlueprint(id) {
  return apiGet(`/v1/workflows/${encodeURIComponent(id)}/blueprint`);
}

/** Run-health trend over recent runs: { sample, lastStatus, steps:[{stepId,green,red}] , … }. */
export async function getHealth(id) {
  return apiGet(`/v1/workflows/${encodeURIComponent(id)}/health`);
}

/** List runs (newest first): { runs, count }. */
export async function listRuns(id) {
  return apiGet(`/v1/workflows/${encodeURIComponent(id)}/runs`);
}

export async function getRun(id, runId) {
  return apiGet(`/v1/workflows/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`);
}

/** Start a run. mode: 'signals-only' | 'full'. Returns { runId, mode }. */
export async function runWorkflow(id, mode, vars) {
  return apiPost(`/v1/workflows/${encodeURIComponent(id)}/run`, { mode, ...(vars ? { vars } : {}) });
}
