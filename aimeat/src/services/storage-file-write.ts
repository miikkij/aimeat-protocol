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
 *   - APP_OWNED_KEYS / appOwnedKeyRefusal() — the keys only an app's own doors write
 *   - writeStorageFile() — the inline write, in order, with the fence first
 *   - mintStorageUploadUrl() — the presigned representation of the same write
 *   - removeStorageFile() — the delete, sharing the same key fence and change events
 *   - changeStorageFileVisibility() — the visibility change both PATCH routes and the publish
 *     request's applier make
 * @usage
 *   const out = await writeStorageFile({ storage, config, emitResourceUpdated }, gaii, input);
 *   if (!out.ok) return renderRefusal(out);   // each door renders its own way
 * @version-history
 *   v1.9.1 — 2026-10-26 — removeStorageFile and changeStorageFileVisibility reach the account's own extension file by its short key
 *     `ext/<name>/...` too, stored as `ext/<account>/<name>/...` (owner namespaces, secaudit2026oct22).
 *   v1.9.0 — 2026-10-20 — setStorageFileHooks(): the write and the delete tell the content class
 *     pipeline about a stored or removed file once it has landed or gone (services/content/intake.ts),
 *     scheduled and never awaited.
 *   v1.8.0 — 2026-10-18 — The write, the presigned mint and the visibility change refuse a level wider
 *     than the file's label allows with 409 LABEL_CAPS_AUDIENCE, before the publish gate (plan
 *     doc-mvdipuyqraas, L3.2; storage-file-publish.ts fileCapRefusal).
 *   v1.7.0 — 2026-10-18 — On a node that shows its content to signed-in accounts only, the write, the
 *     presigned mint and the visibility change store a file asked as public at 'members' (with an
 *     app grant's public upload default too) and answer `warnings` with PUBLIC_IS_SIGNED_IN_HERE,
 *     before the publish gate, at the doors that pass `publishGate` (storage-file-publish.ts
 *     closedFileLevel, plan V1.6).
 *   v1.6.0 — 2026-10-18 — A file stored or minted without a visibility takes visibility.file_default;
 *     `visibility: 'default'` takes visibility.app_upload_default for an app grant and the file default
 *     for anyone else (plan doc-mvcn6c7e4e5q, V5.2), before the gate.
 *   v1.5.0 — 2026-10-18 — The publish gate (services/storage-file-publish.ts; plan doc-mvcn6c7e4e5q,
 *     V4). `publishGate` on the write and the presigned mint: a file made public by a caller the node
 *     asks the owner about is stored at the level it had (a new one: private) and the result carries
 *     `publishRequest`; the mint carries the requester in the token as `publish_ask`. A caller with
 *     nobody on this node to ask is refused with 403 PUBLISH_NOT_ALLOWED. changeStorageFileVisibility():
 *     the visibility change, moved here from PATCH /v1/storage/{key}/visibility and
 *     PATCH /v1/memory/files/{key}/visibility so those two routes and the applier make it once.
 *   v1.4.0 — 2026-10-17 — visibility 'organism:<id>': the write and the presigned mint refuse with 400
 *     NOT_ORGANISM_MEMBER, nothing stored and no URL minted, when the account owning the namespace is
 *     not an active member of that organism (plan doc-mvcn6c7e4e5q, V3.3).
 *   v1.1.0 — 2026-10-11 — The `files` and `memory` changes of a file only its owner reads go to
 *     that owner's streams (event-bus.ts emitRecordChange). Both were global events.
 *   v1.0.0 — 2026-08-11 — Initial (August 2026 audit step 8, unit storage-files). Collapses
 *     POST /v1/storage and aimeat_storage_upload onto one write.
 *   v1.1.0 — 2026-08-15 — removeStorageFile(): the delete, which had one door (DELETE /v1/storage)
 *     and no tool, so an agent could store a file over MCP and never take it back. Written here
 *     rather than in the new tool because the anonymous key fence was already a hand-copied second
 *     copy on that route, and because the route emitted only `files` while the upload emits `files`
 *     and `memory` — a delete moves the byte budget the memory view renders exactly as an upload
 *     does, and the two views disagreed about it.
 *   v1.2.0 — 2026-09-24 — appOwnedKeyRefusal(): the write and the presigned mint refuse the
 *     `apps/icons/` and `apps/screenshots/` prefixes with 403, so only an app's own doors, which
 *     check that the bytes are a picture, write them (A7-2). A page stored there through this write
 *     was served by the icon door as a page. The delete is not fenced.
 *   v1.3.0 — 2026-10-08 — A stored file carries an AI-provenance record. `provenance` runs
 *     provenanceForWrite with the writer before the bytes are stored (an attached id must be the
 *     writer's own and match the bytes' hash; a declaration needs provenance:write; an agent that
 *     says nothing is stamped), and `aiProvenanceId` stores a record the node minted itself. The
 *     presigned mint asks the refusals that need no bytes and carries the statement in the token.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, StorageFileRecord, AiProvenanceRecordRow } from '../storage/interface.js';
