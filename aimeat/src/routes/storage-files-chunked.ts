/**
 * @file storage-files-chunked.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The chunked upload doors, for a file too large to arrive in one request: init a
 *   session, PUT its chunks, complete it into a stored file, or abort it. Split out of
 *   routes/storage-files.ts by pure extraction when that file passed 800 lines; the routes, their
 *   order and their behaviour are unchanged.
 *
 *   ORDER MATTERS, and it is the reason this router is mounted where it is rather than appended:
 *   `/v1/storage/upload/...` would otherwise be swallowed by the `{*key}` wildcard routes that
 *   follow it, and the upload would look like a read of a key called "upload".
 * @structure
 *   - storageChunkedUploadRouter(config, storage) — POST init, PUT :id/:chunk, POST :id/complete,
 *     DELETE :id
 * @usage
 *   import { storageChunkedUploadRouter } from './storage-files-chunked.js';
 *   router.use(storageChunkedUploadRouter(config, storage));   // before the wildcard routes
 * @version-history
 *   v1.4.0 -- 2026-10-08 -- Complete takes ai_provenance / ai_provenance_id and answers with the
 *     file's `ai_provenance` block; the shared write decides the record with the completing writer.
 *   v1.3.0 -- 2026-09-29 -- A chunked upload lands bound like POST /v1/storage: init takes 'workspace'
 *     visibility and group_id / workspace_ref / workspace_refs (refusing a workspace file that names
 *     no workspace before any chunk), and complete writes through writeStorageFile. Complete used to
 *     create the file itself and dropped the binding, so a chunked 'group' file was bound to nothing.
 *   v1.2.0 -- 2026-09-24 -- Init refuses an app's icon and screenshot keys with 403, through the same
 *     appOwnedKeyRefusal() as POST /v1/storage (A7-2).
 *   v1.1.0 -- 2026-09-13 -- The complete answer carries owner_gaii and versioned_url, like every
 *     other storage upload answer (AIMEAT.storage.uploadChunked had neither).
 *   v1.0.0 -- 2026-09-08 -- Extracted from routes/storage-files.ts, unchanged.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireExternalPrincipal, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { resolveIdentity } from '../utils/gaii.js';
import { appOwnedKeyRefusal, writeStorageFile } from '../services/storage-file-write.js';
import { normalizeWorkspaceRefs } from '../utils/workspace-ref.js';
import { emitResourceUpdated, emitResourceListChanged } from '../mcp/index.js';
import { ChunkedUploadInitSchema, validateBody } from '../models/schemas.js';
import { randomBytes } from 'node:crypto';
import { versionedAddress } from '../utils/http-range.js';
import { pubEmbedUrl } from '../services/doc-images.js';
import { storageProvenanceFromBody, uploadProvenanceBlock } from './storage-provenance-input.js';

/** Anonymous agents (shared#anonymous@...) may only use keys prefixed with "anonymous/" */
function isAnonymousGaii(gaii: string): boolean {
    return gaii.includes('#anonymous@');
}

