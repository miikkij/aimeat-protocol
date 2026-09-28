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
 *   v1.0.0 — 2026-09-29 — Initial (wish aimeat-refinery).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, ScheduledJobRecord } from '../../storage/interface.js';
import type { JobRunResult } from '../scheduler.js';
import { localAccountName } from '../../utils/gaii.js';
import { scopeIsCovered } from '../../utils/scope-coverage.js';
import { startRun } from './runs.js';
import { REFINERY_PREFIX_RE, refineryRunAs } from './schedule-input.js';

const RUN_SCOPES = ['connections:read-through', 'ai:use', 'organism:rows', 'memory:write'] as const;

/** Fire one refinery schedule: start the batch and wait for it. */
export async function runRefineryJob(storage: Storage, config: AimeatConfig, job: ScheduledJobRecord): Promise<JobRunResult> {
  const ownerGhii = job.ownerScope;
  if (!ownerGhii) throw new Error(`refinery job "${job.id}" has no ownerScope`);
  const prefix = String((job.input as { prefix?: unknown } | undefined)?.prefix ?? '');
  if (!REFINERY_PREFIX_RE.test(prefix)) throw new Error(`refinery job "${job.id}" has no valid input.prefix`);
  const principal = refineryRunAs(job);
  const byAgent = principal !== ownerGhii;
  let scopes: string[] = ['*'];
  if (byAgent) {
    const agent = await storage.getAgent(principal);
    if (!agent) throw new Error(`the agent that made this schedule (${principal}) no longer exists`);
    scopes = agent.defaultScopes ?? [];
    const missing = RUN_SCOPES.filter((s) => !scopeIsCovered(scopes, s));
    if (missing.length) throw new Error(`the agent that made this schedule no longer holds ${missing.join(', ')}`);
  }
  const { run, done, already } = startRun({ storage, config }, {
    ownerGhii, owner: localAccountName(ownerGhii), principal, roles: byAgent ? ['agent'] : ['owner'], scopes, isOwner: !byAgent,
  }, prefix, { by: `schedule ${job.displayName || job.id}` });
  if (already) return { reads: [], writes: [], skipped: true, skipReason: `a batch of ${prefix} was already running (${run.id})` };
  const finished = await done;
  if (finished.status === 'failed') throw new Error(finished.error ?? 'the batch failed');
  return { reads: [`${prefix}.config`, `${prefix}.cursor`], writes: [`${prefix}.cursor`, `${prefix}.runs`] };
}
