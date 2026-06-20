/**
 * @file upload.ts
 * @description Presigned upload endpoint. Receives raw file bodies at PUT /v1/upload/:token,
 *   validates the token, enforces size limits, and delegates processing based on upload type
 *   (app, storage, extension, cortex).
 * @structure
 *   - uploadRouter() — Express router factory with single PUT endpoint
 *   - handleAppUpload() — process HTML app uploads
 *   - handleStorageUpload() — process generic file uploads
 *   - handleExtensionUpload() — process extension ZIP uploads
 *   - handleCortexUpload() — process cortex ZIP uploads
 * @usage
 *   import { uploadRouter } from '../routes/upload.js';
 *   app.use(uploadRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-05-02 — Initial implementation
 *   v1.1.0 — 2026-06-09 — handleAppUpload derives a BARE ownerName (never the
 *     @node-suffixed GHII) so presigned publishes land in the same canonical app
 *     bucket as inline publishes (see canonicalOwner in routes/apps.ts).
 */

import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, AppManifest } from '../storage/interface.js';
import { verifyUploadToken, UploadTokenError } from '../services/upload-token.js';
import { parseExtensionZip, parseCortexZip } from '../services/upload-zip.js';
import { parseGAII } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';
import { emitResourceListChanged } from '../mcp/index.js';

export function uploadRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();

    router.put('/v1/upload/:token', async (req: Request, res: Response) => {
        const token = req.params.token as string;

        // Verify token
        let verified;
        try {
            verified = await verifyUploadToken(token);
        } catch (err) {
            if (err instanceof UploadTokenError) {
                const status = err.code === 'TOKEN_EXPIRED' ? 410
                    : err.code === 'TOKEN_USED' ? 409
                    : 401;
                res.status(status).json({ success: false, error: err.code, message: err.message });
                return;
            }
            res.status(401).json({ success: false, error: 'TOKEN_INVALID', message: 'Invalid upload token' });
            return;
        }

        // Collect raw body (streaming with size enforcement)
        const chunks: Buffer[] = [];
        let totalSize = 0;

        try {
            for await (const chunk of req as unknown as AsyncIterable<Buffer>) {
                totalSize += chunk.length;
                if (totalSize > verified.maxBytes) {
                    res.status(413).json({
                        success: false,
                        error: 'FILE_TOO_LARGE',
                        message: `Upload exceeds limit of ${verified.maxBytes} bytes`,
                    });
                    return;
                }
                chunks.push(chunk);
            }
        } catch {
            res.status(400).json({ success: false, error: 'STREAM_ERROR', message: 'Failed to read request body' });
            return;
        }

        const data = Buffer.concat(chunks);

        if (data.length === 0) {
            res.status(400).json({ success: false, error: 'EMPTY_BODY', message: 'No file data received' });
            return;
        }

        try {
            switch (verified.utype) {
                case 'app':
                    await handleAppUpload(res, config, storage, verified.sub, verified.meta, data);
                    return;
                case 'storage':
                    await handleStorageUpload(res, storage, verified.sub, verified.meta, data);
                    return;
                case 'extension':
                    await handleExtensionUpload(res, config, storage, verified.sub, data);
                    return;
                case 'cortex':
                    await handleCortexUpload(res, config, storage, verified.sub, data);
                    return;
                default:
                    res.status(400).json({ success: false, error: 'INVALID_TYPE', message: `Unknown upload type` });
            }
        } catch (err) {
            logger.error('Upload processing failed', { error: (err as Error).message, stack: (err as Error).stack, type: verified.utype });
            res.status(500).json({ success: false, error: 'PROCESSING_FAILED', message: 'Upload processing failed' });
        }
    });

    return router;
}

// ── Handler: App ──

