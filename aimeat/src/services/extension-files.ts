/**
 * @file src/services/extension-files.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The file half of the extension sandbox: ctx.files.read / ctx.files.write. An
 *   extension could hold memory records and make outbound text requests, and had no way to touch a
 *   stored FILE — so every capability that works on bytes (an image, a PDF, an audio clip) had to
 *   take base64 in its arguments and hand base64 back in its result. ctx.fetch cannot stand in for
 *   it either: it answers with `text`, so binary read through it is corrupt by construction.
 *
 *   Two rules make this safe to hand to sandboxed code:
 *     READ  — authorized as the READER, through the same authorizeRead() the /v1/pub route uses. An
 *             extension can read exactly what the principal behind the run could read, never more.
 *     WRITE — lands in the caller's own storage under a reserved `ext/{name}/` prefix. The result
 *             belongs to the person who paid for it and shows up in their files, and no extension
 *             can overwrite something they wrote themselves.
 *   Both are size-capped before any base64 crosses the QuickJS bridge, and a write goes through the
 *   ordinary per-file limit and storage quota.
 *
 *   THE READER AND THE NAMESPACE ARE TWO QUESTIONS. On an attended call they have one answer, the
 *   caller, and `reader*` is left out. They part company with nobody present: a schedule, an
 *   @activate job or a workflow step writes into the OWNER's namespace, because a produced file
 *   needs one permanent address, while the authority behind the run belongs to whoever installed
 *   the extension. Passing the namespace as the accessor made the owner's GHII the reader on every
 *   unattended road, so an extension an agent installed read the owner's private files and reported
 *   what it found, which that agent is refused on every attended path (secaudit 2026-10,
 *   extension-system-run:files-read-as-owner-ghii).
 *
 *   THE PREFIX IS A PARAMETER, NOT A CONSTANT — and it defaults to the fence. A road may name a
 *   different key root ONLY when the road, not the guest, derives the key: that is what
 *   `ctx.datapackage` does, where the host builds `datapkg/{name}/{contentHash}/…` and the sandbox
 *   never gets to say where its bytes land. Handing an extension a free choice of root would undo
 *   the one rule that keeps an installed extension off the owner's own files, so `keyPrefix` is set
 *   by the factory's caller and is never read from anything the guest supplies.
 *
 *   A PUBLIC WRITE MEETS WHAT AN UPLOAD MEETS. With `publishers` (services/publish-actors.ts), a
 *   write asked as public takes the closed node's level, the label's audience cap and the node's
 *   publish gate, as writeStorageFile does for an upload: a principal the owner is asked about gets
 *   the file stored at the level it had (a new one: private), a request filed, and `publishRequest`
 *   in the answer; the same url opens for everyone once the owner approves. An agent without
 *   publish:public made a file public at its own or the owner's address through an extension it
 *   installed (secaudit 2026-10, v69).
 * @structure MAX_FILE_BYTES · parseRef · publicFileLevel · makeExtensionFiles (the ctx.files factory)
 * @usage const files = makeExtensionFiles({ config, storage, callerGaii, extName });
 *   const ctx: ExtensionCtx = { …, files };
 *   // unattended: the owner's namespace, the installer's reach
 *   makeExtensionFiles({ config, storage, extName, callerGaii: ownerGhii, callerOwner: ownerName,
 *     readerGaii: installer.gaii, readerOwner: installer.owner,
 *     readerRoles: installer.roles, readerScopes: installer.scopes });
 * @version-history
 *   v1.7.0 — 2026-10-30 — read() answers the file's `visibility`, and `workspaceRef` when it is bound
 *     to workspaces, so an extension can tell whether the people it links the file for can open it.
 *   v1.6.0 — 2026-10-22 — `publishers`: a public write takes the closed node's level, the label's
 *     audience cap and the publish gate, as an upload does, and answers `visibility` and, when making
 *     it public waits for the owner, `publishRequest` (secaudit 2026-10, v69).
 *   v1.5.0 — 2026-10-20 — `narrowedNote`: a refusal caused by the owner's own setting says so and
 *     says where to change it, so a narrowing never reads as a fault (Jouni, 2026-10-20).
 *   v1.4.0 — 2026-10-20 — `readerGaii`, `readerOwner`, `readerRoles` and `readerScopes`: a read is
 *     authorized against the reader, which defaults to the caller, while the caller stays the
 *     namespace for writes (secaudit 2026-10, extension-system-run:files-read-as-owner-ghii).
 *   v1.0.1 — 2026-10-05 — The file's workspace binding goes to fileTarget (secaudit 2026-10, DATA-4).
 *   v1.0.0 — 2026-07-26 — Initial: ctx.files.read/write so a capability can take a file REFERENCE
 *     instead of its bytes (image pipelines, MCP-safe handoff).
 *   v1.1.0 — 2026-07-26 — parseRef delegates to services/file-refs.ts: the same reference form now
 *     serves MCP tools, DM attachments and task attachments, and there is one implementation of it.
 *   v1.2.0 — 2026-08-15 — TARGET-063 A2/A4: `keyPrefix` is a dependency (default unchanged), so a
 *     host-derived key path can live outside `ext/{name}/` without the guest gaining that choice.
 *     `write()` also returns the file's OWNER, which the scheduled road needs: it writes into the
 *     installer's namespace rather than its own, so "the URL of what I just wrote" is no longer
 *     derivable from the caller the sandbox can see.
 *   v1.3.0 — 2026-09-29 — read() passes the file through the classification show() as the caller
 *     (readerForCaller, TARGET-082 V4): a file the caller may not see is refused with CLASSIFIED, and
 *     a warning label is returned as `classificationWarning`. `callerRoles` and `callerScopes` say
 *     who the caller is; without them the caller reads as an unattended run.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, StorageFileRecord } from '../storage/interface.js';
import type { PublishRequester } from './publish-requests/store.js';
import type { ClosedNodeWarning } from './closed-node-level.js';
import { closedFileLevel, fileCapRefusal, keptFileLevel, fileFilePublishRequest } from './storage-file-publish.js';
import { isRaiseToPublic } from './publish-gate.js';
import { askActors, type PublishActor } from './publish-actors.js';
import { authorizeRead } from './access-guard.js';
import { parseFileRef } from './file-refs.js';
import { checkStorageQuota } from './quota.js';
import { localAccountName } from '../utils/gaii.js';
import { readerForCaller } from './classification/reader.js';
import { ClassificationError, fileTarget } from './classification/labels.js';

/** The warning a classified file carries when an AI caller is shown it (reader.show). */
export interface ExtensionFileWarning { label: string; name: string; says: string }

