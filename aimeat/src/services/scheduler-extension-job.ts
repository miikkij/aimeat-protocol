/**
 * @file src/services/scheduler-extension-job.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Scheduled `extension` job executor: turns a ScheduledJobRecord into one unattended
 *   extension run. The run itself — resolving the extension and action, the owner fence, secrets,
 *   the instance, the sandbox context — is services/extension-system-run.ts, shared with the
 *   workflow engine's `extension` step.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from scheduler.ts (max-file-lines)
 *   v1.1.0 — 2026-08-10 — Context comes from buildExtensionCtx instead of 174 hand-written lines.
 *                         Fixes what the copy had been missing: memory writes now go through the
 *                         size and key-count limits, and outbound calls through safeFetch.
 *   v1.2.0 — 2026-08-15 — TARGET-063 A2: the scheduled road gets `ctx.files`, writing into the
 *                         INSTALLER's namespace. It was the only road without it, so an extension on
 *                         a clock could hold memory records and reach the internet and could not put
 *                         one byte into storage — "produce a file on a schedule" did not exist, and
 *                         the reason was a missing argument rather than anything about clocks. The
 *                         namespace is the installer's GHII on purpose: `scheduler@<node>` owns no
 *                         storage, and a package written under it would sit at a different permanent
 *                         URL than the same package written from the app or by an agent.
 *   v1.3.0 — 2026-08-15 — TARGET-063 A3: the body moved to services/extension-system-run.ts so the
 *                         workflow engine's new `extension` step runs the identical sequence rather
 *                         than growing a second copy of it. Two things this road gains on the way:
 *                         the owner fence is now re-checked at RUN time (it was create-time only, and
 *                         a delete-and-reinstall by another owner outlives a create-time gate), and
 *                         the sandbox limits go through sandboxLimits() like every other road — the
 *                         ceiling was already applied at install (routes/extensions/manifest.ts), so
 *                         this only adds the small floors that keep a sandbox large enough to start.
 *   v1.3.1 — 2026-08-16 — The owner scope reading it needs is now WRITTEN: no install door stamped it
 *                         on a manifest-declared job, so from v1.3.0 every scheduled extension on the
 *                         node refused before it started. See services/extension-schedules.ts, which
 *                         also backfills the jobs stored before the stamp existed. The refusal names
 *                         the repair rather than only the missing field.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, ScheduledJobRecord } from '../storage/interface.js';
import { runExtensionActionAsSystem } from './extension-system-run.js';
import type { EmailService } from './email.js';

/**
 * Execute a scheduled `extension` job and return the tracked memory reads/writes for the run log.
 *
 * Every refusal throws: the scheduler records a thrown error as `lastRunResult: 'error'`, leaves the
 * run count alone and notifies the owner, while any normal return is recorded as a successful run.
 */
export async function runExtensionJob(
  storage: Storage,
  config: AimeatConfig,
  emailService: EmailService | undefined,
  job: ScheduledJobRecord,
): Promise<{ reads: string[]; writes: string[] }> {
  if (!job.extensionName || !job.actionId) {
    throw new Error(`Extension job "${job.id}" missing extensionName or actionId`);
  }

  // A schedule's `ownerScope` is the owner GHII; an extension record carries the BARE installer name
  // (routes/extensions/crud.ts writes `req.auth!.owner` into it). Both forms are needed: the owner
  // fence compares bare names, storage is addressed by GHII. Falling back to the extension record's
  // own installer would make the fence compare a value against itself, so it is not done.
  const ownerScope = job.ownerScope ?? '';
  const ownerName = ownerScope.split('@')[0];
  if (!ownerName) {
    throw new Error(`Extension job "${job.id}" has no owner scope — reinstall or reactivate extension "${job.extensionName}" to re-register it`);
  }
  const ownerGhii = ownerScope.includes('@') ? ownerScope : `${ownerName}@${config.nodeId}`;

  const out = await runExtensionActionAsSystem({ storage, config, emailService }, {
    extensionName: job.extensionName,
    actionId: job.actionId,
    instanceId: job.instanceId,
    input: job.input,
    // Nobody is present, and the scheduler says so rather than borrowing the owner's name for it.
    callerGaii: `scheduler@${config.nodeId}`,
    ownerName,
    storageOwnerGhii: ownerGhii,
    logLabel: 'scheduler',
    producerKind: 'extension',
    producerRef: job.id,
    producerSchedule: job.cron,
    trackMemory: true,
  });
  return { reads: out.reads, writes: out.writes };
}
