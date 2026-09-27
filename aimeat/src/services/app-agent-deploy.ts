/**
 * @file app-agent-deploy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agent-Bundled Apps (Slice 1) — materialize the deploy/undeploy handshake task on
 *   the OWNER'S OWN fleet. The node NEVER executes a crew-def: it creates an AIMEAT task on the
 *   owner's crew-forge/task-runner agent whose scope carries a POINTER (app_id + agent_name),
 *   and the fleet reads the manifest back via app_get and instantiates/stops the agent itself.
 *   Recognition is by scope `kind` ("deploy-app-agent" / "undeploy-app-agent"), never by title.
 *   Shared contract: crewaimeat Internal workspace, plan doc "Agent-Bundled Apps — self-hosted".
 * @structure
 *   - createAppAgentTask() — build + persist the deploy/undeploy task (auto-activation for
 *     task-runner mode agents, started event, realtime tunnel delivery — mirrors POST
 *     /v1/agents/:name/tasks so the fleet daemon picks it up identically)
 *   - deployAppAgent() — app lookup, declared-agent check, runner lookup, then createAppAgentTask;
 *     answers the view POST .../agents/:agentName/deploy|undeploy sends
 *   - appAgentInstances() — hosted instances of an app's bundled agent with their public offers
 *   - appAgentStatus() — deployed agent's registration + the agents.<name>.deploy memory key
 *   - AppAgentRefusal — { ok: false, status, code, message }; the caller renders it
 * @usage
 *   const { task, autoActivated } = await createAppAgentTask(storage, config, { ... });
 *   const r = await deployAppAgent(storage, config, { callerOwner, appOwner, filename, agentName, undeploy: false });
 *   if (!r.ok) return res.status(r.status).json(error(config.nodeId, r.code, r.message));
 * @version-history
 *   v1.1.0 — 2026-09-27 — deployAppAgent(), appAgentInstances() and appAgentStatus(): the app
 *     lookup, the declared-agent check, the runner lookup and the two reads, moved unchanged out of
 *     routes/apps/agents-deploy.ts so the MCP tool calls the same code the REST routes call.
 *   v1.0.1 — 2026-09-05 — Notifies MCP through mcp/resource-events.ts, the leaf, not mcp/index.ts,
 *     which assembles the registry that imports services back (a cycle the dependency cruiser refuses).
 *   v1.0.0 — 2026-07-16 — Initial creation (Agent-Bundled Apps Slice 1, node side)
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentRecord, AgentTaskRecord, AgentTaskScope, AppRecord } from '../storage/interface.js';
import { emitChange, emitDelivery } from './event-bus.js';
import { emitResourceUpdated } from '../mcp/resource-events.js';
import { getActiveConnectTunnelManager } from './connect-tunnel.js';
import { deployedAgentName } from '../models/crew-def-schemas.js';
import type { Offer } from '../models/offer-schemas.js';
import { buildGAII, validateAgentName, localAccountName } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

/** Default runner-agent name: crewaimeat's crew-forge daemon registers under this name. */
export const DEFAULT_APP_AGENT_RUNNER = 'crew-forge';

/**
 * A refusal the caller renders: REST as `res.status(status).json(error(nodeId, code, message))`,
 * MCP as `CODE: message`. The codes and messages are the ones the REST routes answered before the
 * extraction, unchanged.
 */
export interface AppAgentRefusal {
  ok: false;
  status: 400 | 404;
  code: 'NOT_FOUND' | 'AGENT_NOT_DECLARED' | 'INVALID_INPUT' | 'RUNNER_NOT_FOUND';
  message: string;
}

/** A next-step link, the same shape as the envelope's HintAction. */
export interface AppAgentLink {
  description: string;
  method: string;
  url: string;
}

