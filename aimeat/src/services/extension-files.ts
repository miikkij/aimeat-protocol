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
 *     READ  — authorized as the CALLER, through the same authorizeRead() the /v1/pub route uses. An
 *             extension can read exactly what the person invoking it could read, never more.
 *     WRITE — lands in the caller's own storage under a reserved `ext/{name}/` prefix. The result
 *             belongs to the person who paid for it and shows up in their files, and no extension
 *             can overwrite something they wrote themselves.
 *   Both are size-capped before any base64 crosses the QuickJS bridge, and a write goes through the
 *   ordinary per-file limit and storage quota.
 *
 *   THE PREFIX IS A PARAMETER, NOT A CONSTANT — and it defaults to the fence. A road may name a
 *   different key root ONLY when the road, not the guest, derives the key: that is what
 *   `ctx.datapackage` does, where the host builds `datapkg/{name}/{contentHash}/…` and the sandbox
 *   never gets to say where its bytes land. Handing an extension a free choice of root would undo
 *   the one rule that keeps an installed extension off the owner's own files, so `keyPrefix` is set
 *   by the factory's caller and is never read from anything the guest supplies.
 * @structure MAX_FILE_BYTES · parseRef · makeExtensionFiles (the ctx.files factory)
 * @usage const files = makeExtensionFiles({ config, storage, callerGaii, extName });
 *   const ctx: ExtensionCtx = { …, files };
 * @version-history
 *   v1.0.0 — 2026-07-26 — Initial: ctx.files.read/write so a capability can take a file REFERENCE
 *     instead of its bytes (image pipelines, MCP-safe handoff).
 *   v1.1.0 — 2026-07-26 — parseRef delegates to services/file-refs.ts: the same reference form now
 *     serves MCP tools, DM attachments and task attachments, and there is one implementation of it.
 *   v1.2.0 — 2026-08-15 — TARGET-063 A2/A4: `keyPrefix` is a dependency (default unchanged), so a
 *     host-derived key path can live outside `ext/{name}/` without the guest gaining that choice.
 *     `write()` also returns the file's OWNER, which the scheduled road needs: it writes into the
 *     installer's namespace rather than its own, so "the URL of what I just wrote" is no longer
 *     derivable from the caller the sandbox can see.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { authorizeRead } from './access-guard.js';
import { parseFileRef } from './file-refs.js';
import { checkStorageQuota } from './quota.js';

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

export function makeExtensionFiles(deps: {
    config: AimeatConfig;
    storage: Storage;
    /** Whose storage is read and written, and whose access rights a read is judged against. */
    callerGaii: string;
    callerOwner?: string;
    extName: string;
    /**
     * The key root every write is forced under. Defaults to `ext/{extName}/`, which is the fence
     * that keeps an extension off files the owner wrote by hand. Pass something else ONLY from a
     * road that derives the whole key itself — see the file header.
     */
    keyPrefix?: string;
}): {
    read(ref: string): Promise<{ base64: string; mime: string; size: number; key: string } | null>;
    write(key: string, base64: string, opts?: { mime?: string; visibility?: string }):
        Promise<{ key: string; gaii: string; owner: string; url: string; size: number }>;
} {
    const { config, storage, callerGaii, callerOwner, extName } = deps;
    const keyPrefix = deps.keyPrefix ?? `ext/${extName}/`;

    return {
        async read(ref) {
            const { gaii, key } = parseRef(String(ref || ''), callerGaii);
            if (!key) return null;
            const file = await storage.getStorageFile(gaii, key);
            if (!file) return null;

            // The extension reads AS the caller. A capability must never become a way to see a file
            // the person invoking it could not open themselves.
            const decision = await authorizeRead(storage, config, {
                ownerGaii: gaii,
                accessorGaii: callerGaii,
                resourceKey: `storage:${key}`,
                visibility: file.visibility,
                groupId: file.groupId,
                workspaceRef: file.workspaceRef,
                accessorSub: callerGaii,
                accessorOwner: callerOwner,
                action: 'read',
            });
            if (!decision.allowed) {
                throw new Error(`Access denied for ${gaii}/${key}: ${decision.reason ?? 'not permitted'}`);
            }
            if (file.size > MAX_EXT_FILE_BYTES) {
                throw new Error(`File ${key} is ${Math.round(file.size / 1024)} kB, over the ${MAX_EXT_FILE_BYTES / 1024 / 1024} MB sandbox limit`);
            }
            return {
                base64: Buffer.from(file.data).toString('base64'),
                mime: file.mimeType,
                size: file.size,
                key: `${gaii}/${key}`,
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

            const visibility = opts?.visibility === 'public' ? 'public' : 'private';
            await storage.createStorageFile({
                key: full,
                ownerGaii: callerGaii,
                visibility,
                mimeType: opts?.mime || 'application/octet-stream',
                size: data.length,
                data,
                tags: [`ext:${extName}`],
                createdAt: new Date().toISOString(),
            });
            return {
                key: full,
                gaii: callerGaii,
                // The namespace the file landed in, spelled out. On the scheduled road that is the
                // INSTALLER, not the principal the sandbox sees as its caller, and a script that
                // wants to hand the address on cannot work it out from anything else it holds.
                owner: callerGaii,
                // Only meaningful for a public file; a private one is fetched with the owner's token.
                url: `${config.baseUrl}/v1/pub/${encodeURIComponent(callerGaii)}/${full.split('/').map(encodeURIComponent).join('/')}`,
                size: data.length,
            };
        },
    };
}
