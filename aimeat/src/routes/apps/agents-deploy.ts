/**
 * @file src/routes/apps/agents-deploy.ts
 * @description Agent-Bundled Apps (Slice 1) — deploy/undeploy/status routes for the crew-defs an
 *   app declares under manifest.cortex.agents. Deploy/undeploy create a pointer task (scope kind
 *   "deploy-app-agent"/"undeploy-app-agent") on the AUTHENTICATED OWNER'S OWN runner agent —
 *   single-tenant by construction: the target owner is ALWAYS the requester (resolveIdentity),
 *   a client-supplied owner that differs is 403, and the node never executes the crew-def.
 *   Status derives the fleet's deployed name (<agent_name>-<slug(app_id)>) and reads liveness
 *   from the agent registration + the agents.<name>.deploy memory key the fleet writes.
 * @structure
 *   - registerAppAgentRoutes() — POST .../agents/:agentName/deploy | /undeploy, GET .../status,
 *     GET .../instances (hosted instances of the agent + their PUBLIC offers/prices)
 * @usage registered from appsRouter() in src/routes/apps.ts
 * @version-history
 *   v1.1.0 — 2026-07-16 — Slice 2: GET .../instances — discover already-hosted instances of an
 *     app's bundled agent (deployed-name convention + the author's original) with their public
 *     offers + prices, so the catalog can show "use a hosted one" vs "deploy your own".
 *   v1.0.0 — 2026-07-16 — Initial creation (Agent-Bundled Apps Slice 1, node side)
 */
import type { Router, Request, Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, AppRecord } from '../../storage/interface.js';
import { requireAuth, optionalAuth } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { buildGAII, validateAgentName } from '../../utils/gaii.js';
import { deployedAgentName } from '../../models/crew-def-schemas.js';
import type { Offer } from '../../models/offer-schemas.js';
import { createAppAgentTask } from '../../services/app-agent-deploy.js';

/** Default runner-agent name: crewaimeat's crew-forge daemon registers under this name. */
const DEFAULT_RUNNER = 'crew-forge';

/** Bare owner name of the authenticated principal (owner claim may carry an @node suffix). */
function bareOwner(req: Request): string {
    const raw = req.auth!.owner;
    return raw.includes('@') ? raw.split('@')[0] : raw;
}

function tokenHasScope(req: Request, scope: string): boolean {
    const scopes: string[] = req.auth!.scopes ?? [];
    const [domain] = scope.split(':');
    return scopes.includes(scope) || scopes.includes(`${domain}:*`) || scopes.includes('*');
}

/**
 * Shared preamble for all three routes: authorize the principal (owner session, same-owner
 * agent, or an app grant holding `scope`), enforce the HARD single-tenant guard (any
 * client-supplied owner must equal the requester — cross-owner is 403), resolve the app,
 * and locate the declared crew-def. Returns null after responding on any failure.
 */
async function resolveDeployContext(
    req: Request, res: Response, config: AimeatConfig, storage: Storage, appScope: string,
): Promise<{ owner: string; app: AppRecord; appId: string; agentName: string } | null> {
    const roles = req.auth!.roles as string[];
    const isOwner = roles.includes('owner') && !roles.includes('agent');
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
        const bare = suppliedTarget.includes('@') ? suppliedTarget.split('@')[0] : suppliedTarget;
        if (bare !== owner) {
            res.status(403).json(error(config.nodeId, 'CROSS_OWNER_FORBIDDEN',
                'App agents deploy onto YOUR OWN fleet only — the target owner is always the authenticated owner'));
            return null;
        }
    }

    const appOwner = req.params.owner as string;
    const filename = req.params.filename as string;
    const agentName = req.params.agentName as string;
    const app = await storage.getAppByOwnerName(
        appOwner.includes('@') ? appOwner.split('@')[0] : appOwner, filename);
    // Foreign apps are deployable only when publicly runnable — parked, operator-hidden and
    // access-coded apps stay invisible to non-owners (404, matching the download routes).
    if (!app || (app.ownerName !== owner && (app.parked || app.operatorHidden || app.accessCode))) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'App not found'));
        return null;
    }

    const declared = (app.manifest?.cortex?.agents ?? [])
        .find(a => (a as { agent_name?: unknown }).agent_name === agentName);
    if (!declared) {
        res.status(404).json(error(config.nodeId, 'AGENT_NOT_DECLARED',
            `App "${app.ownerName}/${app.filename}" does not declare an agent named "${agentName}" in manifest.cortex.agents`));
        return null;
    }

    return { owner, app, appId: `${app.ownerName}/${app.filename}`, agentName };
}

