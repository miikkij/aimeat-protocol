/**
 * @file src/routes/knowledge/helpers.ts
 * @description Shared closures for the knowledge package routes — identity resolution and the
 *   owner-scope memory lookup (GHII + all agents). Extracted from src/routes/knowledge.ts so the
 *   split route-group modules can share them. Extracted to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/knowledge.ts (max-file-lines)
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import { resolveIdentity } from '../../utils/gaii.js';

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
  async function findOwnerScopeMemory(req: Express.Request, key: string) {
    const callerGaii = resolve(req);
    const record = await storage.getMemory(callerGaii, key);
    if (record) return { record, ownerGaii: callerGaii };

    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    if (!isOwnerSession) return null;

    const ownerName = req.auth!.owner as string;
    const agents = await storage.getAgentsByOwner(ownerName);
    for (const agent of agents) {
      const agentRecord = await storage.getMemory(agent.gaii, key);
      if (agentRecord) return { record: agentRecord, ownerGaii: agent.gaii };
    }
    return null;
  }

  return { resolve, findOwnerScopeMemory };
}
