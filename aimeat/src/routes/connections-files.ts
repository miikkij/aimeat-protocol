/**
 * @file src/routes/connections-files.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The file routes of a connected SharePoint or OneDrive, beside the generic read route
 *   (POST /v1/connections/:id/read/:resource in routes/connections.ts, which browses sites, libraries,
 *   folders, lists and changes):
 *
 *     POST /v1/connections/:id/files/text    one file as text for the person's AI
 *     POST /v1/connections/:id/files/store   one file kept as a private file on this node
 *     POST /v1/connections/:id/write/:resource   a file, a folder or a list row written there
 *
 *   THE PERMISSION WORDS ARE THE ONES ALREADY ON THE CONSENT SCREEN. Reading what is IN an account is
 *   `connections:read-through`; storing it as a file also needs `storage:write`; writing to the
 *   account is `connections:use`, the word that publishes and sends. An agent reaches its owner's
 *   account for reading on connections:read-as-owner and for writing on connections:use, exactly as
 *   the mail routes decide it (services/connections/access.ts connectionHoldersOf).
 *
 *   Its own file because routes/connections.ts is at the line ceiling; the work is in
 *   services/connections/drive-files.ts and write.ts.
 * @structure connectionFilesRouter(config, storage)
 * @usage app.use(connectionFilesRouter(config, storage));
 * @version-history
 *   v1.1.0 — 2026-11-02 — /files/store hands its caller to the storage write, so the company page key
 *     asks company:write or the owner's one press as POST /v1/storage does (secaudit2026nov02d round 13,
 *     drive-files.ts:storeDriveFile:company-page-key-unfenced-no-page-writer).
 *   v1.0.0 — 2026-11-02 — Initial (wish-sharepoint-liitin-tiedostot-luettaviksi-ja-kirjoitettaviksi-).
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { validateBody } from '../models/schemas.js';
import { INPUT_LIMITS } from '../models/input-limits.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { resolveIdentity } from '../utils/gaii.js';
import { callerOf } from '../middleware/caller.js';
import { requireEncryptionKey } from '../services/connections/credential.js';
import { buildOutboundProviders } from '../services/connections/providers.js';
import type { ConnectContext } from '../services/connections/oauth.js';
import {
  connectionHoldersOf, requireUsableConnection, readAsOwnerRefusal, CONNECTIONS_READ_AS_OWNER_SCOPE,
} from '../services/connections/access.js';
import { driveFileText, storeDriveFile } from '../services/connections/drive-files.js';
import { writeResource, loadStoredBytes, type WritePayload } from '../services/connections/write.js';
import { readerFor } from '../services/classification/reader.js';
import { explainReadThrough } from './connections-read-through.js';
import { emitResourceUpdated, emitResourceListChanged } from '../services/resource-events.js';

/** The most text a write may carry inline; anything larger is a stored file (from_key). */
const MAX_INLINE_TEXT = 4 * 1024 * 1024;

/** One file of a library, by its library and its item. */
const FileBody = z.object({
  drive_id: z.string().max(INPUT_LIMITS.id),
  item_id: z.string().max(INPUT_LIMITS.id),
  key: z.string().max(INPUT_LIMITS.key).optional(),
});
type FileBody = z.infer<typeof FileBody>;

/**
 * A write: the content (a stored file or text) and the parameters the provider entry reads. The
 * entry checks every parameter it puts into a path or a body, so the rest passes through bounded.
 */
const WriteBody = z.object({
  from_key: z.string().max(INPUT_LIMITS.key).optional(),
  text: z.string().max(MAX_INLINE_TEXT).optional(),
  mime_type: z.string().max(INPUT_LIMITS.name).optional(),
  filename: z.string().max(INPUT_LIMITS.name).optional(),
}).catchall(z.unknown());
type WriteBody = z.infer<typeof WriteBody>;

