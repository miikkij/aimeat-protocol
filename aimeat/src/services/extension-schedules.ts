/**
 * @file src/services/extension-schedules.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Registering the schedules an extension's manifest declares, and saying WHOSE they are.
 *
 *   A manifest-declared schedule is built in four places — activate (services/extension-lifecycle.ts),
 *   redeploy (services/extension-upsert.ts), package install (routes/instances/install.ts) and the
 *   admin install route — and all four built the record by hand. None of them stamped `ownerScope`,
 *   which cost every scheduled extension on aimeat.io: from 2026-08-15 the executor reads the owner
 *   off the JOB (services/scheduler-extension-job.ts) rather than off the extension record, so a job
 *   with no ownerScope refuses before it starts. Every `@activate` job on the node failed with
 *   "has no owner scope" on every restart, and every cron-bearing one on every fire.
 *
 *   WHOSE A MANIFEST SCHEDULE IS. The installer's, always: the schedule comes from the extension's own
 *   manifest and is created by the act of installing it, so the responsible party is `installedBy` and
 *   nobody else. That is the value the executor used before it moved to the job record, and it is what
 *   is written here — as a GHII, because a schedule's ownerScope is a GHII everywhere else.
 *
 *   The stamp is not decoration: it is what the RUN-time owner fence compares. An extension deleted
 *   and reinstalled by a DIFFERENT owner leaves the old job behind, and the old job then names the old
 *   owner while the record names the new one — which is exactly the case the fence exists for, and
 *   exactly the case a fallback to `ext.installedBy` would wave through.
 * @structure
 *   - extensionJobOwnerScope() — the installer's GHII, from whatever form installedBy is in
 *   - registerExtensionSchedules() — build and store the manifest's jobs; replace or skip existing
 *   - backfillExtensionJobOwnerScope() — startup repair for jobs stored before the stamp existed
 * @usage
 *   await registerExtensionSchedules({ storage, config, scheduler }, ext, actor);
 *   await registerExtensionSchedules({ storage, config, scheduler }, ext, actor, { replace: true });
 * @version-history
 *   v1.0.0 — 2026-08-16 — Extracted from the four hand-built copies, with the ownerScope they all
 *     lacked. Adds the startup backfill, because an already-stored job is not re-created by a deploy.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, ExtensionRecord, ScheduledJobRecord } from '../storage/interface.js';
import type { Scheduler } from './scheduler.js';
import { logger } from '../utils/logger.js';

export interface ExtensionScheduleDeps {
    storage: Storage;
    config: AimeatConfig;
    /** Absent on a door with no scheduler wired; then nothing is registered. */
    scheduler?: Scheduler | null;
}

/**
 * The owner scope a manifest-declared job carries: the installer's GHII on this node.
 *
 * `installedBy` is a bare owner name on every door that writes it today, but one route stores
 * `req.auth!.sub`, so the bare name is taken rather than assumed. Returns '' when there is nothing to
 * derive, which the caller must treat as "do not stamp a wrong owner".
 */
export function extensionJobOwnerScope(installedBy: string | undefined, nodeId: string): string {
    const bare = (installedBy ?? '').split('@')[0];
    return bare ? `${bare}@${nodeId}` : '';
}

/** The scheduled-job id a manifest schedule gets. Stable: activate, redeploy and install all reuse it. */
export function extensionJobId(extensionName: string, scheduleId: string): string {
    return `ext:${extensionName}:${scheduleId}`;
}

/**
 * Did this job come from an extension's manifest, or did the owner create it?
 *
 * The id says so: a manifest job is addressed `ext:<extension>:<schedule>` and an owner-created one
 * gets a UUID (services/schedule-write.ts). The distinction is what the schedules view is built on —
 * a manifest job is shown as a fact about the extension, an owner's own schedule is shown with the
 * controls that edit it — and the two used to be told apart by ownerScope, which stopped separating
 * anything the moment a manifest job started carrying one.
 */
export function isManifestDeclaredJob(job: { id: string; type?: string }): boolean {
    return job.type === 'extension' && job.id.startsWith('ext:');
}

