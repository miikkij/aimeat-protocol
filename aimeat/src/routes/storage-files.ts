import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole, optionalAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { checkConsentForRead, auditDataAccess } from '../services/consent.js';
import { randomBytes } from 'node:crypto';
import { ChunkedUploadInitSchema, validateBody } from '../models/schemas.js';
import { checkStorageQuota, chargeOverage } from '../services/quota.js';
import { emitResourceUpdated, emitResourceListChanged } from '../mcp/index.js';
import { resolveIdentity } from '../utils/gaii.js';
import { generateUploadToken } from '../services/upload-token.js';

/** Anonymous agents (shared#anonymous@...) may only use keys prefixed with "anonymous/" */
function isAnonymousGaii(gaii: string): boolean {
    return gaii.includes('#anonymous@');
}

/**
 * Extract storage key from Express 5 wildcard {*key} param.
 * path-to-regexp v8 returns an array of path segments and auto-decodes %xx.
 * Handles both encoded slashes (%2F → single element) and raw slashes (multiple elements).
 */
function extractKey(params: Record<string, string | string[]>): string {
    const k = params.key;
    return Array.isArray(k) ? k.join('/') : k;
}

export function storageFilesRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();
    const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

    // Max chunked file size (configurable, default 5 GB)
    const MAX_CHUNKED_FILE_SIZE = config.storageMaxChunkedFileSizeGb * 1024 * 1024 * 1024;

    // POST /v1/storage — upload file (agent auth)
    router.post('/v1/storage', requireAuth(), requireRole('agent'), async (req, res) => {
        const gaii = resolve(req);

        // Accept raw body or JSON with base64 data
        const contentType = req.headers['content-type'] ?? '';
        let key: string;
        let visibility: string;
        let fileData: Buffer;
        let mimeType: string;
        let federateFlag = false;

        if (contentType.includes('application/json')) {
            const { key: k, visibility: v, data, mime_type, mode, federate: reqFederate } = req.body ?? {};
            federateFlag = reqFederate === true;

            // --- PRESIGNED MODE: return upload URL ---
            if (mode === 'presigned') {
                if (!k) {
                    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'key is required'));
                    return;
                }
                const maxBytes = config.storageMaxFileSizeMb * 1024 * 1024;
                const ct = (mime_type as string) ?? 'application/octet-stream';
                const token = await generateUploadToken({
                    sub: gaii,
                    utype: 'storage',
                    meta: { key: k, mime_type: ct, visibility: v ?? 'private' },
                    maxBytes,
                    contentType: ct,
                });
                res.json(success(config.nodeId, {
                    upload_url: `${config.baseUrl}/v1/upload/${token}`,
                    upload_method: 'PUT',
                    content_type: ct,
                    max_size_bytes: maxBytes,
                    expires_in_seconds: 3600,
                }));
                return;
            }

            if (!k || !data) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'key and data (base64) are required'));
                return;
            }
            key = k;
            visibility = v ?? 'private';
            fileData = Buffer.from(data, 'base64');
            mimeType = mime_type ?? 'application/octet-stream';
        } else {
            // Raw body upload
            key = req.query.key as string ?? `file-${Date.now()}`;
            visibility = req.query.visibility as string ?? 'private';
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
                chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
            }
            fileData = Buffer.concat(chunks);
            mimeType = contentType || 'application/octet-stream';
        }

        // Anonymous namespace enforcement: anonymous agents can only upload to anonymous/* keys
        if (isAnonymousGaii(gaii) && !key.startsWith('anonymous/')) {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Anonymous agents can only upload to keys prefixed with "anonymous/"'));
            return;
        }

        // Per-file size limit (configurable)
        if (fileData.length > config.storageMaxFileSizeMb * 1024 * 1024) {
            res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED', `File size exceeds ${config.storageMaxFileSizeMb}MB limit`));
            return;
        }

        // M-2: Total storage quota enforcement (§8.4, default 100MB per agent)
        const storageQuota = await checkStorageQuota(config, storage, gaii, fileData.length);
        if (!storageQuota.allowed) {
            res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED', storageQuota.reason!));
            return;
        }

        const file = await storage.createStorageFile({
            key,
            ownerGaii: gaii,
            visibility: visibility as 'private' | 'owner' | 'public',
            mimeType,
            size: fileData.length,
            data: fileData,
            federate: federateFlag === true,
            createdAt: new Date().toISOString(),
        });

        // M-3: Charge overage morsels if over quota (§15)
        if (storageQuota.overageMorsels > 0) {
            await chargeOverage(storage, gaii, storageQuota.overageMorsels, 'storage_overage');
        }

        emitResourceUpdated(gaii, `aimeat://storage/${encodeURIComponent(key)}`);
        emitResourceListChanged(gaii);

        res.status(201).json(success(config.nodeId, {
            key: file.key,
            size: file.size,
            mime_type: file.mimeType,
            visibility: file.visibility,
            federate: file.federate ?? false,
            created_at: file.createdAt,
            overage_charged: storageQuota.overageMorsels > 0 ? storageQuota.overageMorsels : undefined,
        }, [
            { description: 'Download this file', method: 'GET', url: `/v1/storage/${encodeURIComponent(key)}` },
            { description: 'List all files', method: 'GET', url: '/v1/storage' },
        ]));
        emitChange('files');
    });

    // GET /v1/storage — list storage items (agent auth)
    router.get('/v1/storage', requireAuth(), requireRole('agent'), async (req, res) => {
        const gaii = resolve(req);
        const files = await storage.listStorageFiles(gaii);

        res.json(success(config.nodeId, {
            files: files.map(f => ({
                key: f.key,
                size: f.size,
                mime_type: f.mimeType,
                visibility: f.visibility,
                created_at: f.createdAt,
            })),
            total: files.length,
        }));
    });

    // -----------------------------------------------
    // Chunked Upload — Large file support
    // Must be registered BEFORE wildcard {*key} routes to prevent
    // /v1/storage/upload/... from matching the wildcard pattern.
    // -----------------------------------------------

    // POST /v1/storage/upload/init — initiate chunked upload
    router.post('/v1/storage/upload/init', requireAuth(), requireRole('agent'), validateBody(ChunkedUploadInitSchema, config.nodeId), async (req, res) => {
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
    router.put('/v1/storage/upload/:id/:chunk', requireAuth(), requireRole('agent'), async (req, res) => {
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
    router.post('/v1/storage/upload/:id/complete', requireAuth(), requireRole('agent'), async (req, res) => {
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
    router.delete('/v1/storage/upload/:id', requireAuth(), requireRole('agent'), async (req, res) => {
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

    // -----------------------------------------------
    // Public file access — no auth required for "public" visibility files.
    // Mirrors the /v1/memory/:gaii/:key pattern.
    // Registered BEFORE wildcard {*key} routes to take priority.
    // -----------------------------------------------

    // GET /v1/pub/:gaii/{*key} — public file download (optional auth for consent-based access)
    // Enables <img src="..."> and direct links for public files.
    // Non-public files can be accessed if caller has consent grant.
    router.get('/v1/pub/:gaii/{*key}', optionalAuth(), async (req, res) => {
        const gaii = req.params.gaii as string;
        const key = extractKey(req.params);
        const file = await storage.getStorageFile(gaii, key);
        if (!file) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Public file not found'));
            return;
        }

        // Public files are always accessible
        if (file.visibility === 'public') {
            res.setHeader('Cache-Control', 'public, max-age=300');
            res.setHeader('Content-Type', file.mimeType);
            res.setHeader('Content-Length', file.size);
            res.end(file.data);
            return;
        }

        // Non-public files: attempt consent check if authenticated
        if (!req.auth?.sub) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Public file not found'));
            return;
        }

        if (!config.consentEnabled) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Public file not found'));
            return;
        }

        const result = await checkConsentForRead(
            storage, `storage:${key}`, gaii, req.auth.sub, file.visibility,
        );

        // Audit the access attempt
        await auditDataAccess(storage, result.consentId ?? null,
            gaii, req.auth.sub, `storage:${key}`, 'read', result.allowed);

        if (!result.allowed) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Public file not found'));
            return;
        }

        res.setHeader('Content-Type', file.mimeType);
        res.setHeader('Content-Length', file.size);
        res.end(file.data);
    });

    // -----------------------------------------------
    // Authenticated file access routes — use {*key} wildcard to support
    // keys containing slashes (e.g. "images/photo.png").
    // Express 5 path-to-regexp v8 auto-decodes %xx in params,
    // so no manual decodeURIComponent needed.
    // -----------------------------------------------

    // HEAD /v1/storage/{*key} — file metadata (agent auth)
    // Must be registered before GET to prevent Express auto-HEAD via GET handler
    router.head('/v1/storage/{*key}', requireAuth(), requireRole('agent'), async (req, res) => {
        const gaii = resolve(req);
        const key = extractKey(req.params);
        const file = await storage.getStorageFile(gaii, key);
        if (!file) {
            res.status(404).end();
            return;
        }

        // Cross-agent access: if the file is not owned by the requester, enforce consent
        if (file.ownerGaii !== resolve(req)) {
            if (file.visibility === 'public') {
                // Public files are always accessible
            } else if (config.consentEnabled) {
                const consentResult = await checkConsentForRead(
                    storage, `storage:${key}`, file.ownerGaii, resolve(req), file.visibility,
                );
                if (!consentResult.allowed) {
                    res.status(403).end();
                    return;
                }
            } else {
                res.status(403).end();
                return;
            }
        }

        res.setHeader('Content-Type', file.mimeType);
        res.setHeader('Content-Length', file.size);
        res.setHeader('X-AIMEAT-Visibility', file.visibility);
        res.setHeader('X-AIMEAT-Created', file.createdAt);
        res.status(200).end();
    });

    // GET /v1/storage/{*key} — download file (agent auth)
    router.get('/v1/storage/{*key}', requireAuth(), requireRole('agent'), async (req, res) => {
        const gaii = resolve(req);
        const key = extractKey(req.params);
        const file = await storage.getStorageFile(gaii, key);
        if (!file) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `File not found: ${key}`));
            return;
        }

        // Cross-agent access: if the file is not owned by the requester, enforce consent
        if (file.ownerGaii !== resolve(req)) {
            if (file.visibility === 'public') {
                // Public files are always accessible
            } else if (config.consentEnabled) {
                const consentResult = await checkConsentForRead(
                    storage, `storage:${key}`, file.ownerGaii, resolve(req), file.visibility,
                );
                await auditDataAccess(storage, consentResult.consentId ?? null,
                    file.ownerGaii, resolve(req), `storage:${key}`, 'read', consentResult.allowed);
                if (!consentResult.allowed) {
                    res.status(403).json(error(config.nodeId, 'CONSENT_REQUIRED', 'You do not have consent to access this file'));
                    return;
                }
            } else {
                res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only access your own files'));
                return;
            }
        }

        // Range header support
        const rangeHeader = req.headers.range;
        if (rangeHeader) {
            const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
            if (match) {
                const start = parseInt(match[1], 10);
                const end = match[2] ? parseInt(match[2], 10) : file.size - 1;
                const chunk = file.data.subarray(start, end + 1);
                res.status(206);
                res.setHeader('Content-Range', `bytes ${start}-${end}/${file.size}`);
                res.setHeader('Content-Length', chunk.length);
                res.setHeader('Content-Type', file.mimeType);
                res.end(chunk);
                return;
            }
        }

        res.setHeader('Content-Type', file.mimeType);
        res.setHeader('Content-Length', file.size);
        res.end(file.data);
    });

    // DELETE /v1/storage/{*key} — delete file (agent auth)
    router.delete('/v1/storage/{*key}', requireAuth(), requireRole('agent'), async (req, res) => {
        const gaii = resolve(req);
        const key = extractKey(req.params);

        // Anonymous namespace enforcement
        if (isAnonymousGaii(gaii) && !key.startsWith('anonymous/')) {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Anonymous agents can only delete keys prefixed with "anonymous/"'));
            return;
        }

        // Defense-in-depth: verify ownership before deletion
        const existing = await storage.getStorageFile(gaii, key);
        if (!existing) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `File not found: ${key}`));
            return;
        }
        if (existing.ownerGaii !== resolve(req)) {
            res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only delete your own files'));
            return;
        }

        const deleted = await storage.deleteStorageFile(gaii, key);
        if (!deleted) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `File not found: ${key}`));
            return;
        }

        emitResourceUpdated(gaii, `aimeat://storage/${encodeURIComponent(key)}`);
        emitResourceListChanged(gaii);

        res.json(success(config.nodeId, { deleted: true, key }));
        emitChange('files');
    });

    return router;
}
