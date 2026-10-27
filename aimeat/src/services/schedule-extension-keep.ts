/**
 * @file src/services/schedule-extension-keep.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A once-per-node step: the `extension` schedules an app or an ecosystem app made before
 *   the kind asked ext:invoke keep firing, although the app's permission does not hold that word.
 *
 *   WHY. Until 2026-10-20 creating an `extension` schedule asked only task:write (secaudit 2026-10,
 *   SCHEDULE_KIND_SCOPE:extension-kind-asks-no-ext-invoke). Create, edit and run-now now ask
 *   ext:invoke, and every fire asks the maker again (services/schedule-fire-refusal.ts). An app whose
 *   grant holds task:write and not ext:invoke could make such a schedule before, and it ran every
 *   time. The ruling of this round is that a use that worked keeps working: the security fix closes
 *   the way in, it does not take away what already ran. An app has no permission page where the owner
 *   presses Allow, so the schedule keeps its fire here instead, as an app published before 4.0.x keeps
 *   its words (services/app-scope-allowance.ts).
 *
 *   WHICH SCHEDULES. Only the ones that existed when this node first started with the rule: an
 *   `extension` schedule whose maker is an app or an ecosystem app, live at that start and not holding
 *   ext:invoke then. Nothing made after it can join: a new schedule, or a new instruction for an old
 *   one, needs ext:invoke from whoever gives it. A grant the owner narrows later is not on the list,
 *   because it held the word at the start; a grant the owner revokes stops its schedule
 *   (services/schedule-actor.ts). An agent's schedule is not kept here: the owner allows the word for
 *   the agent with one press (services/permission-ask.ts), which the fire offers.
 *
 *   WHERE. One record under `system@<nodeId>`, EXTENSION_SCHEDULE_KEEP_KEY: { at, ids }. It is never
 *   swept, and a schedule deleted later only leaves an id that matches nothing.
 * @structure EXTENSION_SCHEDULE_KEEP_KEY · keepAppExtensionSchedulesOnce(storage, config) ·
 *   isKeptExtensionSchedule(storage, nodeId, jobId)
 * @usage
 *   await keepAppExtensionSchedulesOnce(storage, config);              // server-bootstrap/service-init.ts
 *   if (await isKeptExtensionSchedule(storage, nodeId, job.id)) ...   // schedule-fire-refusal.ts, schedule-write.ts
 * @version-history
 *   2026-10-27 — secaudit2026oct26: only a schedule made before the rule's first try on this node is
 *     kept, also when the step runs at a later start (keptBefore, madeBefore).
 *   v1.0.1 — 2026-10-21 — The list is read by "run now" too (services/schedule-write.ts
 *     triggerScheduleRecord): the app that made a kept schedule runs it now as its fire runs.
 *   v1.0.0 — 2026-10-21 — Initial (secaudit 2026-10, capability-loss review of the ext:invoke fix).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { claimOnceOnlyStep, keptBefore, madeBefore } from './once-only-step.js';
import { makerOf, scheduleActor } from './schedule-actor.js';

/** The record under `system@<nodeId>` that lists the kept schedules and says the step has run. */
export const EXTENSION_SCHEDULE_KEEP_KEY = 'migrations.schedule-extension-ext-invoke-keep';

/** The word the extension kind asks since 2026-10-20. */
const WORD = 'ext:invoke';

/**
 * Record, once per node, every `extension` schedule an app or an ecosystem app made whose maker is
 * live and does not hold ext:invoke now. Throws when a read or a write fails, and then leaves no
 * record, so the next start tries again.
 */
export async function keepAppExtensionSchedulesOnce(
  storage: Storage, config: Pick<AimeatConfig, 'nodeId'>,
): Promise<{ ran: boolean; ids: string[] }> {
  const claim = await claimOnceOnlyStep(storage, `system@${config.nodeId}`, EXTENSION_SCHEDULE_KEEP_KEY);
  if (!claim) return { ran: false, ids: [] };
  try {
    const ids: string[] = [];
    // Only what was made before the rule first took effect here (secaudit2026oct26).
    const cutoff = keptBefore(claim);
    for (const job of await storage.listScheduledJobs({ type: 'extension' })) {
      if (!madeBefore(job.createdAt, cutoff)) continue;
      const maker = makerOf(job);
      if (maker === 'unknown-app' || (maker.kind !== 'app' && maker.kind !== 'ecosystem')) continue;
      const actor = await scheduleActor(storage, job);
      if (actor.ok && !scopeIsCovered(actor.scopes, WORD)) ids.push(job.id);
    }
    await claim.finish({ at: new Date().toISOString(), ids });
    if (ids.length) logger.info(`Extension schedules: ${ids.length} made by an app without ext:invoke keep firing`, { ids });
    return { ran: true, ids };
  } catch (err) {
    await claim.release();
    throw err;
  }
}

/** True when the step above kept `jobId`. */
export async function isKeptExtensionSchedule(storage: Storage, nodeId: string, jobId: string): Promise<boolean> {
  const record = await storage.getMemory(`system@${nodeId}`, EXTENSION_SCHEDULE_KEEP_KEY);
  const ids = (record?.value as { ids?: unknown } | undefined)?.ids;
  return Array.isArray(ids) && ids.includes(jobId);
}