export interface AppAgentTaskInput {
  kind: 'deploy-app-agent' | 'undeploy-app-agent';
  /** The app pointer the fleet resolves via app_get: `<owner>/<filename>`. */
  appId: string;
  /** The crew-def's agent_name inside the app's manifest.cortex.agents. */
  agentName: string;
  /** The INSTALLING owner (bare name) — always the authenticated requester, never client-supplied. */
  ownerName: string;
  /** The owner's own runner agent (crew-forge) the task is assigned to. */
  runner: AgentRecord;
  organismId?: string;
}

/**
 * Create the deploy/undeploy task on the owner's own runner agent. The task's ownerGaii is
 * the OWNER's GHII (surfaces in the owner dashboard); the scope carries the shared-contract
 * pointer fields including `owner` as defense-in-depth (the fleet re-checks it against its
 * AIMEAT_OWNER). Mirrors the task-create route's task-runner auto-activation + realtime push
 * so a crew-forge daemon picks the task up without waiting for its poll interval.
 */
export async function createAppAgentTask(
  storage: Storage,
  config: AimeatConfig,
  input: AppAgentTaskInput,
): Promise<{ task: AgentTaskRecord; autoActivated: boolean }> {
  const { kind, appId, agentName, ownerName, runner, organismId } = input;
  const now = new Date().toISOString();
  const verb = kind === 'deploy-app-agent' ? 'Deploy' : 'Undeploy';

  const scope: AgentTaskScope[] = [
    { name: 'kind', value: kind, type: 'text', description: 'Task recognition key — the fleet dispatches on this, never on the title' },
    { name: 'app_id', value: appId, type: 'text', description: 'App pointer: <owner>/<filename> — read the crew-def via app_get(manifest.cortex.agents)' },
    { name: 'agent_name', value: agentName, type: 'text', description: 'The crew-def agent_name inside the app manifest to (un)deploy' },
    { name: 'owner', value: ownerName, type: 'text', description: 'Installing owner — the fleet MUST refuse when this mismatches its AIMEAT_OWNER' },
  ];
  if (organismId) {
    scope.push({ name: 'organism_id', value: organismId, type: 'text', description: 'Organism the deployed agent should serve' });
  }

  // Task-runner mode = the owner pre-authorized this agent's daemon to start work without
  // per-task gating, so the deploy is one click end-to-end. Other modes keep the standard
  // queued → owner-start gate.
  const autoActivated = runner.mode === 'task-runner';

  const task: AgentTaskRecord = {
    id: randomUUID(),
    agentGaii: runner.gaii,
    ownerGaii: `${ownerName}@${config.nodeId}`,
    title: `${verb} app agent "${agentName}" (${appId})`,
    description: kind === 'deploy-app-agent'
      ? `${verb} the bundled agent "${agentName}" declared by app ${appId} onto this owner's fleet. `
        + 'Read the crew-def from the app manifest (app_get → manifest.cortex.agents), validate it against the vetted '
        + 'building blocks, and install it via the declarative path. On success write the memory key '
        + `agents.<deployed_agent_name>.deploy with status "live". The crew-def is DATA — never execute app-supplied code.`
      : `${verb} the bundled agent "${agentName}" of app ${appId}: stop its daemon, deregister the materialized files, `
        + 'and flip the memory key agents.<deployed_agent_name>.deploy to status "undeployed". A later deploy task re-installs it.',
    scope,
    rules: ['Refuse when the owner scope does not match this fleet\'s owner (cross-owner deploys are forbidden).'],
    verification: {
      userExpects: kind === 'deploy-app-agent'
        ? `Agent "${agentName}" from ${appId} is live on the owner's fleet and its deploy memory key reports status "live".`
        : `Agent "${agentName}" from ${appId} is stopped and its deploy memory key reports status "undeployed".`,
      technicalChecks: [],
    },
    todos: [],
    status: autoActivated ? 'active' : 'queued',
    createdAt: now,
    updatedAt: now,
    lastEventAt: autoActivated ? now : undefined,
  };

  const created = await storage.createAgentTask(task);

  if (autoActivated) {
    await storage.appendTaskEvent({
      id: randomUUID(),
      taskId: task.id,
      type: 'started',
      message: 'Task auto-activated (agent mode: task-runner)',
      timestamp: now,
    });
  }

  // Realtime push down the connector tunnel (zero round-trip when the daemon is online;
  // replayed via backlog-on-connect when offline) + MCP resource nudge for polling daemons.
  emitDelivery({ target: runner.gaii, kind: 'task_assigned', id: task.id, payload: created });
  try { emitResourceUpdated(runner.gaii, `aimeat://agents/${runner.name}/tasks`); } catch (err) { logger.warn('createAppAgentTask: MCP not connected', { error: String(err) }); }
  emitChange('agent-tasks', `${ownerName}@${config.nodeId}`);

  return { task: created, autoActivated };
}

