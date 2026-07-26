/**
 * @file src/services/file-refs.ts
 * @description One place that turns a FILE REFERENCE into either an authorized handle or a legible
 *   refusal. A reference is `"<gaii>/<key>"` (a bare key means the caller's own storage) — the same
 *   form `ctx.files.read` already takes, so an extension, an MCP tool, a task attachment and a DM
 *   attachment all name a file the same way.
 *
 *   Why this exists: storage is keyed by (ownerGaii, key), and every agent-facing read path used to
 *   look up ONLY the caller's own namespace. A file the owner uploaded answered "not found" to that
 *   owner's own agent, so a PDF could be handed to an agent as a reference it could never open. The
 *   authorization was never the problem — `visibility:'owner'` and consent grants already cover it;
 *   the lookup was. Reads here go through the same authorizeRead() the /v1/pub route uses, as the
 *   CALLER, so an agent sees exactly what the principal invoking it could see and nothing more.
 *
 *   Bytes never travel through this module: it answers with a presigned, TTL-limited download_url.
 *   A FOREIGN file gets a deliberately shorter TTL than the caller's own — the handle outlives a
 *   revoked grant until it expires, so the window for someone else's data is kept small.
 * @structure
 *   - parseFileRef(ref, callerGaii) — split "<gaii>/<key>" (bare key → caller's namespace)
 *   - resolveFileRef(...) — locate + authorize, never throws, returns a typed access verdict
 *   - fileHandleFor(...) — resolveFileRef + mint the presigned download handle
 *   - OWN_HANDLE_TTL_SECONDS / FOREIGN_HANDLE_TTL_SECONDS
 * @usage
 *   import { fileHandleFor } from '../services/file-refs.js';
 *   const h = await fileHandleFor(storage, config, `${ownerGhii}/${key}`, { gaii: agentGaii });
 *   if (h.access !== 'granted') return refuse(h.reason);
 * @version-history
 *   v1.0.0 — 2026-07-26 — Initial: shared file-reference resolution so an agent can read a file it
 *     does not own (owner-uploaded PDFs, DM attachments, task attachments) through one guard.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, StorageFileRecord } from '../storage/interface.js';
import { authorizeRead } from './access-guard.js';
import { generateDownloadToken } from './download-token.js';

/** A handle for one of the caller's OWN files may live an hour (parity with GET /v1/storage?mode=handle). */
export const OWN_HANDLE_TTL_SECONDS = 3600;
/** Someone else's file: short enough that a revoked grant stops mattering quickly. */
export const FOREIGN_HANDLE_TTL_SECONDS = 900;

export interface FileRefAccessor {
    /** The resolved identity of the caller (GHII / GAII / GEAI) — never a client-supplied id. */
    gaii: string;
    /** `req.auth.sub` when there is one (threaded into the workspace read gate). */
    sub?: string;
    /** The caller's bare owner name (threaded into the workspace read gate). */
    owner?: string;
}

export type FileRefAccess = 'granted' | 'denied' | 'missing';

export interface ResolvedFileRef {
    access: FileRefAccess;
    /** Canonical "<gaii>/<key>" form of what was asked for. */
    ref: string;
    ownerGaii: string;
    key: string;
    /** Present only when access === 'granted'. */
    file?: StorageFileRecord;
    /** Machine-readable cause on a non-granted verdict. */
    reason?: string;
}

export interface FileHandle {
    access: FileRefAccess;
    ref: string;
    owner_gaii: string;
    key: string;
    mime_type?: string;
    size?: number;
    name?: string;
    /** Presigned, no-auth GET. Absent unless access === 'granted'. */
    download_url?: string;
    expires_in_seconds?: number;
    reason?: string;
}

/**
 * Split `"<gaii>/<key>"` into its parts. A GAII always carries an `@node` (and an extension namespace
 * starts with `ext:`), so the first path segment is an owner ONLY when it looks like one — a plain
 * `dm-out/invoice.pdf` stays a key in the caller's own namespace.
 */
