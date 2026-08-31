/**
 * @file src/routes/agents-v2/card.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two PUBLIC documents an Agent v2 identity is made of: the agent's signed card and
 *   the key set that verifies it.
 *
 *     GET /v1/agents/:gaii/card       — the card, as the exact compact JWS that was verified
 *     GET /v1/agents/:gaii/jwks.json  — the agent's Ed25519 verification key, as a JWKS
 *
 *   BOTH ARE UNAUTHENTICATED, and that is the feature. A card whose authenticity can only be
 *   established by asking this node is a card only this node can use; fetching these two documents
 *   and verifying one against the other is the whole check, and another owner's node can do it
 *   without a bilateral arrangement with us. That is why the signature is on the card rather than on
 *   the response.
 *
 *   WHAT IS IN THEM. Only what an agent publishes about itself: name, owner, runtime, run mode,
 *   skills, modalities, the scopes it ASKED for, and its public key. Not what it was granted, not
 *   its trust score, not its tasks. The distinction is deliberate — the card is the public,
 *   discoverable half, and the authenticated extended card that carries more is V2 work.
 *
 *   THE PATH TAKES A GAII, url-encoded. A bare agent name is ambiguous across owners on a shared
 *   node, and a public endpoint that guesses which `concierge` you meant is a public endpoint that
 *   sometimes hands out the wrong person's agent. Nobody has to build the string by hand: the card
 *   carries its own `cardUri` and `jwksUri`.
 *
 * @structure registerAgentCardRoutes(router, config, storage)
 * @usage registerAgentCardRoutes(router, config, storage);
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial (Agent v2, V1).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { isValidGAII } from '../../utils/gaii.js';
import { readCardJws } from '../../services/agent-card.js';

/** Where this node serves an agent's card and key set. Used by the routes and by the enrolment offer. */
export function cardUri(baseUrl: string, gaii: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/v1/agents/${encodeURIComponent(gaii)}/card`;
}
export function jwksUri(baseUrl: string, gaii: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/v1/agents/${encodeURIComponent(gaii)}/jwks.json`;
}

export function registerAgentCardRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  // ── GET /v1/agents/:gaii/card — the agent's own signed card ──
  router.get('/v1/agents/:gaii/card', async (req, res) => {
    const gaii = decodeURIComponent(req.params.gaii as string);
    if (!isValidGAII(gaii)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'The path must be a full agent identity (agent#owner@node), url-encoded.'));
      return;
    }
    const agent = await storage.getAgent(gaii);
    // One answer for "no such agent" and "that agent has no card": a public endpoint that
    // distinguishes them tells an unauthenticated caller which names exist.
    if (!agent || !agent.cardJws) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No published card for that agent.'));
      return;
    }
    // The exact bytes that were verified at enrolment. A signature is over bytes, so re-serialising
    // a parse of the payload would produce a document with the same meaning and a broken signature.
    res.type('application/jose').send(agent.cardJws);
  });

  // ── GET /v1/agents/:gaii/jwks.json — the key that verifies the card ──
  router.get('/v1/agents/:gaii/jwks.json', async (req, res) => {
    const gaii = decodeURIComponent(req.params.gaii as string);
    if (!isValidGAII(gaii)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'The path must be a full agent identity (agent#owner@node), url-encoded.'));
      return;
    }
    const agent = await storage.getAgent(gaii);
    if (!agent || !agent.cardJws) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No published key set for that agent.'));
      return;
    }
    // The key is republished from the PINNED card rather than rebuilt from AgentRecord.publicKey,
    // for one reason: the card is what a verifier checks, so the key set has to be the one that
    // verifies it. Reading the two from two sources is how they come to disagree.
    const read = readCardJws(agent.cardJws);
    if (!read.ok || !read.card) {
      res.status(500).json(error(config.nodeId, 'CARD_UNREADABLE', 'The stored card cannot be read.'));
      return;
    }
    const { kty, crv, x, kid } = read.card.publicKey;
    res.json({ keys: [{ kty, crv, x, kid, use: 'sig', alg: 'EdDSA' }] });
  });

  // ── GET /v1/agents/:gaii/card/info — the card as JSON, for a surface that will not verify it ──
  // Separate from the card itself on purpose: this one is a convenience for our own UI, the JWS is
  // the artifact. Anything deciding whether to TRUST the agent reads the JWS and the JWKS.
  router.get('/v1/agents/:gaii/card/info', async (req, res) => {
    const gaii = decodeURIComponent(req.params.gaii as string);
    if (!isValidGAII(gaii)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'The path must be a full agent identity (agent#owner@node), url-encoded.'));
      return;
    }
    const agent = await storage.getAgent(gaii);
    if (!agent || !agent.cardJws) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No published card for that agent.'));
      return;
    }
    const read = readCardJws(agent.cardJws);
    if (!read.ok || !read.card) {
      res.status(500).json(error(config.nodeId, 'CARD_UNREADABLE', 'The stored card cannot be read.'));
      return;
    }
    res.json(success(config.nodeId, {
      card: read.card,
      card_url: cardUri(config.baseUrl, gaii),
      jwks_url: jwksUri(config.baseUrl, gaii),
      enrolled_at: agent.enrolledAt ?? null,
    }, [
      { description: 'The signed card', method: 'GET', url: `/v1/agents/${encodeURIComponent(gaii)}/card` },
      { description: 'The key that verifies it', method: 'GET', url: `/v1/agents/${encodeURIComponent(gaii)}/jwks.json` },
    ]));
  });
}
