/**
 * @file connections-replies.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two routes that arrived with the LÄHETIN social desk work (2026-10-15):
 *   POST /v1/connections/attempts/:id/replies -- what people answered to an item the caller
 *     published, read from the provider now, in one shape for every network (services/connections/
 *     replies.ts). A POST for the reason the metric read is one: it spends a provider request, and
 *     on X money. Nothing is stored.
 *   GET  /v1/connections/media/:token/:name -- the bytes of a file a publish is handing to a
 *     provider that FETCHES media (Instagram), for fifteen minutes under a random token
 *     (services/connections/media-handoff.ts). Unauthenticated by necessity, like the callback: the
 *     provider's servers fetch it. The token is 256 random bits and the file is one about to be
 *     published to the world, having passed the classification check already.
 * @structure connectionsRepliesRouter(config, storage)
 * @usage app.use(connectionsRepliesRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-10-15 — Initial.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireAnyScope } from '../auth/middleware.js';
import { resolveIdentity } from '../utils/gaii.js';
import { buildOutboundProviders } from '../services/connections/providers.js';
import { requireEncryptionKey } from '../services/connections/credential.js';
import { repliesForAttempt } from '../services/connections/history.js';
import { takeHandedOff } from '../services/connections/media-handoff.js';

export function connectionsRepliesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const providers = buildOutboundProviders(config);

  router.post('/v1/connections/attempts/:id/replies', requireAuth(),
    // Reading what came back THROUGH a connection: the read-through word, or `use`, which already
    // spends the same connection on publishes and metric reads.
    requireAnyScope('connections:use', 'connections:read-through'),
    async (req: Request, res: Response) => {
      if (!config.connectionsEnabled) {
        res.status(503).json(error(config.nodeId, 'CONNECTIONS_DISABLED',
          'Outbound connections are not enabled on this node (AIMEAT_CONNECTIONS_ENABLED).'));
        return;
      }
      const key = requireEncryptionKey(config);
      if (!key) {
        res.status(503).json(error(config.nodeId, 'NO_ENCRYPTION_KEY', 'this node cannot read stored credentials'));
        return;
      }
      const rawLimit = Number(req.body?.limit ?? req.query.limit);
      const out = await repliesForAttempt(
        { config, storage, providers, key },
        resolveIdentity(req.auth!, config.nodeId),
        req.params.id as string,
        Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : undefined,
      );
      if (!out.ok) {
        res.status(out.status).json(error(config.nodeId, out.code, out.reason));
        return;
      }
      res.json(success(config.nodeId, {
        attemptId: out.attemptId, provider: out.provider, url: out.url, replies: out.replies,
        truncated: out.truncated, ...(out.note ? { note: out.note } : {}), fetchedAt: out.fetchedAt,
      }, [
        { description: 'How the same item is doing', method: 'POST', url: `/v1/connections/attempts/${out.attemptId}/metrics` },
      ]));
    });

  router.get('/v1/connections/media/:token/:name', (req: Request, res: Response) => {
    const held = takeHandedOff(req.params.token as string);
    if (!held) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'nothing is held at this address'));
      return;
    }
    res.setHeader('Content-Type', held.mimeType);
    res.setHeader('Content-Length', String(held.bytes.length));
    // Never cached anywhere: the address stops answering when the publish ends.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(held.bytes);
  });

  return router;
}
