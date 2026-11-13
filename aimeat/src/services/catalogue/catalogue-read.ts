/**
 * @file src/services/catalogue/catalogue-read.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node catalogue's listing rules, held once for the /v1/catalogue routes and the
 *   MCP catalogue tools (CLAUDE.md, Backend: one capability, one implementation). Both surfaces wrote
 *   the same two filters until 2026-11-13:
 *
 *   - An agent tagged `unlisted` (the per-owner Secretary, for one) is out of the public directory.
 *   - The boards directory lists public boards only.
 *
 *   The routes keep their 30-second cache around the raw lists and apply the rule to the cached list;
 *   the tools read fresh through listListedAgents and listPublicBoards.
 * @structure listedAgents · publicBoards · listListedAgents · listPublicBoards
 * @usage const agents = await listListedAgents(storage);
 * @version-history
 *   v1.0.0 — 2026-11-13 — Initial (structure programme unit 2).
 */
import type { Storage, AgentRecord, BoardRecord } from '../../storage/interface.js';

/** The agents the public directory lists: every agent not tagged `unlisted`. */
export function listedAgents(agents: AgentRecord[]): AgentRecord[] {
    return agents.filter(a => !(a.tags ?? []).includes('unlisted'));
}

/** The boards the public directory lists: the public ones. */
export function publicBoards(boards: BoardRecord[]): BoardRecord[] {
    return boards.filter(b => b.visibility === 'public');
}

/** The agents the public directory lists, read fresh. */
export async function listListedAgents(storage: Storage): Promise<AgentRecord[]> {
    return listedAgents(await storage.listAgents());
}

/** The boards the public directory lists, read fresh. */
export async function listPublicBoards(storage: Storage): Promise<BoardRecord[]> {
    return publicBoards(await storage.listBoards());
}