/** What may cross the sandbox bridge in one call, in decoded bytes. */
export const MAX_EXT_FILE_BYTES = 8 * 1024 * 1024;

export interface ExtensionFileRef {
    /** "<gaii>/<key>", or a bare key meaning the caller's own storage. */
    ref: string;
}

/**
 * Split "<gaii>/<key>" into its parts. A GAII always carries an @node, so the first path segment
 * is an owner only when it looks like one; anything else is a plain key belonging to the caller.
 * Kept as a named export here (the sandbox's vocabulary) over the shared implementation.
 */
export const parseRef = parseFileRef;

/** Where a sandbox write lands: its level, and who the owner is asked for when publishing it waits. */
interface WriteLevel {
    visibility: StorageFileRecord['visibility'];
    groupId: string | undefined;
    workspaceRef: string | undefined;
    requester: PublishRequester | null;
    warning: ClosedNodeWarning | null;
}

/**
 * The level a sandbox write stores a file at: what writeStorageFile decides for an upload
 * (services/storage-file-write.ts), asked about the run's publishers. A private write is unchanged. A
 * public one is stored at 'members' on a node that shows its content to signed-in accounts only, is
 * refused past its label's audience cap, and, when it raises the file to public for a principal the
 * owner is asked about, is stored at the level the file had (a new one: private) with the requester
 * the request is filed for. A refusal throws, as every refusal in the sandbox does.
 */
async function publicFileLevel(
    ctx: { storage: Storage; config: AimeatConfig }, ownerGaii: string, key: string, asked: 'public' | 'private',
    publishers: readonly PublishActor[],
): Promise<WriteLevel> {
    const plain: WriteLevel = { visibility: asked, groupId: undefined, workspaceRef: undefined, requester: null, warning: null };
    if (asked !== 'public') return plain;
    const closed = await closedFileLevel(ctx, ownerGaii, key, 'public' as const);
    const first = publishers[0];
    const capped = first
        ? await fileCapRefusal(ctx, ownerGaii, key, closed.visibility, undefined, { caller: first.caller, ...(first.app ? { app: first.app } : {}) })
        : null;
    if (capped) throw new Error(`${capped.code}: ${capped.message}`);
    if (closed.visibility !== 'public') return { ...plain, visibility: closed.visibility, warning: closed.warning };
    const existing = await ctx.storage.getStorageFileMeta(ownerGaii, key);
    if (!isRaiseToPublic(existing?.visibility, 'public')) return plain;
    const ask = askActors(ctx, publishers);
    if (ask.kind === 'refused') throw new Error(`${ask.code}: ${ask.message}`);
    if (ask.kind === 'allowed') return plain;
    return { ...keptFileLevel(existing), requester: ask.requester, warning: null };
}

