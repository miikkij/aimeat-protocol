/**
 * @file federation-peer-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Is this peer allowed through this door at all? One answer, so a new permission word
 *   cannot be enforced on seven doors and forgotten on the eighth.
 *
 *   Every inbound federation route had opened with the same four lines: find the peer by source node,
 *   refuse unless `status === 'active'`, refuse without a public key, verify the signature. Eight
 *   copies, and three of the doors behind them had no capability check of any kind — a peer that was
 *   active and signed could deliver messages, announce to every human on the node, and move morsels
 *   onto its ledger, whatever its tier said.
 *
 *   That is the shape the `contact` tier cannot survive. A tier promising "messages and nothing else"
 *   is a promise made at the doors, so the capability is checked HERE, once, and the caller is handed
 *   the peer only if it is genuinely entitled to be there.
 *
 *   ORDER MATTERS AND IS DELIBERATE. The capability is refused BEFORE the route reads the body,
 *   writes a row or credits a balance. Three defects in this codebase have had the same shape:
 *   bytes written before the name was claimed, a paywall standing down before comparing the
 *   coordinate, a response sent before the work it announced. A gate that runs after the effect is
 *   not a gate.
 *
 *   WHAT THIS DOES NOT DO: verify the signature. Each route signs a different canonical payload, and
 *   folding eight payload shapes into one helper would hide the thing most worth reading. The route
 *   keeps its own `verify()` call and uses `peer.publicKey` from the result.
 * @structure
 *   - PeerCapability — the permission words a door can name
 *   - PeerGateResult — the peer, or the refusal to send
 *   - gatePeer() — find, check active, check the capability
 * @usage
 *   const gate = gatePeer(peers, source_node, 'allowMessaging');
 *   if (!gate.ok) { res.status(gate.status).json(error(config.nodeId, gate.code, gate.message)); return; }
 *   // ...then verify the signature against gate.peer.publicKey
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial, with the contact tier: message/receipt/storage-grant, broadcast,
 *     settlement, presence, memory-list and templates each name a word now.
 */
import type { PeerInfo } from './federation.js';

/**
 * The permission words an inbound door may require. Deliberately a subset of the peer's flags: the
 * ones that are not capabilities of a DOOR (peerMode, federationAuthScopes, supportUpstream) have no
 * business being asked for here, and leaving them out means a typo is a compile error.
 */
export type PeerCapability =
  | 'shareCatalogue'
  | 'replicateMemory'
  | 'allowRouting'
  | 'allowMessaging'
  | 'allowBroadcast'
  | 'allowSettlement';

export type PeerGateResult =
  | { ok: true; peer: PeerInfo }
  | { ok: false; status: number; code: string; message: string };

/** What a refused capability is called to the peer. Never names the tier: a peer is told what it may
 *  not do here, not how this node has it filed. */
const DENIED: Record<PeerCapability, string> = {
  shareCatalogue: 'This peer may not read or sync the catalogue on this node',
  replicateMemory: 'This peer may not replicate memory to or from this node',
  allowRouting: 'This peer may not route or relay through this node',
  allowMessaging: 'This peer may not deliver messages to this node',
  allowBroadcast: 'This peer may not broadcast to this node',
  allowSettlement: 'This peer may not settle balances on this node',
};

/**
 * Resolve the peer behind `sourceNode` and decide whether it may use a door requiring `capability`.
 *
 * A missing source node, an unknown peer and a peer that is not active are one answer on purpose:
 * 403 FORBIDDEN, saying only that the caller is not an active peer here. Distinguishing them would
 * turn this route into a way to enumerate a node's federation partners, and the peer list of a node
 * running managed instances is its customer list.
 *
 * A missing public key is refused here rather than later, because every caller's next move is to
 * verify a signature against it and "no key on file" is not a verification failure.
 */
export function gatePeer(
  peers: Map<string, PeerInfo>,
  sourceNode: unknown,
  capability: PeerCapability,
  opts?: {
    /** Statuses accepted instead of the default `['active']`. Settlement passes `['active',
     *  'depeering']`, because money already owed must still land while a link is being taken down;
     *  every other door wants an active peer and should not pass this. */
    acceptStatuses?: readonly string[];
  },
): PeerGateResult {
  const accept = opts?.acceptStatuses ?? ['active'];
  const forbidden = { ok: false as const, status: 403, code: 'FORBIDDEN', message: 'Source node is not an active peer' };

  if (typeof sourceNode !== 'string' || !sourceNode) return forbidden;
  const peer = [...peers.values()].find(p => p.nodeId === sourceNode);
  if (!peer || !accept.includes(peer.status)) return forbidden;

  // Absent means true for every capability except the ones a legacy row never had. The row mappers
  // already apply that default, so an undefined here is a peer built in memory by a caller that
  // forgot a flag — treat it as absent-means-allowed to match the stored rows rather than inventing
  // a third behaviour, and let the round-trip test hold the providers to it.
  if (peer[capability] === false) {
    return { ok: false, status: 403, code: 'POLICY_DENIED', message: DENIED[capability] };
  }

  if (!peer.publicKey) {
    return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Peer has no public key on file for signature verification' };
  }

  return { ok: true, peer };
}
