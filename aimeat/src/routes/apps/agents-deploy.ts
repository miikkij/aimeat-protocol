/**
 * @file src/routes/apps/agents-deploy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agent-Bundled Apps (Slice 1) — deploy/undeploy/status routes for the crew-defs an
 *   app declares under manifest.cortex.agents. Deploy/undeploy create a pointer task (scope kind
 *   "deploy-app-agent"/"undeploy-app-agent") on the AUTHENTICATED OWNER'S OWN runner agent —
 *   single-tenant by construction: the target owner is ALWAYS the requester (resolveIdentity),
 *   a client-supplied owner that differs is 403, and the node never executes the crew-def.
 *   Status derives the fleet's deployed name (<agent_name>-<slug(app_id)>) and reads liveness
 *   from the agent registration + the agents.<name>.deploy memory key the fleet writes.
 *   The work itself is in services/app-agent-deploy.ts; this file holds the auth and the envelope.
 * @structure
 *   - registerAppAgentRoutes() — POST .../agents/:agentName/deploy | /undeploy, GET .../status,
 *     GET .../instances (hosted instances of the agent + their PUBLIC offers/prices)
 * @usage registered from appsRouter() in src/routes/apps.ts
 * @version-history
 *   v1.4.2 — 2026-10-05 — The account holder in person is asked with isOwnerInPerson (utils/gaii.ts; secaudit 2026-10, C4).
 *   v1.4.1 — 2026-10-05 — tokenHasScope is scopeIsCovered (secaudit 2026-10, C3).
 *   v1.4.0 — 2026-10-01 — Passes the caller's principal, so a deploy with no runner becomes a proposal
 *     the owner approves instead of RUNNER_NOT_FOUND (services/app-agent-propose.ts).
 *   v1.3.0 — 2026-09-27 — The app lookup, the declared-agent check, the runner lookup and the
 *     instances and status reads moved unchanged to deployAppAgent(), appAgentInstances() and
 *     appAgentStatus() in services/app-agent-deploy.ts, so the MCP tool calls the same code. The
 *     role check, the app-grant scope check and the single-tenant guard stay here.
 *   v1.2.2 — 2026-09-26 — The supplied target owner and the app owner in the URL come from
 *     localAccountName too, which keeps an identity of another node whole, so neither names the
 *     local namesake (secaudit 2026-09, F-1).
 *   v1.2.1 — 2026-09-24 — bareOwner(req) is localAccountName: a visitor's home GHII stays whole and
 *     never names the local account sharing its local part (secaudit 2026-09, F-1).
 *   v1.2.0 — 2026-09-06 — The shelf's `online` counts a live connector socket, so a hosted agent
 *     that starts a runtime per job is offered rather than sorted to the bottom as offline.
 *   v1.1.0 — 2026-07-16 — Slice 2: GET .../instances — discover already-hosted instances of an
 *     app's bundled agent (deployed-name convention + the author's original) with their public
 *     offers + prices, so the catalog can show "use a hosted one" vs "deploy your own".
 *   v1.0.0 — 2026-07-16 — Initial creation (Agent-Bundled Apps Slice 1, node side)
 */
import type { Router, Request, Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, optionalAuth, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { localAccountName, isOwnerInPerson } from '../../utils/gaii.js';
import { scopeIsCovered } from '../../utils/scope-coverage.js';
import {
    deployAppAgent, appAgentInstances, appAgentStatus, type AppAgentRefusal,
} from '../../services/app-agent-deploy.js';

/** Bare owner name of the authenticated principal (owner claim may carry an @node suffix). */
function bareOwner(req: Request): string {
    return localAccountName(req.auth!.owner);
}

/** scopeIsCovered, the rule requireScope applies (C3). */
function tokenHasScope(req: Request, scope: string): boolean {
    return scopeIsCovered(req.auth!.scopes ?? [], scope);
}

/** Send a service refusal as the envelope the route answered before the extraction. */
function sendRefusal(res: Response, config: AimeatConfig, r: AppAgentRefusal): void {
    res.status(r.status).json(error(config.nodeId, r.code, r.message));
}

/**
 * Shared auth preamble for the deploy, undeploy and status routes: authorize the principal (owner
 * session, same-owner agent, or an app grant holding `scope`) and enforce the HARD single-tenant
 * guard (any client-supplied owner must equal the requester — cross-owner is 403). Returns the
 * requester's bare owner name, or null after responding on any failure. The app lookup and the
 * declared-agent check follow in the service.
 */
function authorizeAppAgentCaller(
    req: Request, res: Response, config: AimeatConfig, appScope: string,
): string | null {
    const roles = req.auth!.roles as string[];
    const isOwner = isOwnerInPerson(req.auth);
    const isAgent = roles.includes('agent');
    const isApp = roles.includes('app');
    if (!isOwner && !isAgent && !isApp) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only owners, agents, or granted apps may manage app-agent deployments'));
        return null;
    }
    if (isApp && !tokenHasScope(req, appScope)) {
        res.status(403).json(error(config.nodeId, 'SCOPE_DENIED', `Scope "${appScope}" required`));
        return null;
    }

    // HARD GUARD (single-tenant, Slice 1): the deploy target is ALWAYS the requesting
    // principal's owner. A client-supplied owner/target_owner naming anyone else is 403 —
    // an installer deploying someone else's published app gets the agent under THEIR OWN
    // owner, never the author's, and no one can point a deploy at a foreign fleet.
    const owner = bareOwner(req);
    const suppliedTarget = (req.body?.owner ?? req.body?.target_owner ?? req.query?.owner) as string | undefined;
    if (typeof suppliedTarget === 'string' && suppliedTarget.length > 0) {
        const bare = localAccountName(suppliedTarget);
        if (bare !== owner) {
            res.status(403).json(error(config.nodeId, 'CROSS_OWNER_FORBIDDEN',
                'You can only deploy onto your own agents. Leave the owner out and it will use yours.'));
            return null;
        }
    }
    return owner;
}

