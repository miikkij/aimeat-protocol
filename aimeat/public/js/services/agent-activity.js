/**
 * @file agent-activity.js
 * @description Frontend API service for agent activity stats and history.
 *   Provides access to activity statistics (tasks completed, tokens used,
 *   success rate), daily activity history, and event log entries.
 * @structure
 *   - getActivity() -- fetch activity stats and daily history
 *   - getActivityLog() -- fetch paginated event log
 * @version-history
 *   v1.0.0 -- 2026-05-22 -- Initial creation for Agent Dashboard Phase 2
 */
import { apiGet } from '/js/api.js';

export async function getActivity(agentName, days = 30, granularity = 'daily') {
  return apiGet(`/v1/agents/${encodeURIComponent(agentName)}/activity?days=${days}&granularity=${granularity}`);
}

export async function getActivityLog(agentName, page = 1, perPage = 20) {
  return apiGet(`/v1/agents/${encodeURIComponent(agentName)}/activity/log?page=${page}&per_page=${perPage}`);
}
