/**
 * @file agent-directives.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Frontend API service for agent directives operations.
 *   Provides get/upsert/delete for per-agent directives and owner-level defaults.
 * @version-history
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 *   v1.1.0 -- 2026-07-16 -- Add getDataAccessOverview (GET /v1/agents/:name/data-access/overview) — folds
 *     the Data Access subtab's 3 mount reads (directives + agent-memory-metadata + skill-links) into one.
 */
import { apiGet, apiPut, apiDelete } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

export async function getDirectives(agentName) {
  return apiGet(`/v1/agents/${encodeURIComponent(agentName)}/directives`);
}

/**
 * Composite mount for the Data Access subtab: directives-derived memory areas + resources, the agent's
 * memory keys (metadata only), and skill links in ONE call. Returns null on error so the caller can fall
 * back to the individual three-request fan-out.
 */
export async function getDataAccessOverview(agentName) {
  try {
    const resp = await apiGet(`/v1/agents/${encodeURIComponent(agentName)}/data-access/overview`);
    return resp?.data ?? null;
  } catch (err) { swallowed('agent-directives: getDataAccessOverview', err); return null; }
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
