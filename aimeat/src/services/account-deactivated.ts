/**
 * @file src/services/account-deactivated.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Is the account a piece of background work acts for deactivated? One read, asked at the
 *   three places that act with no token: the scheduler fire (services/scheduler.ts executeJob), the
 *   start of a workflow run by a trigger (services/workflow/trigger-authority.ts refuseTriggerStart)
 *   and an unattended extension run (services/extension-system-run.ts runExtensionActionAsSystem).
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
 * @structure deactivatedAccountSkip(storage, identity)
 * @usage const skip = await deactivatedAccountSkip(storage, job.ownerScope); if (skip) { ...skip... }
 * @version-history
 *   v1.0.0 -- 2026-10-25 -- Initial (secaudit2026oct22, owner-deactivation:background-work-keeps-acting).
 */
import type { Storage } from '../storage/interface.js';
import { localAccountOf } from '../utils/gaii.js';

/**
 * The sentence that says why work acting for `identity` is skipped, or null when its account is
 * active, unknown, or not a local account. `identity` is a GHII, a GAII, a GEAI or a bare account name.
 */
export async function deactivatedAccountSkip(storage: Pick<Storage, 'getOwner'>, identity: string | null | undefined): Promise<string | null> {
  const name = identity ? localAccountOf(identity) : null;
  if (!name) return null;
  const owner = await storage.getOwner(name);
  if (!owner?.disabledAt) return null;
  return `Skipped: the account "${name}" was deactivated on ${owner.disabledAt.slice(0, 10)}. `
    + 'Its schedules, workflow triggers and unattended extension runs wait, and nothing is deleted. '
    + 'They run again at their next time after the operator reactivates the account.';
}
