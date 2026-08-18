/**
 * @file src/services/storage-file-write.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storing and removing one binary file, once, for every surface that can do either.
 *
 *   WHY THIS FILE EXISTS. `POST /v1/storage` and `aimeat_storage_upload` are the same capability, and
 *   the two copies had drifted in the way that costs money and access rather than tidiness:
 *
 *   1. The account-wide storage quota (M-2, §8.4) ran on the HTTP door and on the presigned handler,
 *      and nowhere on the tool. An agent uploading through MCP could pass the node's 100 MB ceiling
 *      without ever being told, because the tool checked only the PER-FILE size.
 *   2. The overage charge (M-3, §15) that follows that check was likewise absent, so the identical
 *      upload was billed through the browser and free through the tool. The same class of difference
 *      cost this audit a missing per-call toll in exchange_bid_accept.
 *   3. The anonymous key fence lived on the HTTP door only. Its own history says why it belongs on
 *      the write: storage-files v1.8.0 moved it in front of the presigned mint after it turned out
 *      that asking for an upload URL was a way past it. A gate that has already escaped once through
 *      a second representation must not also depend on which door is knocking.
 *   4. On the presigned side the HTTP door hand-wrote the token meta and dropped `group_id` and
 *      `workspace_refs`. That is the exact failure `buildUploadMeta` exists to prevent: a presigned
 *      upload asking for visibility 'group' landed as a group file bound to no group, which
 *      authorizeRead then refuses to everybody, and nothing anywhere said why.
 *
 *   WHAT IS SHARED AND WHAT IS NOT. Shared here: the key fence, the workspace binding requirement,
 *   the per-file ceiling, the account quota, the record shape, the overage charge and the change
 *   events. Not shared, because it genuinely belongs to one door: how a request is parsed, and how a
 *   refusal or a result is rendered. The service never sees an Express Response and never writes one.
 * @structure
 *   - StorageWriteDeps / StorageFileInput / StorageFileWriteResult — the contract
 *   - writeStorageFile() — the inline write, in order, with the fence first
 *   - mintStorageUploadUrl() — the presigned representation of the same write
 *   - removeStorageFile() — the delete, sharing the same key fence and change events
 * @usage
 *   const out = await writeStorageFile({ storage, config, emitResourceUpdated }, gaii, input);
 *   if (!out.ok) return renderRefusal(out);   // each door renders its own way
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial (August 2026 audit step 8, unit storage-files). Collapses
 *     POST /v1/storage and aimeat_storage_upload onto one write.
 *   v1.1.0 — 2026-08-15 — removeStorageFile(): the delete, which had one door (DELETE /v1/storage)
 *     and no tool, so an agent could store a file over MCP and never take it back. Written here
 *     rather than in the new tool because the anonymous key fence was already a hand-copied second
 *     copy on that route, and because the route emitted only `files` while the upload emits `files`
 *     and `memory` — a delete moves the byte budget the memory view renders exactly as an upload
 *     does, and the two views disagreed about it.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, StorageFileRecord } from '../storage/interface.js';
import { checkStorageQuota, chargeOverage } from './quota.js';
import { generateUploadToken, buildUploadMeta } from './upload-token.js';
import { emitChange } from './event-bus.js';
import { isAnonymousGaii } from '../routes/memory/shared.js';

/** How long a presigned storage upload URL is good for. The number the caller is told and the number
 *  the token is signed with are the same value, so they cannot drift apart. */
export const STORAGE_UPLOAD_URL_TTL_SECONDS = 3600;

/** What a caller supplies so the write can reach the rest of the node. */
export interface StorageWriteDeps {
    storage: Storage;
    config: AimeatConfig;
    /** MCP resource notifications. Optional so a door without them still writes. */
    emitResourceUpdated?: (gaii: string, uri: string) => void;
    emitResourceListChanged?: (gaii: string) => void;
}

export interface StorageWriteRefusal {
    ok: false;
    status: number;
    code: 'INVALID_INPUT' | 'FORBIDDEN' | 'QUOTA_EXCEEDED';
    message: string;
    /**
     * Which ceiling refused, when the code is QUOTA_EXCEEDED. The per-file one has an answer the
     * caller can act on straight away (ask for a presigned URL); the account one does not, and
     * offering it there would send an agent round a loop that ends in the same refusal.
     */
    limit?: 'per_file' | 'account';
}

