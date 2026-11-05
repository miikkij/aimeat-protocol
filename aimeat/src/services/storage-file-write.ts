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
 *   - groupBindingRefusal() — a group file names its group
 *   - writeStorageFile() — the inline write, in order, with the fence first
 *   - mintStorageUploadUrl() — the presigned representation of the same write
 *   - heldFile() — the file a key names, by its short key too, for the delete and the visibility change
 *   - removeStorageFile() — the delete, sharing the same key fence and change events
 *   - changeStorageFileVisibility() — the visibility change both PATCH routes and the publish
 *     request's applier make
 * @usage
 *   const out = await writeStorageFile({ storage, config, emitResourceUpdated }, gaii, input);
 *   if (!out.ok) return renderRefusal(out);   // each door renders its own way
 * @version-history
 *   v1.16.0 — 2026-11-05 — groupBindingRefusal() also refuses a group id naming no group, on the write,
 *     the mint and the routes that ask before them (Jouni, 2026-11-05).
 *   v1.15.0 — 2026-11-04 — groupBindingRefusal(): the write and the presigned mint refuse visibility
 *     'group' with no group id with 400 INVALID_INPUT, and the visibility change refuses 'group' on a
 *     file that has no group. Such a file was stored and opened to nobody (Jouni, 2026-11-04).
 *     heldFile(): the short-key lookup the delete and the visibility change each wrote out.
 *   2026-11-04 — A stored file is announced with emitRecordChangePriorUnknown: the same streams hear
 *     it, and the read cache drops as before (codebase analysis 2026-11-03, item C4).
 *   v1.14.0 — 2026-11-01 — The file hooks moved by extraction to ./storage-file-hooks.ts (line limit) and
 *     are re-exported; it adds addStorageFileListener(), which the data products that run when a source
 *     changes use (services/dataproduct/on-change.ts, WP9c).
 *   v1.13.0 — 2026-11-01 — The write and the delete of the welcome page key note its writer
 *     (storage-page-keys.ts notePageKeyChange), and the presigned mint carries the writer in the token
 *     (`page_writer`); the write takes it back as `pageWriter` (secaudit2026oct31w2 round 11,
 *     portfolio-read-hold:absent-record-adopted-at-first-read).
 *   v1.12.0 — 2026-11-01 — The write, the presigned mint and the delete of a company's page key
 *     (`company/<id>/index.html`) ask what the company page route asks: the owner in person, a writer
 *     holding company:write, or one the owner allowed with one press (storage-page-keys.ts,
 *     company/company-page-key.ts). removeStorageFile takes the door's caller. The provenance decision
 *     moved by pure extraction to storage-file-provenance.ts (800-line limit) (secaudit2026oct31w2 round 11).
 *   v1.11.0 — 2026-10-31 — Direct upload: the mint with `direct` answers a signed address in the object
 *     store and a complete address, and the write takes `object` (the reference from the signed token and
 *     the size the store reports) instead of bytes, with the large-file ceiling, and records the file
 *     naming that object (wish-suuret-tiedostot-virtaavat-aimeat-io-n-l-pi-ilman-koko-tiedo).
 *   v1.10.0 — 2026-10-30 — `store` on the write and the presigned mint: the store the writer named for
 *     the bytes (`own:<name>`, `node:<name>`), checked with the writer's rights before anything moves and
 *     carried in the token; a file put in the writer's own storage does not count toward the quota
 *     (wish-useampi-tiedostos-il-yksi-oletus-ja-tallentaja-voi-valita-s-).
 *   v1.9.2 — 2026-10-30 — removeStorageFile reads the file's metadata, not its bytes: a file in an S3 or
 *     Azure store was downloaded whole to be deleted, and one whose object had gone answered 404 for ever.
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
import { emitRecordChange, emitRecordChangePriorUnknown } from './event-bus.js';
import { isAnonymousGaii } from '../routes/memory/shared.js';
import { storeHeldProvenance } from './ai/provenance.js';
import { localAccountName } from '../utils/gaii.js';
import {
    provenanceForStoredBytes, storageProvenanceMintRefusal,
    type StorageProvenanceInput, type ProvenanceRefusalCode,
} from './storage-file-provenance.js';
import { pageKeyWriteRefusal, pageWriterOf, pageWriterMeta, notePageKeyChange, type PageWriter } from './storage-page-keys.js';
// Moved to storage-file-provenance.ts (800-line limit); re-exported so the importers are unchanged.
export { storageProvenanceMintRefusal };
export type { StorageProvenanceInput, ProvenanceRefusalCode };
import { ownExtensionFileKey } from './component-address.js';
import { organismVisibilityRefusal } from './organism-visibility.js';
import { unknownGroupRefusal } from '../storage/memory-sharing.js';
import { emitChange } from './event-bus.js';
import type { CallerContext } from './caller-context.js';
import {
    fileRaiseAsk, keptFileLevel, mintPublishCarry, fileFilePublishRequest, closedFileLevel, fileCapRefusal,
    type StoragePublishGate, type FilePublishFiled,
} from './storage-file-publish.js';
import type { ClosedNodeWarning } from './closed-node-level.js';
import { uploadVisibilityOf } from './content-defaults.js';
import { resolveChoice } from './file-store/file-store-resolver.js';
import { adoptStorageObject, directUploadTarget } from '../storage/blob/file-store-wrap.js';
import { fileStored, fileRemoved } from './storage-file-hooks.js';

