/**
 * @file src/services/connect-tunnel/cross-process.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A tunnel decision made on one process reaches the sockets the node's other processes
 *   hold. A connector's socket lives on whichever process took its upgrade, and since 2026-11-04 a
 *   delivery for its agent reaches that process from any other (services/bus-relay.ts). The decisions
 *   that stop or change what the socket may receive were process-local: an agent deleted, moved or
 *   rekeyed, an account deactivated and a token revoked detached the socket only on the process that
 *   served the request, and an agent stop or a permission change was told only there. So on a node
 *   with several active processes a revoked agent's socket on another process went on receiving its
 *   tasks and messages (secaudit2026nov08 round 14, connect-tunnel-revocation.ts:revoke-process-local-
 *   while-bus-delivers-cross-process).
 *
 *   Now the manager applies each decision here, as before, and tells the other processes on the
 *   `tunnelControl` channel; each of them applies it to the sockets it holds. The bus keeps the order
 *   of one process's events, so a delivery sent after the revocation reaches the other process after
 *   the socket was detached there. A token is named by its id (auth/jwt.ts tokenIdOf), never sent.
 *   With one process (SQLite, or one process on PostgreSQL) no other process hears it, and nothing
 *   changes. The bus delivers at most once, so an event can be lost: each process of a node with
 *   several processes also checks the identities it holds every HELD_IDENTITY_RECHECK_MS
 *   (./recheck.ts), which bounds how long a lost revocation or stop stays out of force there.
 * @structure TunnelControlTarget · TunnelControl · tellOtherProcesses(nodeId, control) ·
 *   listenToOtherProcesses(nodeId, target)
 * @usage
 *   tellOtherProcesses(config.nodeId, { op: 'gaii', gaii, reason });
 *   const stop = listenToOtherProcesses(config.nodeId, this);   // in the manager's constructor
 * @version-history
 *   2026-11-08 -- The header names the bound for a lost event (./recheck.ts; secaudit2026nov08b round 15).
 *   v1.0.0 -- 2026-11-08 -- Initial (secaudit2026nov08 round 14).
 */
import {
  emitTunnelControl, onTunnelControlEvent, offTunnelControlEvent, isRemoteEvent,
  type TunnelControl, type TunnelControlEvent,
} from '../event-bus.js';
import { runAsNode } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';

export type { TunnelControl };

/** The manager's own appliers: each acts on the sockets of this process and tells nobody. */
export interface TunnelControlTarget {
  revokeTokenIdHere(tokenId: string): void;
  closeForGaiiHere(gaii: string, reason: 'moved' | 'deleted' | 'rekeyed'): void;
  closeForOwnerHere(owner: string): void;
  setStoppedHere(gaii: string, stopped: boolean): void;
  notifyScopesChangedHere(gaii: string): void;
}

/** Tell the node's other processes about a decision this process already applied to its own sockets. */
export function tellOtherProcesses(nodeId: string, control: TunnelControl): void {
  emitTunnelControl(nodeId, control);
}

function apply(target: TunnelControlTarget, evt: TunnelControlEvent): void {
  switch (evt.op) {
    case 'token': target.revokeTokenIdHere(evt.tokenId); return;
    case 'gaii': target.closeForGaiiHere(evt.gaii, evt.reason); return;
    case 'owner': target.closeForOwnerHere(evt.owner); return;
    case 'stopped': target.setStoppedHere(evt.gaii, evt.stopped); return;
    case 'scopes': target.notifyScopesChangedHere(evt.gaii); return;
  }
}

/**
 * Apply every decision another process of `nodeId` made to this process's sockets. This process's
 * own events are skipped: the manager applied them before telling. Answers the function that stops it.
 */
export function listenToOtherProcesses(nodeId: string, target: TunnelControlTarget): () => void {
  const handler = (evt: TunnelControlEvent): void => {
    if (!isRemoteEvent(evt) || evt.nodeId !== nodeId) return;
    try {
      runAsNode(nodeId, () => apply(target, evt));
    } catch (err) {
      logger.warn('connect tunnel: a decision from another process was not applied here', { op: evt.op, error: String(err) });
    }
  };
  onTunnelControlEvent(handler);
  return () => offTunnelControlEvent(handler);
}
