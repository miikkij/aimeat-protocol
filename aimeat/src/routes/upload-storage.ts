/**
 * @file src/routes/upload-storage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The storage half of PUT /v1/upload/:token (a presigned storage upload), and the one
 *   reading of the `ai_provenance` block a presigned token carries. Moved out of routes/upload.ts by
 *   pure extraction when that file reached the 800-line ceiling; upload.ts still dispatches here.
 * @structure declaredFromMeta() · completeDirectStorageUpload() · handleStorageUpload()
 * @usage
 *   import { handleStorageUpload, declaredFromMeta } from './upload-storage.js';
 *   await handleStorageUpload(res, config, storage, verified.sub, verified.actor, verified.meta, data);
 * @version-history
 *   v1.5.0 — 2026-11-01 — The write takes the welcome page's writer from the signed token (`page_writer`)
 *     when no live caller is asked (services/storage-page-keys.ts; secaudit2026oct31w2 round 11).
 *   v1.4.0 — 2026-10-31 — completeDirectStorageUpload (POST /v1/upload/{token}/complete): the file a client
 *     PUT straight in the object store is recorded from the size the store reports; a refused one's
 *     object is removed (wish-suuret-tiedostot-virtaavat-aimeat-io-n-l-pi-ilman-koko-tiedo).
 *   v1.3.0 — 2026-10-30 — The token's `store`, the store the writer named at the mint, goes to the write
 *     (wish-useampi-tiedostos-il-yksi-oletus-ja-tallentaja-voi-valita-s-).
 *   v1.2.0 — 2026-10-20 — An agent the mint allowed to publish (no `publish_ask` in the token) is asked
 *     the publish gate again from its current record (uploadPublishGate), so a raise to public by an
 *     agent that lost publish:public after the mint is stored at its kept level with a request
 *     (secaudit 2026-10, PUT-v1-upload:no-live-principal-recheck).
 *   v1.1.0 — 2026-10-18 — A token carrying `publish_ask` (the mint asked the publish gate) hands that
 *     requester to the write: a file that lands as a raise to public is stored at the level it had and
 *     the answer is 202 with `publish_request` (plan doc-mvcn6c7e4e5q, V4).
 *   v1.0.0 — 2026-10-08 — Extracted from routes/upload.ts (max-file-lines). The storage upload takes
 *     the token's actor and its ai_provenance / ai_provenance_id, and answers with the file's
 *     `ai_provenance` block (AI provenance for stored files).
 */
import type { Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, StorageFileRecord } from '../storage/interface.js';
import { writeStorageFile } from '../services/storage-file-write.js';
import { requesterFromMeta } from '../services/storage-file-publish.js';
import { pageWriterFromMeta } from '../services/storage-page-keys.js';
import { uploadPublishGate } from '../services/publish-requests/upload-gate.js';
import { parseDeclaredProvenanceInput } from '../services/ai/provenance-input.js';
import type { DeclaredProvenance } from '../services/ai/provenance.js';
import { logger } from '../utils/logger.js';
import { emitResourceUpdated, emitResourceListChanged } from '../services/resource-events.js';
import { pubEmbedUrl, pubEmbedMarkdown } from '../services/doc-images.js';
import { versionedAddress } from '../utils/http-range.js';
import { uploadProvenanceBlock } from './storage-provenance-input.js';
import { choiceIdOf } from '../services/file-store/file-store-resolver.js';
import { parseBlobRef } from '../storage/blob/blob-types.js';
import { directDownloadUrl, discardStorageObject, storedObjectFacts } from '../storage/blob/file-store-wrap.js';
import { DIRECT_DOWNLOAD_TTL_SECONDS } from '../utils/http-range.js';
import { verifyUploadToken, UploadTokenError } from '../services/upload-token.js';
import { uploadPrincipalRefusal } from '../services/upload-principal.js';

/** The signed address a download door redirects a large stored file to (serveStoredFile), named with
 *  the last part of its key. */
export function directReadUrl(storage: Storage, ownerGaii: string, key: string): Promise<string | null> {
    return directDownloadUrl(storage, ownerGaii, key, { expiresInSec: DIRECT_DOWNLOAD_TTL_SECONDS, filename: key.split('/').pop() });
}

/**
 * POST /v1/upload/{token}/complete: the second half of a direct upload. The client has PUT the bytes
 * to the store address the mint answered; the token (the same capability as the PUT door's, single
 * use) names the object the node chose. The object's size comes from the store, and the shared write
 * then decides with it as with any upload. The token is spent only once the object is there, so a
 * complete called too early can be called again.
 */
