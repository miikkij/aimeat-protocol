/**
 * @file src/routes/storage-files-download.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/download/:token, the presigned download. Moved out of routes/storage-files.ts by
 *   pure extraction when that file reached 800 lines; the route and its answer are unchanged. Mounted by
 *   storageFilesRouter where the route stood, with the byte reader and the provenance marks that file
 *   builds for every download route.
 * @structure storageDownloadRouter(config, storage, { readerFor, markProvenance })
 * @usage router.use(storageDownloadRouter(config, storage, { readerFor, markProvenance }));
 * @version-history
 *   v1.0.0 — 2026-11-01 — Extracted from routes/storage-files.ts (max-file-lines; plan doc-mvwxcas3dom3, D0.4).
 */
import { Router } from 'express';
import type { Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, StorageFileRecord } from '../storage/interface.js';
import { error } from '../middleware/envelope.js';
import { serveStoredFile, type StoredFileReader } from '../utils/http-range.js';
import { verifyDownloadToken, DownloadTokenError, servesFileVersion } from '../services/download-token.js';
import type { ServedProvenance } from '../services/ai/provenance-marks.js';

/** What the download route takes from storageFilesRouter: the byte reader and the provenance marks. */
export interface DownloadRouteDeps {
    readerFor: (ownerGaii: string, key: string) => StoredFileReader;
    markProvenance: (res: Response, file: StorageFileRecord, full: boolean) => Promise<ServedProvenance | undefined>;
}

export function storageDownloadRouter(config: AimeatConfig, storage: Storage, deps: DownloadRouteDeps): Router {
    const router = Router();
    const { readerFor, markProvenance } = deps;

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

        const file = await storage.getStorageFileMeta(verified.sub, verified.key);
        // The token authorizes ONE version of the file: the one stored when it was minted. A file
        // written again under the key since then (another visibility, other bytes) is not what the
        // holder was allowed to read, so it answers as absent, the same answer as a deleted file.
        if (!file || !servesFileVersion(verified, file)) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND',
                'File not found, or it was replaced after this download URL was made. Ask for a new download URL.'));
            return;
        }

        // The presigned token IS the capability (already owner-authorized). Allowed reads
        // are no longer audited (only denials + consent mutations — see consent-audit-buffer).

        res.setHeader('Cache-Control', 'private, max-age=300');
        await markProvenance(res, file, false);
        // The token carries the save-as name when whoever minted it knew one. Content-Disposition
        // beats an anchor's `download` attribute in every browser, so a name the page knows is of no
        // use unless it reaches this response.
        const named = verified.filename ? { ...file, downloadName: verified.filename } : file;
        if (!await serveStoredFile(res, named, req.headers.range, readerFor(verified.sub, verified.key), { headOnly: req.method === 'HEAD', conditionals: req.headers })) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'File not found'));
        }
    });

    return router;
}
