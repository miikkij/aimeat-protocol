/**
 * @file src/services/classification/egress.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one question every federation exit asks before memory leaves this node
 *   (TARGET-082, spec §9 and §13.2 group 5): the classification component's leave(), with the
 *   destination `federation`. A peer read, an outbound replication and a push to a home node all
 *   call this, so a label that forbids leaving holds on each of them from one place.
 *
 *   Federation traffic has no caller of this node behind it, so the reader is the node's own. What
 *   leaves is decided by the content's label, not by who asked.
 * @structure leaveToPeer(deps, records, peer)
 * @usage const sendable = await leaveToPeer({ storage, config }, publicMemories, peer.nodeId);
 * @version-history
 *   v1.0.0 — 2026-09-29 — TARGET-082 V1. Initial.
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { memoryTarget } from './labels.js';
import { systemReader } from './reader.js';

/** The records that may leave this node for `peer`, in the order given. */
export async function leaveToPeer<T extends { ownerGaii: string; key: string }>(
  deps: { storage: Storage; config: Pick<AimeatConfig, 'classificationMode' | 'nodeId'> },
  records: readonly T[],
  peer: string,
): Promise<T[]> {
  const reader = systemReader(deps, `system@${deps.config.nodeId}`);
  return (await reader.leave(records, r => memoryTarget(r.ownerGaii, r.key), { kind: 'federation', peer })).kept;
}