export async function completeDirectStorageUpload(res: Response, config: AimeatConfig, storage: Storage, token: string): Promise<void> {
    const refuseToken = (err: unknown) => {
        const code = err instanceof UploadTokenError ? err.code : 'TOKEN_INVALID';
        const status = code === 'TOKEN_EXPIRED' ? 410 : code === 'TOKEN_USED' ? 409 : 401;
        res.status(status).json({ success: false, error: code, message: err instanceof Error ? err.message : 'Invalid upload token' });
    };
    // Read without spending: the spend waits for the object.
    let peek;
    try { peek = await verifyUploadToken(token, { revokeTokenIfAbsent: async () => true }); } catch (err) { refuseToken(err); return; }
    const blobRef = peek.meta.object;
    if (peek.utype !== 'storage' || typeof blobRef !== 'string') {
        res.status(400).json({ success: false, error: 'NOT_DIRECT', message: 'This upload URL is not a direct one. PUT the file to it instead.' });
        return;
    }
    const principalRefused = await uploadPrincipalRefusal(storage, peek);
    if (principalRefused) { res.status(401).json({ success: false, error: 'TOKEN_INVALID', message: principalRefused }); return; }
    const facts = await storedObjectFacts(storage, blobRef);
    if (!facts) {
        res.status(409).json({ success: false, error: 'OBJECT_NOT_UPLOADED', message: 'The file is not in the store yet. PUT it to the upload_url with the upload_headers, then complete again.' });
        return;
    }
    if (facts.size === 0 || facts.size > peek.maxBytes) {
        await discardStorageObject(storage, blobRef, 'a direct upload outside the size limits');
        res.status(facts.size === 0 ? 400 : 413).json(facts.size === 0
            ? { success: false, error: 'EMPTY_BODY', message: 'The uploaded file is empty.' }
            : { success: false, error: 'FILE_TOO_LARGE', message: `Upload exceeds limit of ${peek.maxBytes} bytes` });
        return;
    }
    let verified;
    try { verified = await verifyUploadToken(token, storage); } catch (err) { refuseToken(err); return; }
    try {
        await handleStorageUpload(res, config, storage, verified.sub, verified.actor, verified.meta, undefined, verified.actorIsAgent, { blobRef, size: facts.size });
    } catch (err) {
        await discardStorageObject(storage, blobRef, 'the direct upload could not be recorded');
        logger.error('Direct upload complete failed', { error: (err as Error).message });
        res.status(500).json({ success: false, error: 'PROCESSING_FAILED', message: 'Upload processing failed', reason: (err as Error).message.slice(0, 300) });
    }
}

/**
 * The `ai_provenance` block a presigned token carries, mapped to the mint path's input — or
 * undefined when there is none, or when what is there no longer validates.
 *
 * Shared by every utype that grows a declaration, which is why it sits here rather than inside
 * handleAppUpload: the app door is simply the first one to need it, and the next one must not
 * hand-roll a second reading of the same key.
 */
export function declaredFromMeta(meta: Record<string, unknown>): DeclaredProvenance | undefined {
    const parsed = parseDeclaredProvenanceInput(meta.ai_provenance);
    if (!parsed.ok) {
        logger.warn('Upload token carried an ai_provenance block that no longer validates — publishing without it', {
            violations: parsed.violations.map((v) => `${v.path}: ${v.message}`).join('; '),
        });
        return undefined;
    }
    return parsed.declared;
}

// ── Handler: Storage ──