export function registerAppAgentRoutes(router: Router, config: AimeatConfig, storage: Storage): void {

    /** Create the deploy/undeploy pointer task on the requester's own runner agent. */
    async function handleAction(req: Request, res: Response, kind: 'deploy-app-agent' | 'undeploy-app-agent'): Promise<void> {
        const owner = authorizeAppAgentCaller(req, res, config, 'task:write');
        if (owner === null) return;

        const result = await deployAppAgent(storage, config, {
            callerOwner: owner,
            appOwner: req.params.owner as string,
            filename: req.params.filename as string,
            agentName: req.params.agentName as string,
            runnerAgent: typeof req.body?.runner_agent === 'string' ? req.body.runner_agent : undefined,
            organismId: typeof req.body?.organism_id === 'string' ? req.body.organism_id : undefined,
            undeploy: kind === 'undeploy-app-agent',
            // Lets a deploy with no runner become a proposal for the owner (app-agent-propose.ts).
            principal: { sub: req.auth!.sub, owner, roles: req.auth!.roles, scopes: req.auth!.scopes ?? [] },
        });
        if (!result.ok) { sendRefusal(res, config, result); return; }
        res.status(201).json(success(config.nodeId, result.view, result.links));
    }

    // POST /v1/apps/:owner/:filename/agents/:agentName/deploy
    router.post('/v1/apps/:owner/:filename/agents/:agentName/deploy', requireAuth(), requireScope('task:write'), (req, res) => void handleAction(req, res, 'deploy-app-agent'));

    // POST /v1/apps/:owner/:filename/agents/:agentName/undeploy
    router.post('/v1/apps/:owner/:filename/agents/:agentName/undeploy', requireAuth(), requireScope('task:write'), (req, res) => void handleAction(req, res, 'undeploy-app-agent'));

    // GET /v1/apps/:owner/:filename/agents/:agentName/instances — hosted instances of an app's
    // bundled agent on THIS node, with their PUBLIC offers + prices (appAgentInstances). Read-only,
    // optionalAuth — it exposes nothing beyond the public agents directory + offers each host
    // explicitly marked public.
    router.get('/v1/apps/:owner/:filename/agents/:agentName/instances', optionalAuth(), async (req, res) => {
        const result = await appAgentInstances(storage, config, {
            appOwner: req.params.owner as string,
            filename: req.params.filename as string,
            agentName: req.params.agentName as string,
            callerOwner: req.auth && !req.auth.anonymous ? bareOwner(req) : null,
        });
        if (!result.ok) { sendRefusal(res, config, result); return; }
        res.json(success(config.nodeId, result.view));
    });

    // GET /v1/apps/:owner/:filename/agents/:agentName/status — liveness as the app UI reads it
    // (appAgentStatus): the deployed agent's registration + the agents.<name>.deploy key the fleet
    // writes, looked up under the requesting owner's namespaces only.
    router.get('/v1/apps/:owner/:filename/agents/:agentName/status', requireAuth(), async (req, res) => {
        const owner = authorizeAppAgentCaller(req, res, config, 'task:read');
        if (owner === null) return;

        const result = await appAgentStatus(storage, config, {
            callerOwner: owner,
            appOwner: req.params.owner as string,
            filename: req.params.filename as string,
            agentName: req.params.agentName as string,
            runnerAgent: typeof req.query.runner_agent === 'string' ? req.query.runner_agent : undefined,
        });
        if (!result.ok) { sendRefusal(res, config, result); return; }
        res.json(success(config.nodeId, result.view));
    });
}
