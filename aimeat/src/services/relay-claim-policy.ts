/**
 * @file src/services/relay-claim-policy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who must sign a relay claim, peer by peer, and which peers are ready for it.
 *
 *   THE MIGRATION THIS SERVES. `federation.relay_claim` is `optional` today, which lets a relayed
 *   request with no claim through because a peer on older software sends none. That is a migration
 *   position and not protection (src/middleware/relay-gate.ts says why), so it has an end: the
 *   default becomes `required` in 3.20.0, and `optional` is removed in 4.0.0. Two things make that
 *   survivable for an operator whose peers update at their own pace:
 *     - a peer can carry its OWN answer (`relayClaim`), which the gate reads before the node's. An
 *       operator keeps one slow peer on `optional` after the node turns `required`, or holds one
 *       peer to `required` before the node does. That setting is the same migration position for
 *       one peer, and it goes with the node-wide `optional` in 4.0.0.
 *     - each peer records when it last relayed here with a verified claim and when a relay naming
 *       it last arrived without one, so the operator can ask which peers are not ready yet.
 *
 *   WHAT A PEER'S `optional` ADMITS. The gate learns which peer an unclaimed relay comes from only
 *   from `x-forwarded-from`, which the sender types. So keeping a peer on `optional` admits any
 *   unclaimed relay that NAMES it, the way the node-wide `optional` admits any unclaimed relay.
 *   The one guard that still holds is the gate's own: a peer that has ever presented a valid claim
 *   may not go back to sending none, whatever its setting says.
 *
 *   WHY THE TIMES ARE COARSE. An unclaimed relay's name is typed by whoever sends it, so writing the
 *   peer row on every such request would let anyone make this node write. Each time is written at
 *   most every ten minutes, and the operator's question ("has this peer updated?") needs no more.
 * @structure
 *   - RelayClaimSetting · RELAY_CLAIM_REQUIRED_BY_DEFAULT_IN · RELAY_CLAIM_OPTIONAL_REMOVED_IN
 *   - parsePeerRelayClaim(raw) -- the three words a door takes
 *   - effectiveRelayClaim(config, peer) -- the peer's own answer, else the node's
 *   - setPeerRelayClaim(storage, peers, nodeId, raw) -- the one write behind the REST door and the tool
 *   - noteRelay(storage, peer, claimed) -- the gate's record of a relay, at most every ten minutes
 *   - peerRelayClaimView / relayClaimSummary -- what the Federation answer says
 * @usage
 *   const view = peerRelayClaimView(config, peer);
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial: the peer's own setting, the two relay times, and the versions.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from './federation.js';
import { logger } from '../utils/logger.js';

export type RelayClaimSetting = 'optional' | 'required';

/** The release in which the node-wide default becomes `required`. */
export const RELAY_CLAIM_REQUIRED_BY_DEFAULT_IN = '3.20.0';
/** The release in which `optional` stops being a setting, the node's and every peer's. */
export const RELAY_CLAIM_OPTIONAL_REMOVED_IN = '4.0.0';
/** At most one write of each relay time per peer in this window. */
export const RELAY_SEEN_WRITE_INTERVAL_MS = 10 * 60_000;
/** The word a door takes for "follow this node's setting". The REST door also takes null. */
export const FOLLOW_NODE = 'node';

export function parsePeerRelayClaim(raw: unknown):
  { ok: true; value: RelayClaimSetting | null } | { ok: false; message: string } {
  if (raw === null || raw === FOLLOW_NODE) return { ok: true, value: null };
  if (raw === 'optional' || raw === 'required') return { ok: true, value: raw };
  return {
    ok: false,
    message: `relay_claim is 'optional', 'required' or '${FOLLOW_NODE}' (follow this node's federation.relay_claim).`,
  };
}

/** What the gate applies to an unclaimed relay naming this peer: its own answer, else the node's. */
export function effectiveRelayClaim(
  config: Pick<AimeatConfig, 'federationRelayClaim'>,
  peer?: Pick<PeerInfo, 'relayClaim'> | null,
): RelayClaimSetting {
  return peer?.relayClaim ?? config.federationRelayClaim;
}

export type SetPeerRelayClaimResult =
  | { ok: true; peer: PeerInfo }
  | { ok: false; status: number; code: 'INVALID_INPUT' | 'NOT_FOUND'; message: string };

/**
 * The one implementation behind PUT /v1/federation/peers/:nodeId/relay-claim and
 * aimeat_admin_federation_relay_claim_set. Refuses before it writes; a missing value is refused
 * rather than read as "follow the node", which has its own word.
 */
