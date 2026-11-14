/**
 * @file src/services/app/agent-deploy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agent-Bundled Apps (Slice 1) — materialize the deploy/undeploy handshake task on
 *   the OWNER'S OWN fleet. The node NEVER executes a crew-def: it creates an AIMEAT task on the
 *   owner's crew-forge/task-runner agent whose scope carries a POINTER (app_id + agent_name),
 *   and the fleet reads the manifest back via app_get and instantiates/stops the agent itself.
 *   Recognition is by scope `kind` ("deploy-app-agent" / "undeploy-app-agent"), never by title.
 *   Shared contract: crewaimeat Internal workspace, plan doc "Agent-Bundled Apps — self-hosted".
 * @structure
 *   - createAppAgentTask() — build + persist the deploy/undeploy task (the shared start decision,
 *     started event, realtime tunnel delivery — mirrors POST /v1/agents/:name/tasks so the fleet
 *     daemon picks it up identically)
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
 *   2026-11-11 — The caller's own agent is found by the app link on its proposal
 *     (services/app-agents/app-agent-link.ts), not by a derived name. A deploy that names no runner acts on
 *     that agent when it exists: it starts a stopped one, publishes the app's newer definition to
 *     it, or answers that it is present; an undeploy stops it. The status answers `state`
 *     (none, waiting, running, stopped), the proposal waiting, whether the definition is the app's
 *     current one, and the permissions the agent holds or would ask for. The list of running copies
 *     finds an agent under either derived name.
 *   2026-11-04 — The running connector tunnel manager is read from nodeContext() (services/node-context.ts) in place of
 *     getActiveConnectTunnelManager (codebase analysis 2026-11-03, item D-i).
 *   2026-10-28 — The start decision reads the runner's record as it is: the node no longer narrows an
 *     agent holding `*` by itself (Jouni, 2026-10-28).
 *   2026-10-20 — createAppAgentTask asks the shared start decision (decideTaskStart over startFactsOf)
 *     in place of the runner's mode alone: a runner holding a permission-floor scope or set to
 *     taskStart 'confirm' gets a queued deploy task, the auto-start event carries the marker, a
 *     waiting task notifies the owner unless they asked in person, the push id is per transition, and
 *     the answer's note says why it waits (secaudit 2026-10,
 *     app-agent-deploy.ts:createAppAgentTask:mode-only-auto-activation).
 *   2026-10-15 — The principal comment says an install set gives its owner and proposes too (feature-list audit #90).
 *   v1.4.0 — 2026-10-11 — An instance's public offers carry `toll_morsels` (the pacing amount) and the old
 *     `price` as its deprecated mirror: a morsel is pacing, never a price.
 *   v1.3.1 — 2026-10-11 — A task for a stopped runner is not activated on deploy; it waits (agent-stop-rules.ts).
 *   v1.3.0 — 2026-10-02 — The `proposed` answer names the proposal's `scopes` and `scopes_left_out`.
 *   v1.2.0 — 2026-10-01 — A deploy that names no runner, from a caller who has no crew-forge, becomes
 *     an agent proposal the owner approves (kind `proposed`), when the caller passed its principal.
 *     An install set passes none and keeps its pending state.
 *   v1.1.0 — 2026-09-27 — deployAppAgent(), appAgentInstances() and appAgentStatus(): the app
 *     lookup, the declared-agent check, the runner lookup and the two reads, moved unchanged out of
 *     routes/apps/agents-deploy.ts so the MCP tool calls the same code the REST routes call.
 *   v1.0.1 — 2026-09-05 — Notifies MCP through mcp/resource-events.ts, the leaf, not mcp/index.ts,
 *     which assembles the registry that imports services back (a cycle the dependency cruiser refuses).
 *   v1.0.0 — 2026-07-16 — Initial creation (Agent-Bundled Apps Slice 1, node side)
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage, AgentRecord, AgentTaskRecord, AgentTaskScope, AppRecord } from '../../storage/interface.js';
import { emitChange, emitDelivery } from '../event-bus.js';
import { emitResourceUpdated } from '../resource-events.js';
import { nodeContext } from '../node-context.js';
import { deployedAgentName, proposedAgentName, crewDefHash } from '../../models/crew-def-schemas.js';
import { presentOfferPacing, type Offer } from '../../models/offer-schemas.js';
import { legacyMorselFieldsLive, MORSEL_PRICE_DEPRECATION } from '../../config/pacing.js';
import { buildGAII, validateAgentName, localAccountName } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { proposeBundledAgent, bundledCrewDef, bundledAgentScopes } from './agent-propose.js';
import {
  proposerIsOwnerSession, proposalScopesFor, proposalApprovalUrl, recordProposalDefinition, type ProposerPrincipal,
} from '../agent/proposals.js';
import { findOwnBundledAgent, type OwnBundledAgent } from '../app-agents/app-agent-link.js';
import { setAgentStopped } from '../agent/stop.js';
import { crewPublish, type CrewCaller } from '../crew-ops.js';
import { withDefaultOffer } from '../agent/default-offer.js';
import { scopeIsCovered } from '../../utils/scope-coverage.js';
import { decideTaskStart, resolveAutoActivation, autoStartEvent, taskWakeId, type TaskStartDecision } from '../agent/task-rules.js';
import { notifyTaskWaiting, waitReason } from '../task-start-notice.js';

/** Default runner-agent name: crewaimeat's crew-forge daemon registers under this name. */
export const DEFAULT_APP_AGENT_RUNNER = 'crew-forge';