export function connectionFilesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const providers = buildOutboundProviders(config);
  const resolve = (req: Request): string => resolveIdentity(req.auth!, config.nodeId);
  const ownerOf = (req: Request): string => `${req.auth!.owner}@${config.nodeId}`;

  /** The service context and the connection, or the answer that refused them. */
  async function open(req: Request, res: Response, purpose: 'name' | 'read'): Promise<{ ctx: ConnectContext; connectionId: string } | null> {
    if (!config.connectionsEnabled) {
      res.status(503).json(error(config.nodeId, 'CONNECTIONS_DISABLED', 'Outbound connections are not enabled on this node (AIMEAT_CONNECTIONS_ENABLED).'));
      return null;
    }
    const principal = resolve(req);
    const holders = connectionHoldersOf(principal, ownerOf(req), req.auth!.scopes, purpose);
    const connection = await requireUsableConnection(storage, holders, req.params.id as string);
    if (!connection) {
      // The owner's account, which this agent may not read without the word: the refusal names it.
      if (purpose === 'read') {
        const refusal = await readAsOwnerRefusal(storage, principal, ownerOf(req), req.auth!.scopes, req.params.id as string);
        if (refusal) {
          res.status(403).json(error(config.nodeId, refusal.code, refusal.message, undefined, { scope: CONNECTIONS_READ_AS_OWNER_SCOPE }));
          return null;
        }
      }
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such connection of yours'));
      return null;
    }
    const key = requireEncryptionKey(config);
    if (!key) {
      res.status(503).json(error(config.nodeId, 'NO_ENCRYPTION_KEY', 'this node cannot read stored credentials'));
      return null;
    }
    return { ctx: { config, storage, providers, key }, connectionId: connection.id };
  }

  router.post('/v1/connections/:id/files/text', requireAuth(), explainReadThrough, requireScope('connections:read-through'),
    validateBody(FileBody, config.nodeId), async (req: Request, res: Response) => {
      const opened = await open(req, res, 'read');
      if (!opened) return;
      // validateBody has checked the body against FileBody above.
      const { drive_id, item_id } = req.body as FileBody;
      const out = await driveFileText(opened.ctx, opened.connectionId, { drive_id, item_id });
      if (!out.ok) return res.status(out.status).json(error(config.nodeId, out.code, out.message));
      res.json(success(config.nodeId, { text: out.text, ...(out.note ? { note: out.note } : {}), source: out.source }));
    });

  router.post('/v1/connections/:id/files/store', requireAuth(), explainReadThrough, requireScope('connections:read-through'),
    requireScope('storage:write'), validateBody(FileBody, config.nodeId), async (req: Request, res: Response) => {
      const opened = await open(req, res, 'read');
      if (!opened) return;
      const { drive_id, item_id, key } = req.body as FileBody;
      // The file is the caller's owner's, as every file an agent or an app stores in that person's name.
      // The caller goes with the write, as on POST /v1/storage, so a key a page origin serves asks
      // what that route asks (secaudit2026nov02d round 13).
      const out = await storeDriveFile(opened.ctx, { storage, config, emitResourceUpdated, emitResourceListChanged },
        resolve(req), opened.connectionId, { drive_id, item_id, key },
        { caller: callerOf(req, config.nodeId, storage), ...(req.auth!.app ? { app: req.auth!.app } : {}) });
      if (!out.ok) return res.status(out.status).json(error(config.nodeId, out.code, out.message));
      res.status(201).json(success(config.nodeId, { stored: { key: out.key }, source: out.source },
        [{ description: 'Read the stored file', method: 'GET', url: `/v1/storage/${out.key.split('/').map(encodeURIComponent).join('/')}` }]));
    });

  router.post('/v1/connections/:id/write/:resource', requireAuth(), requireScope('connections:use'),
    validateBody(WriteBody, config.nodeId), async (req: Request, res: Response) => {
      const opened = await open(req, res, 'name');
      if (!opened) return;
      // validateBody has checked the body against WriteBody above.
      const b: Record<string, unknown> = { ...(req.body as WriteBody) };

      // The bytes of a file write: a stored file of the caller's (after the classification gate), or
      // text given inline. Neither for a folder or a list row, whose body the provider entry builds.
      let payload: WritePayload | undefined;
      const fromKey = typeof b.from_key === 'string' ? b.from_key.trim() : '';
      if (fromKey) {
        const loaded = await loadStoredBytes(opened.ctx, resolve(req), fromKey, opened.connectionId, readerFor({ storage, config }, req.auth));
        if (!loaded.ok) return res.status(loaded.status).json(error(config.nodeId, loaded.code, loaded.message));
        payload = loaded.payload;
        if (typeof b.filename !== 'string' || !b.filename) b.filename = loaded.name;
      } else if (typeof b.text === 'string') {
        if (Buffer.byteLength(b.text, 'utf8') > MAX_INLINE_TEXT) {
          return res.status(413).json(error(config.nodeId, 'TOO_LARGE', 'That is more text than one call carries. Store it as a file first, then write that file.', 413, { field: 'from_key' }));
        }
        const mime = typeof b.mime_type === 'string' && /^[a-z]+\/[A-Za-z0-9.+-]{1,100}$/.test(b.mime_type) ? b.mime_type : 'text/plain; charset=utf-8';
        payload = { bytes: Buffer.from(b.text, 'utf8'), mimeType: mime };
      }

      const out = await writeResource(opened.ctx, opened.connectionId, req.params.resource as string, b, payload);
      if (!out.ok) return res.status(out.status).json(error(config.nodeId, out.code, out.message));
      res.status(201).json(success(config.nodeId, { provider: out.provider, resource: out.resource, data: out.data }));
    });

  return router;
}