export async function setPeerRelayClaim(
  storage: Storage,
  peers: Map<string, PeerInfo>,
  nodeId: string,
  raw: unknown,
): Promise<SetPeerRelayClaimResult> {
  const parsed = parsePeerRelayClaim(raw);
  if (!parsed.ok) return { ok: false, status: 400, code: 'INVALID_INPUT', message: parsed.message };
  const peer = peers.get(nodeId) ?? [...peers.values()].find(p => p.nodeId === nodeId);
  if (!peer) return { ok: false, status: 404, code: 'NOT_FOUND', message: `Peer not found: ${nodeId}` };
  peer.relayClaim = parsed.value;
  await storage.saveFederationPeer(peer);
  return { ok: true, peer };
}

function isStale(iso: string | null | undefined, now: number): boolean {
  const then = iso ? Date.parse(iso) : NaN;
  return !Number.isFinite(then) || now - then >= RELAY_SEEN_WRITE_INTERVAL_MS;
}

/**
 * Record that a relayed request naming `peer` arrived, with a verified claim or without one. On a
 * verified claim it also pins `relayClaimAt`, the first one, which is what keeps a peer that has
 * signed from going back to sending none. Fire and forget: recording a relay must never fail it.
 */
export function noteRelay(storage: Storage, peer: PeerInfo, claimed: boolean, now: number = Date.now()): void {
  const at = new Date(now).toISOString();
  let dirty = false;
  if (claimed && !peer.relayClaimAt) { peer.relayClaimAt = at; dirty = true; }
  if (claimed && isStale(peer.lastClaimedRelayAt, now)) { peer.lastClaimedRelayAt = at; dirty = true; }
  if (!claimed && isStale(peer.lastUnclaimedRelayAt, now)) { peer.lastUnclaimedRelayAt = at; dirty = true; }
  if (!dirty) return;
  storage.saveFederationPeer(peer).catch(err => {
    logger.warn('relay: could not record a relay on the peer', { peer: peer.nodeId, claimed, error: String(err) });
  });
}

/** One peer's relay picture, as the Federation answer shows it. */
export interface PeerRelayClaimView {
  /** The peer's own setting, or null when it follows the node. */
  setting: RelayClaimSetting | null;
  /** What the gate applies to an unclaimed relay naming this peer. */
  effective: RelayClaimSetting;
  /** When it first presented a valid claim. */
  first_signed_at: string | null;
  last_claimed_at: string | null;
  last_unclaimed_at: string | null;
  /** `signs`: it has relayed with a valid claim. `sends_none`: relays naming it arrive without one
   *  and none has ever come with one, so it is not ready for `required`. `unseen`: nothing relayed. */
  state: 'signs' | 'sends_none' | 'unseen';
}

export function peerRelayClaimView(config: Pick<AimeatConfig, 'federationRelayClaim'>, peer: PeerInfo): PeerRelayClaimView {
  return {
    setting: peer.relayClaim ?? null,
    effective: effectiveRelayClaim(config, peer),
    first_signed_at: peer.relayClaimAt ?? null,
    last_claimed_at: peer.lastClaimedRelayAt ?? null,
    last_unclaimed_at: peer.lastUnclaimedRelayAt ?? null,
    state: peer.relayClaimAt ? 'signs' : peer.lastUnclaimedRelayAt ? 'sends_none' : 'unseen',
  };
}

/** The node's answer, the two versions, and the peers sorted by what the operator would do. */
export interface RelayClaimSummary {
  node_setting: RelayClaimSetting;
  default_becomes_required_in: string;
  optional_removed_in: string;
  /** Relays naming these arrive without a claim and none ever came with one. */
  not_ready: string[];
  /** These have relayed here with a valid claim. */
  ready: string[];
  /** Nothing has been relayed from these either way. */
  unseen: string[];
  /** Peers on their own setting, which a change of the node's leaves as it is. */
  kept_optional: string[];
  kept_required: string[];
}

export function relayClaimSummary(config: Pick<AimeatConfig, 'federationRelayClaim'>, peers: PeerInfo[]): RelayClaimSummary {
  const views = peers.map(p => ({ id: p.nodeId, v: peerRelayClaimView(config, p) }));
  const pick = (f: (v: PeerRelayClaimView) => boolean): string[] => views.filter(x => f(x.v)).map(x => x.id);
  return {
    node_setting: config.federationRelayClaim,
    default_becomes_required_in: RELAY_CLAIM_REQUIRED_BY_DEFAULT_IN,
    optional_removed_in: RELAY_CLAIM_OPTIONAL_REMOVED_IN,
    not_ready: pick(v => v.state === 'sends_none'),
    ready: pick(v => v.state === 'signs'),
    unseen: pick(v => v.state === 'unseen'),
    kept_optional: pick(v => v.setting === 'optional'),
    kept_required: pick(v => v.setting === 'required'),
  };
}