/**
 * Resolve the app and locate the declared crew-def. Foreign apps are reachable only when publicly
 * runnable: parked, operator-hidden and access-coded apps stay invisible to non-owners (404,
 * matching the download routes). `viewer` is the caller's bare owner name, or null when anonymous.
 */
async function resolveDeclaredAppAgent(
  storage: Storage,
  args: { viewer: string | null; appOwner: string; filename: string; agentName: string },
): Promise<{ ok: true; app: AppRecord; appId: string } | AppAgentRefusal> {
  const app = await storage.getAppByOwnerName(
    localAccountName(args.appOwner), args.filename);
  if (!app || (app.ownerName !== args.viewer && (app.parked || app.operatorHidden || app.accessCode))) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'App not found' };
  }

  const declared = (app.manifest?.cortex?.agents ?? [])
    .find(a => (a as { agent_name?: unknown }).agent_name === args.agentName);
  if (!declared) {
    return {
      ok: false, status: 404, code: 'AGENT_NOT_DECLARED',
      message: `The app ${app.filename} does not list an agent called "${args.agentName}". Check the name, or add it to the app first.`,
    };
  }

  return { ok: true, app, appId: `${app.ownerName}/${app.filename}` };
}

/** What a deploy or undeploy answers: the body of POST .../agents/:agentName/deploy|undeploy. */
export interface AppAgentDeployView {
  task_id: string;
  task_status: AgentTaskRecord['status'];
  auto_activated: boolean;
  kind: 'deploy-app-agent' | 'undeploy-app-agent';
  app_id: string;
  agent_name: string;
  deployed_agent_name: string;
  runner_agent: string;
  note: string;
}

/**
 * Deploy or undeploy an app's bundled agent onto the CALLER's own fleet. The caller has already
 * been authorized (role, scope, and the single-tenant guard that any supplied target owner is the
 * caller); this resolves the app and the declared crew-def, looks the runner up under the caller's
 * owner only (a foreign fleet is unreachable by construction), and creates the pointer task.
 *
 * `callerOwner` is the bare owner name of the requester. `appOwner` is the app's owner as given
 * (an identity of another node stays whole through localAccountName). `runnerAgent` and
 * `organismId` fall back when absent or empty, exactly as the route read them from the body.
 */