/**
 * The level of a file (plan V5.2): none named is the file default for every caller; 'default' (the
 * SDK's word) is an app grant's own default for an app. Doors map 'default' themselves; this is the
 * same rule for a caller that reaches the write or the mint directly.
 */
function levelOf(config: AimeatConfig, named: string | undefined, gate: StoragePublishGate | undefined): StorageFileRecord['visibility'] {
    return uploadVisibilityOf(config, named, !!gate && 'caller' in gate && gate.caller.kind === 'app') as StorageFileRecord['visibility'];
}

// The hooks told about a stored or removed file live in ./storage-file-hooks.ts (moved at the line
// limit); the names this module exported are exported from here still.
export { setStorageFileHooks, addStorageFileListener, type StorageFileHook } from './storage-file-hooks.js';

/** How long a presigned storage upload URL is good for. The number the caller is told and the number
 *  the token is signed with are the same value, so they cannot drift apart. */
export const STORAGE_UPLOAD_URL_TTL_SECONDS = 3600;

/** The largest file a client may put straight in an object store: the large-file setting
 *  (quota.storage_max_chunked_file_size_gb), since the bytes never pass through the node. */
export function directFileMaxBytes(config: AimeatConfig): number {
    return config.storageMaxChunkedFileSizeGb * 1024 * 1024 * 1024;
}

/** What a caller supplies so the write can reach the rest of the node. */
export interface StorageWriteDeps {
    storage: Storage;
    config: AimeatConfig;
    /** MCP resource notifications. Optional so a door without them still writes. */
    emitResourceUpdated?: (gaii: string, uri: string) => void;
    emitResourceListChanged?: (gaii: string) => void;
}

/** Why the store a writer named cannot take the file (services/file-store/file-store-resolver.ts resolveChoice). */
export type StoreChoiceRefusalCode = 'UNKNOWN_STORE' | 'STORE_NOT_SELECTABLE' | 'STORE_NOT_TAKING_FILES' | 'STORE_NOT_REACHABLE' | 'NO_OWN_STORAGE';

/** The store a writer named for a file's bytes. `operator` lets them name a node store not open to everyone. */
export interface StoreChoice { id: string; operator: boolean }

