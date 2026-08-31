/**
 * @file src/routes/agents-v2/card.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an Agent v2 identity publishes about itself, in two documents with two authors.
 *
 *     GET /v1/agents/:gaii/card           — PUBLIC. The node's signed projection. No auth.
 *     GET /v1/agents/:gaii/card/extended  — the agent's own signed card, verbatim. Same owner only.
 *     GET /v1/agents/:gaii/jwks.json      — PUBLIC. The agent's key, which verifies the extended card.
 *     GET /v1/agents/:gaii/card/info      — the same split, as JSON, for a surface that renders it.
 *
 *   WHY TWO DOCUMENTS AND NOT ONE ENDPOINT THAT VARIES. The obvious design is one address that
 *   returns more to an authenticated reader, and it is a cache accident waiting to happen: anything
 *   in front of this node that keys on the URL will eventually hand an anonymous reader a response
 *   built for an owner. Two addresses cannot make that mistake, `/card` is cacheable by anyone, and
 *   this is also the shape A2A settled on (a public card plus an authenticated extended card).
 *
 *   WHY TWO SIGNERS. The stored `cardJws` is the agent's signature over the FULL card, and the agent
 *   is not present when a stranger reads the public one, so it cannot sign a subset on demand. The
 *   extended card is therefore served as the exact bytes that were verified at enrolment, and the
 *   public card is a projection the node signs with its own key — the one `/.well-known/aimeat`
 *   publishes. The two `kid`s are different keys saying different things, and that is correct: the
 *   agent's signature proves possession, the node's says "this agent exists here, with this key".
 *
 *   WHO SEES THE EXTENDED CARD. The owner in person, and any principal acting in that owner's name.
 *   Here `req.auth.owner` IS the right test — the question is "is this the same PERSON's side of the
 *   fence", not "which principal class is calling" — with federated sessions refused, because their
 *   `owner` claim is a remote node's name judged by a different node.
 *
 *   THE PATH TAKES A GAII, url-encoded. A bare agent name is ambiguous across owners on a shared
 *   node, and a public endpoint that guesses which `concierge` you meant is a public endpoint that
 *   sometimes hands out the wrong person's agent. Nobody has to build the string by hand: the card
 *   carries its own `cardUri` and `jwksUri`.
 *
 * @structure cardUri / jwksUri / nodeKeyUri · registerAgentCardRoutes(router, config, storage)
 * @usage registerAgentCardRoutes(router, config, storage);
 * @version-history
 *   v1.1.0 — 2026-08-31 — The public/extended split (spec chapter 4). `/card` becomes the node-signed
 *     public projection and `/card/extended` carries the agent's own bytes; `/card/info` answers with
 *     whichever half the reader is entitled to and says which it gave them. `requestedScopes`, the
 *     description and the webhook stop being world-readable.
 *   v1.0.0 — 2026-08-31 — Initial (Agent v2, V1).
 */
import type { Router, Request } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, AgentRecord } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { isValidGAII } from '../../utils/gaii.js';
import {
  readCardJws, publicCardProjection, signWithNodeKey, jwkThumbprint, base64KeyToJwkX,
  type PublicAgentCard,
} from '../../services/agent-card.js';
import { getNodeCryptoKeys } from '../../auth/jwt.js';
import type { AgentCard } from '../../models/agent-card.js';
import { logger } from '../../utils/logger.js';

