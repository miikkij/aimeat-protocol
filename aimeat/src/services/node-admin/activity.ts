/**
 * @file src/services/node-admin/activity.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node-wide activity figures the operator reads: every agent, action, board and work
 *   item, and how many agents were seen in the last 24 hours. GET /v1/admin/dashboard and
 *   aimeat_admin_stats both read them here, so the reads and the 24-hour rule are written once
 *   (structure programme 2026-11, unit 2b).
 *
 *   WHO. The node operator in person, or the operator's agent holding operator:admin. Both surfaces ask
 *   the one shared question for that, services/operator-principal.ts askOperator (the route through
 *   requireOperator, the tool through resolveOperatorAgentName), before they call this; this function
 *   takes that answer as given and is never reached by anyone else.
 * @structure nodeActivity(storage, now?) → { agents, actions, boards, allWork, activeAgents24h }
 * @usage const { agents, activeAgents24h } = await nodeActivity(storage);
 * @version-history
 *   v1.0.0 — 2026-11-13 — Moved from routes/admin.ts and mcp/core-admin.ts, which each held the four
 *     reads and the count (structure programme 2026-11, unit 2b).
 */
import type { Storage } from '../../storage/interface.js';

const DAY_MS = 86_400_000;

/** The node's agents, actions, boards and work items, and the agents seen within a day of `now`. */
export async function nodeActivity(storage: Storage, now: number = Date.now()): Promise<{
    agents: Awaited<ReturnType<Storage['listAgents']>>;
    actions: Awaited<ReturnType<Storage['listActions']>>;
    boards: Awaited<ReturnType<Storage['listBoards']>>;
    allWork: Awaited<ReturnType<Storage['listAllWork']>>;
    activeAgents24h: number;
}> {
    const agents = await storage.listAgents();
    const actions = await storage.listActions();
    const boards = await storage.listBoards();
    const allWork = await storage.listAllWork();
    let activeAgents24h = 0;
    for (const a of agents) {
        if (a.lastSeen && now - new Date(a.lastSeen).getTime() < DAY_MS) activeAgents24h++;
    }
    return { agents, actions, boards, allWork, activeAgents24h };
}
