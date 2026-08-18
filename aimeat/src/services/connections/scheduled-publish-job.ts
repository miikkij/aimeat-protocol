/**
 * @file scheduled-publish-job.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The scheduler kind that publishes to a connection when its time comes (LÄHETIN).
 *
 *   WHY THERE IS NO QUEUE TABLE HERE. The node already owns a clock, a durable job row, DST-correct
 *   IANA timezones (croner), an execution log, a REST surface and `/occurrences` for a calendar. A
 *   scheduled publish is a `ScheduledJob` like any other; a one-shot is `constraints: max_runs 1`,
 *   which the scheduler already auto-disables after the fire. Building a second queue beside that one
 *   would have meant rebuilding the timezone handling, the one-shot, the log and the calendar — all
 *   of which exist and are already tested.
 *
 *   IT TAKES THE SAME PATH A PERSON PRESSING SEND TAKES. runOwnPublish(), idempotency gate and all.
 *   A scheduler with its own copy of "open the gate, refresh, call the recipe, record" is a scheduler
 *   that eventually skips the gate, and skipping it publishes the same video twice — on a provider
 *   that charges per post, that is also a second bill.
 *
 *   IT DOES NOT RETRY A FAILURE. The scheduler records the error and the run log carries it. A
 *   schedule nobody is watching that retries on a broken connection is how one expired token becomes
 *   a thousand refused calls at a provider overnight.
 *
 *   AND IT DOES NOT CALL A RUN SUCCESSFUL WHEN NOTHING WAS SENT. The gate can legitimately answer
 *   "this exact message is already opened" or "it is held / queued"; none of those put a post on a
 *   platform. Returning normally for them made the scheduler count the run, log it green and, for a
 *   one-shot, disable the schedule and tell the owner it was finished. `skipped` is the word that
 *   already means "nothing ran, here is why", and it keeps the reason where a person can read it.
 * @structure ScheduledPublishInput · runConnectionsPublishJob
 * @usage registered by the Scheduler for job.type === 'connections-publish'
 * @version-history
 *   v1.1.0 — 2026-08-08 — A fire that published nothing (replay / held / queued) reports `skipped`
 *     with the reason instead of a green success that closed the one-shot.
 *   v1.0.0 — 2026-08-02 — LÄHETIN: scheduled publishing as a kind on the EXISTING scheduler.
 */

import type { AimeatConfig } from '../../config.js';
import type { Storage, ScheduledJobRecord } from '../../storage/interface.js';
import type { JobRunResult } from '../scheduler.js';
import { logger } from '../../utils/logger.js';
import { buildOutboundProviders } from './providers.js';
import { requireEncryptionKey } from './credential.js';
import { runOwnPublish } from './publish-run.js';

/** What the schedule's `input` carries. Validated at create time by the schedules route. */
export interface ScheduledPublishInput {
  connection_id: string;
  caption?: string;
  storage_key?: string;
  params?: Record<string, unknown>;
  /**
   * Whatever the caller wants to find its own schedules by. OPAQUE: never parsed, matched or
   * authorized against — a node that interpreted it would be a node that knows the caller's data
   * model, which is not its business.
   */
  ref?: string;
}

/**
 * Fire one scheduled publish.
 *
 * The publisher is `ownerScope`, resolved when the schedule was CREATED and never re-derived here: a
 * schedule can only ever publish to its author's own account, because a connection belongs to the
 * person who attached it.
 */
export async function runConnectionsPublishJob(
  storage: Storage, config: AimeatConfig, job: ScheduledJobRecord,
): Promise<JobRunResult> {
  const owner = job.ownerScope;
  if (!owner) throw new Error(`connections-publish job "${job.id}" has no ownerScope`);

  const input = (job.input ?? {}) as unknown as ScheduledPublishInput;
  if (!input.connection_id) throw new Error(`connections-publish job "${job.id}" has no connection_id`);

  const key = requireEncryptionKey(config);
  // No key means no credential can be read, so nothing could have been published anyway. A thrown
  // error puts it in the run log where an operator will see it, rather than passing silently.
  if (!key) throw new Error('this node has no encryption key, so it cannot read a stored credential');

  const out = await runOwnPublish(
    { config, storage, providers: buildOutboundProviders(config), key },
    {
      publisher: owner,
      connectionId: input.connection_id,
      storageKey: input.storage_key ?? '',
      caption: input.caption ?? '',
      params: input.params ?? {},
    },
  );

  if (!out.ok) {
    // Thrown, so the scheduler records it as a failed run with the reason and notifies the owner.
    // Swallowing it would leave a schedule that looks like it fired and a post that never appeared.
    throw new Error(out.reason);
  }

  logger.info('connections: a scheduled publish fired', {
    job: job.id, attempt: out.attempt.id, status: out.attempt.status, replay: out.replay,
  });

  // ── A RUN THAT PUBLISHED NOTHING IS NOT A SUCCESSFUL RUN ─────────────────────
  //
  // This was the quietest lie on the whole path, and a production user met it: the gate answers
  // `replay` when this exact message has already been opened, runOwnPublish passes that back as
  // ok:true, and returning normally here made the scheduler count the run, write a green log line,
  // and — for the one-shot LÄHETIN creates — auto-disable the schedule and tell the owner it had
  // finished. A post that never left, reported as sent, and the schedule deleted itself.
  //
  // `skipped` is the scheduler's existing word for "nothing ran, and here is why". It keeps the
  // reason in the run log, leaves runCount and the one-shot budget untouched, and does not pretend.
  // `held` and `queued` are the same shape of answer: waiting is not sending.
  if (out.replay) {
    const landed = out.attempt.status === 'done';
    return {
      reads: [], writes: [], skipped: true,
      skipReason: landed
        ? `nothing was sent: this exact message is already published to that account (${out.attempt.createdAt})`
        : `nothing was sent: an identical message is already ${out.attempt.status} from ${out.attempt.createdAt}`,
    };
  }
  if (out.attempt.status === 'held' || out.attempt.status === 'queued') {
    return {
      reads: [], writes: [], skipped: true,
      skipReason: out.attempt.status === 'held'
        ? 'nothing was sent yet: the post is waiting for moderation'
        : "nothing was sent yet: the account's daily allowance at the provider is spent",
    };
  }

  return { reads: [], writes: [] };
}