export function makeExtensionFiles(deps: {
    config: AimeatConfig;
    storage: Storage;
    /**
     * The NAMESPACE: whose storage a write lands in, and what a bare reference resolves against.
     * It is not the read authority — see `readerGaii`.
     */
    callerGaii: string;
    callerOwner?: string;
    /**
     * The caller's roles and scopes, for the classification reader (TARGET-082). Without roles the
     * caller is an unattended run (['operator']), which reads as an AI: the stricter reading.
     */
    callerRoles?: string[];
    callerScopes?: string[];
    /**
     * The READ AUTHORITY: the principal `authorizeRead` and the classification reader judge a read
     * against. Defaults to the caller, which is the answer on every attended road. An unattended
     * road passes the principal that installed the extension, with that principal's scopes as they
     * stand now, so the run reads what that principal could read and no more.
     */
    readerGaii?: string;
    readerOwner?: string;
    readerRoles?: string[];
    readerScopes?: string[];
    /**
     * One sentence appended to a read refusal, naming the owner's own setting as the cause and where
     * to change it. Passed only when the reach WAS narrowed by that setting, so an ordinary
     * permission refusal never carries it.
     */
    narrowedNote?: string;
    extName: string;
    /**
     * The key root every write is forced under. Defaults to `ext/{extName}/`, which is the fence
     * that keeps an extension off files the owner wrote by hand. Pass something else ONLY from a
     * road that derives the whole key itself — see the file header.
     */
    keyPrefix?: string;
    /**
     * The principals the node's publish gate is asked about when a write makes a file public
     * (services/publish-actors.ts): the caller of an attended action, the installer of an unattended
     * one. Absent asks nothing, as before.
     */
    publishers?: readonly PublishActor[];
}): {
    read(ref: string): Promise<{
        base64: string; mime: string; size: number; key: string; visibility: string; workspaceRef?: string;
        classificationWarning?: ExtensionFileWarning;
    } | null>;
    write(key: string, base64: string, opts?: { mime?: string; visibility?: string }):
        Promise<{
            key: string; gaii: string; owner: string; url: string; size: number; visibility: string;
            publishRequest?: unknown; warnings?: Array<{ code: string; message: string }>;
        }>;
} {
    const { config, storage, callerGaii, callerOwner, extName } = deps;
    const keyPrefix = deps.keyPrefix ?? `ext/${extName}/`;
    // The read authority. Without `readerGaii` it is the caller, which is the attended road, where
    // the namespace and the authority are the same principal. With it, the four reader fields are
    // read as one identity: a missing role or scope list is empty rather than the caller's, so a
    // half-filled reader is narrower than the caller and never wider.
    const asCaller = deps.readerGaii === undefined;
    const readerGaii = asCaller ? callerGaii : deps.readerGaii as string;
    const readerOwner = (asCaller ? callerOwner : deps.readerOwner) ?? localAccountName(readerGaii);
    const reader = readerForCaller({ storage, config }, {
        gaii: readerGaii,
        owner: readerOwner,
        roles: (asCaller ? deps.callerRoles : deps.readerRoles) ?? ['operator'],
        scopes: (asCaller ? deps.callerScopes : deps.readerScopes) ?? [],
    });
    // A refusal that is the owner's own setting says so, and says where the setting is. Without it
    // the script reports "access denied" for a file the owner can plainly see, and nobody can tell
    // that from a real permission problem (Jouni, 2026-10-20: a narrowing must never read as a
    // fault). Empty on every attended road and whenever the reach was not narrowed.
    const narrowedNote = deps.narrowedNote ? ` ${deps.narrowedNote}` : '';

    return {
        async read(ref) {
            const { gaii, key } = parseRef(String(ref || ''), callerGaii);
            if (!key) return null;
            const file = await storage.getStorageFile(gaii, key);
            if (!file) return null;

            // The extension reads AS THE READER. A capability must never become a way to see a file
            // the principal behind the run could not open themselves. On an attended call that is
            // the caller; with nobody present it is the principal that installed the extension.
            const decision = await authorizeRead(storage, config, {
                ownerGaii: gaii,
                accessorGaii: readerGaii,
                resourceKey: `storage:${key}`,
                visibility: file.visibility,
                groupId: file.groupId,
                workspaceRef: file.workspaceRef,
                accessorSub: readerGaii,
                accessorOwner: readerOwner,
                action: 'read',
            });
            if (!decision.allowed) {
                throw new Error(`Access denied for ${gaii}/${key}: ${decision.reason ?? 'not permitted'}${narrowedNote}`);
            }
            // And the classification check, as the same caller (TARGET-082): a file this caller may
            // not see is refused by name, and a warning label rides along on the answer.
            const [shown] = await reader.show([file], () => fileTarget(gaii, key, file.workspaceRef));
            if (!shown) {
                throw new ClassificationError('CLASSIFIED', 403, `${gaii}/${key} is classified, and the principal this action runs for may not read it.${narrowedNote}`);
            }
            const warning = (shown as { classificationWarning?: ExtensionFileWarning }).classificationWarning;
            if (file.size > MAX_EXT_FILE_BYTES) {
                throw new Error(`File ${key} is ${Math.round(file.size / 1024)} kB, over the ${MAX_EXT_FILE_BYTES / 1024 / 1024} MB sandbox limit`);
            }
            return {
                base64: Buffer.from(file.data).toString('base64'),
                mime: file.mimeType,
                size: file.size,
                key: `${gaii}/${key}`,
                // Who else can open it, so a script that hands the address on can say when the
                // reader will get 403 (a private upload linked into a shared record, 2026-10-30).
                visibility: file.visibility,
                ...(file.visibility === 'workspace' && file.workspaceRef ? { workspaceRef: file.workspaceRef } : {}),
                ...(warning ? { classificationWarning: warning } : {}),
            };
        },

        async write(key, base64, opts) {
            const clean = String(key || '').replace(/^\/+/, '').trim();
            if (!clean) throw new Error('write() needs a key');
            // Reserved prefix: the result is attributable to the extension that made it, and no
            // extension can land on top of a file the owner wrote by hand. A storage key is an
            // opaque string rather than a filesystem path, so `..` inside one is inert — it names a
            // silly key, not a directory to climb out of.
            const full = clean.startsWith(keyPrefix) ? clean : `${keyPrefix}${clean}`;

            const data = Buffer.from(String(base64 || '').replace(/^data:[^;]+;base64,/, ''), 'base64');
            if (!data.length) throw new Error('write() got no bytes');
            if (data.length > MAX_EXT_FILE_BYTES) {
                throw new Error(`Refusing ${Math.round(data.length / 1024)} kB: over the ${MAX_EXT_FILE_BYTES / 1024 / 1024} MB sandbox limit`);
            }
            if (data.length > config.storageMaxFileSizeMb * 1024 * 1024) {
                throw new Error(`File size exceeds the node's ${config.storageMaxFileSizeMb}MB limit`);
            }
            const quota = await checkStorageQuota(config, storage, callerGaii, data.length);
            if (!quota.allowed) throw new Error(quota.reason ?? 'storage quota exceeded');

            const asked = opts?.visibility === 'public' ? 'public' : 'private';
            // A public write meets what an upload meets (services/storage-file-write.ts): the closed
            // node's level, the label's audience cap and the publish gate, asked about `publishers`.
            const level: WriteLevel = deps.publishers
                ? await publicFileLevel({ storage, config }, callerGaii, full, asked, deps.publishers)
                : { visibility: asked, groupId: undefined, workspaceRef: undefined, requester: null, warning: null };
            const file = await storage.createStorageFile({
                key: full,
                ownerGaii: callerGaii,
                visibility: level.visibility,
                ...(level.groupId ? { groupId: level.groupId } : {}),
                ...(level.workspaceRef ? { workspaceRef: level.workspaceRef } : {}),
                mimeType: opts?.mime || 'application/octet-stream',
                size: data.length,
                data,
                tags: [`ext:${extName}`],
                createdAt: new Date().toISOString(),
            });
            // The request the gate asked for, now that the file it names exists.
            const filed = level.requester ? await fileFilePublishRequest({ storage, config }, level.requester, file) : null;
            return {
                key: full,
                gaii: callerGaii,
                // The namespace the file landed in, spelled out. On the scheduled road that is the
                // INSTALLER, not the principal the sandbox sees as its caller, and a script that
                // wants to hand the address on cannot work it out from anything else it holds.
                owner: callerGaii,
                // Only meaningful for a public file; a private one is fetched with the owner's token.
                // A file whose publishing waits for the owner opens at this address once approved.
                url: `${config.baseUrl}/v1/pub/${encodeURIComponent(callerGaii)}/${full.split('/').map(encodeURIComponent).join('/')}`,
                size: data.length,
                visibility: level.visibility,
                ...(filed?.ok ? { publishRequest: filed.publishRequest } : {}),
                ...(filed && !filed.ok ? { warnings: [filed.warning] } : {}),
                ...(level.warning ? { warnings: [level.warning] } : {}),
            };
        },
    };
}
