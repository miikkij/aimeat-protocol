/**
 * @file src/services/connect-tunnel/recheck.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description On a node with several processes, the tunnel identities this process holds are checked
 *   again on a timer, so a revocation or a stop another process decided is in force here within
 *   HELD_IDENTITY_RECHECK_MS even when its tunnelControl event was lost.
 *
 *   WHY. Round 14 applies each decision on the process that made it and tells the others with one
 *   tunnelControl event (./cross-process.ts). The bus delivers at most once: a send that fails is
 *   dropped, a crash before the send loses it, and a listener that was down misses what was sent
 *   meanwhile. Nothing else checks a socket a process already holds: a delivery is pushed to any open
 *   socket keyed by its target, and a heartbeat keeps it open. So a lost event for a revoked token
 *   left that socket on the other process receiving task_assigned frames and dm.inbound previews,
 *   and a lost stop left the agent's in-memory flag there unchanged, until the connector disconnected
 *   or the process restarted (secaudit2026nov08b round 15,
 *   connect-tunnel/cross-process.ts:tunnel-control-lost-event-unbounded).
 *
 *   WHAT IS ASKED. Per held identity, the question every request asks (auth/credential-revoked.ts
 *   credentialRevoked: token revoked, session ended, agent deleted or rekeyed, account erased or
 *   deactivated, app gone); a revoked one is told `auth_revoked` and detached, as a revocation
 *   event would do. A token revoked by itself is answered through the revocation cache of
 *   auth/jwt.ts (60 s), so for that one case the bound is that much longer; an ended session, a
 *   deleted or rekeyed agent and an erased or deactivated account are read from storage each round.
 *   For an agent, its record's stop flag; a change is applied as a stop or start
 *   event would apply it. A credential that still holds is left as it is, so a valid connector sees
 *   no difference. With one process per node (the default) no timer runs.
 * @structure HELD_IDENTITY_RECHECK_MS · HeldIdentity · RecheckTarget · recheckHeldIdentities(storage, held, target)
 * @usage
 *   // in ConnectTunnelManager, on a node with several processes
 *   await recheckHeldIdentities(this.storage, [...this.connections.values()], this);
 * @version-history
 *   v1.0.0 -- 2026-11-08 -- Initial (secaudit2026nov08b round 15).
 */
import type { Storage } from '../../storage/interface.js';
import { tokenIdOf, type VerifiedToken } from '../../auth/jwt.js';
import { isStopped } from '../agent-stop-rules.js';
import { REGISTRY_RESYNC_MS } from '../bus-relay.js';
import { logger } from '../../utils/logger.js';

/** How often a process of a node with several processes checks the identities it holds: the registries' bound. */
export const HELD_IDENTITY_RECHECK_MS = REGISTRY_RESYNC_MS;

/** What the check reads of one held identity. */
export interface HeldIdentity {
  principal: string;
  rawToken: string;
  identity: VerifiedToken;
  stopped?: boolean;
}

/** The manager's own appliers for this process's sockets: the ones a tunnelControl event calls. */
export interface RecheckTarget {
  revokeTokenIdHere(tokenId: string): void;
  setStoppedHere(gaii: string, stopped: boolean): void;
}

/**
 * Check each held identity once, one after the other, and apply what changed. Answers how many were
 * detached and how many changed their stop flag. A check that throws is logged and leaves that
 * identity as it was; the next round asks again.
 */
export async function recheckHeldIdentities(
  storage: Pick<Storage, 'getAgent'>, held: readonly HeldIdentity[], target: RecheckTarget,
): Promise<{ detached: number; stopChanged: number }> {
  let detached = 0;
  let stopChanged = 0;
  // Imported when used, as the manager's attach does (connect-tunnel.ts handleAttach).
  const { credentialRevoked } = await import('../../auth/credential-revoked.js');
  for (const conn of held) {
    try {
      if (await credentialRevoked(conn.rawToken, conn.identity)) {
        // Matched by the token's id: a socket that replaced this one meanwhile holds another token
        // and is not touched.
        target.revokeTokenIdHere(tokenIdOf(conn.rawToken));
        detached++;
        continue;
      }
      // An ecosystem app has no agent record, so it reads as not stopped, as the backlog reads it
      // (connect-tunnel-push.ts sendBacklog).
      const stopped = isStopped(await storage.getAgent(conn.principal));
      if (stopped !== !!conn.stopped) {
        target.setStoppedHere(conn.principal, stopped);
        stopChanged++;
      }
    } catch (err) {
      logger.warn('connect tunnel: a held identity was not checked again; the next round asks again', { principal: conn.principal, error: String(err) });
    }
  }
  if (detached || stopChanged) {
    logger.info('connect tunnel: a decision whose event did not arrive was applied here', { event: 'connect_tunnel.recheck', detached, stopChanged });
  }
  return { detached, stopChanged };
}