import { checkStorageQuota, chargeOverage } from './quota.js';
import { generateUploadToken, buildUploadMeta } from './upload-token.js';
import { emitRecordChange } from './event-bus.js';
import { isAnonymousGaii } from '../routes/memory/shared.js';
import {
    provenanceForWrite, provenanceDeclarationRefusal, storeHeldProvenance, contentHashOf,
    ProvenanceScopeError, type DeclaredProvenance,
} from './ai-provenance.js';
import { ownerGhiiOf, localAccountName } from '../utils/gaii.js';
import { ownExtensionFileKey } from './component-address.js';
import { organismVisibilityRefusal } from './organism-visibility.js';
import { emitChange } from './event-bus.js';
import type { CallerContext } from './caller-context.js';
import {
    fileRaiseAsk, keptFileLevel, mintPublishCarry, fileFilePublishRequest, closedFileLevel, fileCapRefusal,
    type StoragePublishGate, type FilePublishFiled,
} from './storage-file-publish.js';
import type { ClosedNodeWarning } from './closed-node-level.js';
import { uploadVisibilityOf } from './content-defaults.js';

/**
 * The level of a file (plan V5.2): none named is the file default for every caller; 'default' (the
 * SDK's word) is an app grant's own default for an app. Doors map 'default' themselves; this is the
 * same rule for a caller that reaches the write or the mint directly.
 */
function levelOf(config: AimeatConfig, named: string | undefined, gate: StoragePublishGate | undefined): StorageFileRecord['visibility'] {
    return uploadVisibilityOf(config, named, !!gate && 'caller' in gate && gate.caller.kind === 'app') as StorageFileRecord['visibility'];
}

/** A function told about a stored or removed file after the fact. It returns at once and never throws. */
export type StorageFileHook = (deps: { storage: Storage; config: AimeatConfig }, ownerGaii: string, key: string) => void;

/**
 * The hooks the write and the delete call once the file has landed or gone. Set at boot
 * (setStorageFileHooks), as the write classifier is (classify-on-write.ts): the content class
 * pipeline that listens here stores its own text files through this module, so a static import
 * would close an import cycle.
 */
const fileHooks: { afterStore?: StorageFileHook; afterRemove?: StorageFileHook } = {};

/** Set the hooks the write and the delete call. Called once at boot. */
export function setStorageFileHooks(hooks: { afterStore?: StorageFileHook; afterRemove?: StorageFileHook }): void {
    fileHooks.afterStore = hooks.afterStore;
    fileHooks.afterRemove = hooks.afterRemove;
}

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
    code: 'INVALID_INPUT' | 'FORBIDDEN' | 'QUOTA_EXCEEDED' | 'NOT_ORGANISM_MEMBER' | 'PUBLISH_NOT_ALLOWED' | 'LABEL_CAPS_AUDIENCE' | ProvenanceRefusalCode;
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
    /**
     * What a CALLER said about how the bytes were made (REST, presigned, chunked, MCP). The write
     * runs provenanceForWrite with the writer: an attached id must be the writer's own record and,
     * when the record names a content hash, the hash of these bytes; a declaration needs
     * provenance:write; an agent that says nothing is stamped (Mint-3); an owner who says nothing
     * gets no record.
     */
    provenance?: StorageProvenanceInput;
    /**
     * A record the NODE minted from these exact bytes (a speech clip, a data package descriptor).
     * Stored as it is: the node is the one vouching for it. Ignored when `provenance` is given.
     */
    aiProvenanceId?: string;
    /**
     * Ask the node's publish gate when this write makes the file public (services/storage-file-publish.ts,
     * plan doc-mvcn6c7e4e5q V4). The upload routes and aimeat_storage_upload set it; a write whose file is
     * public by design (a data package, an app backup) leaves it unset.
     */
    publishGate?: StoragePublishGate;
}

