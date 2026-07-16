/**
 * @file agent-tasks.js
 * @description Frontend API service for agent task operations.
 *   Provides CRUD, lifecycle (start/complete/fail), and event log access
 *   for the agent task queue system.
 * @version-history
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 *   v1.1.0 -- 2026-05-29 -- Add requestChanges() for the owner-asks-agent-to-revise-todos flow.
 *   v1.2.0 -- 2026-05-31 -- Add rateTask() and getAgentStatistics() for the Quality tab.
 *   v1.3.0 -- 2026-06-01 -- listTasks() gains bucket/q/updated_after/before params; add setTaskTriage() for the Recent/Keep/Archive buckets.
 *   v1.4.0 -- 2026-07-16 -- Add getQualityOverview (GET /v1/agents/:name/quality/overview) — folds the
 *     Quality subtab's statistics + done-tasks mount reads into one call.
 */
import { apiGet, apiPost, apiDelete, api } from '/js/api.js';

export async function listTasks(agentName, opts = {}) {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  if (opts.bucket) params.set('bucket', opts.bucket);               // recent | keep | archive
  if (opts.q) params.set('q', opts.q);                              // title/description search
  if (opts.updated_after) params.set('updated_after', opts.updated_after);
  if (opts.updated_before) params.set('updated_before', opts.updated_before);
  if (opts.page) params.set('page', String(opts.page));
  if (opts.per_page) params.set('per_page', String(opts.per_page));
  const qs = params.toString();
  return apiGet(`/v1/agents/${encodeURIComponent(agentName)}/tasks${qs ? '?' + qs : ''}`);
}

/** Move a task between Tasks-tab buckets. triage: 'kept' | 'archived' | null (restore). */
export async function setTaskTriage(agentName, taskId, triage) {
  return api(`/v1/agents/${encodeURIComponent(agentName)}/tasks/${encodeURIComponent(taskId)}/triage`, {
    method: 'PATCH',
    body: JSON.stringify({ triage }),
  });
}

export async function getTask(agentName, taskId) {
  return apiGet(`/v1/agents/${encodeURIComponent(agentName)}/tasks/${encodeURIComponent(taskId)}`);
}

export async function createTask(agentName, data) {
  return apiPost(`/v1/agents/${encodeURIComponent(agentName)}/tasks`, data);
}

export async function startTask(agentName, taskId) {
  return apiPost(`/v1/agents/${encodeURIComponent(agentName)}/tasks/${encodeURIComponent(taskId)}/start`);
}

export async function completeTask(agentName, taskId, data = {}) {
  return apiPost(`/v1/agents/${encodeURIComponent(agentName)}/tasks/${encodeURIComponent(taskId)}/complete`, data);
}

export async function failTask(agentName, taskId, reason) {
  return apiPost(`/v1/agents/${encodeURIComponent(agentName)}/tasks/${encodeURIComponent(taskId)}/fail`, { reason });
}

export async function deleteTask(agentName, taskId) {
  return apiDelete(`/v1/agents/${encodeURIComponent(agentName)}/tasks/${encodeURIComponent(taskId)}`);
}

export async function requestChanges(agentName, taskId, message) {
  return apiPost(`/v1/agents/${encodeURIComponent(agentName)}/tasks/${encodeURIComponent(taskId)}/request-changes`, { message });
}

export async function listEvents(agentName, taskId) {
  return apiGet(`/v1/agents/${encodeURIComponent(agentName)}/tasks/${encodeURIComponent(taskId)}/events`);
}

/** Review a completed task's deliverable. body: { stars, context, comment?, source_grounded?, unsupported?, evaluated_model? } */
export async function rateTask(agentName, taskId, body) {
  return apiPost(`/v1/agents/${encodeURIComponent(agentName)}/tasks/${encodeURIComponent(taskId)}/rate`, body);
}

/** Quality tab: recomputed performance + per-context review rollups + custom metrics. */
export async function getAgentStatistics(agentName) {
  return apiGet(`/v1/agents/${encodeURIComponent(agentName)}/statistics`);
}

/**
 * Composite mount for the Quality subtab: recomputed statistics (performance + reviews + custom) AND the
 * agent's done tasks in ONE call. Returns null on error so the caller can fall back to the individual
 * statistics + done-tasks fan-out.
 */
export async function getQualityOverview(agentName) {
  try {
    const resp = await apiGet(`/v1/agents/${encodeURIComponent(agentName)}/quality/overview`);
    return resp?.data ?? null;
  } catch { return null; }
}
