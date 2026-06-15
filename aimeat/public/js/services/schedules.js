/**
 * @file schedules.js
 * @description Frontend API service for recurring schedules (Profile Scheduler
 *   master view + per-agent Schedules sub-tab). Wraps the /v1/schedules and
 *   /v1/agents/:name/schedules endpoints. All functions return the AIMEAT
 *   envelope; callers read `res.data`.
 * @usage
 *   import { listAllSchedules, createSchedule } from '/js/services/schedules.js';
 * @version-history
 *   v1.0.0 -- 2026-06-03 -- Initial: master + per-agent schedule CRUD/trigger
 *   v1.1.0 -- 2026-06-15 -- Add ecosystem-app helpers: listAppSchedules (filtered managed
 *     eco-capability jobs) + createCapabilitySchedule (POST kind:'eco-capability').
 */
import { apiGet, apiPost, apiPatch, apiDelete } from '/js/api.js';

/** Master aggregate: { managed, extensions, agentInternal }. */
export async function listAllSchedules() {
  return apiGet('/v1/schedules');
}

/** Per-agent view: { managed, agentInternal }. */
export async function listAgentSchedules(agentName) {
  return apiGet(`/v1/agents/${encodeURIComponent(agentName)}/schedules`);
}

export async function getSchedule(id) {
  return apiGet(`/v1/schedules/${encodeURIComponent(id)}`);
}

/** Create a profile-level (or agent-targeted via data.agent_name) schedule. */
export async function createSchedule(data) {
  return apiPost('/v1/schedules', data);
}

/** Create a schedule targeting a specific agent. */
export async function createAgentSchedule(agentName, data) {
  return apiPost(`/v1/agents/${encodeURIComponent(agentName)}/schedules`, data);
}

export async function updateSchedule(id, patch) {
  return apiPatch(`/v1/schedules/${encodeURIComponent(id)}`, patch);
}

/** Pause/resume shorthand. */
export async function setScheduleEnabled(id, enabled) {
  return apiPatch(`/v1/schedules/${encodeURIComponent(id)}`, { enabled });
}

export async function triggerSchedule(id) {
  return apiPost(`/v1/schedules/${encodeURIComponent(id)}/trigger`, {});
}

export async function deleteSchedule(id) {
  return apiDelete(`/v1/schedules/${encodeURIComponent(id)}`);
}

/**
 * The managed `eco-capability` schedules for one connected ecosystem app.
 * Pulls the master aggregate and filters to this app's capability jobs.
 * Returns an array of managed job records (each: id, type, cron, enabled,
 * input:{ app, capability_id, input }, lastRunAt, lastRunResult, nextRunAt,
 * displayName).
 */
export async function listAppSchedules(app) {
  const res = await listAllSchedules();
  const managed = res?.data?.managed || [];
  return managed.filter(j => j.type === 'eco-capability' && j.input?.app === app);
}

/**
 * Create an `eco-capability` schedule: AIMEAT invokes the named capability of a
 * connected ecosystem app on the given cron. `opts.enabled` defaults to true.
 */
export async function createCapabilitySchedule(app, capabilityId, cron, opts = {}) {
  return apiPost('/v1/schedules', {
    kind: 'eco-capability',
    app,
    capability_id: capabilityId,
    cron,
    enabled: opts.enabled !== false,
    ...(opts.displayName ? { display_name: opts.displayName } : {}),
    ...(opts.timezone ? { timezone: opts.timezone } : {}),
  });
}