export interface StorageWriteRefusal {
    ok: false;
    status: number;
    code: 'INVALID_INPUT' | 'FORBIDDEN' | 'QUOTA_EXCEEDED' | 'NOT_ORGANISM_MEMBER' | 'PUBLISH_NOT_ALLOWED' | 'LABEL_CAPS_AUDIENCE' | ProvenanceRefusalCode | StoreChoiceRefusalCode;
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
    /** The bytes. Absent exactly when `object` names them in a store already. */
    data?: Buffer;
    /**
     * A file whose bytes a client already PUT in an object store, through the signed address the node
     * made for this reference (mintStorageUploadUrl with `direct`). The reference comes from the signed
     * upload token and the size from the store, never from the client. The ceiling is the one for a
     * file kept in a store, and the row names the object instead of holding bytes.
     */
    object?: { blobRef: string; size: number };
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
    /** The store the writer named for the bytes. Absent: the owner's default store, else the node's. */
    store?: StoreChoice;
    /** The writer of a page key when `publishGate` names no caller: a presigned upload's signed `page_writer` (storage-page-keys.ts). */
    pageWriter?: PageWriter;
}

/** A refusal when the named store cannot take a file of `ownerGaii`; null when it can, or none was named. */
async function storeChoiceRefusal(deps: StorageWriteDeps, ownerGaii: string, store: StoreChoice | undefined): Promise<StorageWriteRefusal | null> {
    if (!store?.id) return null;
    const r = await resolveChoice({ storage: deps.storage, config: deps.config }, ownerGaii, store.id, { operator: store.operator });
    return r.ok ? null : { ok: false, status: r.status, code: r.code as StorageWriteRefusal['code'], message: r.message };
}

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

/**
 * A group file names its group. Stored without one it is readable by nobody but its owner
 * (consent.ts answers missing_group_id), and the uploader learns nothing, so it is refused here with
 * what to send instead. Exported for the upload routes that check a request before the shared write:
 * POST /v1/memory/files and the chunked init. The value may come straight from a JSON body, so anything
 * but a non-blank string names no group, and an id with no group behind it answers group_not_found on
 * every read, so it is refused as well.
 */
export async function groupBindingRefusal(storage: Pick<Storage, 'getSharingGroup'>, visibility: unknown, groupId: unknown): Promise<KeyRefusal | null> {
    if (visibility !== 'group') return null;
    if (typeof groupId === 'string' && groupId.trim()) {
        const unknown = await unknownGroupRefusal(storage, visibility, groupId);
        return unknown ? { ok: false, ...unknown } : null;
    }
    return {
        ok: false, status: 400, code: 'INVALID_INPUT',
        message: 'visibility "group" requires group_id, the id of a sharing group whose members will read the file '
            + '(aimeat_group_list or GET /v1/groups lists yours). Without a group the file opens to nobody. '
            + 'To share it with a workspace, send visibility "workspace" with workspace_refs. To keep it to yourself, send "private".',
    };
}

