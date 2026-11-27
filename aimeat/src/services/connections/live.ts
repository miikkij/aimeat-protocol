/**
 * @file src/services/connections/live.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The live-update domain of a principal's connected accounts. Every change a person
 *   sees in the list of their connections (GET /v1/connections) is announced on the `connections`
 *   domain to the owner of the connection, over the event bus the SSE transport reads
 *   (services/event-bus.ts emitChange, routes/sse.ts owner filter): a new connection, a new sign-in
 *   that repairs one (oauth.ts completeAuthorization, attach.ts), a connection that now needs a new
 *   sign-in (refresh.ts), and a removed one. The Email and Access pages wait on this event for a
 *   connect round to finish (public/js/connection-wait.js) instead of asking the list again on a timer.
 *   A refresh that only renews a token changes nothing the list shows and is not announced.
 * @structure CONNECTIONS_DOMAIN · announceConnectionChange(principal) · markNeedsReauth(storage, conn, why)
 * @usage announceConnectionChange(connection.principal) after the write that changed the row
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial: the pages polled GET /v1/connections every 1.2 s during a connect round.
 */
import type { Storage } from '../../storage/interface.js';
import type { ConnectionRecord } from '../../models/connection-schemas.js';
import { emitChange } from '../event-bus.js';

/** The domain name the SSE frame carries; the SPA listens for it with onLiveUpdate(['connections']). */
export const CONNECTIONS_DOMAIN = 'connections';

/**
 * Tell the owner's open pages that their connections changed. `principal` is the connection's own
 * (a GHII, or an agent's GAII): the SSE transport compares only its owner segment, so an agent's
 * connection reaches its owner's pages too, and no other account hears of it.
 */
export function announceConnectionChange(principal: string): void {
  emitChange(CONNECTIONS_DOMAIN, principal);
}

/** Mark a connection as needing a new sign-in, and say so to its owner's pages. */
export async function markNeedsReauth(
  storage: Pick<Storage, 'setConnectionStatus'>, conn: Pick<ConnectionRecord, 'id' | 'principal'>, why: string,
): Promise<void> {
  await storage.setConnectionStatus(conn.id, 'needs_reauth', why);
  announceConnectionChange(conn.principal);
}