/**
 * Register the schedules an extension's manifest declares.
 *
 * `replace: true` drops the extension's existing jobs first — what a redeploy needs, because the new
 * manifest's schedules are the whole truth about its clock. Without it an id that already exists is
 * left alone, which is what activation and package install need: they must not restart a job that has
 * been running.
 *
 * Returns how many jobs were created.
 */
export async function registerExtensionSchedules(
    deps: ExtensionScheduleDeps,
    ext: ExtensionRecord,
    actor: string,
    opts: { replace?: boolean } = {},
): Promise<number> {
    const { storage, config, scheduler } = deps;
    if (!scheduler) return 0;

    if (opts.replace) {
        const existing = await storage.listScheduledJobs({ extensionName: ext.name });
        for (const job of existing) {
            scheduler.removeJob(job.id);
            await storage.deleteScheduledJob(job.id);
        }
    }

    const schedules = (ext.config?.__schedules as Array<Record<string, unknown>> | undefined) ?? [];
    if (schedules.length === 0) return 0;

    const ownerScope = extensionJobOwnerScope(ext.installedBy, config.nodeId);
    if (!ownerScope) {
        // An unattended run has no owner to be, so a job that cannot name one would only fail later.
        logger.error(`Extension "${ext.name}" has no installer — its ${schedules.length} manifest schedules were NOT registered`);
        return 0;
    }

    let created = 0;
    for (const sched of schedules) {
        const jobId = extensionJobId(ext.name, sched.id as string);
        if (!opts.replace && await storage.getScheduledJob(jobId)) continue;
        const now = new Date().toISOString();
        const jobRecord: ScheduledJobRecord = {
            id: jobId,
            name: (sched.description as string) ?? `${ext.name}/${sched.id as string}`,
            type: 'extension',
            extensionName: ext.name,
            actionId: sched.action as string,
            cron: sched.cron as string,
            enabled: true,
            input: (sched.input as Record<string, unknown>) ?? undefined,
            // Whose it is, and what the run-time owner fence compares. See the file header.
            ownerScope,
            createdBy: actor,
            createdAt: now,
            updatedAt: now,
        };
        await storage.createScheduledJob(jobRecord);
        scheduler.addJob(jobRecord);
        created++;
        logger.info(`Registered scheduled job: ${jobId}`, { cron: jobRecord.cron, ownerScope });
    }
    return created;
}

/**
 * Stamp the missing owner scope onto extension jobs stored before it was written.
 *
 * A deploy does not fix these on its own: activation and install skip an id that already exists, so a
 * job created by the old code keeps its old shape until somebody rewrites it. Runs at startup BEFORE
 * the scheduler starts, so the first `@activate` wave after a restart already has what it needs.
 *
 * The extension record is the only place the answer can come from, and it is the same answer the
 * executor itself used until 2026-08-15. A job whose extension is gone is left alone: it names nobody,
 * and it would refuse for the better reason a moment later anyway.
 */
export async function backfillExtensionJobOwnerScope(config: AimeatConfig, storage: Storage): Promise<number> {
    const jobs = await storage.listScheduledJobs({ type: 'extension' });
    let repaired = 0;
    let orphaned = 0;
    for (const job of jobs) {
        if (job.ownerScope || !job.extensionName) continue;
        const ext = await storage.getExtension(job.extensionName);
        const ownerScope = extensionJobOwnerScope(ext?.installedBy, config.nodeId);
        if (!ownerScope) { orphaned++; continue; }
        await storage.updateScheduledJob(job.id, { ownerScope, updatedAt: new Date().toISOString() });
        repaired++;
    }
    if (repaired > 0) logger.info(`Stamped owner scope onto ${repaired} extension scheduled jobs`);
    if (orphaned > 0) {
        // These keep refusing, and the log says why rather than leaving the same line to repeat on
        // every fire: there is no installer to name, because the extension is gone or never had one.
        logger.warn(`${orphaned} extension scheduled jobs have no installer to name — they will refuse until their extension is reinstalled`);
    }
    return repaired;
}
