/**
 * @file src/services/account-deactivated.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Is the account a piece of background work acts for deactivated? One read, asked at the
 *   three places that act with no token: the scheduler fire (services/scheduler.ts executeJob), the
 *   start of a workflow run by a trigger (services/workflow/trigger-authority.ts refuseTriggerStart)
 *   and an unattended extension run (services/extension-system-run.ts runExtensionActionAsSystem).
 *   Since 2026-10-27 also before a workflow run in flight dispatches a step
 *   (services/workflow/dispatch-authority.ts waits) and in the goal sweep (services/goals/goals-sweep.ts).
 *
 *   WHY. Deactivation (POST /v1/admin/owners/:name/disable, SCIM active:false) ends every credential
 *   in the request (services/owner-lifecycle.ts), and the per-request check is reached only from a
 *   token. Background work carries no token, so until 2026-10-25 a deactivated account's schedules,
 *   event-triggered workflows and cron extension actions went on acting in its name (secaudit2026oct22,
 *   owner-deactivation:background-work-keeps-acting; developer decision 2026-10-25).
 *
 *   WHAT IT DOES. The work is SKIPPED with a log sentence that names the deactivation. Nothing is
 *   deleted or switched off, so reactivating the account (POST /v1/admin/owners/:name/enable) resumes
 *   every schedule, trigger and extension run at its next time. A skip is not a failure, so the
 *   five-failure pause of a schedule (scheduler-failures.ts) does not count it.
 *
 *   An identity that names no local account (a system job, a federated visitor, an identity of
 *   another node) is never deactivated here, and the answer is null.
 *   Since 2026-11-08 also before an AI job runs (services/ai-jobs/run-gate.ts): the job stays queued
 *   and runs after reactivation. Since the same day the credentials that carry no session ask it too,
 *   through deactivatedSince: a receiver key (services/receivers/verify.ts), an outside party's key or
 *   token (services/parties/verify.ts), an app party's sign-in (services/app-parties/service.ts), and
 *   the agent webhook dispatcher (services/webhook-dispatcher.ts). Each refuses or skips while the flag
 *   is set and works again on reactivation, because nothing is deleted.
 *   Since 2026-11-08 (round 15) also the two sales to a buyer with no account here: the foreign A2A
 *   quote and payment (services/a2a-offering.ts priceForForeignCaller) and the outside party's data
 *   package purchase (services/exchange-party-buy.ts buyable). Neither charges while the flag is set.
 * @structure deactivatedAccountSkip(storage, identity) · deactivatedAccountOf(storage, identity) ·
 *   deactivatedSince(storage, identity)
 * @usage const skip = await deactivatedAccountSkip(storage, job.ownerScope); if (skip) { ...skip... }
 * @version-history
 *   v1.1.1 -- 2026-11-08 -- Two more callers named in the description: the foreign A2A sale and the outside
 *     party's purchase (secaudit2026nov08b round 15). No code change here.
 *   v1.1.0 -- 2026-11-08 -- deactivatedAccountOf(): the same read as facts, for the AI job runner
 *     (secaudit2026nov08 round 14, reclaimJobs:restarts-deactivated-account-job); deactivatedSince for
 *     the credentials without a session (secaudit2026nov08 round 14). Both read the owner once, through
 *     deactivatedSince.
 *   v1.0.1 -- 2026-10-27 -- Two more callers: a workflow run in flight and the goal sweep (secaudit2026oct26).
 *   v1.0.0 -- 2026-10-25 -- Initial (secaudit2026oct22, owner-deactivation:background-work-keeps-acting).
 */
import type { Storage } from '../storage/interface.js';
import { localAccountOf } from '../utils/gaii.js';

/**
 * The sentence that says why work acting for `identity` is skipped, or null when its account is
 * active, unknown, or not a local account. `identity` is a GHII, a GAII, a GEAI or a bare account name.
 */
export async function deactivatedAccountSkip(storage: Pick<Storage, 'getOwner'>, identity: string | null | undefined): Promise<string | null> {
  const off = await deactivatedAccountOf(storage, identity);
  if (!off) return null;
  return `Skipped: the account "${off.name}" was deactivated on ${off.since}. `
    + 'Its schedules, workflow triggers and unattended extension runs wait, and nothing is deleted. '
    + 'They run again at their next time after the operator reactivates the account.';
}

/**
 * The same read, as facts for a caller that words its own sentence (services/ai-jobs/run-gate.ts):
 * the account name and the day it was deactivated, or null as above.
 */
export async function deactivatedAccountOf(
  storage: Pick<Storage, 'getOwner'>, identity: string | null | undefined,
): Promise<{ name: string; since: string } | null> {
  const name = identity ? localAccountOf(identity) : null;
  if (!name) return null;
  const since = await deactivatedSince(storage, name);
  if (!since) return null;
  return { name, since };
}

/**
 * The day (YYYY-MM-DD) the local account `identity` acts for was deactivated, or null when it is
 * active, unknown, or not a local account. `identity` is a GHII, a GAII, a GEAI or a bare account name.
 */
export async function deactivatedSince(storage: Pick<Storage, 'getOwner'>, identity: string | null | undefined): Promise<string | null> {
  const name = identity ? localAccountOf(identity) : null;
  if (!name) return null;
  const owner = await storage.getOwner(name);
  return owner?.disabledAt ? owner.disabledAt.slice(0, 10) : null;
}