/**
 * A refusal the caller renders: REST as `res.status(status).json(error(nodeId, code, message))`,
 * MCP as `CODE: message`. The codes and messages are the ones the REST routes answered before the
 * extraction, unchanged.
 */
export interface AppAgentRefusal {
  ok: false;
  /**
   * 400, 403, 404 and 409 are this service's and the proposal service's (an app may not propose; the
   * name is taken). A stop, a start or a publish of a newer definition answers with the status and
   * the code of the service that refused it (agent-stop.ts, crew-ops.ts), unchanged.
   */
  status: number;
  code: string;
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
  /** The owner asked in person, so a task that waits needs no notification beside the answer. */
  requestedInPerson?: boolean;
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
): Promise<{ task: AgentTaskRecord; autoActivated: boolean; decision: TaskStartDecision }> {
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

  // The shared start decision (services/agent/task-rules.ts), the one the task-create route and the
  // scheduler ask: a stopped runner waits for its own start, a runner holding a permission-floor scope
  // waits for the owner in person, a runner whose owner set taskStart 'confirm' waits for the owner's
  // OK, and only then does task-runner mode start the task at once (the one-click deploy). The deploy
  // task names no start policy of its own, so the caller cannot loosen the runner's setting here.
  // This replaced a mode-only test that started a deploy past the floor and the owner's setting
  // (secaudit 2026-10, app-agent-deploy.ts:createAppAgentTask:mode-only-auto-activation).
  const decision = decideTaskStart(runner);
  const { autoActivated, effectiveStatus } = resolveAutoActivation(decision, 'queued');

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
    status: effectiveStatus,
    createdAt: now,
    updatedAt: now,
    lastEventAt: autoActivated ? now : undefined,
  };

  const created = await storage.createAgentTask(task);

  // The same 'started' event the task-create route writes, with the marker that lets a plan which
  // later declares an effect send the task back to wait (statusAfterProposal).
  if (autoActivated) {
    await storage.appendTaskEvent({
      id: randomUUID(),
      taskId: task.id,
      type: 'started',
      ...autoStartEvent(decision),
      timestamp: now,
    });
  }

  // Realtime push down the connector tunnel (zero round-trip when the daemon is online;
  // replayed via backlog-on-connect when offline) + MCP resource nudge for polling daemons.
  // The delivery id is per transition (taskWakeId), so the push the owner's Start sends later for a
  // waiting task is not skipped as one the runner already acknowledged.
  emitDelivery({ target: runner.gaii, kind: 'task_assigned', id: taskWakeId(task.id, task.status, now), payload: created });
  try { emitResourceUpdated(runner.gaii, `aimeat://agents/${runner.name}/tasks`); } catch (err) { logger.warn('createAppAgentTask: MCP not connected', { error: String(err) }); }
  emitChange('agent-tasks', `${ownerName}@${config.nodeId}`);

  // A task that waits for the owner is told to them, unless the owner asked in person (their answer
  // already says it waits) or the runner is stopped (a Start button would answer AGENT_STOPPED).
  if (!autoActivated && !input.requestedInPerson && decision.waitsBecause !== 'stopped') {
    void notifyTaskWaiting(storage, created, decision);
  }

  return { task: created, autoActivated, decision };
}