/** The writer and its statement, for {@link StorageFileInput.provenance}. */
export interface StorageProvenanceInput {
    /** The resolved identity that wrote the bytes: GHII, GAII or GEAI. Never a client-sent value. */
    actor: string;
    /** The session's own words, when the door has them: a declaration needs the word there too. */
    scopes?: readonly string[];
    /** An existing record to attach. */
    declaredId?: string;
    /** A statement about how the bytes were made. */
    declared?: DeclaredProvenance;
    /** The route or tool that wrote, for the record's generator.pipeline. */
    pipeline?: string;
}

/** The refusals the provenance step of a write can produce, each before any byte is stored. */
export type ProvenanceRefusalCode = 'SCOPE_DENIED' | 'NOT_FOUND' | 'PROVENANCE_HASH_MISMATCH';

/** What the publish gate adds to a stored file: the request the owner answers, or why none was filed. */
export type StoragePublishOutcome = {
    /** The file was stored at the level it had and making it public waits for the owner: a door answers 202. */
    publishRequest?: Extract<FilePublishFiled, { ok: true }>['publishRequest'];
    warnings?: Array<Extract<FilePublishFiled, { ok: false }>['warning'] | ClosedNodeWarning>;
};

export type StorageFileWriteResult =
    | ({ ok: true; file: StorageFileRecord; overageMorsels: number } & StoragePublishOutcome)
    | StorageWriteRefusal;

/**
 * The outcome fields of a filed (or unfiled) request, spread into a write's or a change's result,
 * and the closed node's warning when the file was stored at 'members' instead of public.
 */
function publishOutcome(filed: FilePublishFiled | null, closed: ClosedNodeWarning | null = null): StoragePublishOutcome {
    if (!filed) return closed ? { warnings: [closed] } : {};
    return filed.ok ? { publishRequest: filed.publishRequest } : { warnings: [filed.warning] };
}

/**
 * The two refusals the key fence itself can produce. Narrower than either result type on purpose, so
 * it is assignable to both the write's and the delete's, and neither door can be handed a refusal
 * code it does not answer for. Exported because appOwnedKeyRefusal() returns it to other doors.
 */
export interface KeyRefusal {
    ok: false;
    status: number;
    code: 'INVALID_INPUT' | 'FORBIDDEN';
    message: string;
}

/**
 * Key prefixes that only an app's own doors write: its icon image (POST /v1/apps/{owner}/{file}/icon)
 * and its screenshot (POST .../screenshot, the publish body, the node's own capture). Those doors
 * check that the bytes are a picture; a generic write checks nothing about the bytes, and the icon
 * and screenshot doors serve these keys to anybody from the node's own origin (A7-2).
 */
const APP_OWNED_KEYS: ReadonlyArray<{ prefix: string; holds: string; door: string }> = [
    { prefix: 'apps/icons/', holds: 'icon image', door: 'icon' },
    { prefix: 'apps/screenshots/', holds: 'screenshot', door: 'screenshot' },
];

/**
 * Refuse a generic write to a key an app's own door owns. Exported for the upload doors that do not
 * store through writeStorageFile (POST /v1/memory/files, the chunked upload), so every generic door
 * refuses the same keys with the same answer.
 *
 * Writing only. Removing a file under these keys stays open to its owner through the generic DELETE,
 * because the icon has no DELETE door of its own and a file that should not be there must be
 * removable.
 */
