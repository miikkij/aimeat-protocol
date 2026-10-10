/**
 * @file src/routes/home/agents.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The home's read of a person's agents.
 *
 *     GET /v1/home/agents?limit=5          the owner in person
 *     GET /v1/home/agents?agent=<name>     the same answer with that one agent as its only worker
 *
 *   Proposals that wait for the person, the agents that do work (when each works, on which machine,
 *   what it last did) and the person's machines, in one answer. The home's Agents block draws it.
 *   The projection is built in services/home-agents.ts from the functions the Agents page, the
 *   scheduler and the connector list already call.
 *
 *   The owner in person, like every home route (requireOwnerSession): this is the person's own page.
 *   An AI reads the same facts with aimeat_agents_list and aimeat_connector_list.
 * @structure registerHomeAgentsRoutes(router, ctx)
 * @usage registerHomeAgentsRoutes(router, ctx);
 * @version-history
 *   v1.0.0 — 2026-10-10 — Initial (wish-agentit-home-ruudusta-kuvaile-tilaa-ja-valitse-kone).
 */
import type { Router } from 'express';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { success } from '../../middleware/envelope.js';
import { readHomeAgents } from '../../services/home-agents.js';
import { requireOwnerSession, type HomeRouteCtx } from './welcome-mat.js';

/** How many workers one read lists unless the page asks, and the most it may ask for. */
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

export function registerHomeAgentsRoutes(router: Router, ctx: HomeRouteCtx): void {
    const { config, storage } = ctx;

    router.get('/v1/home/agents', requireAuth(), requireRole('owner'), requireOwnerSession(config.nodeId), async (req, res) => {
        const asked = Number.parseInt(String(req.query.limit ?? ''), 10);
        const limit = Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_LIMIT) : DEFAULT_LIMIT;
        const only = typeof req.query.agent === 'string' && req.query.agent.trim() ? req.query.agent.trim() : undefined;
        const view = await readHomeAgents({ config, storage }, req.auth!.owner, limit, only);
        res.json(success(config.nodeId, view, [
            { description: 'Every agent', method: 'GET', url: '/v1/agents?include=stats' },
            { description: 'The machines', method: 'GET', url: '/v1/agents/v2/connectors' },
        ]));
    });
}