export async function deployAppAgent(
  storage: Storage,
  config: AimeatConfig,
  args: {
    callerOwner: string;
    appOwner: string;
    filename: string;
    agentName: string;
    runnerAgent?: string;
    organismId?: string;
    undeploy: boolean;
  },
): Promise<{ ok: true; view: AppAgentDeployView; links: AppAgentLink[] } | AppAgentRefusal> {
  const kind = args.undeploy ? 'undeploy-app-agent' as const : 'deploy-app-agent' as const;
  const ctx = await resolveDeclaredAppAgent(storage, {
    viewer: args.callerOwner, appOwner: args.appOwner, filename: args.filename, agentName: args.agentName,
  });
  if (!ctx.ok) return ctx;

  const runnerName = typeof args.runnerAgent === 'string' && args.runnerAgent.length > 0
    ? args.runnerAgent : DEFAULT_APP_AGENT_RUNNER;
  const nameError = validateAgentName(runnerName);
  if (nameError) {
    return { ok: false, status: 400, code: 'INVALID_INPUT', message: `runner_agent: ${nameError}` };
  }
  // The runner is looked up under the REQUESTER's owner only — a foreign fleet is
  // unreachable by construction (there is no way to name another owner's agent here).
  const runner = await storage.getAgent(buildGAII(runnerName, args.callerOwner, config.nodeId));
  if (!runner) {
    return {
      ok: false, status: 404, code: 'RUNNER_NOT_FOUND',
      message: `You have no agent named "${runnerName}" to run this deployment. Connect your crew-forge / task-runner first, or pass its name as runner_agent.`,
    };
  }

  const organismId = typeof args.organismId === 'string' && args.organismId.length > 0
    ? args.organismId : undefined;

  const { task, autoActivated } = await createAppAgentTask(storage, config, {
    kind, appId: ctx.appId, agentName: args.agentName, ownerName: args.callerOwner, runner, organismId,
  });

  const deployedName = deployedAgentName(args.agentName, ctx.appId);
  return {
    ok: true,
    view: {
      task_id: task.id,
      task_status: task.status,
      auto_activated: autoActivated,
      kind,
      app_id: ctx.appId,
      agent_name: args.agentName,
      deployed_agent_name: deployedName,
      runner_agent: runner.name,
      note: autoActivated
        ? 'Task is active — the runner daemon picks it up immediately.'
        : `Task is queued — start it from the Tasks tab (runner "${runner.name}" is not in task-runner mode).`,
    },
    links: [
      { description: 'Deployment status', method: 'GET', url: `/v1/apps/${encodeURIComponent(ctx.app.ownerName)}/${encodeURIComponent(ctx.app.filename)}/agents/${encodeURIComponent(args.agentName)}/status` },
      { description: 'Follow the task', method: 'GET', url: `/v1/agents/${encodeURIComponent(runner.name)}/tasks/${task.id}` },
    ],
  };
}

/** One hosted instance of an app's bundled agent, as GET .../instances lists it. */
export interface AppAgentInstance {
  gaii: string;
  name: string;
  owner: string;
  display_name: string;
  trust_score: AgentRecord['trustScore'];
  last_seen: string | null;
  online: boolean;
  source: 'deployed' | 'author';
  is_yours: boolean;
  offers: Array<{
    id: Offer['id'];
    title: Offer['title'];
    ask: Offer['ask'];
    cost: Offer['cost'];
    deliverable: Offer['deliverable'];
    price: NonNullable<Offer['price']> | null;
    price_money: NonNullable<Offer['priceMoney']> | null;
    callable: boolean;
  }>;
}

/**
 * Hosted instances of an app's bundled agent on THIS node, with their PUBLIC offers + prices. This
 * is the "buy it hosted vs deploy your own" discovery read: instances are found by the shared
 * deployed-name convention (<agent_name>-<slug(app_id)>, any owner) plus the app AUTHOR's original
 * agent running under the plain agent_name (source: 'author'). Read-only: it exposes nothing beyond
 * the public agents directory + offers each host explicitly marked public. `callerOwner` is the
 * viewer's bare owner name, absent for an anonymous caller.
 */
