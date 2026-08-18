/**
 * @file schedules.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   v1.2.0 -- 2026-06-15 -- triggerSchedule now RETURNS the envelope data (honest outcome:
 *     'success'|'error'|'busy' + reason) so callers can report skips/offline truthfully.
 *     Add getScheduleDetail (GET /:id → { schedule, runs } run-history log) +
 *     setScheduleCron (PATCH /:id { cron } — change cadence of an existing schedule).
 *   v1.3.0 -- 2026-07-03 -- Add listScheduleOccurrences (GET /v1/schedules/occurrences?from&to):
 *     projected cron fire-times for the Profile › Scheduler calendar.
 */
import { apiGet, apiPost, apiPatch, apiDelete } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

/** Master aggregate: { managed, extensions, agentInternal }. */
export async function listAllSchedules() {
  return apiGet('/v1/schedules');
}

/**
 * Composite mount for the Scheduler tab: the schedule aggregate + the owner's agent list (names) in ONE
 * call. Returns { schedules, agents } or null on error so the caller can fall back to the individual
 * listAllSchedules + listAgents reads. The calendar occurrences stay a separate (range-driven) request.
 */
export async function getSchedulerTab() {
  try {
    const res = await apiGet('/v1/scheduler/tab');
    const d = res?.data;
    if (!d) return null;
    return { schedules: d.schedules || { managed: [], extensions: [], agentInternal: [] }, agents: d.agents || [] };
  } catch (err) { swallowed('schedules: getSchedulerTab', err); return null; }
}

/**
 * Projected cron fire-times for the owner's enabled schedules within [from, to]
 * (Date objects). Returns the envelope; `res.data` = { occurrences:[{ scheduleId,
 * at }], frequent:[{ scheduleId, cron, intervalMinutes, approxPerDay }], from, to,
 * truncated }. Continuous / high-frequency crons (≥ ~6 fires/day) come back in
 * `frequent` (summarized, not enumerated) so they don't flood the grid; normal
 * cadence lands in `occurrences`. Join scheduleId back to listAllSchedules()
 * records for kind/name. Powers the Profile › Scheduler calendar.
 */
export async function listScheduleOccurrences(from, to) {
  const qs = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  return apiGet(`/v1/schedules/occurrences?${qs.toString()}`);
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

/**
 * Run a schedule now. Returns the trigger result payload (the envelope `data`)
 * so the caller can branch on the HONEST outcome:
 *   { triggered, outcome: 'success'|'error'|'busy', reason?, task_id?, schedule }
 * `'busy'` means the run was SKIPPED (e.g. the eco app is offline / the connect
 * tunnel is unavailable, or a previous run is still active) — `reason` says why.
 */
export async function triggerSchedule(id) {
  const res = await apiPost(`/v1/schedules/${encodeURIComponent(id)}/trigger`, {});
  return res?.data || {};
}

/**
 * Detail + recent run history for one schedule.
 * Returns { schedule, runs } where `runs` = up to 20 ExecutionLogEntry records
 * (newest first): { createdAt, trigger, result: 'success'|'error'|'skipped',
 * errorMessage?, durationMs, ... }. Skipped runs (offline attempts) appear here
 * even though they don't advance the schedule's lastRun.
 */
export async function getScheduleDetail(id) {
  const res = await getSchedule(id);
  return res?.data || { schedule: null, runs: [] };
}

/** Change the cadence (cron) of an existing schedule and reschedule it. */
export async function setScheduleCron(id, cron) {
  return apiPatch(`/v1/schedules/${encodeURIComponent(id)}`, { cron });
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