export async function handleStorageUpload(
    res: Response, config: AimeatConfig, storage: Storage,
    sub: string, actor: string, meta: Record<string, unknown>, data: Buffer | undefined, actorIsAgent = false,
    object?: { blobRef: string; size: number },
): Promise<void> {
    // tags + workspace_refs ride in the token meta (PRESIGNED_META_KEYS.storage). Dropping them here
    // is how a presigned upload of a workspace-shared file would land as an untagged private one —
    // the file exists, nobody it was meant for can see it, and nothing says why.
    const tags = Array.isArray(meta.tags)
        ? (meta.tags as unknown[]).filter((t): t is string => typeof t === 'string')
        : undefined;
    // The requester the mint asked the publish gate about, from the SIGNED token (never the client).
    const requester = requesterFromMeta(meta.publish_ask);
    // An agent the mint did not ask about (it held publish:public then) is asked again here, with the
    // grant its record holds NOW: a permission the owner withdrew inside the token's hour applies to
    // this upload, as it does to the same agent's inline write (services/publish-requests/upload-gate.ts).
    const liveGate = !requester && actorIsAgent ? await uploadPublishGate(storage, config.nodeId, actor) : undefined;

    // The key fence, the two size ceilings, the account-wide quota, the record shape, the overage
    // charge and the change events are services/storage-file-write.ts, shared with POST /v1/storage
    // and aimeat_storage_upload. This door's own business is reading the token meta and rendering
    // the answer. `sub` is the token subject, set server-side at mint from resolveIdentity(), so the
    // owner the file lands under is never anything a client sent.
    const written = await writeStorageFile(
        { storage, config, emitResourceUpdated, emitResourceListChanged },
        sub,
        {
            key: meta.key as string,
            ...(object ? { object } : { data }),
            mimeType: (meta.mime_type as string) ?? 'application/octet-stream',
            visibility: (meta.visibility as StorageFileRecord['visibility']) ?? 'private',
            groupId: typeof meta.group_id === 'string' ? meta.group_id : undefined,
            workspaceRef: typeof meta.workspace_refs === 'string' ? meta.workspace_refs : undefined,
            tags,
            // The statement the caller made when it asked for the URL, from the SIGNED token, and the
            // writer the token names (set at mint from resolveIdentity, never from the client). The
            // write checks the attached record's hash against these bytes.
            provenance: {
                actor, pipeline: 'rest.upload.storage',
                ...(typeof meta.ai_provenance_id === 'string' ? { declaredId: meta.ai_provenance_id } : {}),
                ...(meta.ai_provenance !== undefined ? { declared: declaredFromMeta(meta) } : {}),
            },
            ...(requester ? { publishGate: { requester } } : liveGate ? { publishGate: liveGate } : {}),
            // The store the mint checked with the writer's rights, from the SIGNED token. Asked again
            // as an operator would ask it: who may choose it was settled at the mint, and the store's
            // state now (gone, closed to own storage) is what the write asks.
            ...(typeof meta.store === 'string' && meta.store ? { store: { id: meta.store, operator: true } } : {}),
            // The welcome page's writer as the mint knew it, from the SIGNED token, when no live caller
            // is asked here (services/storage-page-keys.ts).
            ...(!liveGate && pageWriterFromMeta(meta.page_writer) ? { pageWriter: pageWriterFromMeta(meta.page_writer) } : {}),
        },
    );
    if (!written.ok) {
        // A refused direct upload leaves no object behind: it will never become a file.
        if (object) await discardStorageObject(storage, object.blobRef, `the write refused it (${written.code})`);
        res.status(written.status).json({ success: false, error: written.code, message: written.message });
        return;
    }
    const { file, overageMorsels } = written;

    // 202 when the file was stored at the level it had and making it public waits for the owner.
    res.status(written.publishRequest ? 202 : 200).json({
        success: true,
        type: 'storage',
        ...(written.publishRequest ? { publish_request: written.publishRequest } : {}),
        ...(written.warnings?.length ? { warnings: written.warnings } : {}),
        // The record the file carries: attached, declared or stamped by the write above.
        ...await uploadProvenanceBlock(storage, config, file.aiProvenanceId),
        key: file.key,
        // Where the bytes went: `database`, `node:<name>` or `own:<name>`.
        store: choiceIdOf(parseBlobRef(file.blobRef)?.storeId),
        owner_gaii: file.ownerGaii,
        size: file.size,
        mime_type: file.mimeType,
        visibility: file.visibility,
        // What the account-wide quota cost this upload. The charge already happened on this path;
        // reporting it is what tells the caller their balance moved.
        ...(overageMorsels > 0 ? { overage_charged: overageMorsels } : {}),
        // Ready-to-embed, owner-addressed URL. Embedding this in a workspace document scopes the file to
        // that workspace's members on save (never the public internet) — use it, not /v1/storage/<key>.
        embed_url: pubEmbedUrl(file.ownerGaii, file.key),
        embed_markdown: pubEmbedMarkdown(file.ownerGaii, file.key),
        // The same address with ?v=<this write>, as POST /v1/storage answers: a re-upload under this
        // key is a new URL to every cache, and GET /v1/pub ignores the query.
        versioned_url: versionedAddress(pubEmbedUrl(file.ownerGaii, file.key), file),
    });
}
