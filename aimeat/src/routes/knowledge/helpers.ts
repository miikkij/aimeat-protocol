/**
 * @file src/routes/knowledge/helpers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared closures for the knowledge package routes — identity resolution and the
 *   owner-scope memory lookup (GHII + all agents). Extracted from src/routes/knowledge.ts so the
 *   split route-group modules can share them. Extracted to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/knowledge.ts (max-file-lines)
 *   v1.1.0 — 2026-07-16 — findOwnerScopeMemory batches the agent scan into one listMemoryForOwners
 *   v1.1.1 — 2026-09-29 — TARGET-082 V4: findOwnerScopeMemory is documented as the unchecked
 *     lookup for read-to-update; a route that puts its record in a response passes it through
 *     presentMemory first (packages-core.ts GET /v1/knowledge/:id does).
 *   v1.1.2 — 2026-10-05 — The account holder in person is asked with isOwnerInPerson (utils/gaii.ts;
 *     secaudit 2026-10, C4).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import { resolveIdentity, isOwnerInPerson } from '../../utils/gaii.js';

export type KnowledgeHelpers = {
  resolve: (req: Express.Request) => string;
  findOwnerScopeMemory: (
    req: Express.Request,
    key: string,
  ) => Promise<{ record: MemoryRecord; ownerGaii: string } | null>;
};

export function makeKnowledgeHelpers(config: AimeatConfig, storage: Storage): KnowledgeHelpers {
  const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

  // Find a memory record across the owner's scope (GHII + all agents).
  // Owner sessions store packages under GHII but agents store under GAII.
  // Returns the record + the actual ownerGaii it was found under.
  // Unchecked by classification: the sharing routes read it to update it. A route that returns the
  // record to the caller passes it through presentMemory (services/classification/present-memory.ts).
  async function findOwnerScopeMemory(req: Express.Request, key: string) {
    const callerGaii = resolve(req);
    const record = await storage.getMemory(callerGaii, key);
    if (record) return { record, ownerGaii: callerGaii };

    if (!isOwnerInPerson(req.auth)) return null;

    const ownerName = req.auth!.owner as string;
    const agents = await storage.getAgentsByOwner(ownerName);
    // One IN query for `key` across every owner agent (was getMemory per agent); same isLive
    // semantics as getMemory. Return the first agent (original order) that has it.
    const rows = await storage.listMemoryForOwners(agents.map(a => a.gaii), { prefix: key });
    const byGaii = new Map(rows.filter(r => r.key === key).map(r => [r.ownerGaii, r]));
    for (const agent of agents) {
      const agentRecord = byGaii.get(agent.gaii);
      if (agentRecord) return { record: agentRecord, ownerGaii: agent.gaii };
    }
    return null;
  }

  return { resolve, findOwnerScopeMemory };
}
