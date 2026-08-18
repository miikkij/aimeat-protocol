/**
 * @file src/services/extension-upsert.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Swapping an installed extension's code in place.
 *
 *   An upsert is three things, not one: the field swap, the EXCHANGE re-projection (a price or a
 *   flag on an action may have changed), and — when the extension is ACTIVE — re-registering its
 *   schedules from the new manifest and re-running its @activate jobs.
 *
 *   The field swap existed on both doors. The other two lived only in PUT /v1/extensions/:name, so
 *   an agent redeploying an active extension through MCP left the OLD schedules registered against
 *   the new code, never ran the new @activate work, and left its market listing describing the
 *   previous price. Nothing failed; the extension simply kept doing what it used to.
 * @structure
 *   - upsertExtensionInPlace() — swap, re-project, re-init; returns the stored record or null
 * @usage
 *   const out = await upsertExtensionInPlace({ storage, config, scheduler }, name, record,
 *     { ownerName, actor, wasActive });
 *   if (!out.record) return refuse('the write did not apply');
 * @version-history
 *   v1.1.0 — 2026-08-16 — Schedule re-registration goes through services/extension-schedules.ts, so a
 *     redeployed extension's jobs carry the installer's `ownerScope` like every other road's.
 *   v1.0.0 — 2026-08-11 — Extracted after the copied-logic check found the pair.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, ExtensionRecord } from '../storage/interface.js';
import type { Scheduler } from './scheduler.js';
import { reconcileAfterExtensionWrite } from './exchange-projection.js';
import { registerExtensionSchedules } from './extension-schedules.js';
import { logger } from '../utils/logger.js';

export interface UpsertDeps {
    storage: Storage;
    config: AimeatConfig;
    /** Absent on a door with no scheduler wired; then an active extension is not re-initialised. */
    scheduler?: Scheduler | null;
}

export interface UpsertContext {
    /** The bare owner name, for the EXCHANGE projection. */
    ownerName: string;
    /** Who is recorded as having created the re-registered schedule jobs. */
    actor: string;
    /** Whether the extension was ACTIVE before the swap. */
    wasActive: boolean;
}

/**
 * Replace an installed extension's code and metadata, preserving its lifecycle fields and its
 * `ext:{name}` memory.
 *
 * Returns the stored record, or null when the write did not apply — which the caller must report as
 * a failure rather than echoing the record it wanted to store. Answering with the NEW version while
 * the database still holds the old code is the most misleading answer available, because it looks
 * like proof the deploy worked.
 */
export async function upsertExtensionInPlace(
    deps: UpsertDeps,
    name: string,
    record: ExtensionRecord,
    ctx: UpsertContext,
): Promise<{ record: ExtensionRecord | null; reinitialized: boolean }> {
    const { storage, config, scheduler } = deps;

    const updated = await storage.updateExtension(name, {
        version: record.version,
        description: record.description,
        author: record.author,
        requiredApis: record.requiredApis,
        actions: record.actions,
        config: record.config,
        limits: record.limits,
        federation: record.federation,
        instances: record.instances,
    });
    if (!updated) return { record: null, reinitialized: false };

    // The listings this extension's actions declare — a price or a flag may have moved with the code.
    await reconcileAfterExtensionWrite(storage, ctx.ownerName, config.nodeId, name);

    // An ACTIVE extension is re-initialised: the schedules come from the manifest, so the new
    // manifest's schedules replace the old ones, and its @activate jobs run again. New action code
    // is already live — each call reads scriptContent fresh from storage.
    if (!(ctx.wasActive && scheduler)) return { record: updated, reinitialized: false };

    // `replace: true`: the new manifest's schedules are the whole truth about this extension's clock,
    // so the old ones go first. The jobs are stamped with the INSTALLER's owner scope, which is
    // `updated.installedBy` and not the redeployer — an operator may write on somebody else's behalf,
    // and the schedule still belongs to the person whose extension it is.
    await registerExtensionSchedules({ storage, config, scheduler }, updated, ctx.actor, { replace: true });
    scheduler.runActivateJobs(name).catch(err =>
        logger.error(`Failed to run @activate jobs for ${name}`, { error: String(err) }));

    return { record: updated, reinitialized: true };
}
