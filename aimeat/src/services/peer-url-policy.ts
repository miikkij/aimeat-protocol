/**
 * @file src/services/peer-url-policy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which peer addresses a node takes: on a public node only HTTPS, on a local node HTTP
 *   as well (Core 2026-11 FED-13; ruling decision-core-2026-11-avoimet-kysymykset-ja-agenttien-automaattinen-l
 *   Q16: "a public node refuses a non-HTTPS peer, a local node may use HTTP").
 *
 *   Every message between nodes carries signatures, but a plain-HTTP link still shows its content to
 *   anyone on the path, and a federated sign-in sends a password over it. A node on the public
 *   internet therefore takes only an `https:` peer address from PEER_HTTPS_REQUIRED_IN (4.0.0),
 *   whatever is configured. Before that release a plain-HTTP address on a public node is still taken,
 *   counted and named on the response (services/deprecation.ts). A local node (a development or a
 *   personal node, `securityProfile: 'local'`) keeps plain HTTP, so two development nodes can peer.
 *
 *   Asked where an address enters: an introduction, a peering request, the readiness test, an
 *   operator adding or editing a peer, a re-admission, a genesis peering, and the key exchange every
 *   peering runs. A peer row stored with an `http:` address before 4.0.0 is not rewritten; the key
 *   exchange refuses it from 4.0.0.
 * @structure PEER_HTTPS_REQUIRED_IN · PeerUrlRefusal · peerUrlRefusal(config, url, version?)
 * @usage
 *   const refusal = peerUrlRefusal(config, node_url);
 *   if (refusal) { res.status(400).json(error(config.nodeId, refusal.code, refusal.message)); return; }
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial (wish-core-luonnoksen-pienemm-t-aukot-tilin-poisto-peerit-http-ll-, FED-13).
 */
import type { AimeatConfig } from '../config.js';
import { noteDeprecatedUse, removedFrom } from './deprecation.js';

/** The release from which a public node takes only an `https:` peer address. */
export const PEER_HTTPS_REQUIRED_IN = '4.0.0';

export interface PeerUrlRefusal {
  code: 'PEER_HTTPS_REQUIRED';
  message: string;
}

/**
 * Null when this node may use `url` as a peer address; the refusal otherwise. Only the scheme is
 * judged here: SSRF and the address ranges stay validateOutboundUrl's job. A value that is not a URL
 * is left to that check too.
 */
export function peerUrlRefusal(
  config: Pick<AimeatConfig, 'securityProfile'>, url: unknown, version?: string,
): PeerUrlRefusal | null {
  if (config.securityProfile !== 'public' || typeof url !== 'string') return null;
  // URL.canParse rather than a try: an address that is not a URL is validateOutboundUrl's refusal.
  if (!URL.canParse(url)) return null;
  if (new URL(url).protocol !== 'http:') return null;
  if (removedFrom(PEER_HTTPS_REQUIRED_IN, version)) {
    return {
      code: 'PEER_HTTPS_REQUIRED',
      message: `This node is on the public internet, so a peer address must use https:// (since ${PEER_HTTPS_REQUIRED_IN}). ${url} uses plain http.`,
    };
  }
  noteDeprecatedUse({
    kind: 'peer_plain_http', removedIn: PEER_HTTPS_REQUIRED_IN,
    notice: 'A public node took a peer address that uses plain http.',
  }, { url });
  return null;
}
