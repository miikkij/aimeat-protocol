/**
 * @file agent-services.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Frontend API service for agent published services (actions).
 *   Fetches one agent's actions from the work exchange by the agent's exact identity.
 * @version-history
 *   2026-10-15 — The list is asked for by the agent's exact GAII (GET /v1/actions?provider=), not filtered in the browser by a substring of its name, which showed same-named agents of other owners (feature-list audit #80).
 *   v1.0.0 -- 2026-05-22 -- Initial creation for Agent Dashboard Phase 3
 */
import { apiGet } from '/js/api.js';

export async function getAgentServices(agentGaii) {
  if (!agentGaii) return { ok: false, actions: [] };
  const res = await apiGet(`/v1/actions?provider=${encodeURIComponent(agentGaii)}&per_page=200`);
  if (!res.ok) return { ok: false, actions: [] };
  return { ok: true, actions: res.data?.actions || [] };
}