export function appOwnedKeyRefusal(key: string): KeyRefusal | null {
    const owned = APP_OWNED_KEYS.find(k => String(key ?? '').startsWith(k.prefix));
    if (!owned) return null;
    return {
        ok: false, status: 403, code: 'FORBIDDEN',
        message: `Keys under "${owned.prefix}" hold an app's ${owned.holds}. Only the app's own door writes `
            + `them, because it checks that the bytes are a picture: POST /v1/apps/{owner}/{filename}/${owned.door}.`,
    };
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

type ProvenanceRefusal = { ok: false; status: number; code: ProvenanceRefusalCode; message: string };

/**
 * The record an attached id names, when it may be attached by this writer: one answer for "no such
 * record" and "somebody else's record", so the refusal tells nobody which ids exist on this node.
 * Attaching is what makes a record public when the file is public, so the ownership test is the
 * whole gate (resolveAttachableProvenanceId says the same for memory).
 */
async function attachableRecord(
    storage: Storage, actor: string, id: string,
): Promise<AiProvenanceRecordRow | ProvenanceRefusal> {
    const row = await storage.getAiProvenance(id);
    if (row && row.ownerGhii === ownerGhiiOf(actor)) return row;
    return {
        ok: false, status: 404, code: 'NOT_FOUND',
        message: `No AI-provenance record of yours has the id "${id}". Attach the id the node returned `
            + 'when it made this content for you, or describe how it was made in ai_provenance instead.',
    };
}

/**
 * The provenance decision for one stored file (provenanceForWrite, with the two checks that only a
 * door holding the bytes can make). Returns the id to store on the file, or the refusal.
 *
 * THE HASH CHECK (B12). A record that names a content hash is a statement about exact bytes, and a
 * file that carries it says "this record is about me". When the two differ the attach is refused:
 * the by-hash lookup would never find the file, and the public label would describe other bytes.
 */
async function provenanceForStoredBytes(
    deps: StorageWriteDeps, p: StorageProvenanceInput, data: Buffer,
    visibility: StorageFileRecord['visibility'], held: AiProvenanceRecordRow[],
): Promise<{ ok: true; id: string | undefined } | ProvenanceRefusal> {
    const { storage, config } = deps;
    if (config.aiProvenance === false) return { ok: true, id: undefined };
    if (p.declaredId) {
        const row = await attachableRecord(storage, p.actor, p.declaredId);
        if ('ok' in row) return row;
        const bytesHash = contentHashOf(data);
        if (row.contentHash && row.contentHash !== bytesHash) {
            return {
                ok: false, status: 400, code: 'PROVENANCE_HASH_MISMATCH',
                message: `Record ${row.id} is about other bytes: it names ${row.contentHash}, and this file `
                    + `is ${bytesHash}. Upload the exact bytes the record was made for, or describe this `
                    + 'file in ai_provenance instead.',
            };
        }
        return { ok: true, id: row.id };
    }
    try {
        const id = await provenanceForWrite(storage, {
            principal: p.actor, ...(p.scopes ? { scopes: p.scopes } : {}),
            content: data, declared: p.declared, pipeline: p.pipeline ?? 'storage.upload',
            surface: { visibility, humanAudience: true },
            labelPolicy: config.aiLabelPublic, nodeId: config.nodeId, baseUrl: config.baseUrl,
            enabled: config.aiProvenance, held,
        });
        return { ok: true, id };
    } catch (err) {
        if (err instanceof ProvenanceScopeError) return { ok: false, status: 403, code: 'SCOPE_DENIED', message: err.message };
        throw err;
    }
}

/**
 * The refusal a presigned mint can give before any byte arrives: an attached id that is not the
 * caller's own, or a declaration without provenance:write. The hash is checked when the bytes land.
 */
export async function storageProvenanceMintRefusal(
    deps: StorageWriteDeps, p: StorageProvenanceInput,
): Promise<ProvenanceRefusal | null> {
    if (deps.config.aiProvenance === false) return null;
    if (p.declaredId) {
        const row = await attachableRecord(deps.storage, p.actor, p.declaredId);
        return 'ok' in row ? row : null;
    }
    const refused = await provenanceDeclarationRefusal(deps.storage, {
        principal: p.actor, declared: p.declared, ...(p.scopes ? { scopes: p.scopes } : {}),
    });
    return refused ? { ok: false, status: 403, code: 'SCOPE_DENIED', message: refused.message } : null;
}

/** Store one file under `ownerGaii`, with every gate and side effect the capability carries. */
export async function writeStorageFile(
    deps: StorageWriteDeps,
    ownerGaii: string,
    input: StorageFileInput,
): Promise<StorageFileWriteResult> {
    const { storage, config } = deps;

    const fenced = checkKey(ownerGaii, input.key) ?? appOwnedKeyRefusal(input.key);
    if (fenced) return fenced;

    // No visibility named: the node's starting level (plan V5.2), before the publish gate below. A
    // closed node then stores public at 'members' (plan V1.6), at the doors that ask the gate.
    const closed = input.publishGate
        ? await closedFileLevel({ storage, config }, ownerGaii, input.key, levelOf(config, input.visibility, input.publishGate))
        : { visibility: levelOf(config, input.visibility, input.publishGate), warning: null };
    const visibility = closed.visibility;
    // A workspace-visible file that names no workspace is readable by nobody, so it is refused here
    // rather than stored and puzzled over later.
    if (visibility === 'workspace' && !input.workspaceRef) {
        return {
            ok: false, status: 400, code: 'INVALID_INPUT',
            message: 'visibility "workspace" requires workspace_refs (or workspace_ref) as one or more "<organismId>/<workspaceId>"',
        };
    }
    // 'organism:<id>' names an organism the account owning this namespace is an active member of.
    const audience = await organismVisibilityRefusal(storage, visibility, { identity: ownerGaii });
    if (audience) return { ok: false, ...audience };
    // The label's audience cap (plan doc-mvdipuyqraas, L3.2), before the publish gate.
    const capped = await fileCapRefusal({ storage, config }, ownerGaii, input.key, visibility, input.workspaceRef, input.publishGate);
    if (capped) return capped;

    // The publish gate (plan doc-mvcn6c7e4e5q, V4). A write that makes the file public, by a caller
    // the node asks the owner about, stores the file at the level it had (a new one: private) and
    // files a request after the bytes land. Keeping a public file public asks nothing.
    const raise = await fileRaiseAsk({ storage, config }, ownerGaii, input.key, visibility, input.publishGate);
    if (raise.kind === 'refused') return { ok: false, status: raise.status, code: raise.code, message: raise.message };
    const level = raise.kind === 'ask'
        ? keptFileLevel(raise.existing)
        : {
            visibility,
            groupId: visibility === 'group' ? input.groupId : undefined,
            workspaceRef: visibility === 'workspace' ? input.workspaceRef : undefined,
        };

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

    // The provenance decision is made BEFORE the bytes are stored, so a refused declaration stores
    // nothing. A record minted here is held and stored only once the file has landed.
    const held: AiProvenanceRecordRow[] = [];
    const decided = input.provenance
        ? await provenanceForStoredBytes(deps, input.provenance, input.data, level.visibility, held)
        : { ok: true as const, id: input.aiProvenanceId };
    if (!decided.ok) return decided;

    const file = await storage.createStorageFile({
        key: input.key,
        ownerGaii,
        visibility: level.visibility,
        groupId: level.groupId,
        workspaceRef: level.workspaceRef,
        mimeType: input.mimeType ?? 'application/octet-stream',
        size: input.data.length,
        data: input.data,
        ...(input.tags?.length ? { tags: input.tags } : {}),
        federate: input.federate === true,
        createdAt: new Date().toISOString(),
        ...(decided.id ? { aiProvenanceId: decided.id } : {}),
    });
    await storeHeldProvenance(storage, held);

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
    // A file only its owner reads is told to that owner's streams (event-bus.ts emitRecordChange).
    // The write does not read what the key held before, so a file it replaced as private is not
    // announced to those who could read the earlier one.
    emitRecordChange('files', ownerGaii, level.visibility);
    emitRecordChange('memory', ownerGaii, level.visibility);
    // The content class pipeline on arrival (services/content/intake.ts): scheduled, never awaited.
    fileHooks.afterStore?.({ storage, config }, ownerGaii, input.key);

    // The request the publish gate asked for, now that the file it names exists.
    const filed = raise.kind === 'ask' ? await fileFilePublishRequest({ storage, config }, raise.requester, file) : null;
    return { ok: true, file, overageMorsels: quota.overageMorsels, ...publishOutcome(filed, closed.warning) };
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
    asked: string,
): Promise<StorageFileDeleteResult> {
    const { storage } = deps;

    const fenced = checkKey(ownerGaii, asked);
    if (fenced) return fenced;

    // The account's own extension's file named by its short key is stored under the stored name
    // (services/component-address.ts ownExtensionFileKey); tried only when the key as written names no file.
    let key = asked;
    let existing = await storage.getStorageFile(ownerGaii, key);
    if (!existing) {
        const stored = await ownExtensionFileKey(storage, key, localAccountName(ownerGaii));
        const found = stored ? await storage.getStorageFile(ownerGaii, stored) : null;
        if (found && stored) { existing = found; key = stored; }
    }
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
    emitRecordChange('files', ownerGaii, existing.visibility);
    emitRecordChange('memory', ownerGaii, existing.visibility);
    fileHooks.afterRemove?.({ storage, config: deps.config }, ownerGaii, key);

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
    /**
     * The writer and its statement. The refusals that need no bytes are asked now; the statement
     * rides in the signed token (`ai_provenance` as it arrived on the wire, `ai_provenance_id`) and
     * the token names the writer as its actor, so PUT /v1/upload/:token decides with the bytes.
     */
    provenance?: StorageProvenanceInput & { wireBlock?: unknown };
    /**
     * Ask the publish gate for a file asked as public (services/storage-file-publish.ts mintPublishCarry):
     * refused when nobody on this node can be asked, and otherwise the requester rides in the token as
     * `publish_ask`, so the upload files the request when the bytes land.
     */
    publishGate?: { caller: CallerContext; app?: string };
}

export type StorageUploadUrlResult =
    | {
        ok: true;
        uploadUrl: string;
        contentType: string;
        maxBytes: number;
        expiresInSeconds: number;
        /** The file will land at 'members' instead of public: the node is closed (plan V1.6). */
        warnings?: ClosedNodeWarning[];
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
    given: StorageUploadUrlInput,
): Promise<StorageUploadUrlResult> {
    const { config } = deps;
    // No visibility named: the node's starting level (plan V5.2), decided before the publish gate's
    // carry so a default of public asks the owner as an explicit one does.
    // A closed node then mints public at 'members' (plan V1.6), at the doors that ask the gate.
    const named = levelOf(config, given.visibility, given.publishGate);
    const closed = given.publishGate
        ? await closedFileLevel({ storage: deps.storage, config }, ownerGaii, given.key, named)
        : { visibility: named, warning: null };
    const input = { ...given, visibility: closed.visibility };

    const fenced = checkKey(ownerGaii, input.key) ?? appOwnedKeyRefusal(input.key);
    if (fenced) return fenced;
    // Refused at the mint as at the write, so no URL is handed out for a file that cannot land.
    const audience = await organismVisibilityRefusal(deps.storage, input.visibility, { identity: ownerGaii });
    if (audience) return { ok: false, ...audience };
    if (input.provenance) {
        const refused = await storageProvenanceMintRefusal(deps, input.provenance);
        if (refused) return refused;
    }
    // The label's audience cap (plan doc-mvdipuyqraas, L3.2): no URL for a file that could not land.
    const capped = await fileCapRefusal({ storage: deps.storage, config }, ownerGaii, input.key, input.visibility, input.workspaceRef, input.publishGate);
    if (capped) return capped;
    const carry = await mintPublishCarry({ storage: deps.storage, config }, ownerGaii, input.key, input.visibility, input.publishGate);
    if (!carry.ok) return carry;

    // The operator's own setting, not a constant: a node configured for 50 MB used to mint 10 MB
    // tokens and refuse everything above it, with nothing connecting the admin page to the tool.
    const maxBytes = config.storageMaxFileSizeMb * 1024 * 1024;
    const contentType = input.mimeType ?? 'application/octet-stream';
    const token = await generateUploadToken({
        sub: ownerGaii,
        ...(input.provenance ? { actor: input.provenance.actor } : {}),
        utype: 'storage',
        meta: buildUploadMeta('storage', {
            key: input.key,
            mime_type: contentType,
            visibility: input.visibility,
            group_id: input.groupId,
            tags: input.tags,
            workspace_refs: input.workspaceRef || undefined,
            ai_provenance: input.provenance?.wireBlock ?? undefined,
            ai_provenance_id: input.provenance?.declaredId,
            publish_ask: carry.requester,
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
        ...(closed.warning ? { warnings: [closed.warning] } : {}),
    };
}

export type StorageVisibilityResult =
    | ({ ok: true; file: StorageFileRecord } & StoragePublishOutcome)
    | { ok: false; status: number; code: 'INVALID_INPUT' | 'NOT_FOUND' | 'NOT_ORGANISM_MEMBER' | 'PUBLISH_NOT_ALLOWED' | 'LABEL_CAPS_AUDIENCE'; message: string };

/**
 * Change who may read one stored file: PATCH /v1/storage/{key}/visibility,
 * PATCH /v1/memory/files/{key}/visibility, and the approved publish request (apply-file.ts) all make the
 * change here. The routes validate the visibility word and the workspace binding first, because their
 * messages name their own body fields.
 *
 * `workspaceRef` is applied with visibility 'workspace' only; for any other visibility the stored
 * binding is left as it is. `publishGate` asks the publish gate when the change makes the file public:
 * on an ask the file keeps its level and the result carries `publishRequest`.
 */
export async function changeStorageFileVisibility(
    deps: StorageWriteDeps,
    ownerGaii: string,
    asked: string,
    requested: StorageFileRecord['visibility'],
    opts: { workspaceRef?: string; federated?: boolean; publishGate?: StoragePublishGate } = {},
): Promise<StorageVisibilityResult> {
    const { storage, config } = deps;
    // The account's own extension's file by its short key, as removeStorageFile reads it.
    const key = await storage.getStorageFileMeta(ownerGaii, asked)
        ? asked : (await ownExtensionFileKey(storage, asked, localAccountName(ownerGaii))) ?? asked;
    // 'organism:<id>' names an organism the file owner's account is an active member of.
    const audience = await organismVisibilityRefusal(storage, requested, { identity: ownerGaii, ...(opts.federated !== undefined ? { federated: opts.federated } : {}) });
    if (audience) return { ok: false, ...audience };

    // A closed node changes a file to 'members' instead of public (plan V1.6), at the doors that ask the gate.
    const closed = opts.publishGate
        ? await closedFileLevel({ storage, config }, ownerGaii, key, requested)
        : { visibility: requested, warning: null };
    const visibility = closed.visibility;
    // The label's audience cap (plan doc-mvdipuyqraas, L3.2), before the publish gate.
    const capped = await fileCapRefusal({ storage, config }, ownerGaii, key, visibility, visibility === 'workspace' ? opts.workspaceRef : undefined, opts.publishGate);
    if (capped) return capped;
    const raise = await fileRaiseAsk({ storage, config }, ownerGaii, key, visibility, opts.publishGate);
    if (raise.kind === 'refused') return { ok: false, status: raise.status, code: raise.code, message: raise.message };
    if (raise.kind === 'ask') {
        // Nothing else changes on this route: the file keeps its level and the owner is asked.
        if (!raise.existing) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'File not found' };
        const filed = await fileFilePublishRequest({ storage, config }, raise.requester, raise.existing);
        return { ok: true, file: raise.existing, ...publishOutcome(filed) };
    }

    const updated = await storage.updateFileVisibility(ownerGaii, key, visibility, visibility === 'workspace' ? opts.workspaceRef : undefined);
    if (!updated) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'File not found' };
    // Global on purpose: the file's visibility is what changed, and this path does not read what it
    // was, so those who could read the file until now are told as well.
    emitChange('memory');
    return { ok: true, file: updated, ...publishOutcome(null, closed.warning) };
}