/**
 * Resolve the app and locate the declared crew-def. Foreign apps are reachable only when publicly
 * runnable: parked, operator-hidden and access-coded apps stay invisible to non-owners (404,
 * matching the download routes). `viewer` is the caller's bare owner name, or null when anonymous.
 */
async function resolveDeclaredAppAgent(
  storage: Storage,
  args: { viewer: string | null; appOwner: string; filename: string; agentName: string },
): Promise<{ ok: true; app: AppRecord; appId: string; declared: Record<string, unknown> } | AppAgentRefusal> {
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

  return { ok: true, app, appId: `${app.ownerName}/${app.filename}`, declared: declared as Record<string, unknown> };
}

/**
 * What a deploy or undeploy answers when the caller already has this agent, made by a proposal
 * they approved: nothing new is created, and the answer says what was done to the agent.
 */
export interface AppAgentOwnView {
  /** present: nothing to do. started / stopped: its state changed. updated: it now runs the app's current definition. */
  kind: 'present' | 'updated' | 'started' | 'stopped';
  app_id: string;
  agent_name: string;
  /** The agent's own name on the caller's account. */
  agent: string;
  changed: boolean;
  note: string;
}

type OwnAgent = Extract<OwnBundledAgent, { state: 'running' | 'stopped' }>;

/**
 * Deploy or undeploy for a caller who already has the agent, made by their approval. An undeploy
 * stops it. A deploy starts a stopped one and publishes the app's definition to it when the app
 * declares a newer one than it runs. Each step asks the permission its own endpoint asks: stop and
 * start take agent:write (routes/agents/stop-start.ts), a publish takes memory:write
 * (routes/agent-crew.ts), and the owner in person needs neither.
 */
