/**
 * @file agent-orphans.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Boot step: the outside-account connections and own app clients of agents deleted
 *   before 2026-10-09, removed.
 *
 *   WHY. Until 2026-10-09 deleting an agent left its connections and its own app clients in place,
 *   under its GAII (secrets audit 2026-10-09, chapter 2, F2). Nobody could see or revoke them, and a
 *   new agent made with the same name gets the same GAII and so inherited the old mailbox. The
 *   storage cascade takes them with the agent now; this step removes what earlier deletions left.
 *
 *   POSITIVE EVIDENCE ONLY. A principal is taken as a deleted agent's when it parses as a GAII of
 *   THIS node (an ecosystem app's GEAI does not) and no agent row holds it. Anything else stays.
 *   Idempotent, and it never throws: a failure leaves the rows for the next boot.
 * @structure removeDeletedAgentsConnections
 * @usage await removeDeletedAgentsConnections(storage, config.nodeId);
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, chapter 2, F2).
 */
import type { Storage } from '../../storage/interface.js';
import { parseGAII } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';

/** Returns how many connections and app clients went. */
export async function removeDeletedAgentsConnections(
  storage: Storage, nodeId: string,
): Promise<{ connections: number; clients: number }> {
  const done = { connections: 0, clients: 0 };
  try {
    const principals = new Set((await storage.listConnections()).map(c => c.principal));
    for (const principal of principals) {
      const parsed = parseGAII(principal);
      if (!parsed || parsed.node !== nodeId) continue;
      if (await storage.getAgent(principal)) continue;
      done.connections += await storage.deleteConnectionsByPrincipal(principal);
      for (const c of await storage.listPrincipalProviderClients(principal)) {
        if (await storage.deletePrincipalProviderClient(c.provider, principal)) done.clients++;
      }
    }
    if (done.connections || done.clients) {
      logger.info(`[connections] removed ${done.connections} connection(s) and ${done.clients} app client(s) of agents that no longer exist`);
    }
  } catch (err) {
    logger.warn(`[connections] removing deleted agents' connections failed; they stay until the next boot: ${String((err as Error).message ?? err)}`);
  }
  return done;
}
