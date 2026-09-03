/**
 * @file connect-tunnel-revocation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The three ways a live tunnel socket is closed because the node has stopped honouring
 *   what it holds. Pure extraction from connect-tunnel.ts when that file passed the 800-line cap;
 *   the bodies are verbatim and the class methods now delegate here.
 *
 *   They are one concern with three predicates, and the predicate is the whole difference:
 *
 *     by RAW TOKEN   a bearer was revoked, and the revoker has the string
 *     by GAII        one agent was deleted, and nobody has its string
 *     by OWNER       an account was deactivated, so every principal acting for it goes
 *
 *   Keeping them together is the point. Each was added for its own incident, and each time the
 *   question was "does one of the existing ones already reach this case" — which is far easier to
 *   answer when they sit in one file and the predicates line up.
 *
 *   A tunnel verifies its bearer ONCE, at upgrade. That is why every one of these has to exist: the
 *   node refusing a credential changes nothing about a socket that is already open, and a socket
 *   nobody closed goes on reporting itself as online.
 * @structure revokeByToken() · revokeByGaii() · revokeByOwner()
 * @usage
 *   import { revokeByGaii } from './connect-tunnel-revocation.js';
 *   revokeByGaii(this.connections, (ws, f) => this.send(ws, f), gaii);
 * @version-history
 *   2026-09-03 — These detach ONE identity instead of closing a socket. Closing was right while a
 *     socket carried exactly one identity and catastrophic the moment it carried twelve: one dead
 *     credential would have dropped eleven good ones. The socket closes only when the manager's
 *     detach finds nobody left on it.
 *   v1.0.0 — 2026-09-02 — Extracted from connect-tunnel.ts (max-file-lines), together with the new
 *     by-GAII close that deleting an agent needs.
 */
import type { WebSocket } from 'ws';
import type { ConnectFrame } from './connect-tunnel-wire.js';
import { logger } from '../utils/logger.js';

/** Just enough of a connection for these three to do their work. */
interface Closable {
  principal: string;
  ws: WebSocket;
  socketId: string;
  rawToken: string;
  identity: { owner: string };
}

/** How the manager writes a frame — passed in so this module owns no socket policy of its own. */
type Send = (ws: WebSocket, frame: ConnectFrame) => void;

/**
 * Remove ONE identity from wherever it is. The manager's own detach, passed in, because deciding
 * when a socket may actually close is its bookkeeping and not this module's.
 */
type Detach = (socketId: string, principal: string, reason: string) => void;

/**
 * THE FENCE, AND IT IS ONE LINE OF POLICY: tell that identity, then detach that identity.
 *
 * This used to close the socket. That was right when a socket carried exactly one identity and
 * catastrophic the moment it carried twelve — one agent's dead credential would have dropped the
 * other eleven, whose credentials are all perfectly good. The `auth_revoked` frame is stamped with
 * whose it is so a shared client stops the right one, and the socket closes only if the manager's
 * detach finds nobody left on it.
 */
function cut(send: Send, detach: Detach, conn: Closable, message: string, where: string): void {
  send(conn.ws, { type: 'auth_revoked', agent: conn.principal, message, timestamp: new Date().toISOString() });
  try { detach(conn.socketId, conn.principal, where); } catch (err) { logger.warn(`${where}: ignore`, { error: String(err) }); }
}

/**
 * P2: a bearer was revoked — if its socket is live, tell the principal to stop + re-auth, then
 * close. The forward bearer IS this token, so leaving the socket open would just 401 every forward
 * call (silent breakage); pushing `auth_revoked` lets the client surface re-auth guidance at once
 * and removes the client's periodic auth-liveness probe. Matched by the pinned rawToken.
 */
export function revokeByToken(connections: Map<string, Closable>, send: Send, detach: Detach, rawToken: string): void {
  for (const conn of connections.values()) {
    if (conn.rawToken !== rawToken) continue;
    cut(send, detach, conn, 'Token revoked', 'onTokenRevoked');
    break;  // one live session per identity — at most one match
  }
}

/**
 * Close the live socket belonging to ONE principal, because the node has stopped honouring what
 * it holds — deleting an agent, today.
 *
 * Deleting revokes the agent's sessions (`revokeSessionsByGaii`) and the node then refuses every
 * call correctly, but nothing told the tunnel: the socket stayed up and `/local/status` read
 * `online` for a credential that was already dead. A surface that says a thing works when it does
 * not is the same class of defect as `lastSeen` read as evidence of a connection, and it costs the
 * same kind of afternoon. It bit during a re-seed, where deleting and recreating agents is routine
 * — crew-forge's whole job is making agents and clearing away the ones it made, so a reused name is
 * not an edge case there.
 *
 * Neither existing door reached this case. `revokeByToken` matches the RAW token, which the owner
 * pressing Delete never sees; `revokeByOwner` is an account-wide sweep and would drop the other
 * five agents sharing the daemon. Same mechanism as both, with the predicate this case needs —
 * and `connections` is keyed by the GAII, so it is one lookup rather than a scan.
 */
export function revokeByGaii(connections: Map<string, Closable>, send: Send, detach: Detach, gaii: string): void {
  const conn = connections.get(gaii);
  if (!conn) return;
  cut(send, detach, conn, 'Agent deleted', 'closeForGaii');
}

/**
 * Close every live socket whose principal acts for this OWNER. Deactivating an account
 * (owner-lifecycle.ts) revokes session rows, but a tunnel verified its bearer only at upgrade,
 * so without this the deactivated owner's agents keep receiving pushes until their own exp.
 * Matched on the verified token's `owner` claim, which is the bare owner name on every
 * principal family this tunnel accepts (agents and ecosystem apps).
 */
export function revokeByOwner(connections: Map<string, Closable>, send: Send, detach: Detach, owner: string): void {
  // Snapshot first: detach deletes from the very map this walks, and a shared socket means several
  // of this owner's identities are in it at once.
  for (const conn of [...connections.values()]) {
    if (conn.identity.owner !== owner) continue;
    cut(send, detach, conn, 'Account deactivated', 'closeForOwner');
  }
}