async function actOnOwnAgent(
  storage: Storage, config: AimeatConfig,
  args: {
    own: OwnAgent; appId: string; agentName: string; declared: Record<string, unknown>;
    callerOwner: string; undeploy: boolean; principal?: ProposerPrincipal;
  },
): Promise<{ ok: true; view: AppAgentOwnView; links: AppAgentLink[] } | AppAgentRefusal> {
  const { own, appId, agentName, declared, callerOwner, principal } = args;
  const deps = { storage, config };
  const agent = own.agent;
  const shown = agent.displayName || agent.name;
  const inPerson = principal ? proposerIsOwnerSession(principal) : false;
  const may = (scope: string) => inPerson || (principal ? scopeIsCovered(principal.scopes, scope) : false);
  const callerPrincipal = !principal || inPerson ? `${callerOwner}@${config.nodeId}` : principal.sub;
  const links: AppAgentLink[] = [
    { description: 'Status of this agent', method: 'GET', url: `/v1/apps/${appId.split('/').map(encodeURIComponent).join('/')}/agents/${encodeURIComponent(agentName)}/status` },
  ];
  const answer = (kind: AppAgentOwnView['kind'], changed: boolean, note: string) => ({
    ok: true as const, links,
    view: { kind, app_id: appId, agent_name: agentName, agent: agent.name, changed, note },
  });
  const current = crewDefHash(declared);
  const stopOrStart = async (stop: boolean): Promise<AppAgentRefusal | null> => {
    if (!may('agent:write')) {
      return {
        ok: false, status: 403, code: 'ACCESS_DENIED',
        message: `${stop ? 'Stopping' : 'Starting'} ${shown} takes the agent:write permission. Ask the owner to do it, here or on the Agents page.`,
      };
    }
    const out = await setAgentStopped(deps, callerOwner, callerPrincipal, agent.name, stop);
    if (!out.ok) {
      return { ok: false, status: out.code === 'AGENT_NOT_FOUND' ? 404 : out.code === 'ACCESS_DENIED' ? 403 : 400, code: out.code, message: out.message };
    }
    return null;
  };

  if (args.undeploy) {
    if (own.state === 'stopped') return answer('stopped', false, `${shown} is already stopped.`);
    const refused = await stopOrStart(true);
    if (refused) return refused;
    return answer('stopped', true, `${shown} is stopped. It takes no new work until it is started again; the agent and what it wrote stay.`);
  }

  let started = false;
  if (own.state === 'stopped') {
    const refused = await stopOrStart(false);
    if (refused) return refused;
    started = true;
  }
  const startedNote = `${shown} is started again.`;
  if (own.definitionHash === null || own.definitionHash === current) {
    return started ? answer('started', true, startedNote) : answer('present', false, `You already have ${shown}, and it runs the app's current definition.`);
  }

  // The app declares a newer definition than the agent runs: publish it, validated by the agent's
  // own runtime as every publish is (services/crew-ops.ts crewPublish).
  const publishRefusal = async (): Promise<AppAgentRefusal | null> => {
    if (!principal || !may('memory:write')) {
      return {
        ok: false, status: 403, code: 'ACCESS_DENIED',
        message: `The app has a newer definition for ${shown}. Publishing it takes the memory:write permission.`,
      };
    }
    const caller: CrewCaller = {
      principal: callerPrincipal, owner: callerOwner, scopes: principal.scopes, roles: principal.roles,
      pipeline: 'app-agent.update',
    };
    const definition = withDefaultOffer(bundledCrewDef(declared).crewDef as unknown as Record<string, unknown>, {
      name: agent.name, displayName: shown, purpose: agent.description ?? '',
    });
    const out = await crewPublish(deps, caller, agent.name, definition);
    if (!out.ok) return { ok: false, status: out.status, code: out.code, message: out.message };
    // The proposal the agent came from now says which definition it runs (services/app-agents/app-agent-link.ts).
    // The definition is published either way, so a failure here is logged and the status offers the update again.
    if (own.proposal) {
      await recordProposalDefinition(deps, callerOwner, own.proposal.id, current)
        .catch(err => logger.warn('app agent: the published definition was not recorded on its proposal', { agent: agent.name, error: String(err) }));
    }
    return null;
  };
  const refused = await publishRefusal();
  if (refused) {
    return started
      ? answer('started', true, `${startedNote} The app's newer definition was not published: ${refused.message}`)
      : refused;
  }
  emitChange('agents');
  return answer('updated', true, `${shown} now runs the app's current definition.`);
}

