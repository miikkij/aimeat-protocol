/**
 * @file src/services/workspace-import-gates.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The write rules a workspace restore applies to the values an ARCHIVE names.
 *
 *   WHY THIS FILE EXISTS. A workspace or organism bundle is untrusted input: whoever made the ZIP
 *   chose every key, every visibility and every mime type in it. services/workspace-import.ts used
 *   to write all of them with raw `storage.setMemory` and `storage.createStorageFile`, so the checks
 *   the ordinary write doors make never ran. Measured (secaudit 2026-10,
 *   workspace-import:restore-skips-write-gates): a record and a file landed at
 *   `organism:<an organism the importer is not in>` and a member of that organism read them, while
 *   POST /v1/memory and POST /v1/storage refuse the same value; and a file landed at the app-owned
 *   key `apps/icons/<file>`, which the app origin then served as a page, while POST /v1/storage
 *   refuses that key for everyone.
 *
 *   WHAT IT DOES. `restoredLevel()` is the one place a restore decides what level an archived item
 *   is stored at: the organism-membership audience rule (services/organism-visibility.ts), the
 *   closed node (services/closed-node-level.ts), the label's audience cap and the publish gate
 *   (services/memory-publish-gate.ts), in the order every write door asks them. A level the caller
 *   may not set is NARROWED to private rather than refused, and the narrowing is named in the
 *   import result: a backup whose one stray record cannot be restored is a backup nobody can use,
 *   and the same reasoning already governs `skipped_undeclared`.
 *
 *   `outsideWorkspaceRoot()` is the key fence: an image key the archive names is remapped into the
 *   NEW workspace root, and anything that falls outside it is not written at all. The storage write
 *   itself goes through services/storage-file-write.ts, which carries the key fence, the app-owned
 *   key refusal and the file ceilings.
 * @structure ImportCaller · RestoreClamp · importCallerContext() · restoredLevel() ·
 *   outsideWorkspaceRoot()
 * @usage
 *   const level = await restoredLevel({ storage, config }, caller, { key, target }, o.visibility, 'workspace import');
 *   if (level.clamp) clamped.push(level.clamp);
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial (secaudit 2026-10, workspace-import:restore-skips-write-gates).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, StoredVisibility } from '../storage/interface.js';
import type { ContentLabelTarget } from '../storage/types/content-labels.js';
import type { CallerContext } from './caller-context.js';
import { callerFromAuth } from './caller-context.js';
import { isStoredVisibility, organismVisibilityRefusal } from './organism-visibility.js';
import { closedNodeLevel } from './closed-node-level.js';
import { memoryCapRefusal, memoryWriterAsk } from './memory-publish-gate.js';
import { isRaiseToPublic } from './publish-gate.js';
import { localAccountName, ownerGhiiOf } from '../utils/gaii.js';

/** The token facts a restore has about the principal that asked for it. */
export interface ImportCaller {
    /** The session principal (resolveIdentity): a GHII, an agent GAII or a GEAI. */
    principal: string;
    /** The namespace the restore writes into. */
    targetGaii: string;
    /** The bare account name behind the session. */
    owner: string;
    roles: readonly string[];
    scopes: readonly string[];
    /** A session from another node. */
    federated?: boolean;
    /** `owner/filename` of an app grant, so a publish request names the app that asked. */
    app?: string;
}

/** Why a restored item is stored at a narrower level than the archive named. */
export type RestoreClampReason =
    | 'not_a_level'
    | 'not_organism_member'
    | 'signed_in_only'
    | 'label_caps_audience'
    | 'needs_the_owner'
    | 'share_password_not_carried';

/** One narrowing, named in the import result so the person sees what the restore changed. */
export interface RestoreClamp {
    /** The memory key or storage key the item was stored at. */
    key: string;
    /** The level the archive named. */
    asked: string;
    /** The level it was stored at. */
    stored: string;
    reason: RestoreClampReason;
    message: string;
}

/** One item the restore did not write at all, with the reason. */
export interface RestoreSkip {
    key: string;
    reason: string;
}

/**
 * The caller object the publish gate and the organism create read, built from the facts every
 * import door has. The same construction services/memory-publish-gate.ts makes for a memory write.
 */
export function importCallerContext(
    ctx: { storage: Storage; config: AimeatConfig }, caller: ImportCaller,
): CallerContext {
    return callerFromAuth({
        sub: caller.principal,
        owner: caller.owner || localAccountName(ownerGhiiOf(caller.targetGaii)),
        roles: [...caller.roles], scopes: [...caller.scopes],
        ...(caller.federated !== undefined ? { federated: caller.federated } : {}),
    }, ctx.config.nodeId, ctx.storage);
}

/** True when a remapped key fell outside the workspace the restore is building. */
export function outsideWorkspaceRoot(newRoot: string, key: string): boolean {
    return !key.startsWith(`${newRoot}.`);
}

/**
 * The level one archived item is stored at: the archive's word when this caller may set it here, and
 * private otherwise. The order is the one every write door uses — the audience rule, the closed
 * node, the label cap, then the publish gate — so a restore can store nothing a direct write would
 * have refused.
 *
 * `where` names the act in a cap refusal's audit entry ('workspace import', 'organism import').
 */
export async function restoredLevel(
    ctx: { storage: Storage; config: AimeatConfig },
    caller: ImportCaller,
    item: { key: string; target: ContentLabelTarget },
    asked: unknown,
    where: string,
): Promise<{ visibility: StoredVisibility; clamp: RestoreClamp | null }> {
    const narrowed = (reason: RestoreClampReason, message: string, stored: StoredVisibility = 'private') => ({
        visibility: stored,
        clamp: { key: item.key, asked: String(asked), stored, reason, message },
    });

    if (asked === undefined || asked === null || asked === '') return { visibility: 'private', clamp: null };
    if (!isStoredVisibility(asked)) {
        return narrowed('not_a_level', `The archive names "${String(asked)}", which is not a level this node stores. Restored as private.`);
    }

    let visibility: StoredVisibility = asked;
    let clamp: RestoreClamp | null = null;

    // The organism-membership audience rule: naming an organism is for its active members, and the
    // archive was written somewhere else, by someone else.
    const audience = await organismVisibilityRefusal(ctx.storage, visibility, {
        identity: caller.principal, federated: caller.federated === true,
    });
    if (audience) return narrowed('not_organism_member', `${audience.message} Restored as private.`);

    // A node that shows its content to its signed-in accounts only stores public at 'members'.
    const closed = closedNodeLevel(ctx.config, visibility, 'members' as const, {});
    if (closed.warning) {
        visibility = 'members';
        clamp = { key: item.key, asked: String(asked), stored: 'members', reason: 'signed_in_only', message: closed.warning.message };
    }

    // The label's audience cap, before the publish gate, as on every write path.
    const capped = await memoryCapRefusal(ctx, caller, [item.target], visibility, undefined, where);
    if (capped) return narrowed('label_caps_audience', `${capped.message} Restored as private.`);

    // The publish gate: a restore that would make the item public, by a caller the node asks the
    // owner about, keeps it private. No request is filed: the owner asked for a restore, not for a
    // publication, and a bundle can carry hundreds of public records.
    if (isRaiseToPublic(undefined, visibility)) {
        const ask = memoryWriterAsk(ctx, caller);
        if (ask.kind !== 'allowed') {
            return narrowed('needs_the_owner', 'Making something public here needs the owner or the "publish:public" permission. Restored as private.');
        }
    }

    return { visibility, clamp };
}