export function parseFileRef(ref: string, callerGaii: string): { gaii: string; key: string } {
    const slash = String(ref ?? '').indexOf('/');
    if (slash > 0) {
        const head = ref.slice(0, slash);
        if (head.includes('@') || head.startsWith('ext:')) {
            return { gaii: head, key: ref.slice(slash + 1) };
        }
    }
    return { gaii: callerGaii, key: String(ref ?? '') };
}

/** Build the canonical reference string for a stored file. */
export function fileRefFor(ownerGaii: string, key: string): string {
    return `${ownerGaii}/${key}`;
}

/**
 * Locate the file a reference names and decide whether `accessor` may read it. Never throws: a
 * missing file, an unreadable one and a malformed reference all come back as a verdict, because
 * every caller here is a tool or a route that owes the agent a legible answer rather than a stack
 * trace. Existence is NOT disclosed to a caller who may not read the file — a denied read reports
 * 'denied' whether or not the bytes exist, matching GET /v1/pub.
 */
export async function resolveFileRef(
    storage: Storage,
    config: AimeatConfig,
    ref: string,
    accessor: FileRefAccessor,
): Promise<ResolvedFileRef> {
    const { gaii, key } = parseFileRef(ref, accessor.gaii);
    const canonical = fileRefFor(gaii, key);
    if (!key) {
        return { access: 'missing', ref: canonical, ownerGaii: gaii, key, reason: 'empty_key' };
    }

    const file = await storage.getStorageFile(gaii, key);
    const own = gaii === accessor.gaii;
    if (!file) {
        return {
            access: 'missing',
            ref: canonical,
            ownerGaii: gaii,
            key,
            // The single most common mistake: naming a bare key for a file that belongs to the OWNER.
            reason: own
                ? 'not_found_in_your_namespace'
                : 'not_found',
        };
    }

    const decision = await authorizeRead(storage, config, {
        ownerGaii: gaii,
        accessorGaii: accessor.gaii,
        resourceKey: `storage:${key}`,
        visibility: file.visibility,
        groupId: file.groupId,
        workspaceRef: file.workspaceRef,
        accessorSub: accessor.sub,
        accessorOwner: accessor.owner,
        action: 'read',
    });
    if (!decision.allowed) {
        return { access: 'denied', ref: canonical, ownerGaii: gaii, key, reason: decision.reason ?? 'not_permitted' };
    }

    return { access: 'granted', ref: canonical, ownerGaii: gaii, key, file };
}

/**
 * Turn an already-resolved reference into a handle. Split out from fileHandleFor so a caller that
 * needs the record for something else (an inline text read, a byte stream) pays for ONE lookup —
 * getStorageFile loads the data, and resolving twice would read a large file twice.
 */
export async function handleFromResolved(
    config: AimeatConfig,
    resolved: ResolvedFileRef,
    accessorGaii: string,
    opts?: { name?: string },
): Promise<FileHandle> {
    const base: FileHandle = {
        access: resolved.access,
        ref: resolved.ref,
        owner_gaii: resolved.ownerGaii,
        key: resolved.key,
    };
    if (opts?.name) base.name = opts.name;
    if (resolved.access !== 'granted' || !resolved.file) {
        return { ...base, reason: resolved.reason };
    }

    const file = resolved.file;
    const ttl = resolved.ownerGaii === accessorGaii ? OWN_HANDLE_TTL_SECONDS : FOREIGN_HANDLE_TTL_SECONDS;
    const token = await generateDownloadToken(
        { sub: file.ownerGaii, key: file.key, mimeType: file.mimeType, size: file.size },
        ttl,
    );
    return {
        ...base,
        mime_type: file.mimeType,
        size: file.size,
        download_url: `${config.baseUrl}/v1/download/${token}`,
        expires_in_seconds: ttl,
    };
}

/**
 * Resolve a reference and, when the read is allowed, mint the presigned download handle. This is what
 * every agent-facing surface returns: the agent gets a URL it can hand to a fetch, a document parser
 * or a human, and the bytes never enter a model context.
 */
export async function fileHandleFor(
    storage: Storage,
    config: AimeatConfig,
    ref: string,
    accessor: FileRefAccessor,
    opts?: { name?: string },
): Promise<FileHandle> {
    const resolved = await resolveFileRef(storage, config, ref, accessor);
    return handleFromResolved(config, resolved, accessor.gaii, opts);
}