export interface StorageFileInput {
    key: string;
    data: Buffer;
    mimeType?: string;
    visibility?: StorageFileRecord['visibility'];
    groupId?: string;
    /** Already normalized by the caller through utils/workspace-ref.js: a single string. */
    workspaceRef?: string;
    tags?: string[];
    federate?: boolean;
}

export type StorageFileWriteResult =
    | { ok: true; file: StorageFileRecord; overageMorsels: number }
    | StorageWriteRefusal;

/**
 * The two refusals the key fence itself can produce. Narrower than either result type on purpose, so
 * it is assignable to both the write's and the delete's, and neither door can be handed a refusal
 * code it does not answer for.
 */
interface KeyRefusal {
    ok: false;
    status: number;
    code: 'INVALID_INPUT' | 'FORBIDDEN';
    message: string;
}

/**
 * May this principal touch this key at all. Every representation of the upload runs it, and so does
 * the delete, which is the point: the fence is on the act, not on the shape the caller happens to
 * ask for. The DELETE route carried its own copy of this until v1.1.0.
 */
function checkKey(ownerGaii: string, key: string): KeyRefusal | null {
    if (!key) {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'key is required' };
    }
    if (isAnonymousGaii(ownerGaii) && !key.startsWith('anonymous/')) {
        return {
            ok: false, status: 403, code: 'FORBIDDEN',
            message: 'Anonymous agents can only use keys prefixed with "anonymous/"',
        };
    }
    return null;
}

/** Store one file under `ownerGaii`, with every gate and side effect the capability carries. */
export async function writeStorageFile(
    deps: StorageWriteDeps,
    ownerGaii: string,
    input: StorageFileInput,
): Promise<StorageFileWriteResult> {
    const { storage, config } = deps;

    const fenced = checkKey(ownerGaii, input.key);
    if (fenced) return fenced;

    const visibility = input.visibility ?? 'private';
    // A workspace-visible file that names no workspace is readable by nobody, so it is refused here
    // rather than stored and puzzled over later.
    if (visibility === 'workspace' && !input.workspaceRef) {
        return {
            ok: false, status: 400, code: 'INVALID_INPUT',
            message: 'visibility "workspace" requires workspace_refs (or workspace_ref) as one or more "<organismId>/<workspaceId>"',
        };
    }

    if (input.data.length > config.storageMaxFileSizeMb * 1024 * 1024) {
        return {
            ok: false, status: 413, code: 'QUOTA_EXCEEDED', limit: 'per_file',
            message: `File size exceeds ${config.storageMaxFileSizeMb}MB limit`,
        };
    }

    // M-2 (§8.4): the account-wide ceiling, which is a different gate from the per-file one above.
    const quota = await checkStorageQuota(config, storage, ownerGaii, input.data.length);
    if (!quota.allowed) {
        return { ok: false, status: 413, code: 'QUOTA_EXCEEDED', limit: 'account', message: quota.reason! };
    }

    const file = await storage.createStorageFile({
        key: input.key,
        ownerGaii,
        visibility,
        groupId: visibility === 'group' ? input.groupId : undefined,
        workspaceRef: visibility === 'workspace' ? input.workspaceRef : undefined,
        mimeType: input.mimeType ?? 'application/octet-stream',
        size: input.data.length,
        data: input.data,
        ...(input.tags?.length ? { tags: input.tags } : {}),
        federate: input.federate === true,
        createdAt: new Date().toISOString(),
    });

    // M-3 (§15): the charge that follows the check. Missing on the tool door, so the same upload
    // was metered through the browser and free through MCP.
    if (quota.overageMorsels > 0) {
        await chargeOverage(storage, ownerGaii, quota.overageMorsels, 'storage_overage');
    }

    deps.emitResourceUpdated?.(ownerGaii, `aimeat://storage/${encodeURIComponent(input.key)}`);
    deps.emitResourceListChanged?.(ownerGaii);

    // Both views: a stored file appears in the files list and counts against the byte budget the
    // memory view renders. The tool emitted both and POST /v1/storage emitted only 'files', so an
    // upload by an agent moved the memory view and the identical upload from the browser did not.
    emitChange('files');
    emitChange('memory');

    return { ok: true, file, overageMorsels: quota.overageMorsels };
}

export interface StorageDeleteRefusal {
    ok: false;
    status: number;
    code: 'INVALID_INPUT' | 'FORBIDDEN' | 'NOT_FOUND' | 'ACCESS_DENIED';
    message: string;
}

export type StorageFileDeleteResult =
    | { ok: true; key: string; size: number; mimeType: string; visibility: StorageFileRecord['visibility'] }
    | StorageDeleteRefusal;

