/**
 * @file src/routes/connections-agents.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The accounts an owner's agents connected, seen and revoked by the owner in person
 *   (secrets audit 2026-10-09, chapter 2, F2).
 *
 *   WHY A ROUTE OF ITS OWN. An agent connects an outside account under its own GAII, so every other
 *   connections route, which compares the connection's principal with the caller's, never shows the
 *   owner those rows and never lets them revoke one. Until 2026-10-09 the owner could not see that an
 *   agent held a live, sealed refresh token to a mailbox, and could not take it away short of
 *   deleting the agent.
 *
 *   OWNER IN PERSON ONLY. requireOwnerPrincipal admits the account holder and an agent the owner
 *   gave account:security; the handlers then ask for the owner in person, so no agent (the
 *   connection's own agent included), app grant or visitor reaches either route. A connection that
 *   is not one of this owner's agents' (another owner's, the owner's own, or none) answers one 404.
 *
 *   THE SAME PROJECTION. toPublicConnection plus the agent's name and identity: no credential and no
 *   provider scope vocabulary, exactly what the ordinary list gives.
 * @structure connectionsAgentsRouter(config, storage):
 *   GET    /v1/connections/agents      -- the accounts the owner's agents connected
 *   DELETE /v1/connections/agents/:id  -- revoke one at the provider, then locally
 * @usage app.use(connectionsAgentsRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, chapter 2, F2).
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireOwnerPrincipal } from '../auth/middleware.js';
import { callerOf } from '../middleware/caller.js';
import { buildOutboundProviders } from '../services/connections/providers.js';
import { requireEncryptionKey } from '../services/connections/credential.js';
import { listAgentsConnections, requireAgentsConnection } from '../services/connections/access.js';
import { revokeConnection } from '../services/connections/refresh.js';

const IN_PERSON_REASON = 'Only the account holder, signed in on this node, sees and revokes the accounts their agents connected.';

export function connectionsAgentsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const providers = buildOutboundProviders(config);

  /** The caller's account name when it is the owner in person, or null with the answer already sent. */
  function ownerInPerson(req: Request, res: Response): string | null {
    if (!config.connectionsEnabled) {
      res.status(503).json(error(config.nodeId, 'CONNECTIONS_DISABLED',
        'Outbound connections are not enabled on this node (AIMEAT_CONNECTIONS_ENABLED).'));
      return null;
    }
    const caller = callerOf(req, config.nodeId, storage);
    if (!caller.inPerson) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', IN_PERSON_REASON));
      return null;
    }
    return caller.owner;
  }

  router.get('/v1/connections/agents', requireAuth(), requireOwnerPrincipal(IN_PERSON_REASON), async (req: Request, res: Response) => {
    const owner = ownerInPerson(req, res);
    if (!owner) return;
    res.json(success(config.nodeId, { connections: await listAgentsConnections(storage, owner) }, [
      { description: 'Revoke one', method: 'DELETE', url: '/v1/connections/agents/{id}' },
    ]));
  });

  router.delete('/v1/connections/agents/:id', requireAuth(), requireOwnerPrincipal(IN_PERSON_REASON), async (req: Request, res: Response) => {
    const owner = ownerInPerson(req, res);
    if (!owner) return;
    const conn = await requireAgentsConnection(storage, owner, req.params.id as string);
    // Absent, another owner's and the owner's own answer alike.
    if (!conn) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such connection of your agents'));
      return;
    }
    const key = requireEncryptionKey(config);
    if (!key) {
      res.status(503).json(error(config.nodeId, 'NO_ENCRYPTION_KEY',
        'This node has no encryption key configured, so it cannot read the credential to revoke. Set AIMEAT_ENCRYPTION_KEY.'));
      return;
    }
    const result = await revokeConnection({ config, storage, providers, key }, conn.id);
    if (!result.ok) {
      res.status(400).json(error(config.nodeId, result.code, result.reason));
      return;
    }
    // told_provider as on the owner's own revoke: the local credential is gone either way.
    res.json(success(config.nodeId, { revoked: true, told_provider: result.toldProvider }));
  });

  return router;
}
