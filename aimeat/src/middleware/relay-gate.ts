/**
 * @file src/middleware/relay-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The receiving half of relay control: can a node refuse a relay it does not want?
 *
 *   Until now it could not. `allowRouting` is read on the SENDER, when it decides whether to forward
 *   — so an operator who demoted a peer to stop it relaying achieved nothing, and Stage B measured
 *   exactly that on 2026-09-02. Both directions are enforced now and neither replaced the other:
 *   the sender still decides what IT relays outward, and this decides what arrives.
 *
 *   IT IS GLOBAL BECAUSE A RELAY TARGETS ANY PATH. `POST /v1/federation/route` on the relaying node
 *   turns into an ordinary HTTP call to any endpoint on the receiver, so there is no one route to
 *   put this on. It runs before every route and after the rate limiter, which is deliberate: a
 *   signature verification is work, and work done before the rate limiter is work an unlimited
 *   caller can spend for you.
 *
 *   WHAT IT DOES NOT DO. It does not authenticate the request. A relayed call still carries whatever
 *   credentials it carried, and every route's own auth still runs. This answers one question only:
 *   is this node willing to be relayed to by that peer.
 *
 *   THE MISSING-CLAIM CASE IS A SETTING, AND THE SETTING'S OWN WORDS SAY WHAT IT IS WORTH.
 *   `optional` (the shipped default) lets a request through when it carries no claim at all, because
 *   a peer running older software sends none and refusing would break the relay the day this node
 *   updates. That is a migration position and not protection: a peer that does not want to be
 *   refused can simply omit the header. `required` is the protection. Between them sits the one
 *   thing `optional` CAN promise honestly — a peer that has ever presented a valid claim is
 *   remembered as able to sign one, and an unclaimed relay from that peer is refused from then on.
 *   So the downgrade is closed for every peer that has updated, and only genuinely old peers pass.
 * @structure relayGate(config, storage, peers) -> express.RequestHandler
 * @usage app.use(relayGate(config, storage, services.peers));
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial (wish-vastaanottaja-voi-kieltaytya-relaysta).
 */
import type { RequestHandler } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { error } from './envelope.js';
import { logger } from '../utils/logger.js';
import {
  RELAY_HEADERS, claimsToBeRelayed, hasRelayClaim, verifyRelayClaim,
} from '../services/relay-claim.js';

/**
 * Refuse, accept, or decide by policy — for every inbound request that says it was relayed.
 *
 * A request carrying neither header is not a relay and is not this gate's business; it is passed on
 * untouched, which is nearly all traffic and costs one property read.
 */
export function relayGate(
  config: AimeatConfig,
  storage: Storage,
  peers: Map<string, PeerInfo>,
): RequestHandler {
  return (req, res, next) => {
    // Read per request, not once at construction: `federation.relay_claim` is a MUTABLE setting, and
    // PUT /v1/admin/config writes it straight into this object. An operator who turns the gate up
    // means now, not after the next restart.
    const required = config.federationRelayClaim === 'required';
    const headers = req.headers as Record<string, string | string[] | undefined>;
    const claimed = hasRelayClaim(headers);
    if (!claimed && !claimsToBeRelayed(headers)) { next(); return; }

    // ── A relay with no proof ──
    if (!claimed) {
      const from = req.headers[RELAY_HEADERS.forwardedFrom];
      const fromNode = (Array.isArray(from) ? from[0] : from) ?? '';
      // The name is unauthenticated, so it decides nothing on its own. It is used for exactly two
      // things: telling the operator who still has to update, and looking up whether that peer has
      // ALREADY proved it can sign — which it cannot have faked, because the pin was written from a
      // verified claim.
      const knownSigner = [...peers.values()].some(p => p.nodeId === fromNode && !!p.relayClaimAt);
      if (required || knownSigner) {
        logger.warn('relay: refused a relayed request that carried no claim', {
          from: fromNode || '(unnamed)', path: req.originalUrl, mode: config.federationRelayClaim, knownSigner,
        });
        res.status(403).json(error(config.nodeId, 'RELAY_CLAIM_REQUIRED',
          knownSigner && !required
            ? `${fromNode} has relayed to this node with a signed claim before, so a relayed request from it without one is refused. This is about the link between our two nodes, not about the caller you are relaying for.`
            : `This node accepts relayed requests only with a signed relay claim in ${RELAY_HEADERS.claim} and ${RELAY_HEADERS.signature}. This is about the link between our two nodes, not about the caller you are relaying for.`));
        return;
      }
      // Let through, and say so once per request, so an operator can see who still needs to update
      // before they turn the setting up.
      logger.warn('relay: a relayed request carried no claim and was allowed by policy', {
        from: fromNode || '(unnamed)', path: req.originalUrl, setting: 'federation.relay_claim=optional',
      });
      next();
      return;
    }

    // ── A relay with a claim: it is checked, whatever the setting says ──
    //
    // `optional` never means "unchecked". A claim that is present and wrong is a refusal in both
    // modes: the caller is telling us who it is, and a node that shrugged at a bad proof would be
    // teaching relays that signing badly is as good as signing.
    void (async () => {
      try {
        const check = await verifyRelayClaim({ storage, config, peers }, headers, req.method, req.originalUrl);
        if (!check.ok) {
          logger.warn('relay: refused a relayed request', { code: check.code, path: req.originalUrl });
          res.status(check.status).json(error(config.nodeId, check.code, check.message));
          return;
        }
        // Remember that this peer can sign, once. Fire and forget: measuring a peer's capability
        // must never fail the request it was measured on, and the next valid claim writes it again
        // if this one did not land.
        if (!check.peer.relayClaimAt) {
          check.peer.relayClaimAt = new Date().toISOString();
          storage.saveFederationPeer(check.peer).catch(err => {
            logger.warn('relay: could not record that a peer signs relay claims', { peer: check.peer.nodeId, error: String(err) });
          });
        }
        next();
      } catch (err) {
        // A gate that throws must refuse, not fall open. This is the one path where "something went
        // wrong" and "the caller is allowed" would otherwise be the same outcome.
        logger.warn('relay: the claim check failed unexpectedly', { path: req.originalUrl, error: String(err) });
        res.status(403).json(error(config.nodeId, 'RELAY_CLAIM_INVALID',
          'That relay claim could not be checked, so it was not accepted.'));
      }
    })();
  };
}
