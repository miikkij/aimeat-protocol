/**
 * @file src/routes/a2a.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The A2A door: one of this node's agents, reachable by an Agent2Agent client.
 *
 *     GET  /v1/a2a/:owner/:agent/agent-card.json   what the agent is, in A2A's words
 *     POST /v1/a2a/:owner/:agent                   the JSON-RPC surface
 *     GET  /v1/oasf/:owner/:agent                  the same agent, as an OASF record (V6c)
 *     GET  /.well-known/agent-card.json            the node's directory, as an A2A card
 *     POST /v1/a2a/directory                       the directory's JSON-RPC interface (public)
 *
 *   THE CARD IS PUBLIC AND THE DOOR IS NOT. Discovery has to be public or it is not discovery, and
 *   the card says nothing the AIMEAT card at /v1/agents/:gaii/card does not already say to anyone
 *   who asks. Everything behind it takes a credential, which the card declares so a client knows
 *   before it tries.
 *
 *   THREE KINDS OF CALLER, AND EACH REACHES A DIFFERENT SURFACE.
 *
 *     nobody          the card, and nothing else
 *     this account    the agent's own surface — V4 turns, V5 tasks, the same fence those apply
 *     a stranger      what the owner has PUBLISHED for hire, paid for, and nothing else
 *
 *   THE THIRD ONE IS NOT AN EXTENSION OF THE SECOND. It is a separate handler over a separate
 *   store, because "which caller am I" is exactly the question a fence answers, and a fence made of
 *   `if (foreign)` branches inside methods is a fence with holes in it. A stranger never reaches
 *   `AimeatA2ARequestHandler`, so no capability, tool or task of this account is one bug away.
 *
 *   PUBLISHING THE OFFERING IS THE CONSENT. There is no approval screen on the stranger's road and
 *   no new permission word: listing agent work on the EXCHANGE already means "I will do this for
 *   others, on these terms, at this price", and that listing is the whole of what a stranger may
 *   ask for. Its price is settled through x402 before the work starts.
 *
 *   THE AGENT'S IDENTIFIER IS PUBLIC. The address `/v1/a2a/:owner/:agent` on this node names the
 *   owner and the agent, so the GAII (`agent#owner@node`) can be derived from it, and the directory
 *   lists it. What a stranger does not get is anything the identifier would open: it holds a work id
 *   and reads an offering, and every account surface stays behind the bearer road (feature-list
 *   audit #83 corrected the earlier claim that a stranger never learns a GAII).
 *
 *   WHY THE SDK IS HERE AT ALL. It owns the JSON-RPC framing, the method names, the error codes and
 *   the protobuf serialisation — the parts where being subtly wrong means a client fails in a way
 *   neither side can debug. It owns none of the behaviour: `AimeatA2ARequestHandler` lands every
 *   method in the same ops functions the REST and MCP doors call.
 *
 * @structure a2aRouter(config, storage)
 * @usage app.use(a2aRouter(config, storage));
 * @version-history
 *   2026-10-27 — The directory card and its new JSON-RPC interface live in services/a2a-directory.ts;
 *     the card names the interface instead of an empty list and drops the 0.3 top-level `url`.
 *   2026-10-19 — Every A2A card this router builds carries `iconUrl`, the absolute address of the
 *     agent's avatar, when it has one (services/agent-avatar.ts). The directory rows have no picture
 *     field and stay as they are.
 *   2026-10-15 — The header and the directory comment say the agent's identifier is public (derivable
 *     from the card's address); they said a stranger never learns a GAII (feature-list audit #83).
 *   v1.4.0 — 2026-10-06 — The account road builds its caller with callerOf (middleware/caller.ts), so
 *     the caller carries `federated` and a visitor is refused by name as well as by the owner
 *     comparison (secaudit 2026-10 follow-up, A3; no defect was found: verifyJWT names a visitor by
 *     its home GHII, and e2e-federated-namesake already proved the 403).
 *   v1.3.0 — 2026-09-04 — The node directory at `/.well-known/agent-card.json` validates as an A2A
 *     Agent Card. It carried only a registry, so a client that checks the schema before reading the
 *     document got nothing — a validator named all six missing fields. They are present now and
 *     every one is true of a directory: no interface of its own, nothing streamed, JSON in and out,
 *     and one skill which is saying where the real cards are. The `agents` array is unchanged.
 *   v1.2.0 — 2026-09-01 — A stranger can hire this agent: a verified foreign card reaches a
 *     published offering, pays for it with x402 and reads the result, over a separate handler.
 *   v1.1.0 — 2026-09-01 — The OASF record (V6c): the third projection of the same agent.
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V6a).
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { jsonRpcHandler, agentCardHandler } from '@a2a-js/sdk/server/express';
import { UnauthenticatedUser } from '@a2a-js/sdk/server';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentRecord } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { error } from '../middleware/envelope.js';
import { callerOf } from '../middleware/caller.js';
import { buildGAII } from '../utils/gaii.js';
import { a2aCardFor } from '../services/a2a-card.js';
import { agentInterfaceUrl, directoryAgents, directoryCard, DirectoryA2AHandler } from '../services/a2a-directory.js';
import { oasfRecordFor } from '../services/oasf-projection.js';
import { AimeatA2ARequestHandler } from '../services/a2a-handler.js';
import type { A2ACaller } from '../services/a2a-handler.js';
import { ForeignA2AHandler } from '../services/a2a-foreign-handler.js';
import { identifyForeignCaller, FOREIGN_HEADERS } from '../services/a2a-foreign.js';
import { offeringsForAgent } from '../services/a2a-offering.js';
import { readAvatarsOrEmpty } from '../services/agent-avatar.js';
import { logger } from '../utils/logger.js';


export function a2aRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /** The named agent, or null. Both doors resolve it the same way, from the path. */
  async function findAgent(req: Request): Promise<AgentRecord | null> {
    const owner = req.params.owner as string;
    const name = req.params.agent as string;
    if (!owner || !name) return null;
    return storage.getAgent(buildGAII(name, owner, config.nodeId));
  }

  /** The absolute address of the agent's avatar for the card's `iconUrl`, or undefined when it has none. */
  async function iconUrlFor(agent: AgentRecord): Promise<string | undefined> {
    const avatar = (await readAvatarsOrEmpty(storage, [agent.gaii], logger.warn.bind(logger), 'A2A agent card')).get(agent.gaii);
    return avatar ? `${config.baseUrl.replace(/\/+$/, '')}${avatar.url}` : undefined;
  }

  // ── The card. Public, like the AIMEAT card it is a second view of. ──
  //
  // MOUNTED WITH use(), NOT get(). Both SDK handlers are routers whose own path is `/`, so they
  // only ever see a request Express has already stripped the prefix from. Calling one from inside a
  // `router.get(fullPath)` hands it the full path, its inner route does not match, it calls next(),
  // and the request lands on the node's terminal 404 as "Route not found" — which is what happened,
  // and which reads like the route was never registered at all.
  /**
   * GET /.well-known/agent-card.json — A2A's standard front door, at the NODE root.
   *
   * WHY IT HAS TO EXIST. The per-agent cards live at `/v1/a2a/:owner/:agent/agent-card.json`, which
   * a stranger finds only if somebody hands them the URL. A foreign agent that arrives knowing
   * nothing but the hostname could not ask this node who it has, so discovery did not work at all —
   * the standard location answered 404.
   *
   * BOTH ADDRESSES STAY. The per-agent path is unchanged and is still the card's real home; this
   * one is a directory that points at them.
   *
   * WHAT IT LISTS, AND WHY THAT IS NOT A FILTER. Only agents with a PUBLISHED OFFERING. That is
   * already this node's consent model for strangers — a foreign caller may reach an agent because
   * its owner published an offering, and nothing else opens that door — so the listing obeys the
   * same sentence rather than inventing a second one. An agent with no offering is not hidden; it
   * is not for sale.
   *
   * PUBLIC, like the cards it points at, and it says nothing they do not.
   */
  router.get(['/.well-known/agent-card.json', '/v1/a2a/directory/agent-card.json'], async (_req, res) => {
    // A DIRECTORY THAT IS A CARD, because this path is A2A's and A2A says a card lives here. Every
    // required field is true of a directory, and since 2026-10-27 it names an interface that
    // answers: /v1/a2a/directory, where any message gets the same `agents` list back
    // (services/a2a-directory.ts says why the empty interface list went).
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json(directoryCard(config, await directoryAgents(config, storage)));
  });

  // The directory's JSON-RPC interface. Public, like the card: it answers what the card already
  // says and keeps nothing. Registered before the per-agent routes, which it cannot be mistaken for
  // (one path segment after /v1/a2a, where an agent's address has two).
  router.use('/v1/a2a/directory', async (req, res, next) => {
    const card = directoryCard(config, await directoryAgents(config, storage));
    return jsonRpcHandler({
      requestHandler: new DirectoryA2AHandler(config, storage, card),
      legacyCompat: { enabled: true },
      userBuilder: async () => new UnauthenticatedUser(),
    })(req, res, next);
  });

  router.use('/v1/a2a/:owner/:agent/agent-card.json', async (req, res, next) => {
    const agent = await findAgent(req);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No agent of that name on this node.'));
      return;
    }
    const offerings = await offeringsForAgent(storage, agent);
    const card = a2aCardFor(config, agent, agentInterfaceUrl(config, agent.owner, agent.name), { offerings, iconUrl: await iconUrlFor(agent) });
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
    const a2a = agentInterfaceUrl(config, agent.owner, agent.name);
    res.json(oasfRecordFor(config, agent, {
      a2a,
      a2aCard: `${a2a}/agent-card.json`,
      card: `${base}/v1/agents/${encodeURIComponent(agent.gaii)}/card`,
    }));
  });

  const auth = requireAuth();

  /** Hand the request to the SDK, whichever handler is behind it. Framing is the SDK's job. */
  function serveRpc(handler: AimeatA2ARequestHandler | ForeignA2AHandler, userName: string) {
    return jsonRpcHandler({
      requestHandler: handler,
      // A2A 1.0 is what this node answers, and 0.3 is what nearly every client sends today. The
      // SDK translates the older shape into the newer one and hands the same handler the result,
      // so there is one implementation behind both and the card declares both interfaces.
      legacyCompat: { enabled: true },
      // The caller was identified before this point — by requireAuth, or by a verified card and a
      // fresh assertion. This only hands the SDK the identity it wants for its own context object.
      // It is never the thing that decides access.
      userBuilder: async () => ({ isAuthenticated: true, userName }),
    });
  }

  // ── The JSON-RPC surface. Two roads in, chosen by which credential the caller brought. ──
  //
  // AN AUTHORIZATION HEADER MEANS THE ACCOUNT ROAD, its absence plus a signed card means the
  // stranger's road, and neither means 401 naming both. Deciding on the presence of a bearer rather
  // than on which headers look interesting is what keeps the choice unambiguous: a principal of
  // this account cannot be quietly downgraded to a buyer by an extra header, and a stranger cannot
  // reach the account road by sending one.
  router.use('/v1/a2a/:owner/:agent', async (req: Request, res: Response, next: NextFunction) => {
    const agent = await findAgent(req);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No agent of that name on this node.'));
      return;
    }
    const url = agentInterfaceUrl(config, agent.owner, agent.name);

    if (req.headers.authorization) {
      return auth(req, res, async () => {
        // The same fence V4 and V5 apply, applied before the SDK sees the request: this road
        // carries work between principals of ONE account. A visitor from another node is named by
        // its home GHII, so it never equals the local owner name; it is refused by name as well.
        const who = callerOf(req, config.nodeId, storage);
        if (who.visitor || agent.owner !== who.owner) {
          res.status(403).json(error(config.nodeId, 'ACCESS_DENIED',
            'This A2A interface answers to principals of the agent\'s own account. To hire it from outside, drop the bearer and present your own signed agent card.'));
          return;
        }
        // The scopes travel with the caller because the gate is per JSON-RPC METHOD, not per HTTP
        // door: one requireScope() here would have to name one word and be wrong for every other
        // method behind it. The handler asks the same question requireScope asks, method by method.
        const caller: A2ACaller = who.auth;
        const offerings = await offeringsForAgent(storage, agent);
        const card = a2aCardFor(config, agent, url, { offerings, iconUrl: await iconUrlFor(agent) });
        return serveRpc(new AimeatA2ARequestHandler(storage, config, agent, caller, card), req.auth!.sub)(req, res, next);
      });
    }

    if (!req.headers[FOREIGN_HEADERS.card]) {
      // Two ways in, so the refusal names both. The header names go in `details`, where a program
      // looks for them, rather than into a sentence a person has to read past.
      res.status(401).json(error(config.nodeId, 'UNAUTHORIZED',
        'Sign in as this account to use this agent, or send your own signed agent card to hire it.',
        401, { use_it: 'Authorization: Bearer', hire_it: [FOREIGN_HEADERS.card, FOREIGN_HEADERS.assertion] }));
      return;
    }

    const who = await identifyForeignCaller(config, storage, req.headers);
    if (!who.ok) {
      res.status(who.status).json(error(config.nodeId, who.code, who.message));
      return;
    }
    const offerings = await offeringsForAgent(storage, agent);
    const card = a2aCardFor(config, agent, url, { offerings, iconUrl: await iconUrlFor(agent) });
    const handler = new ForeignA2AHandler(storage, config, agent, who.peer, card, {
      header: req.header('X-PAYMENT') ?? undefined,
    });
    return serveRpc(handler, who.peer.gaii)(req, res, next);
  });

  return router;
}
