/**
 * @file src/services/schedule-file-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one rule about a stored file a schedule names: a schedule made by somebody other
 *   than the account holder in person may name only a file that maker can read itself.
 *
 *   WHY IT EXISTS. A `connections-publish` schedule carries a `storage_key`, and the fire reads
 *   those bytes from the OWNER's storage and sends them to an outside account. Nothing asked
 *   whether the maker could read the file, so an agent holding `task:write` and `connections:use`
 *   published the owner's private file to an external provider, while `GET /v1/pub/<owner>/<key>`
 *   answered the same agent 403 (secaudit 2026-10,
 *   checkConnectionsPublishInput:owner-storage-file-for-non-owner-maker). A task attachment has
 *   followed the opposite rule since it was written: an attachment must be one the creator can
 *   read (services/task-files.ts). Both now ask the same function, resolveFileRef.
 *
 *   WHY IT IS ITS OWN FILE. The create and edit doors ask it from services/schedule-write.ts, and
 *   the fire asks it from services/scheduler.ts. schedule-write.ts imports the Scheduler for the
 *   live clock, so the fire cannot reach the rule through that file without a module cycle.
 * @structure scheduleFileDenial() · scheduleStorageFileRefusal()
 * @usage
 *   const denied = await scheduleFileDenial(storage, config, owner, key, maker);   // create / edit
 *   const refusal = await scheduleStorageFileRefusal(storage, config, job);        // the fire
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial (secaudit 2026-10).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, ScheduledJobRecord } from '../storage/interface.js';
import { localAccountName } from '../utils/gaii.js';
import { readerForCaller } from './classification/reader.js';
import { resolveFileRef, type FileRefAccessor } from './file-refs.js';
import { scheduleActor } from './schedule-actor.js';

/** The refusal shape services/schedule-write.ts answers with, without its `ok: false`. */
export interface ScheduleFileDenial {
    status: 403;
    code: 'FILE_ACCESS_DENIED';
    message: string;
}

/** The maker may not read the file this schedule would publish, or null when it may. */
export async function scheduleFileDenial(
    storage: Storage, config: AimeatConfig, owner: string, storageKey: string, maker: FileRefAccessor,
): Promise<ScheduleFileDenial | null> {
    const resolved = await resolveFileRef(storage, config, `${owner}/${storageKey}`, maker);
    if (resolved.access === 'granted') return null;
    return {
        status: 403, code: 'FILE_ACCESS_DENIED',
        message: `You cannot read the stored file '${storageKey}' yourself, so you cannot schedule it to be published.`,
    };
}

/**
 * The same rule again at the fire, for a schedule a non-owner made: a file's visibility can be
 * narrowed after the schedule was saved, and the publish reads the OWNER's bytes. Answers the
 * sentence to fail the run with, or null when the fire may proceed. A schedule the account holder
 * made in person is never asked, and neither is one that names no file.
 */
export async function scheduleStorageFileRefusal(
    storage: Storage, config: AimeatConfig, job: ScheduledJobRecord,
): Promise<string | null> {
    const storageKey = (job.input as { storage_key?: unknown } | undefined)?.storage_key;
    const owner = job.ownerScope ?? '';
    if (typeof storageKey !== 'string' || !storageKey || !owner) return null;
    if (!job.createdByAgent && !job.createdByApp) return null;
    // Who it fires as, asked now (services/schedule-actor.ts): a maker that is gone does not fire.
    const actor = await scheduleActor(storage, job);
    if (!actor.ok) return actor.reason;
    if (actor.isOwner) return null;
    const ownerName = localAccountName(owner);
    const denied = await scheduleFileDenial(storage, config, owner, storageKey, {
        gaii: actor.principal,
        sub: actor.principal,
        owner: ownerName,
        reader: readerForCaller({ storage, config }, {
            gaii: actor.principal, owner: ownerName, roles: actor.roles, scopes: actor.scopes,
        }),
    });
    return denied ? denied.message : null;
}
