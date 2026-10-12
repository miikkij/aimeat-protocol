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
 *   v1.2.0 — 2026-10-12 — GET /v1/home/agents/choices?include=tools: each app with the tools an
 *     agent of the person can call on it.
 *   v1.1.0 — 2026-10-11 — PUT and DELETE /v1/agents/:name/workplace: where an agent's finished
 *     work goes (services/agent-workplace.ts).
 *   v1.0.0 — 2026-10-10 — Initial (wish-agentit-home-ruudusta-kuvaile-tilaa-ja-valitse-kone).
 */
import type { Router, Request } from 'express';
import { requireAuth, requireRole, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { callerOf } from '../../middleware/caller.js';
import { emitChange } from '../../services/event-bus.js';
import { readHomeAgents } from '../../services/home-agents.js';
import { setWorkplace, clearWorkplace, workplaceView, type WorkplaceCaller } from '../../services/agent-workplace.js';
import { readTieChoices } from '../../services/agent-ties.js';
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

    // GET /v1/home/agents/choices — what the person can pick for an agent's ties: the workspaces of
    // the organisms they are in (where its work may go) and their own apps (which may show it).
    // ?include=tools adds, to each app, the tools an agent of the person can call on it: the page
    // that drafts a new agent gives them to the model that writes the draft.
    router.get('/v1/home/agents/choices', requireAuth(), requireRole('owner'), requireOwnerSession(config.nodeId), async (req, res) => {
        const include = typeof req.query.include === 'string' ? req.query.include.split(',') : [];
        res.json(success(config.nodeId, await readTieChoices({ config, storage }, req.auth!.owner, { tools: include.includes('tools') })));
    });

    /** Who is asking, in the terms services/agent-workplace.ts takes. */
    const workplaceCaller = (req: Request): WorkplaceCaller => {
        const caller = callerOf(req, config.nodeId, storage);
        return { principal: caller.principal, ownerName: caller.owner, roles: [...caller.roles], scopes: [...caller.scopes] };
    };

    // PUT /v1/agents/:name/workplace — name the workspace this agent's finished work is shared with.
    // Body: { organism_id, workspace_id }. The owner in person, or a session of theirs that may
    // change the agent. The answer is the stored place; GET /v1/home/agents reads it with names.
    router.put('/v1/agents/:name/workplace', requireAuth(), requireScope('agent:write'), async (req, res) => {
        const out = await setWorkplace({ config, storage }, workplaceCaller(req), req.params.name as string, {
            organismId: req.body?.organism_id, workspaceId: req.body?.workspace_id,
        });
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        emitChange('agents');
        res.json(success(config.nodeId, { agent: req.params.name, workplace: workplaceView(out.workplace) }));
    });

    // DELETE /v1/agents/:name/workplace — back to the default: the work stays in the agent's own
    // memory. What was already shared stays shared.
    router.delete('/v1/agents/:name/workplace', requireAuth(), requireScope('agent:write'), async (req, res) => {
        const out = await clearWorkplace({ config, storage }, workplaceCaller(req), req.params.name as string);
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        emitChange('agents');
        res.json(success(config.nodeId, { agent: req.params.name, workplace: null }));
    });
}