/** Store one file under `ownerGaii`, with every gate and side effect the capability carries. */
export async function writeStorageFile(
    deps: StorageWriteDeps,
    ownerGaii: string,
    input: StorageFileInput,
): Promise<StorageFileWriteResult> {
    const { storage, config } = deps;

    // A key a page origin serves asks what that page's own route asks (storage-page-keys.ts).
    const writer = input.pageWriter ?? pageWriterOf(deps, input.publishGate);
    const fenced = checkKey(ownerGaii, input.key) ?? appOwnedKeyRefusal(input.key)
        ?? await pageKeyWriteRefusal(deps, ownerGaii, input.key, writer);
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
    // The same for a group file that names no group, on the level the node settled on.
    const unbound = await groupBindingRefusal(storage, visibility, input.groupId);
    if (unbound) return unbound;
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

    if (!input.data && !input.object) return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'No file data received' };
    const size = input.object ? input.object.size : input.data!.length;
    // A file kept in an object store has the larger ceiling: its bytes never pass through the node.
    if (input.object ? size > directFileMaxBytes(config) : size > config.storageMaxFileSizeMb * 1024 * 1024) {
        return {
            ok: false, status: 413, code: 'QUOTA_EXCEEDED', limit: 'per_file',
            message: input.object
                ? `File size exceeds the ${config.storageMaxChunkedFileSizeGb} GB limit of a file kept in a store`
                : `File size exceeds ${config.storageMaxFileSizeMb}MB limit`,
        };
    }

    // The store the writer named, asked with the writer's rights before any byte moves.
    const storeRefused = await storeChoiceRefusal(deps, ownerGaii, input.store);
    if (storeRefused) return storeRefused;

    // M-2 (§8.4): the account-wide ceiling, which is a different gate from the per-file one above.
    const quota = await checkStorageQuota(config, storage, ownerGaii, size, input.store?.id);
    if (!quota.allowed) {
        return { ok: false, status: 413, code: 'QUOTA_EXCEEDED', limit: 'account', message: quota.reason! };
    }

    // The provenance decision is made BEFORE the bytes are stored, so a refused declaration stores
    // nothing. A record minted here is held and stored only once the file has landed.
    const held: AiProvenanceRecordRow[] = [];
    const decided = input.provenance
        ? await provenanceForStoredBytes(deps, input.provenance, input.object ? undefined : input.data, level.visibility, held)
        : { ok: true as const, id: input.aiProvenanceId };
    if (!decided.ok) return decided;

    const record: StorageFileRecord = {
        key: input.key,
        ownerGaii,
        visibility: level.visibility,
        groupId: level.groupId,
        workspaceRef: level.workspaceRef,
        mimeType: input.mimeType ?? 'application/octet-stream',
        size,
        data: input.data ?? Buffer.alloc(0),
        ...(input.tags?.length ? { tags: input.tags } : {}),
        federate: input.federate === true,
        createdAt: new Date().toISOString(),
        ...(decided.id ? { aiProvenanceId: decided.id } : {}),
        ...(input.store?.id ? { storeChoice: input.store.id } : {}),
    };
    const file = input.object
        ? await adoptStorageObject(storage, record, input.object.blobRef)
        : await storage.createStorageFile(record);
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
    // For that reason the read cache drops as for any change (event-bus.ts emitRecordChangePriorUnknown).
    emitRecordChangePriorUnknown('files', ownerGaii, level.visibility);
    emitRecordChangePriorUnknown('memory', ownerGaii, level.visibility);
    // The content class pipeline on arrival (services/content/intake.ts): scheduled, never awaited.
    fileStored({ storage, config }, ownerGaii, input.key);
    // A welcome page notes its writer before the answer, so the next read meets the record (storage-page-keys.ts).
    await notePageKeyChange(deps, ownerGaii, input.key, writer, input.data);

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
 * The file `asked` names in `ownerGaii`'s namespace, without its bytes. The account's own extension's
 * file named by its short key is stored under the stored name (services/component-address.ts
 * ownExtensionFileKey), tried only when the key as written names no file. With no file, `key` is `asked`.
 */
async function heldFile(storage: Storage, ownerGaii: string, asked: string): Promise<{ key: string; file: StorageFileRecord | null }> {
    const direct = await storage.getStorageFileMeta(ownerGaii, asked);
    if (direct) return { key: asked, file: direct };
    const stored = await ownExtensionFileKey(storage, asked, localAccountName(ownerGaii));
    const found = stored ? await storage.getStorageFileMeta(ownerGaii, stored) : null;
    return found && stored ? { key: stored, file: found } : { key: asked, file: null };
}

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
    /** The door's caller, for the keys a page origin serves (storage-page-keys.ts). Absent: the node's own delete. */
    gate?: { caller: CallerContext; app?: string },
): Promise<StorageFileDeleteResult> {
    const { storage } = deps;

    const writer = pageWriterOf(deps, gate);
    const fenced = checkKey(ownerGaii, asked) ?? await pageKeyWriteRefusal(deps, ownerGaii, asked, writer);
    if (fenced) return fenced;

    // Metadata only: a delete needs the row, not the bytes. Reading the bytes downloaded a whole file
    // from an object store just to remove it, and a row whose object had gone could not be deleted.
    const { key, file: existing } = await heldFile(storage, ownerGaii, asked);
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
    fileRemoved({ storage, config: deps.config }, ownerGaii, key);
    // A removed welcome page can uncover another copy, which the remover then put on show (storage-page-keys.ts).
    await notePageKeyChange(deps, ownerGaii, key, writer);

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
    /** The store the writer named for the bytes: checked now with the writer's rights, carried in the
     *  token as `store`, and asked again for the store's state when the bytes land. */
    store?: StoreChoice;
    /** Ask for an address in the object store itself: the client PUTs the bytes there and then POSTs
     *  the node's complete address. Answered with an upload through the node when the file would go to
     *  the database or the store cannot sign one. */
    direct?: boolean;
}