export function registerAppAgentRoutes(router: Router, config: AimeatConfig, storage: Storage): void {

    /** Create the deploy/undeploy pointer task on the requester's own runner agent. */
    async function handleAction(req: Request, res: Response, kind: 'deploy-app-agent' | 'undeploy-app-agent'): Promise<void> {
        const ctx = await resolveDeployContext(req, res, config, storage, 'task:write');
        if (!ctx) return;

        const runnerName = typeof req.body?.runner_agent === 'string' && req.body.runner_agent.length > 0
            ? req.body.runner_agent : DEFAULT_RUNNER;
        const nameError = validateAgentName(runnerName);
        if (nameError) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `runner_agent: ${nameError}`));
            return;
        }
        // The runner is looked up under the REQUESTER's owner only — a foreign fleet is
        // unreachable by construction (there is no way to name another owner's agent here).
        const runner = await storage.getAgent(buildGAII(runnerName, ctx.owner, config.nodeId));
        if (!runner) {
            res.status(404).json(error(config.nodeId, 'RUNNER_NOT_FOUND',
                `You have no agent named "${runnerName}" to run this deployment. Connect your crew-forge / task-runner first, or pass its name as runner_agent.`));
            return;
        }

        const organismId = typeof req.body?.organism_id === 'string' && req.body.organism_id.length > 0
            ? req.body.organism_id : undefined;

        const { task, autoActivated } = await createAppAgentTask(storage, config, {
            kind, appId: ctx.appId, agentName: ctx.agentName, ownerName: ctx.owner, runner, organismId,
        });

        const deployedName = deployedAgentName(ctx.agentName, ctx.appId);
        res.status(201).json(success(config.nodeId, {
            task_id: task.id,
            task_status: task.status,
            auto_activated: autoActivated,
            kind,
            app_id: ctx.appId,
            agent_name: ctx.agentName,
            deployed_agent_name: deployedName,
            runner_agent: runner.name,
            note: autoActivated
                ? 'Task is active — the runner daemon picks it up immediately.'
                : `Task is queued — start it from the Tasks tab (runner "${runner.name}" is not in task-runner mode).`,
        }, [
            { description: 'Deployment status', method: 'GET', url: `/v1/apps/${encodeURIComponent(ctx.app.ownerName)}/${encodeURIComponent(ctx.app.filename)}/agents/${encodeURIComponent(ctx.agentName)}/status` },
            { description: 'Follow the task', method: 'GET', url: `/v1/agents/${encodeURIComponent(runner.name)}/tasks/${task.id}` },
        ]));
    }

    // POST /v1/apps/:owner/:filename/agents/:agentName/deploy
    router.post('/v1/apps/:owner/:filename/agents/:agentName/deploy', requireAuth(), (req, res) => void handleAction(req, res, 'deploy-app-agent'));

    // POST /v1/apps/:owner/:filename/agents/:agentName/undeploy
    router.post('/v1/apps/:owner/:filename/agents/:agentName/undeploy', requireAuth(), (req, res) => void handleAction(req, res, 'undeploy-app-agent'));

    // GET /v1/apps/:owner/:filename/agents/:agentName/instances — hosted instances of an app's
    // bundled agent on THIS node, with their PUBLIC offers + prices. This is the "buy it hosted
    // vs deploy your own" discovery surface: instances are found by the shared deployed-name
    // convention (<agent_name>-<slug(app_id)>, any owner) plus the app AUTHOR's original agent
    // running under the plain agent_name (source: 'author'). Read-only, optionalAuth — it exposes
    // nothing beyond the public agents directory + offers each host explicitly marked public.
    router.get('/v1/apps/:owner/:filename/agents/:agentName/instances', optionalAuth(), async (req, res) => {
        const appOwnerParam = req.params.owner as string;
        const filename = req.params.filename as string;
        const agentName = req.params.agentName as string;
        const viewer = req.auth && !req.auth.anonymous ? bareOwner(req) : null;
        const app = await storage.getAppByOwnerName(
            appOwnerParam.includes('@') ? appOwnerParam.split('@')[0] : appOwnerParam, filename);
        if (!app || (app.ownerName !== viewer && (app.parked || app.operatorHidden || app.accessCode))) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'App not found'));
            return;
        }
        const declared = (app.manifest?.cortex?.agents ?? [])
            .find(a => (a as { agent_name?: unknown }).agent_name === agentName);
        if (!declared) {
            res.status(404).json(error(config.nodeId, 'AGENT_NOT_DECLARED',
                `App "${app.ownerName}/${app.filename}" does not declare an agent named "${agentName}" in manifest.cortex.agents`));
            return;
        }

        const appId = `${app.ownerName}/${app.filename}`;
        const deployedName = deployedAgentName(agentName, appId);
        const all = await storage.listAgents();
        const now = Date.now();
        const candidates = all.filter(a =>
            (a.name === deployedName || (a.name === agentName && a.owner === app.ownerName))
            && !(a.tags ?? []).includes('unlisted'));

        const instances = await Promise.all(candidates.map(async (a) => {
            const rec = await storage.getMemory(a.gaii, `agents.${a.name}.offers`);
            const offers = (((rec?.value as { offers?: Offer[] } | undefined)?.offers) ?? [])
                .filter(o => o.visibility === 'public')
                .map(o => ({
                    id: o.id,
                    title: o.title,
                    ask: o.ask,
                    cost: o.cost,
                    deliverable: o.deliverable,
                    price: o.price ?? null,
                    price_money: o.priceMoney ?? null,
                    callable: !!o.callable,
                }));
            return {
                gaii: a.gaii,
                name: a.name,
                owner: a.owner,
                display_name: a.displayName ?? a.name,
                trust_score: a.trustScore,
                last_seen: a.lastSeen ?? null,
                online: !!(a.lastSeen && (now - new Date(a.lastSeen).getTime()) < 10 * 60 * 1000),
                source: a.name === deployedName ? 'deployed' as const : 'author' as const,
                is_yours: viewer !== null && a.owner === viewer,
                offers,
            };
        }));
        // Live, offer-bearing hosts first — that's the "buy it here" shelf.
        instances.sort((x, y) => Number(y.online) - Number(x.online) || y.offers.length - x.offers.length);

        res.json(success(config.nodeId, {
            app_id: appId,
            agent_name: agentName,
            deployed_agent_name: deployedName,
            instances,
            total: instances.length,
        }));
    });

    // GET /v1/apps/:owner/:filename/agents/:agentName/status — liveness as the app UI reads it:
    // the deployed agent's registration + the agents.<name>.deploy key the fleet writes. The key
    // may live under the deployed agent's, the runner's, or the owner's namespace depending on
    // which identity wrote it — check all three (all belong to the requesting owner).
    router.get('/v1/apps/:owner/:filename/agents/:agentName/status', requireAuth(), async (req, res) => {
        const ctx = await resolveDeployContext(req, res, config, storage, 'task:read');
        if (!ctx) return;

        const runnerName = typeof req.query.runner_agent === 'string' && req.query.runner_agent.length > 0
            ? req.query.runner_agent : DEFAULT_RUNNER;
        const deployedName = deployedAgentName(ctx.agentName, ctx.appId);
        const deployedGaii = buildGAII(deployedName, ctx.owner, config.nodeId);
        const registered = await storage.getAgent(deployedGaii);

        const key = `agents.${deployedName}.deploy`;
        let deployState: unknown = null;
        for (const ns of [deployedGaii, buildGAII(runnerName, ctx.owner, config.nodeId), `${ctx.owner}@${config.nodeId}`]) {
            const rec = await storage.getMemory(ns, key);
            if (rec) { deployState = rec.value; break; }
        }

        const stateStatus = (deployState as { status?: unknown } | null)?.status;
        res.json(success(config.nodeId, {
            app_id: ctx.appId,
            agent_name: ctx.agentName,
            deployed_agent_name: deployedName,
            registered: !!registered,
            last_seen: registered?.lastSeen ?? null,
            deploy_state: deployState,
            live: stateStatus === 'live' || (stateStatus === undefined && !!registered),
        }));
    });
}
