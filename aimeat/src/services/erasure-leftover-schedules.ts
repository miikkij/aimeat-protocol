/**
 * @file src/services/erasure-leftover-schedules.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A once-per-node step: the schedules that account erasures before 2026-10-25 left
 *   behind are named to the operator on the Security page, one incident with one entry per schedule,
 *   and nothing is deleted or changed. The operator deletes each one, or keeps it, from the incident.
 *
 *   WHY. Until 2026-10-25 the erasure's schedule step deleted only the jobs whose createdBy was the
 *   person's own GHII or bare name (services/owner-erasure.ts). A schedule one of the person's agents
 *   or ecosystem apps made carries the maker's identity as createdBy and the account as ownerScope, so
 *   it stayed: its definition (the AI prompt, the inputs, the task text) is listed to whoever
 *   registers the released name next, and it fires as that person's agent of the same name once they
 *   connect one (secaudit2026oct22, owner-erasure:agent-made-schedules-survive-and-rebind). The
 *   erasure now deletes every job whose ownerScope is the account. Jobs an older erasure left are not
 *   deleted on their own, because a schedule cannot tell who meant what; the operator decides
 *   (developer decision 2026-10-25).
 *
 *   WHICH SCHEDULES. A job whose ownerScope names an account of this node (`name@<nodeId>`) and
 *   either no account holds the name, or the account that holds it was registered after the job was
 *   made, so it is a later holder of a released name. Core jobs and jobs that name no account are left
 *   out. An agent registered again under the same name in the same account keeps its schedules; that
 *   account is older than its jobs, so they are not named here.
 *
 *   WHEN. Once, recorded under `system@<nodeId>` (ERASURE_LEFTOVER_SCHEDULES_KEY), before the node
 *   serves (server-bootstrap/once-only-keep-steps.ts). A node with none records the run and opens no
 *   incident; a later start opens none.
 *
 *   WHAT THE OPERATOR CAN DO. Each schedule is an entry of the incident (services/incident-entries.ts)
 *   with 'delete' or 'keep': on the Security page, with POST /v1/admin/security/incidents/:id/resolve
 *   { name: <schedule id>, resolution }, with the MCP tool aimeat_admin_incident_resolve or with its
 *   CLI twin. Operator only. A delete removes the job from the scheduler and from storage.
 * @structure ERASURE_LEFTOVER_SCHEDULES_KEY · ERASURE_LEFTOVER_INCIDENT_TYPE · erasureLeftoverSchedules() ·
 *   reportErasureLeftoverSchedulesOnce() · deleteLeftoverSchedule()
 * @usage await reportErasureLeftoverSchedulesOnce(storage, config);   // server-bootstrap/once-only-keep-steps.ts
 * @version-history
 *   v1.0.0 -- 2026-10-25 -- Initial (secaudit2026oct22, owner-erasure:agent-made-schedules-survive-and-rebind;
 *     developer decision 2026-10-25).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, ScheduledJobRecord } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { claimOnceOnlyStep } from './once-only-step.js';
import { recordSecurityIncident, type IncidentEntry } from './security-incident.js';
import { getActiveScheduler } from './scheduler.js';
import { emitChange } from './event-bus.js';

/** The record under `system@<nodeId>` that says this node has run the step. */
export const ERASURE_LEFTOVER_SCHEDULES_KEY = 'migrations.secaudit2026oct22.erasure-leftover-schedules';

/** The incident's type, which services/incident-decisions.ts dispatches on. */
export const ERASURE_LEFTOVER_INCIDENT_TYPE = 'erasure_leftover_schedules';

/** The account name a job's ownerScope names on this node, or null when it names none. */
function accountOfScope(ownerScope: string | undefined, nodeId: string): string | null {
  const s = ownerScope ?? '';
  if (!s.endsWith(`@${nodeId}`)) return null;
  const name = s.slice(0, -(nodeId.length + 1));
  return name && !name.includes('#') && !name.includes(':') && !name.includes('@') ? name : null;
}