/** What a deploy answers when it became a proposal for the owner (no runner to give it to). */
export interface AppAgentProposalView {
  kind: 'proposed';
  app_id: string;
  agent_name: string;
  proposed_name: string;
  proposal_id: string;
  /** What the proposal asks for: the definition's scopes, capped by what the proposer may grant. */
  scopes: string[];
  /** Declared by the app and left out of the proposal. */
  scopes_left_out: string[];
  note: string;
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
    /**
     * Who is asking, as the proposal service needs it. Given by the route and the MCP tool: a deploy
     * that names no runner, for an owner who has no crew-forge runner, becomes a proposal the owner
     * approves (app-agent-propose.ts). An install set gives its owner, so a bundled agent with no
     * runner reaches the owner as a proposal too (install-set-apply.ts, feature-list audit #90).
     */
    principal?: ProposerPrincipal;
  },
): Promise<{ ok: true; view: AppAgentDeployView | AppAgentProposalView | AppAgentOwnView; links: AppAgentLink[] } | AppAgentRefusal> {
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

  // The caller already has this agent, made by a proposal they approved: the request acts on that
  // agent. A caller who names a runner asks for a deployment on their own fleet, and gets one.
  let waitingProposal = false;
  if (!args.runnerAgent) {
    const own = await findOwnBundledAgent({ storage, config }, args.callerOwner, ctx.appId, args.agentName);
    if ((own.state === 'running' || own.state === 'stopped') && own.via === 'proposal') {
      return actOnOwnAgent(storage, config, {
        own, appId: ctx.appId, agentName: args.agentName, declared: ctx.declared,
        callerOwner: args.callerOwner, undeploy: args.undeploy, principal: args.principal,
      });
    }
    waitingProposal = own.state === 'waiting';
  }
  // The runner is looked up under the REQUESTER's owner only — a foreign fleet is
  // unreachable by construction (there is no way to name another owner's agent here).
  const runner = await storage.getAgent(buildGAII(runnerName, args.callerOwner, config.nodeId));
  // No runner named and none to fall back on: the agent reaches the owner as a proposal instead.
  // crew-forge left the basic agents on 2026-09-02, so this is what a new account meets.
  if (!runner && !args.undeploy && !args.runnerAgent && args.principal) {
    const proposed = await proposeBundledAgent({ storage, config }, args.principal, ctx.app, args.agentName);
    if (!proposed.ok) return proposed as AppAgentRefusal;
    // The owner's open pages learn that something waits for them, as after POST /v1/agents/v2/agent-proposals.
    if (!proposed.proposal.already_waiting) emitChange('open-items');
    return {
      ok: true,
      view: {
        kind: 'proposed', app_id: ctx.appId, agent_name: args.agentName,
        proposed_name: proposed.proposal.proposed_name, proposal_id: proposed.proposal.proposal_id,
        scopes: proposed.proposal.scopes, scopes_left_out: proposed.proposal.scopes_left_out,
        note: proposed.proposal.already_waiting
          ? 'This agent already waits for your approval on your open items.'
          : 'This agent now waits for your approval on your open items. Approving it creates the agent with its definition.',
      },
      links: [{ description: 'Waiting proposals', method: 'GET', url: '/v1/agents/v2/agent-proposals' }],
    };
  }
  if (!runner && args.undeploy && !args.runnerAgent) {
    // Nothing of the caller's was made from this definition, so there is nothing to stop.
    return {
      ok: false, status: 404, code: 'NOT_DEPLOYED',
      message: waitingProposal
        ? `"${args.agentName}" waits for your approval and does not exist yet, so there is nothing to stop. Decline the proposal on your open items if you do not want it.`
        : `You have no agent made from "${args.agentName}" of this app, so there is nothing to stop.`,
    };
  }
  if (!runner) {
    return {
      ok: false, status: 404, code: 'RUNNER_NOT_FOUND',
      message: args.runnerAgent
        ? `You have no agent named "${runnerName}". Leave runner_agent out, and the agent reaches you as a proposal to approve.`
        : `This agent could not be proposed to you from here. Ask the owner to add it from the app's page.`,
    };
  }

  const organismId = typeof args.organismId === 'string' && args.organismId.length > 0
    ? args.organismId : undefined;

  const { task, autoActivated, decision } = await createAppAgentTask(storage, config, {
    kind, appId: ctx.appId, agentName: args.agentName, ownerName: args.callerOwner, runner, organismId,
    requestedInPerson: args.principal ? proposerIsOwnerSession(args.principal) : false,
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
        : `Task is queued. ${waitReason(runner.displayName || runner.name, decision)}`
          + (decision.waitsBecause === 'stopped' ? '' : ' Start it from the Tasks tab.'),
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
    /** The pacing amount per use in morsels (0 = none). */
    toll_morsels: number;
    /** Deprecated mirror of toll_morsels until 4.0.0, marked `deprecated`; null when there is no pacing. */
    price: { morsels: number; unit: string; deprecated: string } | null;
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
  // An agent made by approving a proposal has the derived name cut to 40 characters, so both are
  // asked for. The viewer's own is added from its app link, whatever it is called and listed or not.
  const proposedName = proposedAgentName(agentName, appId);
  const own = viewer ? await findOwnBundledAgent({ storage, config: _config }, viewer, appId, agentName) : null;
  const ownGaii = own && (own.state === 'running' || own.state === 'stopped') ? own.agent.gaii : null;
  const all = await storage.listAgents();
  const now = Date.now();
  const tunnels = nodeContext().tunnel;
  const derived = (a: AgentRecord) => a.name === deployedName || a.name === proposedName;
  const candidates = all.filter(a => a.gaii === ownGaii
    || ((derived(a) || (a.name === agentName && a.owner === app.ownerName))
      && !(a.tags ?? []).includes('unlisted')));

  const instances = await Promise.all(candidates.map(async (a): Promise<AppAgentInstance> => {
    const rec = await storage.getMemory(a.gaii, `agents.${a.name}.offers`);
    const offers = (((rec?.value as { offers?: Offer[] } | undefined)?.offers) ?? [])
      .filter(o => o.visibility === 'public')
      .map(o => {
        // A morsel amount is pacing, never a price: `toll_morsels`, with the old `price` as its mirror.
        const paced = presentOfferPacing(o, legacyMorselFieldsLive(), MORSEL_PRICE_DEPRECATION);
        return {
          id: o.id,
          title: o.title,
          ask: o.ask,
          cost: o.cost,
          deliverable: o.deliverable,
          toll_morsels: paced.tollMorsels ?? 0,
          price: paced.price ?? null,
          price_money: o.priceMoney ?? null,
          callable: !!o.callable,
        };
      });
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
      source: derived(a) || a.gaii === ownGaii ? 'deployed' as const : 'author' as const,
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
  args: {
    callerOwner: string; appOwner: string; filename: string; agentName: string; runnerAgent?: string;
    /** Who is asking. With it, `scopes` for an agent that does not exist yet is what THIS caller's proposal would ask for. */
    principal?: ProposerPrincipal;
  },
): Promise<{ ok: true; view: AppAgentStatusView } | AppAgentRefusal> {
  const ctx = await resolveDeclaredAppAgent(storage, {
    viewer: args.callerOwner, appOwner: args.appOwner, filename: args.filename, agentName: args.agentName,
  });
  if (!ctx.ok) return ctx;
  const deps = { storage, config };

  const runnerName = typeof args.runnerAgent === 'string' && args.runnerAgent.length > 0
    ? args.runnerAgent : DEFAULT_APP_AGENT_RUNNER;
  const deployedName = deployedAgentName(args.agentName, ctx.appId);
  // The caller's agent by its app link (services/app-agents/app-agent-link.ts); the derived name is the answer
  // only while none exists.
  const own = await findOwnBundledAgent(deps, args.callerOwner, ctx.appId, args.agentName);
  const mine = own.state === 'running' || own.state === 'stopped' ? own : null;
  const registered = mine?.agent ?? null;
  const recordName = registered?.name ?? deployedName;

  const key = `agents.${recordName}.deploy`;
  let deployState: unknown = null;
  for (const ns of [buildGAII(recordName, args.callerOwner, config.nodeId), buildGAII(runnerName, args.callerOwner, config.nodeId), `${args.callerOwner}@${config.nodeId}`]) {
    const rec = await storage.getMemory(ns, key);
    if (rec) { deployState = rec.value; break; }
  }
  const stateStatus = (deployState as { status?: unknown } | null)?.status;
  // A fleet marks an agent it took down in its record and may leave the registration standing.
  const state: AppAgentStatusView['state'] = mine?.state === 'running' && mine.via === 'fleet' && stateStatus === 'undeployed'
    ? 'stopped' : own.state;

  // The permissions: the agent's own when it exists, the waiting proposal's, or what a proposal
  // from this caller would ask for (the definition's, capped, plus the crew runtime's).
  let scopes: string[];
  let leftOut: string[] = [];
  if (registered) scopes = registered.defaultScopes ?? [];
  else if (own.state === 'waiting') scopes = own.proposal.scopes;
  else {
    const asked = bundledAgentScopes(bundledCrewDef(ctx.declared).declaredScopes,
      args.principal ?? { sub: args.callerOwner, owner: args.callerOwner, roles: ['owner'], scopes: [] });
    scopes = await proposalScopesFor(deps, args.callerOwner, asked.scopes);
    leftOut = asked.dropped;
  }

  const tunnels = nodeContext().tunnel;
  const recorded = mine?.definitionHash ?? null;
  return {
    ok: true,
    view: {
      app_id: ctx.appId,
      agent_name: args.agentName,
      deployed_agent_name: recordName,
      registered: !!registered,
      last_seen: registered?.lastSeen ?? null,
      deploy_state: deployState,
      live: mine?.via === 'proposal'
        ? state === 'running'
        : stateStatus === 'live' || (stateStatus === undefined && !!registered),
      state,
      agent: registered?.name ?? null,
      agent_display_name: registered ? registered.displayName ?? registered.name : null,
      via: mine?.via ?? null,
      online: !!registered && (!!tunnels?.isConnected(registered.gaii)
        || !!(registered.lastSeen && (Date.now() - new Date(registered.lastSeen).getTime()) < 10 * 60 * 1000)),
      proposal_id: own.state === 'waiting' ? own.proposal.id : null,
      approval_url: own.state === 'waiting' ? proposalApprovalUrl(config.baseUrl, own.proposal.id) : null,
      definition_current: registered && recorded ? recorded === crewDefHash(ctx.declared) : null,
      scopes,
      scopes_left_out: leftOut,
    },
  };
}

/** What GET .../agents/:agentName/status answers: the caller's own copy of an app's bundled agent. */
export interface AppAgentStatusView {
  app_id: string;
  agent_name: string;
  /** The caller's agent's name when it exists; otherwise the name a fleet deployment would give it. */
  deployed_agent_name: string;
  registered: boolean;
  last_seen: string | null;
  /** The record `agents.<name>.deploy`, as its writer left it. */
  deploy_state: unknown;
  live: boolean;
  /**
   * none: the caller has no such agent. waiting: a proposal for it waits for the owner's approval.
   * running / stopped: the agent exists, and takes work or does not.
   */
  state: 'none' | 'waiting' | 'running' | 'stopped';
  agent: string | null;
  agent_display_name: string | null;
  /** proposal: made by the owner's approval. fleet: registered by the owner's own runtime. */
  via: 'proposal' | 'fleet' | null;
  /** Work sent to the agent arrives now: its runtime holds a connection, or it was seen in the last ten minutes. */
  online: boolean;
  proposal_id: string | null;
  /** Where the owner approves the waiting proposal. */
  approval_url: string | null;
  /** Whether the agent runs the definition the app declares now; null when it is not known or no agent exists. */
  definition_current: boolean | null;
  /** The permissions the agent holds, the waiting proposal asks for, or a new proposal would ask for. */
  scopes: string[];
  /** Declared by the app and never asked for from here: beyond the caller, or never granted from an app. */
  scopes_left_out: string[];
}
