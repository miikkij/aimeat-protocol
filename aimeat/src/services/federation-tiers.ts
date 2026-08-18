/**
 * @file federation-tiers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Single source of truth for federation peer TIERS and the permission
 *   flags each tier grants. A peer's `tier` decides what it may do on the network;
 *   `deriveTierFlags(tier)` returns the canonical flag set so the literals live in
 *   exactly one place (they were previously duplicated across the approve,
 *   direct-add, and key-exchange paths in federation-peer.ts).
 *
 *   Tiers:
 *   - `visiting` — low-trust self-join tier. Can browse/discover (catalogue read,
 *     directory, presence) and originate paid work as a REQUESTER, but is never a
 *     provider-of-record, relay, memory-replication target, or federated-auth
 *     issuer. This is the "feel the federation immediately" tier.
 *   - `member` — today's full peer (all flags on except federated auth, which stays
 *     opt-in). A visiting peer reaches `member` only via a local operator's
 *     deliberate promotion ("vouch").
 *   - `genesis` — the anchor/genesis relationship; same capabilities as member,
 *     tagged distinctly for display.
 * @structure deriveTierFlags(tier) · coerceTier(raw) · PeerTier type
 * @usage import { deriveTierFlags, coerceTier } from '../services/federation-tiers.js';
 * @version-history
 *   v1.0.0 — 2026-06-19 — Initial tier model (visiting/member/genesis) + flag derivation.
 */

export type PeerTier = 'genesis' | 'member' | 'visiting';

/** The permission flags a tier grants. Mirrors the flag fields on PeerInfo/FederationPeerRecord. */
export interface TierFlags {
  shareCatalogue: boolean;
  replicateMemory: boolean;
  allowRouting: boolean;
  peerMode: 'federation' | 'private';
  allowFederatedAuth: boolean;
  federationAuthScopes: string[];
}

const VALID_TIERS = new Set<PeerTier>(['genesis', 'member', 'visiting']);

/**
 * Map a (possibly missing/invalid) tier value to a valid one. Existing peers and
 * legacy records have no tier → treated as `member` (full capability, back-compat).
 */
export function coerceTier(raw: unknown): PeerTier {
  return VALID_TIERS.has(raw as PeerTier) ? raw as PeerTier : 'member';
}

/**
 * Canonical permission flags for a tier. The ONLY place these literals live.
 * - visiting: discovery + paid-requester only; no provider/relay/replication/auth.
 * - member/genesis: full federation capability; federated auth stays opt-in.
 */
export function deriveTierFlags(tier: PeerTier): TierFlags {
  if (tier === 'visiting') {
    return {
      shareCatalogue: true,       // may READ our catalogue summary (browse/discover)
      replicateMemory: false,     // not a replication target
      allowRouting: false,        // not a provider-of-record / relay
      peerMode: 'federation',
      allowFederatedAuth: false,
      federationAuthScopes: [],
    };
  }
  // member + genesis: today's full-peer defaults
  return {
    shareCatalogue: true,
    replicateMemory: true,
    allowRouting: true,
    peerMode: 'federation',
    allowFederatedAuth: false,    // opt-in even for members (unchanged from today)
    federationAuthScopes: [],
  };
}
