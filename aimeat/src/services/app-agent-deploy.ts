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
 * @usage
 *   const { task, autoActivated } = await createAppAgentTask(storage, config, { ... });
 * @version-history
 *   v1.0.0 — 2026-07-16 — Initial creation (Agent-Bundled Apps Slice 1, node side)
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentRecord, AgentTaskRecord, AgentTaskScope } from '../storage/interface.js';
import { emitChange, emitDelivery } from './event-bus.js';
import { emitResourceUpdated } from '../mcp/index.js';
import { logger } from '../utils/logger.js';

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
