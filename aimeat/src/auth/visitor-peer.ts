/**
 * @file src/auth/visitor-peer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The seventh credential-death question, and the visitor's current scopes: a session a
 *   visitor from another node holds here lives only as long as the peer that vouched for it.
 *
 *   A visitor's token is minted by the federated branch of POST /v1/ghii/login on the word of a peer
 *   (routes/ghii/register-login.ts). The peer's status, the node's federation sign-in policy, the
 *   peer's tier and its federation_auth_scopes were read at the mint and never again, and the token
 *   carries no session id. So an operator who narrowed the peer's scope list, switched federated
 *   sign-in off, or removed the peer with the emergency de-peer ("immediate disconnect") left every
 *   visitor token already minted on that peer's word working, with its minted scopes, until its own
 *   exp, up to an hour (secaudit 2026-10, credentialRevoked:federated-visitor-not-bound-to-live-peer).
 *
 *   visitorPeerRefuses() asks, on every request, the questions the mint asked: the visitor's home node
 *   is an ACTIVE peer, the node's policy is not `disabled`, a `specific_peers` policy names this peer,
 *   and the peer's tier may carry a sign-in at all. visitorPeerScopes() gives what the peer may grant
 *   a visitor now (its own list, else the node default), which auth/effective-scopes.ts intersects
 *   with the token's list, so a narrowed list applies at once and nothing is ever widened.
 *
 *   CHEAP ON PURPOSE. It runs on every request a visitor makes, so it reads the in-memory peer
 *   registry the federation routes and the heartbeat share (server-bootstrap/service-init.ts registers
 *   it per node) and the live config object, and never storage. Every operator change to a peer (PUT,
 *   DELETE, emergency DELETE) updates that registry in the same request.
 *
 *   FAILS CLOSED. A node that registered no registry knows of no peer, so a visitor has no live peer
 *   and is refused. Only a visitor is asked: every other principal returns before any read.
 * @structure VisitorPeerView · registerVisitorPeers(peers, nodeId) · visitorPeerRefuses(verified) ·
 *   visitorPeerScopes(verified)
 * @usage if (visitorPeerRefuses(verified)) return true;   // auth/credential-revoked.ts
 * @version-history
 *   v1.0.1 — 2026-10-21 — A peer the heartbeat marks degraded, offline or unreachable keeps its
 *     visitors; only a removed peer or an operator-set status ends their sessions (it signed every
 *     visitor out after about fifteen minutes of network trouble).
 *   v1.0.0 — 2026-10-20 — Initial (secaudit 2026-10, federated-visitor-not-bound-to-live-peer).
 */
import type { VerifiedToken } from './jwt.js';
import { isForeignPrincipal } from '../utils/gaii.js';
import { coerceTier, tierCeiling } from '../services/federation-tiers.js';
import { PerNode, sessionConfig } from './node-auth.js';

/** Statuses a peer leaves on its own when it answers again (services/federation.ts LIVENESS_RECOVERABLE). */
const LIVENESS_RECOVERABLE_STATUSES: ReadonlySet<string> = new Set(['active', 'degraded', 'offline', 'unreachable']);

/**
 * The fields of a federation peer record (services/federation.ts PeerInfo) this question reads.
 * Named here, not imported, so the auth layer does not depend on the federation service module.
 */
export interface VisitorPeerView {
  nodeId: string;
  status: string;
  tier?: string;
  allowFederatedAuth: boolean;
  federationAuthScopes: string[];
}

/** The live peer registry of each node this process serves; `none`, so a node that registered no
 *  registry is not answered with another node's. */
const peerRegistry = new PerNode<ReadonlyMap<string, VisitorPeerView>>('none');

/**
 * File a node's live peer registry (server-bootstrap/service-init.ts, once per node at boot). The
 * map itself is held, not a copy, so every change the federation routes make to it is seen here.
 */
export function registerVisitorPeers(peers: ReadonlyMap<string, VisitorPeerView>, nodeId?: string): void {
  peerRegistry.set(peers, nodeId);
}

/** The peer a visitor's token names as its home, as the registry holds it now; null when none. */
function homePeerOf(verified: Pick<VerifiedToken, 'homeNode'>): VisitorPeerView | null {
  const homeNode = verified.homeNode;
  if (!homeNode) return null;
  return peerRegistry.get()?.get(homeNode) ?? null;
}

/**
 * Does the peer that vouched for this visitor no longer carry its session? True when the home node is
 * not an active peer any more (removed, emergency-removed, suspended), when this node's federated
 * sign-in policy is `disabled`, when a `specific_peers` policy no longer names the peer, or when the
 * peer's tier cannot carry a sign-in. The same questions the federated login asks before it mints.
 * False, with no read, for every principal that is not a visitor.
 */
export function visitorPeerRefuses(verified: VerifiedToken): boolean {
  if (!isForeignPrincipal(verified)) return false;
  const peer = homePeerOf(verified);
  // A peer that is only unreachable for a while (degraded, offline, unreachable: the heartbeat sets
  // these after a few failed pings) keeps its visitors; a removed peer is gone from the map, and a
  // status only an operator sets (depeering, suspended, pending) ends the session. Same set as
  // services/federation.ts LIVENESS_RECOVERABLE.
  if (!peer || !LIVENESS_RECOVERABLE_STATUSES.has(peer.status)) return true;
  const policy = sessionConfig()?.federationAuthPolicy ?? 'disabled';
  if (policy === 'disabled') return true;
  if (policy === 'specific_peers' && !peer.allowFederatedAuth) return true;
  return !tierCeiling(coerceTier(peer.tier)).allowFederatedAuth;
}

/**
 * What the visitor's home peer may grant a visitor NOW: the peer's own federation_auth_scopes, else
 * the node's federationDefaultScopes, the same choice the federated login makes at the mint. Null
 * for a principal that is not a visitor. An empty list for a visitor whose peer is gone, which the
 * credential check has already refused.
 */
export function visitorPeerScopes(verified: VerifiedToken): string[] | null {
  if (!isForeignPrincipal(verified)) return null;
  const peer = homePeerOf(verified);
  if (!peer) return [];
  if (peer.federationAuthScopes?.length > 0) return [...peer.federationAuthScopes];
  return [...(sessionConfig()?.federationDefaultScopes ?? [])];
}
