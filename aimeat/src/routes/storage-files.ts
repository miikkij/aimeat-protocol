/**
 * @file storage-files.ts
 * @description Binary file storage REST API: upload (inline/presigned/chunked), list, download,
 *   delete, and public/consent access. Files are addressed by key under an owner GAII.
 * @structure
 *   - storageFilesRouter() — Express router: POST/GET/HEAD/DELETE /v1/storage, chunked upload,
 *     presigned GET /v1/download/:token, and public GET /v1/pub/:gaii/{*key}
 * @usage
 *   import { storageFilesRouter } from '../routes/storage-files.js';
 *   app.use(storageFilesRouter(config, storage));
 * @version-history
 *   v1.1.0 -- 2026-05-30 -- MCP audit Phase 2 (F11): presigned GET /v1/download/:token + storage
 *     GET ?mode=handle|inline so binary bytes are fetched out-of-band, never base64'd into context.
 *   v1.2.0 -- 2026-06-07 -- Access parity with memory: read paths go through shared authorizeRead()
 *     (threads file.groupId so visibility:'group' is membership-checked); presigned downloads now
 *     write an audit entry; /v1/pub authenticated-but-denied returns 403 (was 404).
 *   v1.3.0 -- 2026-06-08 -- PATCH /v1/storage/:key/visibility (mirrors the memory-files route) so a
 *     document can make its embedded images public for other viewers.
 *   v1.4.0 -- 2026-06-21 -- Drop the presigned-download audit write: allowed reads are no longer
 *     audited (consent audit now records only denials + grant/revoke mutations).
 *   v1.5.0 -- 2026-07-11 -- POST /v1/storage response carries owner_gaii + embed_url/embed_markdown so a
 *     caller can embed the file with the owner-addressed /v1/pub form (see services/doc-images).
 *   v1.6.0 -- 2026-07-26 -- GET /v1/pub sends Access-Control-Allow-Origin: * and Cross-Origin-
 *     Resource-Policy: cross-origin on the PUBLIC branch only. A public file could be displayed but
 *     not read by script: the global CORS middleware resolves origins from the caller's identity and
 *     a public read carries none, so it fell back to the node default. The gated branches below are
 *     unchanged and keep the credentialed policy.
 *   v1.7.0 -- 2026-07-26 -- GET /v1/pub accepts ?mode=handle (presigned URL + metadata instead of the
 *     bytes) so an agent/liaison that may read a file it does NOT own can hand the URL to a fetch or
 *     a document parser without pulling binary through a tool result. Same guard, other representation.
 *     Also removed the unreachable cross-owner branches from GET/HEAD /v1/storage: those look the key
 *     up in the CALLER's namespace, so `file.ownerGaii !== caller` could never be true and the
 *     authorizeRead() there never ran. Cross-namespace reads have exactly one door: /v1/pub.
 *   v1.8.0 -- 2026-07-27 -- POST /v1/storage mode=presigned applies the anonymous-namespace fence
 *     before minting the token. The check sat after the presigned early return, so asking for an
 *     upload URL let an anonymous agent write outside anonymous/* — the gate belongs on the write,
 *     not on the representation the caller happens to choose.
 *   v1.9.0 -- 2026-08-01 -- TARGET-058 Phase 5 step 0b: every file response declares `charset=utf-8`
 *     when, and only when, the stored bytes pass a UTF-8 decode test (sniffedContentType). A bare
 *     `text/*` makes a browser fall back to the locale default and render UTF-8 as mojibake; these
 *     are UPLOADED bytes though, so a genuinely cp1252 .txt/.csv keeps the type it has today rather
 *     than being retyped into something its owner cannot read.
 *   v1.10.0 -- 2026-08-11 -- POST /v1/storage stores through services/storage-file-write.ts, which
 *     aimeat_storage_upload now calls too. The tool copy of this write had never run the account-wide
 *     storage quota, never charged the overage that follows it, and had no anonymous key fence, so the
 *     same upload was gated and billed through this door and neither through the tool. The presigned
 *     branch also stops hand-writing the token meta: it dropped `group_id` and `workspace_refs`, so a
 *     presigned upload asking for visibility 'group' landed bound to no group and was readable by
 *     nobody. Chunked complete still writes its own copy; it has no tool twin.
 *   v1.11.0 -- 2026-08-11 -- August 2026 audit H-26: every response that carries file bytes goes
 *     through setStoredFileHeaders() (utils/file-download-headers.ts), which adds nosniff, a
 *     Content-Disposition and a file-only CSP to the content type it already set. A file's type
 *     comes from whoever uploaded it, and GET /v1/pub serves a public file to anyone from the apex
 *     origin, so uploaded text/html or image/svg+xml was a page running next to the portal's
 *     session. Images, media, PDFs and plain text still render inline; everything else downloads.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import { setStoredFileHeaders } from '../utils/file-download-headers.js';
import type { Storage, StorageFileRecord } from '../storage/interface.js';
import { requireAuth, requireRole, requireExternalPrincipal, requireScope, optionalAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { authorizeRead } from '../services/access-guard.js';
import { randomBytes } from 'node:crypto';
import { decodeStrictBase64 } from '../utils/base64.js';
import { ChunkedUploadInitSchema, validateBody } from '../models/schemas.js';
import { checkStorageQuota, chargeOverage } from '../services/quota.js';
import { emitResourceUpdated, emitResourceListChanged } from '../mcp/index.js';
import { resolveIdentity } from '../utils/gaii.js';
import { normalizeWorkspaceRefs } from '../utils/workspace-ref.js';
import { writeStorageFile, mintStorageUploadUrl } from '../services/storage-file-write.js';
import { generateDownloadToken, verifyDownloadToken, DownloadTokenError } from '../services/download-token.js';
import { pubEmbedUrl, pubEmbedMarkdown } from '../services/doc-images.js';
import { FOREIGN_HANDLE_TTL_SECONDS, OWN_HANDLE_TTL_SECONDS } from '../services/file-refs.js';

/** F11: max bytes returned inline (base64) from handle/inline download mode — keeps big binaries out of the model context. */
const INLINE_MAX_BYTES = 32 * 1024;
/** F11: mime types small enough / textual enough to be safe to inline. */
function isInlineableMime(mime: string): boolean {
    return mime.startsWith('text/') || /(json|xml|csv|javascript|yaml|markdown|x-www-form-urlencoded)/i.test(mime);
}

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

    // GET /v1/download/:token — presigned download (F11). No agent auth: the token IS the
    // capability and is scoped to one owner+key with a TTL. Lets binary bytes be fetched
    // out-of-band (handed off, embedded, streamed) instead of base64'd into the model context.
    router.get('/v1/download/:token', async (req, res) => {
        let verified;
        try {
            verified = await verifyDownloadToken(req.params.token as string);
        } catch (err) {
            if (err instanceof DownloadTokenError) {
                const status = err.code === 'TOKEN_EXPIRED' ? 410 : 401;
                res.status(status).json(error(config.nodeId, err.code, err.message));
                return;
            }
            res.status(401).json(error(config.nodeId, 'TOKEN_INVALID', 'Invalid download token'));
            return;
        }

        const file = await storage.getStorageFile(verified.sub, verified.key);
        if (!file) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'File not found'));
            return;
        }

        // The presigned token IS the capability (already owner-authorized). Allowed reads
        // are no longer audited (only denials + consent mutations — see consent-audit-buffer).

        const rangeHeader = req.headers.range;
        if (rangeHeader) {
            const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
            if (match) {
                const start = parseInt(match[1], 10);
                const end = match[2] ? parseInt(match[2], 10) : file.size - 1;
                const chunk = file.data.subarray(start, end + 1);
                res.status(206);
                setStoredFileHeaders(res, file);
                res.setHeader('Content-Range', `bytes ${start}-${end}/${file.size}`);
                res.setHeader('Content-Length', chunk.length);
                res.end(chunk);
                return;
            }
        }

        setStoredFileHeaders(res, file);
        res.setHeader('Content-Length', file.size);
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.end(file.data);
    });

    // POST /v1/storage — upload file (agent auth)
    router.post('/v1/storage', requireAuth(), requireExternalPrincipal(), requireScope('storage:write'), async (req, res) => {
        const gaii = resolve(req);

        // Accept raw body or JSON with base64 data
        const contentType = req.headers['content-type'] ?? '';
        let key: string;
        let visibility: string;
        let fileData: Buffer;
        let mimeType: string;
        let federateFlag = false;
        let groupId: string | undefined;
        let workspaceRef: string | undefined;

        if (contentType.includes('application/json')) {
            const { key: k, visibility: v, data, mime_type, mode, federate: reqFederate, group_id: reqGroupId, workspace_ref: reqWorkspaceRef, workspace_refs: reqWorkspaceRefs } = req.body ?? {};
            federateFlag = reqFederate === true;

            // --- PRESIGNED MODE: return upload URL ---
            // The key fence and the token meta are the shared ones (services/storage-file-write.ts).
            // Hand-writing the meta here is how `group_id` and `workspace_refs` used to be dropped at
            // mint: a presigned upload asking for visibility 'group' landed bound to no group and was
            // then readable by nobody.
            if (mode === 'presigned') {
                const minted = await mintStorageUploadUrl({ storage, config }, gaii, {
                    key: k ? String(k) : '',
                    mimeType: mime_type as string | undefined,
                    visibility: v as string | undefined,
                    groupId: reqGroupId as string | undefined,
                    workspaceRef: normalizeWorkspaceRefs(reqWorkspaceRefs, reqWorkspaceRef) || undefined,
                });
                if (!minted.ok) {
                    res.status(minted.status).json(error(config.nodeId, minted.code, minted.message));
                    return;
                }
                res.json(success(config.nodeId, {
                    upload_url: minted.uploadUrl,
                    upload_method: 'PUT',
                    content_type: minted.contentType,
                    max_size_bytes: minted.maxBytes,
                    expires_in_seconds: minted.expiresInSeconds,
                }));
                return;
            }

            if (!k || !data) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'key and data (base64) are required'));
                return;
            }
            const decoded = decodeStrictBase64(data);
            if (!decoded) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'data must be base64-encoded'));
                return;
            }
            key = k;
            visibility = v ?? 'private';
            groupId = visibility === 'group' ? reqGroupId : undefined;
            // A 'workspace' file that names no workspace is refused by the shared write below, which
            // is also where the raw-body branch meets the same rule.
            workspaceRef = visibility === 'workspace' ? normalizeWorkspaceRefs(reqWorkspaceRefs, reqWorkspaceRef) : undefined;
            fileData = decoded;
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

        // The key fence, the two size ceilings, the record shape, the overage charge and the change
        // events are the shared write (services/storage-file-write.ts). This handler parses the
        // request and renders the answer; the decisions belong to every door that stores a file.
        const written = await writeStorageFile({ storage, config, emitResourceUpdated, emitResourceListChanged }, gaii, {
            key,
            data: fileData,
            mimeType,
            visibility: visibility as StorageFileRecord['visibility'],
            groupId,
            workspaceRef,
            federate: federateFlag === true,
        });
        if (!written.ok) {
            res.status(written.status).json(error(config.nodeId, written.code, written.message));
            return;
        }
        const { file, overageMorsels } = written;

        res.status(201).json(success(config.nodeId, {
            key: file.key,
            owner_gaii: file.ownerGaii,
            size: file.size,
            mime_type: file.mimeType,
            visibility: file.visibility,
            federate: file.federate ?? false,
            created_at: file.createdAt,
            overage_charged: overageMorsels > 0 ? overageMorsels : undefined,
            // Ready-to-embed, owner-addressed URL. Embedding this in a workspace document scopes the file
            // to that workspace's members on save (never the public internet) — use it, not /v1/storage/<key>.
            embed_url: pubEmbedUrl(file.ownerGaii, file.key),
            embed_markdown: pubEmbedMarkdown(file.ownerGaii, file.key),
        }, [
            { description: 'Download this file', method: 'GET', url: `/v1/storage/${encodeURIComponent(key)}` },
            { description: 'List all files', method: 'GET', url: '/v1/storage' },
        ]));
    });

    // GET /v1/storage — list storage items (agent auth)
    router.get('/v1/storage', requireAuth(), requireExternalPrincipal(), requireScope('storage:read'), async (req, res) => {
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

    // PATCH /v1/storage/:key/visibility — change a file's visibility (owner of the file only).
    // Mirrors PATCH /v1/memory/files/:key/visibility. `:key` (single segment) matches the dotted,
    // slash-free keys used for workspace images; registered before the wildcard {*key} routes.
    // Lets a document make its embedded images public so other viewers can load them.
    router.patch('/v1/storage/:key/visibility', requireAuth(), requireExternalPrincipal(), requireScope('storage:write'), async (req, res) => {
        const gaii = resolve(req);
        const key = req.params.key as string;
        const { visibility } = req.body ?? {};

        if (!visibility || !['private', 'owner', 'public'].includes(visibility)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'visibility must be "private", "owner", or "public"'));
            return;
        }

        const updated = await storage.updateFileVisibility(gaii, key, visibility);
        if (!updated) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'File not found'));
            return;
        }

        res.json(success(config.nodeId, { key: updated.key, visibility: updated.visibility }));
        emitChange('memory');
    });

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

        // ?mode=handle — answer an ALLOWED read with a presigned URL + metadata instead of the bytes.
        // Same access decision as the byte path (this runs only after it passes); the caller just gets
        // a URL it can hand to a fetch, a document parser or a human. A file the caller does not own
        // gets the shorter TTL: the handle survives a revoked grant until it expires.
        const handleMode = (Array.isArray(req.query.mode) ? req.query.mode[0] : req.query.mode) === 'handle';
        const sendHandle = async (accessorGaii: string): Promise<void> => {
            const ttl = accessorGaii === gaii ? OWN_HANDLE_TTL_SECONDS : FOREIGN_HANDLE_TTL_SECONDS;
            const token = await generateDownloadToken(
                { sub: gaii, key, mimeType: file.mimeType, size: file.size }, ttl,
            );
            res.json(success(config.nodeId, {
                ref: `${gaii}/${key}`, owner_gaii: gaii, key, mode: 'handle',
                mime_type: file.mimeType, size: file.size, visibility: file.visibility,
                download_url: `${config.baseUrl}/v1/download/${token}`,
                download_method: 'GET', expires_in_seconds: ttl,
                note: 'Binary content is NOT inlined. GET download_url to fetch the bytes out-of-band.',
            }, [{ description: 'Fetch the file bytes', method: 'GET', url: `/v1/download/${token}` }]));
        };

        // Public files are always accessible (audited when the consent layer is on,
        // mirroring memory's public read).
        if (file.visibility === 'public') {
            await authorizeRead(storage, config, {
                ownerGaii: gaii,
                accessorGaii: req.auth?.sub ?? 'anonymous',
                resourceKey: `storage:${key}`,
                visibility: 'public',
                action: 'read',
            });
            if (handleMode) { await sendHandle(req.auth?.sub ? resolveIdentity(req.auth, config.nodeId) : gaii); return; }
            res.setHeader('Cache-Control', 'public, max-age=300');
            // A public file is world-readable by definition, and until now only by <img>: a script
            // that fetched the same bytes got no Access-Control-Allow-Origin and was blocked. The
            // global CORS middleware resolves allowed origins from the CALLER's identity, and a
            // public read carries none, so it fell back to the node default and app origins missed.
            // '*' is the honest answer for content that needs no credentials to read — the same
            // header the app-template, library-pack and font routes already send — and it is set
            // ONLY on this branch: the consent-gated paths below keep the credentialed policy.
            res.setHeader('Access-Control-Allow-Origin', '*');
            // Lets the bytes be drawn into a canvas and read back, which is what any app doing
            // something WITH a public image (resize, re-encode, hand to a tool) has to do.
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
            // The door this hardening exists for. Anyone on the internet reaches this branch, the
            // bytes come back from the apex origin, and their type is whatever the uploader said it
            // was, so an uploaded page would run as the portal. Images, media, PDFs and plain text
            // still render; everything else is saved rather than shown.
            setStoredFileHeaders(res, file);
            res.setHeader('Content-Length', file.size);
            res.end(file.data);
            return;
        }

        // Consent layer off → preserve the legacy existence-hiding behavior.
        if (!config.consentEnabled) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Public file not found'));
            return;
        }

        // Same access decision + audit as memory, threading file.groupId (visibility:'group'),
        // file.workspaceRef + the accessor's sub/owner (visibility:'workspace' → canReadWorkspace).
        // An anonymous caller holding a matching grant can still be allowed (parity with the prior
        // behavior). The <img>-loadable path for a NON-public file is: the reader's app blob-fetches
        // /v1/pub with the reader's Bearer, and this decision gates it.
        const isAnonymous = !req.auth?.sub || req.auth.anonymous === true;
        // Resolve to the GHII/GAII — an OWNER session carries a BARE `sub`, but consent grants and the
        // workspace manifest gate are keyed under the resolved identity (owner@node). Passing the bare
        // name would miss the grant. This mirrors what the workspace route (canReadWorkspace) resolves.
        const accessorGaii = isAnonymous ? 'anonymous' : resolveIdentity(req.auth!, config.nodeId);
        // 'members' = any authenticated node user; authorizeRead trusts the caller to reject the shared
        // anonymous identity, so gate it here — a token-less <img> must not read a members-only file.
        if (file.visibility === 'members' && isAnonymous) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Public file not found'));
            return;
        }
        const result = await authorizeRead(storage, config, {
            ownerGaii: gaii,
            accessorGaii,
            resourceKey: `storage:${key}`,
            visibility: file.visibility,
            groupId: file.groupId,
            workspaceRef: file.workspaceRef,
            accessorSub: req.auth?.sub,
            accessorOwner: req.auth?.owner as string | undefined,
            action: 'read',
        });

        if (!result.allowed) {
            // Authenticated-but-denied → 403 (matches GET /v1/memory/:gaii/:key). Anonymous or
            // unauthenticated callers keep the 404 existence-hiding convention for file URLs.
            if (isAnonymous) {
                res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Public file not found'));
                return;
            }
            res.status(403).json(error(config.nodeId, 'CONSENT_DENIED', `Access denied: ${result.reason}`));
            return;
        }

        if (handleMode) { await sendHandle(accessorGaii); return; }
        setStoredFileHeaders(res, file);
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
    router.head('/v1/storage/{*key}', requireAuth(), requireExternalPrincipal(), requireScope('storage:read'), async (req, res) => {
        const gaii = resolve(req);
        const key = extractKey(req.params);
        // This route is namespaced to the caller: the lookup above already scopes to `gaii`, so a
        // file belonging to anyone else is simply absent here. Cross-namespace reads (an agent
        // reading its owner's file, a group/workspace share) go through GET /v1/pub/:gaii/{key},
        // which runs the authorizeRead() guard.
        const file = await storage.getStorageFile(gaii, key);
        if (!file) {
            // ASCII only: a header value with a non-ASCII character (an em dash, say) makes Node throw
            // ERR_INVALID_CHAR and turns this 404 into a 500.
            res.setHeader('X-AIMEAT-Hint', 'Own namespace only - for a file owned by someone else use GET /v1/pub/{owner}/{key}');
            res.status(404).end();
            return;
        }

        // Same headers as the GET below, so a client cannot learn one answer from HEAD and meet a
        // different one when it fetches the bytes.
        setStoredFileHeaders(res, file);
        res.setHeader('Content-Length', file.size);
        res.setHeader('X-AIMEAT-Visibility', file.visibility);
        res.setHeader('X-AIMEAT-Created', file.createdAt);
        res.status(200).end();
    });

    // GET /v1/storage/{*key} — download file (agent auth)
    router.get('/v1/storage/{*key}', requireAuth(), requireExternalPrincipal(), requireScope('storage:read'), async (req, res) => {
        const gaii = resolve(req);
        const key = extractKey(req.params);
        // Namespaced to the caller (see the HEAD handler above): a file owned by anyone else is not
        // reachable here at all. The named alternative in the 404 is the whole point — an agent asked
        // for its OWNER's file by bare key and got a blank "not found" that read as data loss.
        const file = await storage.getStorageFile(gaii, key);
        if (!file) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND',
                `File not found in your namespace: ${key}. This route reads only your own files - for a file owned by someone else (e.g. your owner's upload or a DM attachment) use GET /v1/pub/{owner}/{key}.`));
            return;
        }

        // F11: ?mode=handle | inline — return a JSON handle instead of raw bytes, so callers
        // (e.g. the connector MCP) never pull binary into the model context. Default = raw bytes.
        const mode = (Array.isArray(req.query.mode) ? req.query.mode[0] : req.query.mode) as string | undefined;
        if (mode === 'handle' || mode === 'inline') {
            const resourceUri = `aimeat://storage/${encodeURIComponent(key)}`;
            if (mode === 'inline') {
                if (file.size > INLINE_MAX_BYTES || !isInlineableMime(file.mimeType)) {
                    res.status(413).json(error(config.nodeId, 'INLINE_NOT_ALLOWED',
                        `Inline is only for small (<= ${INLINE_MAX_BYTES} bytes) text files. This file is ${file.size} bytes (${file.mimeType}). Use mode=handle and the download_url instead.`));
                    return;
                }
                res.json(success(config.nodeId, {
                    key: file.key, mime_type: file.mimeType, size: file.size, mode: 'inline',
                    content_text: file.data.toString('utf8'), resource_uri: resourceUri,
                }));
                return;
            }
            const token = await generateDownloadToken({ sub: file.ownerGaii, key, mimeType: file.mimeType, size: file.size });
            res.json(success(config.nodeId, {
                key: file.key, mime_type: file.mimeType, size: file.size, visibility: file.visibility, mode: 'handle',
                download_url: `${config.baseUrl}/v1/download/${token}`,
                download_method: 'GET', expires_in_seconds: 3600, resource_uri: resourceUri,
                note: 'Binary content is NOT inlined. GET download_url to fetch the bytes out-of-band.',
            }, [{ description: 'Fetch the file bytes', method: 'GET', url: `/v1/download/${token}` }]));
            return;
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
                setStoredFileHeaders(res, file);
                res.setHeader('Content-Range', `bytes ${start}-${end}/${file.size}`);
                res.setHeader('Content-Length', chunk.length);
                res.end(chunk);
                return;
            }
        }

        setStoredFileHeaders(res, file);
        res.setHeader('Content-Length', file.size);
        res.end(file.data);
    });

    // DELETE /v1/storage/{*key} — delete file (agent auth)
    router.delete('/v1/storage/{*key}', requireAuth(), requireExternalPrincipal(), requireScope('storage:write'), async (req, res) => {
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