/** One schedule an older erasure left, as an entry of the incident. */
function entryOf(job: ScheduledJobRecord, why: 'gone' | 'later'): IncidentEntry {
  const label = job.displayName || job.name;
  const reason = why === 'gone' ? 'no account holds the name now' : 'the account of this name was registered after the schedule was made';
  return {
    id: job.id, kind: 'schedule', where: `${job.id} (${job.ownerScope})`, action: 'delete', status: 'open',
    what: `the ${job.type} schedule "${label}" made by ${job.createdBy} for ${job.ownerScope}, ${job.enabled ? 'on' : 'off'}, cron ${job.cron}: ${reason}`,
    params: { label, maker: job.createdBy, owner: job.ownerScope ?? '', cron: job.cron },
  };
}

/** Every schedule an older erasure left behind, oldest first. */
export async function erasureLeftoverSchedules(storage: Storage, nodeId: string): Promise<IncidentEntry[]> {
  const out: Array<{ at: string; entry: IncidentEntry }> = [];
  const accounts = new Map<string, { createdAt?: string } | null>();
  for (const job of await storage.listScheduledJobs({})) {
    if (job.type === 'core') continue;
    const name = accountOfScope(job.ownerScope, nodeId);
    if (!name) continue;
    if (!accounts.has(name)) accounts.set(name, await storage.getOwner(name));
    const account = accounts.get(name);
    if (!account) { out.push({ at: job.createdAt, entry: entryOf(job, 'gone') }); continue; }
    const madeAt = Date.parse(job.createdAt);
    const registeredAt = Date.parse(account.createdAt ?? '');
    if (Number.isFinite(madeAt) && Number.isFinite(registeredAt) && registeredAt > madeAt) out.push({ at: job.createdAt, entry: entryOf(job, 'later') });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at)).map(o => o.entry);
}

/**
 * Name the schedules older erasures left in one Security page incident, one entry per schedule, and
 * record the run. Writes nothing else. Throws when a write fails, and then leaves no record, so the
 * next start tries again.
 * @returns the entries named, or null on a node that ran the step before
 */
export async function reportErasureLeftoverSchedulesOnce(
  storage: Storage, config: Pick<AimeatConfig, 'nodeId'>,
): Promise<IncidentEntry[] | null> {
  const claim = await claimOnceOnlyStep(storage, `system@${config.nodeId}`, ERASURE_LEFTOVER_SCHEDULES_KEY);
  if (!claim) return null;
  try {
    const found = await erasureLeftoverSchedules(storage, config.nodeId);
    if (found.length) {
      await recordSecurityIncident(storage, config, {
        type: ERASURE_LEFTOVER_INCIDENT_TYPE,
        code: 'ERASURE_LEFT_SCHEDULES',
        actorGhii: `system@${config.nodeId}`,
        actorName: 'node',
        source: 'boot',
        detail: `${found.length} schedule(s) of erased accounts are still stored. An account erasure before 2026-10-25 deleted only the schedules `
          + 'the person made, not the ones their agents or apps made. Such a schedule is listed to whoever registers the name next, and it can run '
          + 'as their agent of the same name. Nothing was changed. Delete each one, or keep it: on the Security page, or with POST '
          + '/v1/admin/security/incidents/{id}/resolve { "name": "<schedule id>", "resolution": "delete" | "keep" }. The incident resolves with the last one.',
        entries: found,
      });
      logger.warn(`${found.length} schedule(s) that older account erasures left need the operator's review; see the Security page`);
    }
    await claim.finish({ at: new Date().toISOString(), schedules: found.map(e => e.id) });
    return found;
  } catch (err) {
    await claim.release();
    throw err;
  }
}

/** The offered action of one entry (services/incident-entries.ts EntryActor): delete the schedule. */
export async function deleteLeftoverSchedule(storage: Storage, _config: AimeatConfig, entry: IncidentEntry): Promise<string> {
  const job = await storage.getScheduledJob(entry.id);
  if (!job) return 'the schedule was gone already';
  getActiveScheduler()?.removeJob(entry.id);
  await storage.deleteScheduledJob(entry.id);
  emitChange('scheduler');
  return `the schedule "${job.displayName || job.name}" was deleted`;
}
