/**
 * @file src/routes/storage-files-delete.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description DELETE /v1/storage/{*key}, deleting one of the caller's own files. Moved out of
 *   routes/storage-files.ts by pure extraction when that file reached 800 lines; the route and its
 *   answer are unchanged. Mounted by storageFilesRouter where the route stood, last.
 * @structure storageDeleteRouter(config, storage)
 * @usage router.use(storageDeleteRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-11-01 — Extracted from routes/storage-files.ts (max-file-lines; plan doc-mvwxcas3dom3, D3).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireExternalPrincipal, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitResourceUpdated, emitResourceListChanged } from '../mcp/index.js';
import { resolveIdentity } from '../utils/gaii.js';
import { removeStorageFile } from '../services/storage-file-write.js';
import { extractKey } from './storage-files-request.js';

export function storageDeleteRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();
    const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

    // DELETE /v1/storage/{*key} — delete file (agent auth)
    // The key fence, the existence and ownership checks and the change events are the shared delete
    // (services/storage-file-write.ts), which aimeat_storage_delete calls too. This handler parses
    // the request and renders the answer.
    router.delete('/v1/storage/{*key}', requireAuth(), requireExternalPrincipal(), requireScope('storage:write'), async (req, res) => {
        const gaii = resolve(req);
        const key = extractKey(req.params);

        const removed = await removeStorageFile({ storage, config, emitResourceUpdated, emitResourceListChanged }, gaii, key);
        if (!removed.ok) {
            res.status(removed.status).json(error(config.nodeId, removed.code, removed.message));
            return;
        }

        res.json(success(config.nodeId, {
            deleted: true, key: removed.key, size: removed.size, mime_type: removed.mimeType,
        }));
    });

    return router;
}
