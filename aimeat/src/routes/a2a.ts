/**
 * @file src/routes/a2a.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The A2A door: one of this node's agents, reachable by an Agent2Agent client.
 *
 *     GET  /v1/a2a/:owner/:agent/agent-card.json   what the agent is, in A2A's words
 *     POST /v1/a2a/:owner/:agent                   the JSON-RPC surface
 *     GET  /v1/oasf/:owner/:agent                  the same agent, as an OASF record (V6c)
 *
 *   THE CARD IS PUBLIC AND THE DOOR IS NOT. Discovery has to be public or it is not discovery, and
 *   the card says nothing the AIMEAT card at /v1/agents/:gaii/card does not already say to anyone
 *   who asks. Everything behind it takes a credential, which the card declares so a client knows
 *   before it tries.
 *
 *   ONE ACCOUNT, IN V6a. The caller must be a principal of the same owner as the agent it is
 *   addressing. That is the same fence V4 and V5 apply and it is reached through the same
 *   functions — this route adds no rule of its own beyond finding the agent and checking the owner.
 *   Letting a caller from ANOTHER account or another node through this door is a real trust
 *   boundary with its own consent story, and it is not a decision to make on the way past. The card
 *   is honest about it: the security requirement is a bearer for this account.
 *
 *   WHY THE SDK IS HERE AT ALL. It owns the JSON-RPC framing, the method names, the error codes and
 *   the protobuf serialisation — the parts where being subtly wrong means a client fails in a way
 *   neither side can debug. It owns none of the behaviour: `AimeatA2ARequestHandler` lands every
 *   method in the same ops functions the REST and MCP doors call.
 *
 * @structure a2aRouter(config, storage)
 * @usage app.use(a2aRouter(config, storage));
 * @version-history
 *   v1.1.0 — 2026-09-01 — The OASF record (V6c): the third projection of the same agent.
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V6a).
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { jsonRpcHandler, agentCardHandler } from '@a2a-js/sdk/server/express';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentRecord } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { error } from '../middleware/envelope.js';
import { buildGAII } from '../utils/gaii.js';
import { a2aCardFor } from '../services/a2a-card.js';
import { oasfRecordFor } from '../services/oasf-projection.js';
import { AimeatA2ARequestHandler } from '../services/a2a-handler.js';
import type { A2ACaller } from '../services/a2a-handler.js';

/** The address this node publishes for one agent's A2A interface. */
function interfaceUrl(config: AimeatConfig, owner: string, agentName: string): string {
  const base = config.baseUrl.replace(/\/+$/, '');
  return `${base}/v1/a2a/${encodeURIComponent(owner)}/${encodeURIComponent(agentName)}`;
}

export function a2aRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /** The named agent, or null. Both doors resolve it the same way, from the path. */
  async function findAgent(req: Request): Promise<AgentRecord | null> {
    const owner = req.params.owner as string;
    const name = req.params.agent as string;
    if (!owner || !name) return null;
    return storage.getAgent(buildGAII(name, owner, config.nodeId));
  }

  // ── The card. Public, like the AIMEAT card it is a second view of. ──
  //
  // MOUNTED WITH use(), NOT get(). Both SDK handlers are routers whose own path is `/`, so they
  // only ever see a request Express has already stripped the prefix from. Calling one from inside a
  // `router.get(fullPath)` hands it the full path, its inner route does not match, it calls next(),
  // and the request lands on the node's terminal 404 as "Route not found" — which is what happened,
  // and which reads like the route was never registered at all.
  router.use('/v1/a2a/:owner/:agent/agent-card.json', async (req, res, next) => {
    const agent = await findAgent(req);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No agent of that name on this node.'));
      return;
    }
    const card = a2aCardFor(config, agent, interfaceUrl(config, agent.owner, agent.name));
    // The SDK's handler owns the ETag, Cache-Control and 304, which is the part of serving a card
    // that is easy to get subtly wrong.
    return agentCardHandler({ agentCardProvider: async () => card })(req, res, next);
  });

  // ── The OASF record. The same agent again, for a directory that indexes agents rather than
  //    talking to them. Public for the same reason the card is: this is discovery, and it says
  //    nothing the two cards beside it do not. Not part of the A2A protocol — it lives here
  //    because it is the third projection of one record, and keeping the three together is what
  //    stops a fourth from being written somewhere else.
  router.get('/v1/oasf/:owner/:agent', async (req, res) => {
    const agent = await findAgent(req);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No agent of that name on this node.'));
      return;
    }
    const base = config.baseUrl.replace(/\/+$/, '');
    const a2a = interfaceUrl(config, agent.owner, agent.name);
    res.json(oasfRecordFor(config, agent, {
      a2a,
      a2aCard: `${a2a}/agent-card.json`,
      card: `${base}/v1/agents/${encodeURIComponent(agent.gaii)}/card`,
    }));
  });

  // ── The JSON-RPC surface. Authenticated, and fenced to the agent's own account. ──
  router.use('/v1/a2a/:owner/:agent', requireAuth(), async (req: Request, res: Response, next: NextFunction) => {
    const agent = await findAgent(req);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No agent of that name on this node.'));
      return;
    }
    // The same fence V4 and V5 apply, applied before the SDK sees the request: this road carries
    // work between principals of ONE account.
    if (agent.owner !== req.auth!.owner) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED',
        'This A2A interface answers to principals of the agent\'s own account.'));
      return;
    }

    // The scopes travel with the caller because the gate is per JSON-RPC METHOD, not per HTTP
    // door: one requireScope() here would have to name one word and be wrong for every other
    // method behind it. The handler asks the same question requireScope asks, method by method.
    const caller: A2ACaller = {
      sub: req.auth!.sub, owner: req.auth!.owner,
      roles: req.auth!.roles ?? [], scopes: req.auth!.scopes ?? [],
    };
    const card = a2aCardFor(config, agent, interfaceUrl(config, agent.owner, agent.name));
    const handler = new AimeatA2ARequestHandler(storage, config, agent, caller, card);

    return jsonRpcHandler({
      requestHandler: handler,
      // A2A 1.0 is what this node answers, and 0.3 is what nearly every client sends today. The
      // SDK translates the older shape into the newer one and hands the same handler the result,
      // so there is one implementation behind both and the card declares both interfaces.
      legacyCompat: { enabled: true },
      // The request is already authenticated by requireAuth above; this hands the SDK the identity
      // it wants for its own context object. It is never the thing that decides access.
      userBuilder: async () => ({ isAuthenticated: true, userName: req.auth!.sub }),
    })(req, res, next);
  });

  return router;
}
