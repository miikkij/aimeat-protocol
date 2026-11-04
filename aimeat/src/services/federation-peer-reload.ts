/**
 * @file src/services/federation-peer-reload.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The federation peers a process keeps in memory, read from storage: at boot
 *   (server-bootstrap/service-init.ts) and again when another process of the node changed them
 *   (services/bus-relay.ts). Every inbound peer check reads the in-memory map, so an operator's
 *   emergency de-peering made on one process reached the others only at their next restart, and they
 *   went on accepting the removed peer's signed requests (codebase analysis 2026-11-03, HA 2b).
 *
 *   WHAT A RELOAD TAKES FROM STORAGE. Which peers there are, and everything the operator decides about
 *   each: address, key, tier, permissions, mode, expiry, an operator's status (suspended, depeering,
 *   pending). What it keeps from memory is what this process learns from the peer itself and does not
 *   always write down: when it was last seen, its liveness status (active, degraded, offline,
 *   unreachable) while storage also holds a liveness status, its software version and its heartbeat
 *   counts. The inbound heartbeat route sets those in memory only.
 *
 *   A PEER THIS PROCESS CHANGED DURING THE READ is left as this process made it: a peer added, replaced
 *   or removed in memory while the storage read was under way is newer than what the read saw.
 * @structure peerInfoFromRow(row) · reloadPeers(storage, peers, nodeId)
 * @usage await reloadPeers(storage, peers, config.nodeId);
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial. peerInfoFromRow moved unchanged from service-init.ts (codebase
 *     analysis 2026-11-03, HA stage 2, e2-bus).
 */
import type { FederationPeerRecord, Storage } from '../storage/interface.js';
import { LIVENESS_RECOVERABLE, type PeerInfo } from './federation.js';

/** One stored peer row as the in-memory peer. A row written before a column existed keeps what it could already do. */
export function peerInfoFromRow(sp: FederationPeerRecord): PeerInfo {
  return {
    nodeId: sp.nodeId,
    url: sp.url,
    publicKey: sp.publicKey,
    status: sp.status,
    addedAt: sp.addedAt,
    lastSeen: sp.lastSeen,
    shareCatalogue: sp.shareCatalogue ?? true,
    replicateMemory: sp.replicateMemory ?? true,
    allowRouting: sp.allowRouting ?? true,
    // A row written before these columns existed keeps what it could already do. supportUpstream
    // is the opposite default: support routing is never inherited from an absent value.
    allowMessaging: sp.allowMessaging ?? true,
    allowBroadcast: sp.allowBroadcast ?? true,
    allowSettlement: sp.allowSettlement ?? true,
    supportUpstream: sp.supportUpstream ?? false,
    peerMode: sp.peerMode || 'federation',
    allowFederatedAuth: sp.allowFederatedAuth ?? false,
    federationAuthScopes: sp.federationAuthScopes ?? [],
    tier: sp.tier ?? 'member',
    availability: sp.availability ?? undefined,
    expiresAt: sp.expiresAt ?? null,
    heartbeatOk: sp.heartbeatOk ?? 0,
    heartbeatTotal: sp.heartbeatTotal ?? 0,
    availabilityWindow: sp.availabilityWindow ?? null,
    availabilityPct: sp.availabilityPct ?? null,
    softwareVersion: sp.softwareVersion ?? null,
    nodeCardHash: sp.nodeCardHash ?? null,
    relayClaimAt: sp.relayClaimAt ?? null,
    relayClaim: sp.relayClaim ?? null,
    lastClaimedRelayAt: sp.lastClaimedRelayAt ?? null,
    lastUnclaimedRelayAt: sp.lastUnclaimedRelayAt ?? null,
  };
}

/** What this process learns from the peer itself; a reload keeps its own copy of these. */
const LEARNED_FIELDS: ReadonlyArray<keyof PeerInfo> = [
  'lastSeen', 'softwareVersion', 'heartbeatOk', 'heartbeatTotal', 'availability', 'availabilityWindow', 'availabilityPct',
];

/** Bring one in-memory peer to the stored row, keeping what this process learned from the peer. */
function mergeStored(cur: PeerInfo, stored: PeerInfo): void {
  const keep: Partial<Record<keyof PeerInfo, unknown>> = {};
  for (const f of LEARNED_FIELDS) keep[f] = cur[f];
  const keepStatus = LIVENESS_RECOVERABLE.has(cur.status) && LIVENESS_RECOVERABLE.has(stored.status) ? cur.status : stored.status;
  Object.assign(cur, stored, keep, { status: keepStatus });
}

/**
 * Bring the in-memory peers to storage: add the stored peers this process lacks, drop the ones storage
 * no longer has, and take the operator's decisions on each. A row under this node's own id is never
 * loaded (as at boot). Changes the map in place, so every holder of it sees the result.
 */
export async function reloadPeers(storage: Pick<Storage, 'listFederationPeers'>, peers: Map<string, PeerInfo>, nodeId: string): Promise<{ added: number; removed: number }> {
  const before = new Map(peers);
  const rows = await storage.listFederationPeers();
  const stored = new Set<string>();
  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.nodeId === nodeId) continue;
    stored.add(row.nodeId);
    const cur = peers.get(row.nodeId);
    if (cur !== before.get(row.nodeId)) continue;   // changed here during the read
    if (!cur) { peers.set(row.nodeId, peerInfoFromRow(row)); added++; continue; }
    mergeStored(cur, peerInfoFromRow(row));
  }
  for (const [id, was] of before) {
    if (stored.has(id) || peers.get(id) !== was) continue;
    peers.delete(id);
    removed++;
  }
  return { added, removed };
}
