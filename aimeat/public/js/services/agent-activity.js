/**
 * @file agent-activity.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Frontend API service for agent activity stats and history.
 *   Provides access to activity statistics (tasks completed, tokens used,
 *   success rate), daily activity history, and event log entries.
 * @structure
 *   - getActivity() -- fetch activity stats and daily history
 *   - getActivityLog() -- fetch paginated event log
 *   - getActivityOverview() -- fetch the Activity subtab mount composite (activity+log+directives+webhook+telemetry)
 * @version-history
 *   v1.0.0 -- 2026-05-22 -- Initial creation for Agent Dashboard Phase 2
 *   v1.1.0 -- 2026-07-16 -- Add getActivityOverview (GET /v1/agents/:name/activity/overview) — folds the
 *     subtab's 5 agent-domain mount reads into one call (ledger stays separate).
 */
import { apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

export async function getActivity(agentName, days = 30, granularity = 'daily') {
  return apiGet(`/v1/agents/${encodeURIComponent(agentName)}/activity?days=${days}&granularity=${granularity}`);
}

export async function getActivityLog(agentName, page = 1, perPage = 20) {
  return apiGet(`/v1/agents/${encodeURIComponent(agentName)}/activity/log?page=${page}&per_page=${perPage}`);
}

/**
 * Composite mount for the Activity subtab: activity_stats + event log (page 1) + directives budget +
 * webhook + telemetry in ONE call. Each sub-object mirrors the individual endpoint's `.data`. Returns
 * null on error so the caller can fall back to the individual six-request fan-out.
 */
export async function getActivityOverview(agentName) {
  try {
    const resp = await apiGet(`/v1/agents/${encodeURIComponent(agentName)}/activity/overview`);
    return resp?.data ?? null;
  } catch (err) { swallowed('agent-activity: getActivityOverview', err); return null; }
}