export function storageChunkedUploadRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();
    const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

    // Max chunked file size (configurable, default 5 GB)
    const MAX_CHUNKED_FILE_SIZE = config.storageMaxChunkedFileSizeGb * 1024 * 1024 * 1024;

    // -----------------------------------------------
    // Chunked Upload — Large file support
    // Must be registered BEFORE wildcard {*key} routes to prevent
    // /v1/storage/upload/... from matching the wildcard pattern.
    // -----------------------------------------------

    // POST /v1/storage/upload/init — initiate chunked upload
    router.post('/v1/storage/upload/init', requireAuth(), requireExternalPrincipal(), requireScope('storage:write'), validateBody(ChunkedUploadInitSchema, config.nodeId), async (req, res) => {
        const gaii = resolve(req);
        const { key, mime_type, visibility, chunk_size, total_chunks, group_id, workspace_ref, workspace_refs } = req.body ?? {};
        const workspaceRef = visibility === 'workspace' ? normalizeWorkspaceRefs(workspace_refs, workspace_ref) : undefined;
        // Refused here, before any chunk, with the answer POST /v1/storage gives at its shared write.
        if (visibility === 'workspace' && !workspaceRef) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                'visibility "workspace" requires workspace_refs (or workspace_ref) as one or more "<organismId>/<workspaceId>"'));
            return;
        }

        // Anonymous namespace enforcement
        if (isAnonymousGaii(gaii) && !key.startsWith('anonymous/')) {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Anonymous agents can only upload to keys prefixed with "anonymous/"'));
            return;
        }
        // An app's icon and screenshot keys belong to the app's own doors (A7-2). Refused here, at
        // the start of the session, rather than at complete, when the chunks are already in.
        const owned = appOwnedKeyRefusal(String(key));
        if (owned) {
            res.status(owned.status).json(error(config.nodeId, owned.code, owned.message));
            return;
        }

        const uploadId = `upload-${randomBytes(12).toString('hex')}`;
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 6 * 3600_000).toISOString(); // 6 hours

        // M-4: Reject if declared total size exceeds max chunked file size (5GB)
        const chunkSz = chunk_size ?? 10 * 1024 * 1024;
        if (total_chunks && chunkSz * total_chunks > MAX_CHUNKED_FILE_SIZE) {
            res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED',
                `Declared file size (${total_chunks} chunks × ${chunkSz} bytes) exceeds max chunked file size of 5 GB`));
            return;
        }

        await storage.createChunkedUpload({
            uploadId,
            ownerGaii: gaii,
            key,
            mimeType: mime_type ?? 'application/octet-stream',
            visibility: visibility ?? 'private',
            groupId: visibility === 'group' ? group_id : undefined,
            workspaceRef,
            chunkSize: chunk_size ?? 10 * 1024 * 1024, // 10MB default
            totalChunks: total_chunks,
            receivedChunks: new Map(),
            createdAt: now.toISOString(),
            expiresAt,
        });

        res.status(201).json(success(config.nodeId, {
            upload_id: uploadId,
            key,
            chunk_size: chunk_size ?? 10 * 1024 * 1024,
            expires_at: expiresAt,
        }, [
            { description: 'Upload chunk', method: 'PUT', url: `/v1/storage/upload/${uploadId}/0` },
            { description: 'Complete upload', method: 'POST', url: `/v1/storage/upload/${uploadId}/complete` },
        ]));
        emitChange('files');
    });

    // PUT /v1/storage/upload/:id/:chunk — upload a single chunk
    // The one chunk door the widening missed: init and complete beside it already take any scoped
    // principal, so an app could open an upload and finish it but never send the bytes.
    router.put('/v1/storage/upload/:id/:chunk', requireAuth(), requireExternalPrincipal(), requireScope('storage:write'), async (req, res) => {
        const uploadId = req.params.id as string;
        const chunkIndex = parseInt(req.params.chunk as string, 10);
        if (isNaN(chunkIndex) || chunkIndex < 0) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'chunk index must be a non-negative integer'));
            return;
        }

        const upload = await storage.getChunkedUpload(uploadId);
        if (!upload) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Upload not found or expired'));
            return;
        }
        if (upload.ownerGaii !== resolve(req)) {
            res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not your upload'));
            return;
        }

        const chunks: Buffer[] = [];
        for await (const chunk of req) {
            chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        }
        const data = Buffer.concat(chunks);

        // M-4: Running total size check — reject early if exceeding 5GB
        let currentTotal = data.length;
        for (const [, buf] of upload.receivedChunks) {
            currentTotal += buf.length;
        }
        if (currentTotal > MAX_CHUNKED_FILE_SIZE) {
            res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED',
                `Total uploaded size (${currentTotal} bytes) exceeds max chunked file size of 5 GB`));
            return;
        }

        const added = await storage.addChunk(uploadId, chunkIndex, data);
        if (!added) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Upload not found or expired'));
            return;
        }

        res.json(success(config.nodeId, {
            upload_id: uploadId,
            chunk_index: chunkIndex,
            chunk_size: data.length,
            received: true,
        }));
        emitChange('files');
    });

    // POST /v1/storage/upload/:id/complete — assemble chunks into final file
    router.post('/v1/storage/upload/:id/complete', requireAuth(), requireExternalPrincipal(), requireScope('storage:write'), async (req, res) => {
        const uploadId = req.params.id as string;
        const upload = await storage.getChunkedUpload(uploadId);
        if (!upload) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Upload not found or expired'));
            return;
        }
        if (upload.ownerGaii !== resolve(req)) {
            res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not your upload'));
            return;
        }
        if (upload.receivedChunks.size === 0) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'No chunks uploaded'));
            return;
        }
        // How the bytes were made, stated where the whole file is first known: here.
        const stated = storageProvenanceFromBody(req.body, resolve(req), 'rest.storage.chunked', req.auth!.scopes);
        if (!stated.ok) {
            res.status(400).json(error(config.nodeId, 'INVALID_PROVENANCE', 'The ai_provenance block does not validate.', undefined, { violations: stated.violations }));
            return;
        }

        // Assemble in order
        const sortedIndices = [...upload.receivedChunks.keys()].sort((a, b) => a - b);
        const buffers = sortedIndices.map(i => upload.receivedChunks.get(i)!);
        const assembledData = Buffer.concat(buffers);

        // Optional checksum verification
        const { checksum_sha256 } = req.body ?? {};
        if (checksum_sha256) {
            const { createHash } = await import('node:crypto');
            const actual = createHash('sha256').update(assembledData).digest('hex');
            if (actual !== checksum_sha256) {
                res.status(400).json(error(config.nodeId, 'CHECKSUM_MISMATCH', 'SHA-256 checksum does not match', undefined, {
                    expected: checksum_sha256, actual,
                }));
                return;
            }
        }

        // The shared write (services/storage-file-write.ts): the key fence, the per-file and account
        // ceilings, the group or workspace binding, the overage charge and the change events, the
        // same as POST /v1/storage and the MCP tool. This door used to create the file itself and
        // dropped the binding, so a chunked 'group' file was bound to no group (2026-09-29).
        const written = await writeStorageFile({ storage, config, emitResourceUpdated, emitResourceListChanged }, upload.ownerGaii, {
            key: upload.key,
            data: assembledData,
            mimeType: upload.mimeType,
            visibility: upload.visibility,
            groupId: upload.groupId,
            workspaceRef: upload.workspaceRef,
            provenance: stated.provenance,
        });
        if (!written.ok) {
            res.status(written.status).json(error(config.nodeId, written.code, written.message));
            return;
        }
        const file = written.file;

        // Clean up chunked upload
        await storage.deleteChunkedUpload(uploadId);

        res.status(201).json(success(config.nodeId, {
            ...await uploadProvenanceBlock(storage, config, file.aiProvenanceId),
            key: file.key,
            owner_gaii: file.ownerGaii,
            size: file.size,
            mime_type: file.mimeType,
            visibility: file.visibility,
            chunks_assembled: sortedIndices.length,
            created_at: file.createdAt,
            // The /v1/pub address plus ?v=<this write>, as every other storage upload answers: a
            // re-upload to the same key is otherwise served from browsers' five-minute copies.
            versioned_url: versionedAddress(pubEmbedUrl(file.ownerGaii, file.key), file),
        }, [
            { description: 'Download this file', method: 'GET', url: `/v1/storage/${encodeURIComponent(file.key)}` },
        ]));
        emitChange('files');
    });

    // DELETE /v1/storage/upload/:id — abort chunked upload
    router.delete('/v1/storage/upload/:id', requireAuth(), requireExternalPrincipal(), requireScope('storage:write'), async (req, res) => {
        const uploadId = req.params.id as string;
        const upload = await storage.getChunkedUpload(uploadId);
        if (!upload) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Upload not found or expired'));
            return;
        }
        if (upload.ownerGaii !== resolve(req)) {
            res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not your upload'));
            return;
        }

        await storage.deleteChunkedUpload(uploadId);

        res.json(success(config.nodeId, { upload_id: uploadId, aborted: true }));
        emitChange('files');
    });

    return router;
}
