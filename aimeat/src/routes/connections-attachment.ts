/**
 * @file src/routes/connections-attachment.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `store: true` branch of POST /v1/connections/:id/read/attachment: the attachment
 *   goes to the caller's own storage as a private file, and the answer names the file instead of
 *   carrying its bytes. Its own file because routes/connections.ts is near the line ceiling; the work
 *   is services/connections/attachment-store.ts.
 *
 *   TWO PERMISSIONS. Reading a mailbox is `connections:read-through`, which the route has already
 *   checked; writing a file is `storage:write`, checked here with the same middleware, so an agent or
 *   an app holding only the first cannot fill the owner's storage.
 * @structure answerStoredAttachment()
 * @usage if (resource === 'attachment' && params.store === true) return answerStoredAttachment(...);
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial.
 */
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireScope } from '../auth/middleware.js';
import type { ConnectContext } from '../services/connections/oauth.js';
import { storeMailAttachment } from '../services/connections/attachment-store.js';
import { emitResourceUpdated, emitResourceListChanged } from '../mcp/index.js';

export async function answerStoredAttachment(
    req: Request, res: Response, config: AimeatConfig, storage: Storage,
    ctx: ConnectContext, connectionId: string, ownerGhii: string, params: Record<string, unknown>,
): Promise<void> {
    // requireScope answers the refusal itself and calls next only when the word is held.
    let allowed = false;
    requireScope('storage:write')(req, res, () => { allowed = true; });
    if (!allowed) return;

    const out = await storeMailAttachment(ctx, { storage, config, emitResourceUpdated, emitResourceListChanged },
        ownerGhii, connectionId, params);
    if (!out.ok) {
        res.status(out.status).json(error(config.nodeId, out.code, out.message));
        return;
    }
    res.status(201).json(success(config.nodeId, {
        provider: out.provider, resource: 'attachment',
        stored: { key: out.key, filename: out.filename, mime_type: out.mime_type, size: out.size },
    }, [{ description: 'Read the stored file', method: 'GET', url: `/v1/storage/${out.key.split('/').map(encodeURIComponent).join('/')}` }]));
}
