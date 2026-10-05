/**
 * @file src/services/refinery/scheduled-job.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The scheduler kind `refinery`: one batch of a mail refinery on each fire, the same
 *   batch the app's button and aimeat_refinery_run start (runs.ts, pipeline.ts). Its `input` is
 *   `{ prefix }`; the definition is the owner's memory record `<prefix>.config`. What was checked
 *   when it was stored, and who it runs as, is schedule-input.ts.
 *
 *   AN AGENT'S PERMISSIONS ARE READ AGAIN AT EVERY FIRE, so taking a word away from the agent stops
 *   its schedule at the next fire rather than at its next token.
 *
 *   A FIRE THAT FILED NOTHING IS NOT A SUCCESS. A batch where every message failed throws, so the run
 *   log shows the reason; a batch already running (a person pressed the button at the same minute) is
 *   `skipped` with that reason.
 * @structure runRefineryJob
 * @usage registered by the Scheduler for job.type === 'refinery'
 * @version-history
 *   v1.1.0 — 2026-10-05 — Who it fires as is services/schedule-actor.ts: an app's schedule runs as
 *     that app, with its grant's scopes and its app reference, and stops when the grant goes. It ran
 *     as the owner with every scope (secaudit 2026-10, AI-2).
 *   v1.0.0 — 2026-09-29 — Initial (wish aimeat-refinery).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, ScheduledJobRecord } from '../../storage/interface.js';
import type { JobRunResult } from '../scheduler.js';
import { localAccountName } from '../../utils/gaii.js';
import { scopeIsCovered } from '../../utils/scope-coverage.js';
import { startRun } from './runs.js';
import { REFINERY_PREFIX_RE, REFINERY_RUN_SCOPES } from './schedule-input.js';
import { scheduleActor } from '../schedule-actor.js';

/** Fire one refinery schedule: start the batch and wait for it. */
export async function runRefineryJob(storage: Storage, config: AimeatConfig, job: ScheduledJobRecord): Promise<JobRunResult> {
  const ownerGhii = job.ownerScope;
  if (!ownerGhii) throw new Error(`refinery job "${job.id}" has no ownerScope`);
  const prefix = String((job.input as { prefix?: unknown } | undefined)?.prefix ?? '');
  if (!REFINERY_PREFIX_RE.test(prefix)) throw new Error(`refinery job "${job.id}" has no valid input.prefix`);
  // Who it fires as, asked now (services/schedule-actor.ts): the owner, or the agent or app that made
  // it with the words it holds today. An app's schedule runs as that app, never as the owner.
  const actor = await scheduleActor(storage, job);
  if (!actor.ok) throw new Error(actor.reason);
  if (!actor.isOwner) {
    const missing = REFINERY_RUN_SCOPES.filter((s) => !scopeIsCovered(actor.scopes, s));
    if (missing.length) throw new Error(`what made this schedule no longer holds ${missing.join(', ')}`);
  }
  const { run, done, already } = startRun({ storage, config }, {
    ownerGhii, owner: localAccountName(ownerGhii), principal: actor.principal, roles: actor.roles, scopes: actor.scopes,
    isOwner: actor.isOwner, ...(actor.appRef ? { appRef: actor.appRef } : {}),
  }, prefix, { by: `schedule ${job.displayName || job.id}` });
  if (already) return { reads: [], writes: [], skipped: true, skipReason: `a batch of ${prefix} was already running (${run.id})` };
  const finished = await done;
  if (finished.status === 'failed') throw new Error(finished.error ?? 'the batch failed');
  return { reads: [`${prefix}.config`, `${prefix}.cursor`], writes: [`${prefix}.cursor`, `${prefix}.runs`] };
}