/**
 * Remove one file from `ownerGaii`'s namespace. Irreversible: there is no version history behind a
 * stored file the way there is behind a memory record, so what this deletes is gone.
 *
 * THE ORDER IS THE POINT. Fence, then read, then compare, then delete — a refusal must happen before
 * anything is removed, which is the same rule the write follows for the quota. It also lets the
 * caller be told WHAT it deleted (size, type), because those are read before the row goes.
 *
 * WHY NO CROSS-OWNER FORM. Reading has one, and it is the reason aimeat_storage_download takes a
 * reference: a file is keyed by (owner, key) and an agent legitimately reads its owner's uploads.
 * Deleting does not get the same door. `getStorageFile(ownerGaii, key)` is namespaced to the caller,
 * so a file belonging to anyone else is simply absent here, and the ownership comparison below is a
 * second lock on a door that is already shut rather than the lock that shuts it.
 */
export async function removeStorageFile(
    deps: StorageWriteDeps,
    ownerGaii: string,
    key: string,
): Promise<StorageFileDeleteResult> {
    const { storage } = deps;

    const fenced = checkKey(ownerGaii, key);
    if (fenced) return fenced;

    const existing = await storage.getStorageFile(ownerGaii, key);
    if (!existing) {
        return {
            ok: false, status: 404, code: 'NOT_FOUND',
            message: `File not found in your namespace: ${key}. This deletes only your own files — a file someone else owns is not reachable here, whatever you may be allowed to read.`,
        };
    }
    if (existing.ownerGaii !== ownerGaii) {
        return { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'You can only delete your own files' };
    }

    const deleted = await storage.deleteStorageFile(ownerGaii, key);
    if (!deleted) {
        // The row was there a moment ago and is not now. Another door removed it in between, which
        // is the caller's desired end state, but saying "deleted" would claim work we did not do.
        return { ok: false, status: 404, code: 'NOT_FOUND', message: `File not found: ${key}` };
    }

    deps.emitResourceUpdated?.(ownerGaii, `aimeat://storage/${encodeURIComponent(key)}`);
    deps.emitResourceListChanged?.(ownerGaii);

    // Both views, for the same reason the write emits both: the file leaves the files list AND frees
    // bytes in the budget the memory view renders. The route emitted only 'files'.
    emitChange('files');
    emitChange('memory');

    return {
        ok: true, key, size: existing.size, mimeType: existing.mimeType, visibility: existing.visibility,
    };
}

export interface StorageUploadUrlInput {
    key: string;
    mimeType?: string;
    visibility?: string;
    groupId?: string;
    tags?: string[];
    /** Already normalized through utils/workspace-ref.js: a single string. */
    workspaceRef?: string;
}

export type StorageUploadUrlResult =
    | {
        ok: true;
        uploadUrl: string;
        contentType: string;
        maxBytes: number;
        expiresInSeconds: number;
    }
    | StorageWriteRefusal;

/**
 * Mint a presigned URL for the same write. The options the caller states here ride in the SIGNED
 * token (PRESIGNED_META_KEYS.storage) and are applied by PUT /v1/upload/:token, so what was asked
 * for when the URL was requested is what lands with the bytes.
 */
export async function mintStorageUploadUrl(
    deps: StorageWriteDeps,
    ownerGaii: string,
    input: StorageUploadUrlInput,
): Promise<StorageUploadUrlResult> {
    const { config } = deps;

    const fenced = checkKey(ownerGaii, input.key);
    if (fenced) return fenced;

    // The operator's own setting, not a constant: a node configured for 50 MB used to mint 10 MB
    // tokens and refuse everything above it, with nothing connecting the admin page to the tool.
    const maxBytes = config.storageMaxFileSizeMb * 1024 * 1024;
    const contentType = input.mimeType ?? 'application/octet-stream';
    const token = await generateUploadToken({
        sub: ownerGaii,
        utype: 'storage',
        meta: buildUploadMeta('storage', {
            key: input.key,
            mime_type: contentType,
            visibility: input.visibility ?? 'private',
            group_id: input.groupId,
            tags: input.tags,
            workspace_refs: input.workspaceRef || undefined,
        }),
        maxBytes,
        contentType,
    }, STORAGE_UPLOAD_URL_TTL_SECONDS);

    return {
        ok: true,
        uploadUrl: `${config.baseUrl}/v1/upload/${token}`,
        contentType,
        maxBytes,
        expiresInSeconds: STORAGE_UPLOAD_URL_TTL_SECONDS,
    };
}
