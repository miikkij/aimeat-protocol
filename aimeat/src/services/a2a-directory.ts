/**
 * @file src/services/a2a-directory.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's A2A directory: the card at /.well-known/agent-card.json and the JSON-RPC
 *   interface it names, /v1/a2a/directory.
 *
 *   WHY IT HAS AN INTERFACE NOW. From 2026-09-04 the directory validated as an Agent Card with an
 *   empty `supportedInterfaces`, on the ruling that a non-empty list would send a stranger's task to
 *   an address that answers nothing. A2A 1.0 requires the list, so a validator still read the card
 *   as having no address (AGENTSCAN 1.1.0, 2026-10-27), and the top-level `url` it kept from A2A 0.3
 *   told a 0.3 client to post work to the node's front page. The interface below answers: any
 *   SendMessage gets back one message whose data part is the same `agents` list the card carries,
 *   so the card's one skill can be called as well as read. Nothing else is offered, nothing is
 *   stored, and the caller's message is not read beyond being well formed.
 *
 *   PUBLIC, like the card. The list is the agents whose owners published an offering, which is the
 *   consent this node already uses for strangers (services/a2a-offering.ts), and the interface
 *   answers exactly what the public card says.
 * @structure directoryInterfaceUrl(config) · directoryAgents(config, storage) ·
 *   directoryCard(config, agents) · DirectoryA2AHandler
 * @usage
 *   const agents = await directoryAgents(config, storage);
 *   res.json(directoryCard(config, agents));
 *   new DirectoryA2AHandler(config, storage, card);      // routes/a2a.ts, behind jsonRpcHandler
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial: the card moves here from routes/a2a.ts, gains the interface, and
 *     drops the A2A 0.3 top-level `url`.
 */
import {
  Role, type AgentCard, type Message, type Task, type SendMessageRequest, type GetTaskRequest,
  type CancelTaskRequest, type TaskPushNotificationConfig, type GetTaskPushNotificationConfigRequest,
  type ListTaskPushNotificationConfigsRequest, type ListTaskPushNotificationConfigsResponse,
  type DeleteTaskPushNotificationConfigRequest, type ListTasksRequest, type ListTasksResponse,
  type GetExtendedAgentCardRequest, type StreamResponse, type SubscribeToTaskRequest,
  A2A_PROTOCOL_VERSION,
} from '@a2a-js/sdk';
import type { A2ARequestHandler, ServerCallContext } from '@a2a-js/sdk/server';
import {
  JsonRpcTaskNotFoundError, JsonRpcRequestMalformedError, JsonRpcUnsupportedOperationError,
} from '@a2a-js/sdk/errors';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { publishedAgentOfferings } from './a2a-offering.js';
import { directoryDescriptionFor } from './a2a-card.js';

/** The A2A version nearly every client speaks today; the SDK's compat layer answers it (a2a-card.ts). */
const A2A_LEGACY_VERSION = '0.3';

/** One row of the directory: an agent offered to other agents, and where its own card is. */
export interface DirectoryAgent {
  name: string;
  owner: string;
  gaii: string;
  display_name: string;
  description: string;
  agent_card: string;
  interface: string;
  offerings: number;
}

export type DirectoryCard = AgentCard & { protocol: 'a2a'; node: string; agents: DirectoryAgent[] };

function base(config: AimeatConfig): string {
  return config.baseUrl.replace(/\/+$/, '');
}

/** The address of one agent's own A2A interface (the same one routes/a2a.ts serves). */
export function agentInterfaceUrl(config: AimeatConfig, owner: string, agentName: string): string {
  return `${base(config)}/v1/a2a/${encodeURIComponent(owner)}/${encodeURIComponent(agentName)}`;
}

/** The directory's own interface. One path segment, so no owner/agent pair can be read as it. */
export function directoryInterfaceUrl(config: AimeatConfig): string {
  return `${base(config)}/v1/a2a/directory`;
}

/** The agents with a published offering, as directory rows. */
export async function directoryAgents(config: AimeatConfig, storage: Storage): Promise<DirectoryAgent[]> {
  const published = await publishedAgentOfferings(storage, config);
  return published.map(({ agent, offerings }) => ({
    name: agent.name,
    owner: agent.owner,
    // Public: the agent card's address names the owner and the agent on this node, which is the
    // whole GAII. Listing it gives away nothing a stranger cannot derive (feature-list audit #83).
    gaii: agent.gaii,
    display_name: agent.displayName ?? agent.name,
    description: directoryDescriptionFor(agent.description, offerings),
    agent_card: `${agentInterfaceUrl(config, agent.owner, agent.name)}/agent-card.json`,
    interface: agentInterfaceUrl(config, agent.owner, agent.name),
    // The count, not the offerings: what each one costs is on the card, and saying it twice is
    // how the two come to disagree.
    offerings: offerings.length,
  }));
}

/**
 * The directory as an A2A 1.0 Agent Card. Every required field is true of a directory: one
 * interface (1.0 and 0.3 at the same address, as the per-agent cards declare), nothing streamed,
 * JSON in and out, and one skill, which is the list. `agents` is the list itself, outside A2A's
 * fields, as it has been since 2026-09-01.
 */
