/**
 * @file agent-capabilities.js
 * @description Frontend API service for agent capability reporting and retrieval
 * @version-history
 *   v1.0.0 -- 2026-05-22 -- Initial creation for Agent Dashboard Phase 2
 */
import { apiGet, apiPut } from '/js/api.js';

export async function getCapabilities(agentName) {
  return apiGet(`/v1/agents/${encodeURIComponent(agentName)}/capabilities`);
}

export async function updateCapabilities(agentName, data) {
  return apiPut(`/v1/agents/${encodeURIComponent(agentName)}/capabilities`, data);
}
