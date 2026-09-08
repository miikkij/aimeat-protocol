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
 *   v1.0.0 -- 2026-09-08 -- Extracted from routes/storage-files.ts, unchanged.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireExternalPrincipal, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { resolveIdentity } from '../utils/gaii.js';
import { checkStorageQuota, chargeOverage } from '../services/quota.js';
import { emitResourceUpdated, emitResourceListChanged } from '../mcp/index.js';
import { ChunkedUploadInitSchema, validateBody } from '../models/schemas.js';
import { randomBytes } from 'node:crypto';

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
        const { key, mime_type, visibility, chunk_size, total_chunks } = req.body ?? {};

        // Anonymous namespace enforcement
        if (isAnonymousGaii(gaii) && !key.startsWith('anonymous/')) {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Anonymous agents can only upload to keys prefixed with "anonymous/"'));
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

        // Per-file size limit (must match POST /v1/storage enforcement)
        if (assembledData.length > config.storageMaxFileSizeMb * 1024 * 1024) {
            res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED', `Assembled file size (${assembledData.length} bytes) exceeds ${config.storageMaxFileSizeMb}MB per-file limit`));
            return;
        }

        // M-2: Total storage quota check before committing assembled file
        const gaii = upload.ownerGaii;
        const storageQuota = await checkStorageQuota(config, storage, gaii, assembledData.length);
        if (!storageQuota.allowed) {
            res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED', storageQuota.reason!));
            return;
        }

        // Create the final storage file
        const file = await storage.createStorageFile({
            key: upload.key,
            ownerGaii: upload.ownerGaii,
            visibility: upload.visibility,
            mimeType: upload.mimeType,
            size: assembledData.length,
            data: assembledData,
            createdAt: new Date().toISOString(),
        });

        // M-3: Charge overage morsels if over quota (§15)
        if (storageQuota.overageMorsels > 0) {
            await chargeOverage(storage, gaii, storageQuota.overageMorsels, 'storage_overage');
        }

        // Clean up chunked upload
        await storage.deleteChunkedUpload(uploadId);

        emitResourceUpdated(gaii, `aimeat://storage/${encodeURIComponent(upload.key)}`);
        emitResourceListChanged(gaii);

        res.status(201).json(success(config.nodeId, {
            key: file.key,
            size: file.size,
            mime_type: file.mimeType,
            visibility: file.visibility,
            chunks_assembled: sortedIndices.length,
            created_at: file.createdAt,
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
