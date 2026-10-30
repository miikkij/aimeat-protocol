/**
 * @file src/routes/storage-files-list.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/storage, the caller's own files, and storePlaceOf, the place a file's bytes are
 *   in as a person names it. Moved out of routes/storage-files.ts by pure extraction when that file
 *   passed 800 lines; the route and its answer are unchanged. Mounted by storageFilesRouter where the
 *   route stood.
 * @structure storePlaceOf · storageFilesListRouter(config, storage)
 * @usage router.use(storageFilesListRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-10-30 — Extracted from routes/storage-files.ts, with each file's `store`
 *     (wish-useampi-tiedostos-il-yksi-oletus-ja-tallentaja-voi-valita-s-).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, StorageFileRecord } from '../storage/interface.js';
import { requireAuth, requireExternalPrincipal, requireScope } from '../auth/middleware.js';
import { success } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { readerFor as contentReaderFor } from '../services/classification/reader.js';
import { fileTarget } from '../services/classification/labels.js';
import { choiceIdOf } from '../services/file-store/file-store-resolver.js';
import { parseBlobRef } from '../storage/blob/blob-types.js';

/** Where a file's bytes are, as a person names the place: `database`, `node:<name>` or `own:<name>`. */
export const storePlaceOf = (f: StorageFileRecord): string => choiceIdOf(parseBlobRef(f.blobRef)?.storeId);

export function storageFilesListRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();
    const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

    // GET /v1/storage — list storage items (agent auth)
    router.get('/v1/storage', requireAuth(), requireExternalPrincipal(), requireScope('storage:read'), async (req, res) => {
        const gaii = resolve(req);
        // The classification reader (TARGET-082): a file this caller may not see is not listed.
        const files = await contentReaderFor({ storage, config }, req.auth)
            .show(await storage.listStorageFiles(gaii), f => fileTarget(gaii, f.key, f.workspaceRef));

        res.json(success(config.nodeId, {
            files: files.map(f => ({
                key: f.key,
                size: f.size,
                mime_type: f.mimeType,
                visibility: f.visibility,
                created_at: f.createdAt,
                // Where the bytes are: `database`, `node:<name>` or `own:<name>`.
                store: storePlaceOf(f),
            })),
            total: files.length,
        }));
    });

    return router;
}
