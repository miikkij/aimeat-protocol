/**
 * @file agent-services.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Frontend API service for agent published services (actions).
 *   Fetches actions from the work exchange and filters by agent name.
 * @version-history
 *   v1.0.0 -- 2026-05-22 -- Initial creation for Agent Dashboard Phase 3
 */
import { apiGet } from '/js/api.js';

export async function getAgentServices(agentName) {
  const res = await apiGet('/v1/actions');
  if (!res.ok) return { ok: false, actions: [] };
  const actions = (res.data?.actions || []).filter(a =>
    a.provider_gaii?.includes(`${agentName}#`) || a.provider_gaii?.includes(agentName)
  );
  return { ok: true, actions };
}