/** Where this node serves an agent's card and key set. Used by the routes and by the enrolment offer. */
export function cardUri(baseUrl: string, gaii: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/v1/agents/${encodeURIComponent(gaii)}/card`;
}
export function jwksUri(baseUrl: string, gaii: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/v1/agents/${encodeURIComponent(gaii)}/jwks.json`;
}
/** Where the key that signs the PUBLIC projection is published. Already served, not a new endpoint. */
export function nodeKeyUri(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/.well-known/aimeat`;
}

/**
 * Is this reader on the same side of the fence as the agent's owner?
 *
 * `req.auth.owner` carries the human's account name on every principal that acts for them, which is
 * exactly the question here. Federated sessions are refused: their `owner` is a remote node's name,
 * and a name that means one person here and another somewhere else is not an answer.
 */
function isSameOwnerReader(req: Request, agent: AgentRecord): boolean {
  const auth = req.auth;
  if (!auth || auth.anonymous || auth.federated) return false;
  return auth.owner === agent.owner;
}

export function registerAgentCardRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  /** Resolve `:gaii` to a carded agent, answering the caller when it cannot. */
  async function loadCarded(req: Request, res: Parameters<Parameters<Router['get']>[1]>[1]): Promise<{ gaii: string; agent: AgentRecord; card: AgentCard } | null> {
    const gaii = decodeURIComponent(req.params.gaii as string);
    if (!isValidGAII(gaii)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'The path must be a full agent identity (agent#owner@node), url-encoded.'));
      return null;
    }
    const agent = await storage.getAgent(gaii);
    // One answer for "no such agent" and "that agent has no card": a public endpoint that
    // distinguishes them tells an unauthenticated caller which names exist.
    if (!agent || !agent.cardJws) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No published card for that agent.'));
      return null;
    }
    const read = readCardJws(agent.cardJws);
    if (!read.ok || !read.card) {
      res.status(500).json(error(config.nodeId, 'CARD_UNREADABLE', 'The stored card cannot be read.'));
      return null;
    }
    return { gaii, agent, card: read.card };
  }

  /**
   * The projection plus, when the node can sign, its signature. The fallback is deliberate and
   * narrow: if the node's keys are not usable from here the document is still true and still worth
   * serving, so it goes out unsigned rather than 500-ing, and the caller can tell which it got
   * because one is a JWS and the other is JSON.
   */
  async function projectionOf(card: AgentCard): Promise<{ projection: PublicAgentCard; jws: string | null }> {
    const projection = publicCardProjection(card, nodeKeyUri(config.baseUrl));
    try {
      const { privateKey } = getNodeCryptoKeys();
      const nodeKey = await storage.getNodeKey();
      if (!nodeKey?.publicKey) return { projection, jws: null };
      const kid = await jwkThumbprint(base64KeyToJwkX(nodeKey.publicKey));
      return { projection, jws: await signWithNodeKey(projection, privateKey, kid) };
    } catch (err) {
      // Not silent: an unsigned public card is a weaker document than the one this node promises,
      // and an operator has to be able to find out that it is serving them.
      logger.warn('Public agent card served unsigned: the node key was not usable', { error: String(err) });
      return { projection, jws: null };
    }
  }

  // ── GET /v1/agents/:gaii/card — the PUBLIC card ──
  router.get('/v1/agents/:gaii/card', async (req, res) => {
    const found = await loadCarded(req, res);
    if (!found) return;
    const { projection, jws } = await projectionOf(found.card);
    if (jws) { res.type('application/jose').send(jws); return; }
    res.json(projection);
  });

  // ── GET /v1/agents/:gaii/card/extended — the agent's OWN card, verbatim ──
  router.get('/v1/agents/:gaii/card/extended', async (req, res) => {
    const found = await loadCarded(req, res);
    if (!found) return;
    if (!isSameOwnerReader(req, found.agent)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED',
        'The full card is for this agent\'s own account. Read the public card instead, at the address without /extended.'));
      return;
    }
    // The exact bytes that were verified at enrolment. A signature is over bytes, so re-serialising
    // a parse of the payload would produce a document with the same meaning and a broken signature.
    res.set('Cache-Control', 'no-store');
    res.type('application/jose').send(found.agent.cardJws);
  });

  // ── GET /v1/agents/:gaii/jwks.json — the key that verifies the EXTENDED card ──
  router.get('/v1/agents/:gaii/jwks.json', async (req, res) => {
    const found = await loadCarded(req, res);
    if (!found) return;
    // The key is republished from the PINNED card rather than rebuilt from AgentRecord.publicKey,
    // for one reason: the card is what a verifier checks, so the key set has to be the one that
    // verifies it. Reading the two from two sources is how they come to disagree.
    const { kty, crv, x, kid } = found.card.publicKey;
    res.json({ keys: [{ kty, crv, x, kid, use: 'sig', alg: 'EdDSA' }] });
  });

  // ── GET /v1/agents/:gaii/card/info — the same split, as JSON ──
  // A convenience for rendering. Anything DECIDING whether to trust the agent reads a JWS and a key
  // set. `extended` says which half the reader was given, so a surface never has to guess whether a
  // missing field is absent or withheld.
  router.get('/v1/agents/:gaii/card/info', async (req, res) => {
    const found = await loadCarded(req, res);
    if (!found) return;
    const extended = isSameOwnerReader(req, found.agent);
    const card = extended ? found.card : (await projectionOf(found.card)).projection;
    if (extended) res.set('Cache-Control', 'no-store');
    res.json(success(config.nodeId, {
      extended,
      card,
      card_url: cardUri(config.baseUrl, found.gaii),
      extended_card_url: `${cardUri(config.baseUrl, found.gaii)}/extended`,
      jwks_url: jwksUri(config.baseUrl, found.gaii),
      node_key_url: nodeKeyUri(config.baseUrl),
      enrolled_at: extended ? (found.agent.enrolledAt ?? null) : undefined,
    }, [
      { description: 'The public card, signed by this node', method: 'GET', url: `/v1/agents/${encodeURIComponent(found.gaii)}/card` },
      { description: 'The key that verifies the agent\'s own card', method: 'GET', url: `/v1/agents/${encodeURIComponent(found.gaii)}/jwks.json` },
    ]));
  });
}