export function directoryCard(config: AimeatConfig, agents: DirectoryAgent[]): DirectoryCard {
  const url = directoryInterfaceUrl(config);
  return {
    name: config.nodeId,
    description: `Agents on ${config.nodeId} that are offered to other agents. Send any message to the interface and the answer is the list.`,
    protocol: 'a2a',
    node: config.nodeId,
    version: '1.1.0',
    supportedInterfaces: [
      { url, protocolBinding: 'JSONRPC', tenant: '', protocolVersion: A2A_PROTOCOL_VERSION },
      { url, protocolBinding: 'JSONRPC', tenant: '', protocolVersion: A2A_LEGACY_VERSION },
    ],
    provider: { url: base(config), organization: config.nodeId },
    capabilities: { streaming: false, pushNotifications: false, extensions: [], extendedAgentCard: false },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['application/json'],
    skills: [{
      id: 'directory',
      name: 'Agent directory',
      description: `Lists the agents on ${config.nodeId} whose owners have published an offering, with the address of each one's own agent card. Publishing the offering is the consent, so an agent absent from this list is not hidden — it is not for sale.`,
      tags: ['directory', 'discovery', 'a2a'],
      examples: ['Which agents can I hire here?'],
      inputModes: ['text/plain', 'application/json'],
      outputModes: ['application/json'],
      securityRequirements: [],
    }],
    signatures: [],
    agents,
  };
}

/**
 * The directory's JSON-RPC handler. SendMessage answers with a message (no task: there is no work
 * to track); everything about tasks answers "no such task", and streaming and push are refused.
 */
export class DirectoryA2AHandler implements A2ARequestHandler {
  constructor(
    private readonly config: AimeatConfig,
    private readonly storage: Storage,
    private readonly card: DirectoryCard,
  ) {}

  async getAgentCard(): Promise<AgentCard> { return this.card; }

  async getAuthenticatedExtendedAgentCard(_p: GetExtendedAgentCardRequest, _c: ServerCallContext): Promise<AgentCard> {
    return this.card;
  }

  async sendMessage(params: SendMessageRequest, _ctx: ServerCallContext): Promise<Message | Task> {
    if (!params.message || params.message.parts.length === 0) {
      throw new JsonRpcRequestMalformedError({ message: 'A message with at least one part is required.' });
    }
    // Read fresh, not from the card, so a message sent after an offering is published sees it.
    const agents = await directoryAgents(this.config, this.storage);
    const line = agents.length === 1 ? 'One agent is offered here.' : `${agents.length} agents are offered here.`;
    return {
      messageId: randomUUID(),
      contextId: params.message.contextId || randomUUID(),
      taskId: '',
      role: Role.ROLE_AGENT,
      parts: [
        { content: { $case: 'text', value: `${line} Each one's agent_card is its own A2A card.` }, metadata: undefined, filename: '', mediaType: 'text/plain' },
        { content: { $case: 'data', value: { node: this.config.nodeId, agents } }, metadata: undefined, filename: '', mediaType: 'application/json' },
      ],
      metadata: undefined,
      extensions: [],
      referenceTaskIds: [],
    };
  }

  async getTask(_p: GetTaskRequest, _c: ServerCallContext): Promise<Task> {
    throw new JsonRpcTaskNotFoundError({ message: 'The directory answers with a message and keeps no tasks.' });
  }

  async cancelTask(_p: CancelTaskRequest, _c: ServerCallContext): Promise<Task> {
    throw new JsonRpcTaskNotFoundError({ message: 'The directory answers with a message and keeps no tasks.' });
  }

  async listTasks(_p: ListTasksRequest, _c: ServerCallContext): Promise<ListTasksResponse> {
    return { tasks: [], nextPageToken: '', pageSize: 0, totalSize: 0 };
  }

  // eslint-disable-next-line require-yield
  async *sendMessageStream(_p: SendMessageRequest, _c: ServerCallContext): AsyncGenerator<StreamResponse, void, undefined> {
    throw new JsonRpcUnsupportedOperationError({ message: 'The directory does not stream. Use SendMessage.' });
  }

  // eslint-disable-next-line require-yield
  async *resubscribe(_p: SubscribeToTaskRequest, _c: ServerCallContext): AsyncGenerator<StreamResponse, void, undefined> {
    throw new JsonRpcUnsupportedOperationError({ message: 'The directory does not stream. Use SendMessage.' });
  }

  async createTaskPushNotificationConfig(_p: TaskPushNotificationConfig, _c: ServerCallContext): Promise<TaskPushNotificationConfig> {
    throw new JsonRpcUnsupportedOperationError({ message: 'The directory keeps no tasks to notify about.' });
  }

  async getTaskPushNotificationConfig(_p: GetTaskPushNotificationConfigRequest, _c: ServerCallContext): Promise<TaskPushNotificationConfig> {
    throw new JsonRpcUnsupportedOperationError({ message: 'The directory keeps no tasks to notify about.' });
  }

  async listTaskPushNotificationConfigs(_p: ListTaskPushNotificationConfigsRequest, _c: ServerCallContext): Promise<ListTaskPushNotificationConfigsResponse> {
    throw new JsonRpcUnsupportedOperationError({ message: 'The directory keeps no tasks to notify about.' });
  }

  async deleteTaskPushNotificationConfig(_p: DeleteTaskPushNotificationConfigRequest, _c: ServerCallContext): Promise<void> {
    throw new JsonRpcUnsupportedOperationError({ message: 'The directory keeps no tasks to notify about.' });
  }
}
