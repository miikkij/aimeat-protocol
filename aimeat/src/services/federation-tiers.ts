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
 *   FEDERATION IS A LADDER, NOT A SWITCH. Someone who says they do not want to
 *   federate is refusing to share data — catalogue, memory, routing, login — not
 *   refusing to be reachable. Presented as one switch the only answer is no, so
 *   the tiers are rungs and `contact` is the floor:
 *
 *     contact  <  visiting  <  member  <  genesis
 *
 *   - `contact` — messages and nothing else. The floor. Two nodes can talk while
 *     sharing no catalogue, no memory, no routing, no login, no presence, and
 *     without appearing in each other's public directory (peerMode 'private').
 *     This is where an infrastructure operator sits on a managed instance by
 *     default: reachable for support, and reachable for nothing else.
 *   - `visiting` — low-trust self-join tier. Can browse/discover (catalogue read,
 *     directory, presence) and originate paid work as a REQUESTER, but is never a
 *     provider-of-record, relay, memory-replication target, or federated-auth
 *     issuer. This is the "feel the federation immediately" tier.
 *   - `member` — today's full peer (all flags on except federated auth, which stays
 *     opt-in). A visiting peer reaches `member` only via a local operator's
 *     deliberate promotion ("vouch").
 *   - `genesis` — the anchor/genesis relationship; same capabilities as member,
 *     tagged distinctly for display.
 *
 *   DEFAULTS AND CEILINGS ARE DIFFERENT QUESTIONS, and conflating them was the trap
 *   this file had to be split to avoid. `deriveTierFlags` answers "what does this
 *   tier start with" and is applied on a tier change. `tierCeiling` answers "what
 *   is this tier allowed to reach" and is what an operator's flag edit is clamped
 *   against. They coincide at `contact` and `visiting`; at `member` they do not,
 *   because federated auth defaults OFF and may deliberately be raised.
 * @structure
 *   - PeerTier / TierFlags — the vocabulary
 *   - coerceTier(raw) — a missing or unknown tier is 'member' (legacy rows)
 *   - tierRank(tier) — the ladder as a number, for "is this a demotion"
 *   - deriveTierFlags(tier) — what a tier STARTS with
 *   - tierCeiling(tier) — what a tier may REACH
 *   - clampFlagsToTier(tier, requested) — an edit, held to the ceiling
 * @usage import { deriveTierFlags, coerceTier, clampFlagsToTier } from '../services/federation-tiers.js';
 * @version-history
 *   v1.0.0 — 2026-06-19 — Initial tier model (visiting/member/genesis) + flag derivation.
 *   v1.1.0 — 2026-08-23 — `contact`: the floor of the ladder, messages only. Three new permission
 *     words (allowMessaging / allowBroadcast / allowSettlement) because no existing flag separated a
 *     contact peer from a visiting one on the message, broadcast and settlement doors, and a door
 *     with no word cannot be refused. tierRank() so a trust advisory demoting to 'visiting' cannot
 *     silently PROMOTE a contact peer. clampFlagsToTier() replaces the hand-written elevation guard
 *     in federation-peer/peers.ts, which carried the ceiling rules as five inline conditions.
 */

export type PeerTier = 'genesis' | 'member' | 'visiting' | 'contact';

/** The permission flags a tier grants. Mirrors the flag fields on PeerInfo/FederationPeerRecord. */
export interface TierFlags {
  shareCatalogue: boolean;
  replicateMemory: boolean;
  allowRouting: boolean;
  /** May this peer deliver direct messages, read receipts and attachment grants here? */
  allowMessaging: boolean;
  /** May this peer's operator announce to EVERY human on this node at once? */
  allowBroadcast: boolean;
  /** May this peer move morsels onto this node's ledger? The only unauthenticated money door. */
  allowSettlement: boolean;
  peerMode: 'federation' | 'private';
  allowFederatedAuth: boolean;
  federationAuthScopes: string[];
}

const VALID_TIERS = new Set<PeerTier>(['genesis', 'member', 'visiting', 'contact']);

/** The ladder, low to high. Every tier appears exactly once. */
const TIER_ORDER: PeerTier[] = ['contact', 'visiting', 'member', 'genesis'];

/**
 * Map a (possibly missing/invalid) tier value to a valid one. Existing peers and
 * legacy records have no tier → treated as `member` (full capability, back-compat).
 *
 * `contact` is reachable only where it was deliberately written: an operator's tier edit, an invite
 * that named it, or the peering request it was approved at. Nothing coerces INTO it, so a peer never
 * arrives at the floor by accident, and nothing coerces OUT of it either.
 */
