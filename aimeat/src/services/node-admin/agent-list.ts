/**
 * @file src/services/node-admin/agent-list.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's node-wide agent list: every agent, the page `limit` asks for, and each
 *   shown agent's avatar. GET /v1/admin/agents and the MCP tool aimeat_admin_agents each read the list
 *   and cut it. The route cut it only for a positive whole number; the tool cut it for any truthy
 *   value, so limit=-1 left out the last agent (structure programme 2026-11, unit 2b, B6). The route's
 *   rule is the one both use now: a limit that is not a positive whole number lists every agent.
 *   The operator check stays at each surface (requireOperator, askOperator), one rule in both.
 * @structure OperatorAgentList · operatorAgentList(storage, limit, where)
 * @usage const { shown, total, avatars } = await operatorAgentList(storage, req.query.limit, 'GET /v1/admin/agents');
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (structure programme 2026-11, unit 2b part 2, B6; developer approval 2026-11-14).
 */
import type { Storage } from '../../storage/interface.js';
import { readAvatarsOrEmpty, type AvatarView } from '../agent/avatar.js';
import { logger } from '../../utils/logger.js';

type Agent = Awaited<ReturnType<Storage['listAgents']>>[number];

export interface OperatorAgentList {
    shown: Agent[];
    /** Every agent on the node, whatever the page. */
    total: number;
    avatars: Map<string, AvatarView>;
}

/** The node's agents, cut to `limit` when it reads as a positive whole number (parseInt), with their avatars. */
export async function operatorAgentList(storage: Storage, limit: unknown, where: string): Promise<OperatorAgentList> {
    const agents = await storage.listAgents();
    const n = Number.parseInt(String(limit ?? ''), 10);
    const shown = Number.isFinite(n) && n > 0 ? agents.slice(0, n) : agents;
    const avatars = await readAvatarsOrEmpty(storage, shown.map(a => a.gaii), logger.warn.bind(logger), where);
    return { shown, total: agents.length, avatars };
}
