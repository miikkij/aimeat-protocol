/**
 * @file src/routes/oauth-rounds.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's confirmation of an outside sign-in round started outside their browser
 *   (secrets audit 2026-10-09, chapter 2). An agent that connects a mailbox or signs a remote MCP
 *   server in is handed the node's page /v1/oauth-round?state=…, not the provider's address. The
 *   owner opens it signed in, and the page reads the round here and confirms it.
 *
 *   OWNER IN PERSON ONLY. requireOwnerPrincipal admits the account holder and an agent the owner
 *   gave account:security; the handlers then ask for the owner in person, because a confirmation is
 *   the owner's own browser saying "this is me". An agent, an app grant and a visitor are refused,
 *   and a round of another account answers 404 like a missing one.
 *
 *   THE CONFIRMATION SETS THE COOKIE. POST …/approve gives this browser the round's binding cookie,
 *   scoped to the callback's path, and answers with the provider's address. The callback then seals
 *   the credential for this browser and refuses every other.
 * @structure oauthRoundsRouter(config, storage):
 *   GET  /v1/oauth-rounds/:state          -- what the round connects, and to whom
 *   POST /v1/oauth-rounds/:state/approve  -- bind it to this browser; answers the provider's address
 * @usage app.use(oauthRoundsRouter(config, storage));
 * @version-history
 *   v1.1.0 — 2026-10-10 — approve binds the round before it sets the cookie, and a round already
 *     bound answers 409 with no Set-Cookie (secaudit 2026-10-10 I6).
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, chapter 2).
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireOwnerPrincipal } from '../auth/middleware.js';
import { callerOf } from '../middleware/caller.js';
import { newRoundBinding, setRoundBinding } from '../middleware/oauth-round-cookie.js';
import { buildOutboundProviders } from '../services/connections/providers.js';
import { findOwnersRound, describeRound, bindRound, type OwnersRound } from '../services/oauth-rounds.js';
import { connectCallbackPath } from './connections-callback.js';

const MCP_CALLBACK_PATH = '/v1/mcp-servers/callback';

const IN_PERSON_REASON = 'Only the account holder, signed in on this node, can confirm a sign-in to an outside account.';

export function oauthRoundsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const providers = buildOutboundProviders(config);

  /** The caller's own waiting round, or an answer already sent. */
  async function ownRound(req: Request, res: Response): Promise<OwnersRound | null> {
    const caller = callerOf(req, config.nodeId, storage);
    if (!caller.inPerson) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', IN_PERSON_REASON));
      return null;
    }
    const found = await findOwnersRound(storage, req.params.state as string, caller.ownerGhii);
    if (!found) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND',
        'There is no sign-in of yours waiting under this address. It may have expired; ask for a new one.'));
      return null;
    }
    return found;
  }

  router.get('/v1/oauth-rounds/:state', requireAuth(), requireOwnerPrincipal(IN_PERSON_REASON), async (req: Request, res: Response) => {
    const found = await ownRound(req, res);
    if (!found) return;
    res.set('Cache-Control', 'no-store');
    res.json(success(config.nodeId, { round: await describeRound(storage, providers, found) }, [
      { description: 'Confirm it in this browser', method: 'POST', url: `/v1/oauth-rounds/${encodeURIComponent(found.round.state)}/approve` },
    ]));
  });

  router.post('/v1/oauth-rounds/:state/approve', requireAuth(), requireOwnerPrincipal(IN_PERSON_REASON), async (req: Request, res: Response) => {
    const found = await ownRound(req, res);
    if (!found) return;
    const path = found.kind === 'account' ? connectCallbackPath(config) : MCP_CALLBACK_PATH;
    const ttl = Math.max(1000, new Date(found.round.expiresAt).getTime() - Date.now());
    // The round is bound first and the cookie set only on success, so a refused approve sets no
    // cookie that would overwrite the binding of the browser that won (secaudit 2026-10-10 I6).
    const binding = newRoundBinding();
    const bound = await bindRound(storage, found, binding.hash);
    if (!bound) {
      res.status(409).json(error(config.nodeId, 'ALREADY_USED', 'This sign-in was already used. Ask for a new one.'));
      return;
    }
    setRoundBinding(req, res, found.round.state, path, ttl, binding.value);
    res.set('Cache-Control', 'no-store');
    res.json(success(config.nodeId, { authorize_url: bound.authorizeUrl }));
  });

  return router;
}