export function coerceTier(raw: unknown): PeerTier {
  return VALID_TIERS.has(raw as PeerTier) ? raw as PeerTier : 'member';
}

/**
 * Where a tier sits on the ladder. Higher is more trusted.
 *
 * Exists because a `suspend` trust advisory demotes a peer to `visiting` unconditionally, and for a
 * contact peer that is an ELEVATION: `visiting` may read the catalogue and `contact` may not. A
 * demotion has to check it is one.
 */
export function tierRank(tier: PeerTier): number {
  return TIER_ORDER.indexOf(tier);
}

/**
 * Canonical permission flags a tier STARTS with. The ONLY place these literals live.
 * - contact: messages only; invisible in the directory; no catalogue, replication, routing,
 *   broadcast, settlement or auth.
 * - visiting: discovery + paid-requester only; no provider/relay/replication/auth.
 * - member/genesis: full federation capability; federated auth stays opt-in.
 */
export function deriveTierFlags(tier: PeerTier): TierFlags {
  if (tier === 'contact') {
    return {
      shareCatalogue: false,      // nothing of what this node offers
      replicateMemory: false,     // not a replication target
      allowRouting: false,        // not a provider-of-record / relay
      allowMessaging: true,       // the one thing the floor is for
      allowBroadcast: false,      // may not reach every human here at once
      allowSettlement: false,     // may not move money onto this node's ledger
      peerMode: 'private',        // absent from /v1/federation/directory and the federation book
      allowFederatedAuth: false,
      federationAuthScopes: [],
    };
  }
  if (tier === 'visiting') {
    return {
      shareCatalogue: true,       // may READ our catalogue summary (browse/discover)
      replicateMemory: false,     // not a replication target
      allowRouting: false,        // not a provider-of-record / relay
      allowMessaging: true,       // unchanged from before the flag existed
      allowBroadcast: true,       // unchanged from before the flag existed
      allowSettlement: true,      // a visiting peer originates paid work, so settlement flows back
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
    allowMessaging: true,
    allowBroadcast: true,
    allowSettlement: true,
    peerMode: 'federation',
    allowFederatedAuth: false,    // opt-in even for members (unchanged from today)
    federationAuthScopes: [],
  };
}

/**
 * The MAXIMUM a tier may be raised to by a flag edit, which is not the same question as what it
 * starts with. A capability above this line needs a real tier change, not a checkbox.
 *
 * `member` and `genesis` differ from their defaults in exactly one place: federated auth is off by
 * default and an operator may turn it on. Below member it may not be turned on at all, which is the
 * rule the old inline guard enforced for `visiting` and now also covers `contact`.
 */
export function tierCeiling(tier: PeerTier): TierFlags {
  if (tier === 'contact' || tier === 'visiting') return deriveTierFlags(tier);
  return { ...deriveTierFlags(tier), allowFederatedAuth: true };
}

/**
 * Hold a requested flag set to what the tier permits.
 *
 * Every boolean is ANDed with the ceiling, so an edit may always turn a capability OFF and may only
 * turn one ON where the tier already allows it. `peerMode` is forced when the ceiling pins it, which
 * is what keeps a contact link out of the public directory whatever the request said. Federated-auth
 * SCOPES are cleared wherever federated auth itself is unreachable, so a stored scope list cannot
 * outlive the permission it describes.
 *
 * At `member` and `genesis` this is the identity function on today's inputs, so existing peers are
 * edited exactly as before.
 */
export function clampFlagsToTier(tier: PeerTier, requested: TierFlags): TierFlags {
  const ceiling = tierCeiling(tier);
  return {
    shareCatalogue: requested.shareCatalogue && ceiling.shareCatalogue,
    replicateMemory: requested.replicateMemory && ceiling.replicateMemory,
    allowRouting: requested.allowRouting && ceiling.allowRouting,
    allowMessaging: requested.allowMessaging && ceiling.allowMessaging,
    allowBroadcast: requested.allowBroadcast && ceiling.allowBroadcast,
    allowSettlement: requested.allowSettlement && ceiling.allowSettlement,
    peerMode: ceiling.peerMode === 'private' ? 'private' : requested.peerMode,
    allowFederatedAuth: requested.allowFederatedAuth && ceiling.allowFederatedAuth,
    federationAuthScopes: ceiling.allowFederatedAuth ? requested.federationAuthScopes : [],
  };
}