async function handleAppUpload(
    res: Response, config: AimeatConfig, storage: Storage,
    sub: string, meta: Record<string, unknown>, data: Buffer,
): Promise<void> {
    // `sub` is the presigned token subject: a full GAII (agent#owner@node) for
    // agent uploads, or the owner's GHII (owner@node) for owner uploads. Either
    // way the canonical app bucket is the owner GHII and the display/URL name is
    // the BARE owner — never the @node-suffixed form, which would fork the app
    // into a second bucket (see canonicalOwner() in routes/apps.ts).
    const parsed = parseGAII(sub);
    const ownerName = parsed ? parsed.owner : (sub.includes('@') ? sub.split('@')[0] : sub);
    const ownerGaii = parsed ? `${parsed.owner}@${parsed.node}` : sub;
    const filename = meta.filename as string;

    const existingVersion = await storage.getLatestVersionNumber(ownerGaii, filename);
    const newVersion = existingVersion + 1;
    const isUpdate = existingVersion > 0;

    const manifest: AppManifest = {
        name: meta.name as string,
        description: (meta.description as string) ?? '',
        version: (meta.version as string) ?? `1.0.${newVersion - 1}`,
        category: (meta.category as string) ?? 'tool',
        tags: (meta.tags as string[]) ?? [],
        authorDisplay: ownerName,
        usesCortex: [],
    };
    if (meta.icon) manifest.icon = meta.icon as string;

    // Carry the parked state forward across re-publishes (a parked app stays hidden
    // when updated). Mirrors POST /v1/apps.
    let parkedState = false;
    if (isUpdate) {
        const existingApp = await storage.getApp(ownerGaii, filename);
        parkedState = !!existingApp?.parked;
    }

    await storage.createApp({
        ownerGaii,
        ownerName,
        filename,
        versionNumber: newVersion,
        manifest,
        mimeType: 'text/html',
        size: data.length,
        data,
        parked: parkedState,
        createdAt: new Date().toISOString(),
    });

    const downloadUrl = `/v1/apps/${encodeURIComponent(ownerName)}/${encodeURIComponent(filename)}`;
    logger.info(`App ${isUpdate ? 'updated' : 'published'} via upload: ${filename} v${newVersion}`, { by: sub });
    emitResourceListChanged(sub);

    res.json({
        success: true,
        type: 'app',
        filename,
        version_number: newVersion,
        name: manifest.name,
        size: data.length,
        is_update: isUpdate,
        download_url: downloadUrl,
        inline_url: `${downloadUrl}?mode=inline`,
    });
}

// ── Handler: Storage ──

async function handleStorageUpload(
    res: Response, storage: Storage,
    sub: string, meta: Record<string, unknown>, data: Buffer,
): Promise<void> {
    const key = meta.key as string;
    const visibility = (meta.visibility as 'private' | 'owner' | 'public') ?? 'private';
    const mimeType = (meta.mime_type as string) ?? 'application/octet-stream';

    const file = await storage.createStorageFile({
        key,
        ownerGaii: sub,
        visibility,
        mimeType,
        size: data.length,
        data,
        createdAt: new Date().toISOString(),
    });

    emitResourceListChanged(sub);

    res.json({
        success: true,
        type: 'storage',
        key: file.key,
        size: file.size,
        mime_type: mimeType,
        visibility,
    });
}

// ── Handler: Extension ──

async function handleExtensionUpload(
    res: Response, config: AimeatConfig, storage: Storage,
    sub: string, data: Buffer,
): Promise<void> {
    const result = await parseExtensionZip(data, config);
    if (!result.ok) {
        res.status(400).json({ success: false, error: 'VALIDATION_FAILED', message: result.error });
        return;
    }

    const record = result.record!;
    record.installedBy = parseGAII(sub)?.owner ?? 'upload';
    record.installedAt = new Date().toISOString();

    const existing = await storage.getExtension(record.name);
    if (existing) {
        res.status(409).json({ success: false, error: 'ALREADY_EXISTS', message: `Extension "${record.name}" is already installed` });
        return;
    }

    const created = await storage.createExtension(record);
    logger.info(`Extension installed via upload: ${created.name}`, { version: created.version, by: sub });
    emitResourceListChanged(sub);

    res.json({
        success: true,
        type: 'extension',
        name: created.name,
        version: created.version,
        status: created.status,
        actions: created.actions.map(a => ({ id: a.id, method: a.method, path: a.path })),
    });
}

// ── Handler: Cortex ──

async function handleCortexUpload(
    res: Response, config: AimeatConfig, storage: Storage,
    sub: string, data: Buffer,
): Promise<void> {
    const parsed = parseGAII(sub);
    const ownerName = parsed?.owner ?? sub;

    const result = await parseCortexZip(data, config, ownerName);
    if (!result.ok) {
        res.status(400).json({ success: false, error: 'VALIDATION_FAILED', message: result.error });
        return;
    }

    if (result.libs) {
        for (const [filename, content] of Object.entries(result.libs)) {
            await storage.setCortexLibFile(result.extension!.name, filename, content);
        }
    }

    const record = await storage.createCortexExtension(result.extension!);
    logger.info(`Cortex installed via upload: ${record.name}`, { version: record.version, by: sub });
    emitResourceListChanged(sub);

    res.json({
        success: true,
        type: 'cortex',
        name: record.name,
        namespace: record.namespace,
        version: record.version,
        status: record.status,
        component_count: record.components.length,
    });
}
