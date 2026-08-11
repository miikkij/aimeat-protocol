/**
 * @file src/services/storage-file-write.ts
 * @description Storing one binary file, once, for every surface that can store one.
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
 * @usage
 *   const out = await writeStorageFile({ storage, config, emitResourceUpdated }, gaii, input);
 *   if (!out.ok) return renderRefusal(out);   // each door renders its own way
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial (August 2026 audit step 8, unit storage-files). Collapses
 *     POST /v1/storage and aimeat_storage_upload onto one write.
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
 * May this principal write this key at all. Both representations of the upload run it, which is the
 * point: the fence is on the write, not on the shape the caller happens to ask for.
 */
function checkKey(ownerGaii: string, key: string): StorageWriteRefusal | null {
    if (!key) {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'key is required' };
    }
    if (isAnonymousGaii(ownerGaii) && !key.startsWith('anonymous/')) {
        return {
            ok: false, status: 403, code: 'FORBIDDEN',
            message: 'Anonymous agents can only upload to keys prefixed with "anonymous/"',
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
