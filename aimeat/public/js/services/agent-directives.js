/**
 * @file agent-directives.js
 * @description Frontend API service for agent directives operations.
 *   Provides get/upsert/delete for per-agent directives and owner-level defaults.
 * @version-history
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */
import { apiGet, apiPut, apiDelete } from '/js/api.js';

export async function getDirectives(agentName) {
  return apiGet(`/v1/agents/${encodeURIComponent(agentName)}/directives`);
}

export async function upsertDirectives(agentName, data) {
  return apiPut(`/v1/agents/${encodeURIComponent(agentName)}/directives`, data);
}

export async function deleteDirectives(agentName) {
  return apiDelete(`/v1/agents/${encodeURIComponent(agentName)}/directives`);
}

export async function getOwnerDefaults() {
  return apiGet('/v1/owner/agent-defaults');
}

export async function upsertOwnerDefaults(data) {
  return apiPut('/v1/owner/agent-defaults', data);
}
