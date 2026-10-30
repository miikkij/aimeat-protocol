/**
 * @file src/services/peer-registry.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The live federation peer map of one node, made knowing that node's own id, so the gate
 *   every inbound federation route asks (federation-peer-gate.ts gatePeer) can refuse a peer under this
 *   node's own id without each route passing the id along.
 *
 *   WHY. A peer speaks for the people of its node id. Every admission path refuses this node's own id
 *   (secaudit2026oct26), but a path added later, or a row written by hand, would put such a peer in the
 *   map, and then it would speak for every person here. The gate answers for every door at once, so
 *   the check sits there and reads the id from the map it is handed.
 *
 *   One process can serve several nodes (the two-node test suites boot two), so the id is filed per
 *   map, never in module state. A map made with plain `new Map()` (a test, a dry-run copy) has no id
 *   filed and passes the gate as before.
 * @structure peerRegistry(thisNodeId) · ownNodeIdOf(peers)
 * @usage
 *   const peers = peerRegistry<PeerInfo>(config.nodeId);     // server-bootstrap/service-init.ts
 *   if (sourceNode === ownNodeIdOf(peers)) refuse();          // federation-peer-gate.ts
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (secaudit2026oct26 round 8c, federation-07: the gate refuses a peer
 *     under this node's own id).
 */

/** Each node's peer map, with the id of the node it belongs to. Weak, so a dropped map is not held. */
const ownIds = new WeakMap<ReadonlyMap<string, unknown>, string>();

/** A new, empty peer map for the node `thisNodeId`. */
export function peerRegistry<T>(thisNodeId: string): Map<string, T> {
    const peers = new Map<string, T>();
    ownIds.set(peers, thisNodeId);
    return peers;
}

/** The id of the node that owns this peer map, or undefined for a map made without one. */
export function ownNodeIdOf(peers: ReadonlyMap<string, unknown>): string | undefined {
    return ownIds.get(peers);
}
