/**
 * @file agent-tasks.js
 * @description Frontend API service for agent task operations.
 *   Provides CRUD, lifecycle (start/complete/fail), and event log access
 *   for the agent task queue system.
 * @version-history
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 *   v1.1.0 -- 2026-05-29 -- Add requestChanges() for the owner-asks-agent-to-revise-todos flow.
 */
import { apiGet, apiPost, apiDelete } from '/js/api.js';

export async function listTasks(agentName, opts = {}) {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  if (opts.page) params.set('page', String(opts.page));
  if (opts.per_page) params.set('per_page', String(opts.per_page));
  const qs = params.toString();
  return apiGet(`/v1/agents/${encodeURIComponent(agentName)}/tasks${qs ? '?' + qs : ''}`);
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