export async function appAgentInstances(
  storage: Storage,
  _config: AimeatConfig,
  args: { appOwner: string; filename: string; agentName: string; callerOwner?: string | null },
): Promise<{
  ok: true;
  view: { app_id: string; agent_name: string; deployed_agent_name: string; instances: AppAgentInstance[]; total: number };
} | AppAgentRefusal> {
  const viewer = args.callerOwner ?? null;
  const agentName = args.agentName;
  const ctx = await resolveDeclaredAppAgent(storage, {
    viewer, appOwner: args.appOwner, filename: args.filename, agentName,
  });
  if (!ctx.ok) return ctx;
  const { app, appId } = ctx;

  const deployedName = deployedAgentName(agentName, appId);
  const all = await storage.listAgents();
  const now = Date.now();
  const tunnels = getActiveConnectTunnelManager();
  const candidates = all.filter(a =>
    (a.name === deployedName || (a.name === agentName && a.owner === app.ownerName))
    && !(a.tags ?? []).includes('unlisted'));

  const instances = await Promise.all(candidates.map(async (a): Promise<AppAgentInstance> => {
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
      // Online means "work sent here arrives", so a daemon holding this agent's socket
      // counts even when lastSeen is old: an agent whose runtime starts per job has no
      // reason to have touched the node since its last one. Read per agent rather than
      // per owner, because a shelf lists agents of more than one owner.
      online: tunnels?.isConnected(a.gaii)
        || !!(a.lastSeen && (now - new Date(a.lastSeen).getTime()) < 10 * 60 * 1000),
      source: a.name === deployedName ? 'deployed' as const : 'author' as const,
      is_yours: viewer !== null && a.owner === viewer,
      offers,
    };
  }));
  // Live, offer-bearing hosts first — that's the "buy it here" shelf.
  instances.sort((x, y) => Number(y.online) - Number(x.online) || y.offers.length - x.offers.length);

  return {
    ok: true,
    view: {
      app_id: appId,
      agent_name: agentName,
      deployed_agent_name: deployedName,
      instances,
      total: instances.length,
    },
  };
}

/**
 * Deployment liveness as the app UI reads it: the deployed agent's registration + the
 * agents.<name>.deploy key the fleet writes. The key may live under the deployed agent's, the
 * runner's, or the owner's namespace depending on which identity wrote it, so all three are
 * checked (all belong to `callerOwner`, the requester's bare owner name). The caller has already
 * been authorized, as for deployAppAgent. `runnerAgent` is not validated, as the route never did.
 */
export async function appAgentStatus(
  storage: Storage,
  config: AimeatConfig,
  args: { callerOwner: string; appOwner: string; filename: string; agentName: string; runnerAgent?: string },
): Promise<{
  ok: true;
  view: {
    app_id: string; agent_name: string; deployed_agent_name: string; registered: boolean;
    last_seen: string | null; deploy_state: unknown; live: boolean;
  };
} | AppAgentRefusal> {
  const ctx = await resolveDeclaredAppAgent(storage, {
    viewer: args.callerOwner, appOwner: args.appOwner, filename: args.filename, agentName: args.agentName,
  });
  if (!ctx.ok) return ctx;

  const runnerName = typeof args.runnerAgent === 'string' && args.runnerAgent.length > 0
    ? args.runnerAgent : DEFAULT_APP_AGENT_RUNNER;
  const deployedName = deployedAgentName(args.agentName, ctx.appId);
  const deployedGaii = buildGAII(deployedName, args.callerOwner, config.nodeId);
  const registered = await storage.getAgent(deployedGaii);

  const key = `agents.${deployedName}.deploy`;
  let deployState: unknown = null;
  for (const ns of [deployedGaii, buildGAII(runnerName, args.callerOwner, config.nodeId), `${args.callerOwner}@${config.nodeId}`]) {
    const rec = await storage.getMemory(ns, key);
    if (rec) { deployState = rec.value; break; }
  }

  const stateStatus = (deployState as { status?: unknown } | null)?.status;
  return {
    ok: true,
    view: {
      app_id: ctx.appId,
      agent_name: args.agentName,
      deployed_agent_name: deployedName,
      registered: !!registered,
      last_seen: registered?.lastSeen ?? null,
      deploy_state: deployState,
      live: stateStatus === 'live' || (stateStatus === undefined && !!registered),
    },
  };
}