export type StorageUploadUrlResult =
    | {
        ok: true;
        uploadUrl: string;
        contentType: string;
        maxBytes: number;
        /** True when uploadUrl is in the object store: PUT there with uploadHeaders, then POST completeUrl. */
        direct?: boolean;
        uploadHeaders?: Record<string, string>;
        completeUrl?: string;
        /** Why an upload asked as direct goes through the node instead. */
        directUnavailable?: string;
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

    const writer = pageWriterOf(deps, input.publishGate);
    const fenced = checkKey(ownerGaii, input.key) ?? appOwnedKeyRefusal(input.key)
        ?? await pageKeyWriteRefusal(deps, ownerGaii, input.key, writer);
    if (fenced) return fenced;
    // Refused at the mint as at the write, so no URL is handed out for a file that cannot land.
    const unbound = await groupBindingRefusal(deps.storage, input.visibility, input.groupId);
    if (unbound) return unbound;
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
    // No URL for a store that cannot take the file.
    const storeRefused = await storeChoiceRefusal(deps, ownerGaii, input.store);
    if (storeRefused) return storeRefused;

    const contentType = input.mimeType ?? 'application/octet-stream';
    // Direct: the address is the store's own, for one new object; the node keeps the reference in the
    // signed token and records the file when the client completes.
    const target = input.direct
        ? await directUploadTarget(deps.storage, ownerGaii, input.store?.id, contentType, STORAGE_UPLOAD_URL_TTL_SECONDS)
        : null;
    // The operator's own setting, not a constant: a node configured for 50 MB used to mint 10 MB
    // tokens and refuse everything above it, with nothing connecting the admin page to the tool.
    const maxBytes = target ? directFileMaxBytes(config) : config.storageMaxFileSizeMb * 1024 * 1024;
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
            store: input.store?.id || undefined,
            object: target?.blobRef,
            page_writer: pageWriterMeta(input.key, writer),
        }),
        maxBytes,
        contentType,
    }, STORAGE_UPLOAD_URL_TTL_SECONDS);

    return {
        ok: true,
        ...(target
            ? { uploadUrl: target.url, direct: true, uploadHeaders: target.headers, completeUrl: `${config.baseUrl}/v1/upload/${token}/complete` }
            : { uploadUrl: `${config.baseUrl}/v1/upload/${token}`,
                ...(input.direct ? { direct: false, directUnavailable: 'This file goes to the node\'s database or to a store the node cannot sign an address for, so it is uploaded through the node.' } : {}) }),
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
    const { key, file } = await heldFile(storage, ownerGaii, asked);
    // 'group' keeps the group the file has, and this change cannot name one. A file with none would
    // open to nobody, so it is refused. A file that is not there falls through to the 404 below.
    if (requested === 'group' && file && !file.groupId) {
        return {
            ok: false, status: 400, code: 'INVALID_INPUT',
            message: 'This file has no group, and changing its visibility cannot give it one, so visibility "group" would open it to nobody. '
                + 'Upload it again with visibility "group" and group_id, or send visibility "workspace" with workspace_refs.',
        };
    }
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
