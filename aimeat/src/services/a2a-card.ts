/**
 * @file src/services/a2a-card.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One of this node's agents, described as an A2A AgentCard.
 *
 *   IT IS THE SAME AGENT, NOT A SECOND DECLARATION. Everything here is read off the AgentRecord the
 *   node already holds: the name, the description, the capabilities the owner granted. There is no
 *   place for an operator to write an A2A card by hand, deliberately — a hand-written card is a
 *   second source of truth about what an agent can do, and the first thing it does is drift.
 *
 *   WHAT THE CARD PROMISES IS WHAT THE HANDLER DOES. `streaming: false` because there is no stream
 *   behind this door, and saying otherwise would leave a client holding a connection open for
 *   updates that never arrive. `pushNotifications: true` because V4 stores exactly the config A2A
 *   describes. Both are read from one place so the card and the refusal cannot disagree.
 *
 * @structure a2aCardFor(config, agent, baseUrl)
 * @usage const card = a2aCardFor(config, agent, 'https://node.example/v1/a2a/claude');
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V6a).
 */
import type { AgentCard } from '@a2a-js/sdk';
import { A2A_PROTOCOL_VERSION } from '@a2a-js/sdk';

/**
 * The A2A version almost every client in the world speaks today. The SDK ships a compatibility
 * layer for it and the door turns it on, so this card declares BOTH interfaces: a client that
 * reads only the version it knows finds an address, and one that reads both picks the newer.
 * A card that declared 1.0 alone would be correct and unreachable.
 */
const A2A_LEGACY_VERSION = '0.3';
import type { AimeatConfig } from '../config.js';
import type { AgentRecord } from '../storage/interface.js';

/** What this door does and does not do. Read by the card and by the handler's refusals. */
export const A2A_SURFACE = {
  streaming: false,
  pushNotifications: true,
} as const;

/**
 * An agent's declared capabilities, as A2A skills.
 *
 * An agent with none declared still gets one skill, named after itself. A card with an empty skill
 * list is valid and useless: a client looking for something to hire reads the skills, and an agent
 * that lists nothing is invisible to it. Saying "this agent does what it says it does, ask it"
 * is a weaker claim than a real skill list and a truer one than silence.
 */
function skillsFor(agent: AgentRecord): AgentCard['skills'] {
  const declared = (agent.capabilities ?? []).filter(c => typeof c === 'string' && c.trim() !== '');
  if (declared.length === 0) {
    return [{
      id: agent.name,
      name: agent.displayName || agent.name,
      description: agent.description || `Work handled by ${agent.displayName || agent.name} on this node.`,
      tags: agent.tags ?? [],
      examples: [],
      inputModes: ['text/plain', 'application/json'],
      outputModes: ['text/plain', 'application/json'],
      securityRequirements: [],
    }];
  }
  return declared.map(c => ({
    id: c,
    name: c,
    description: `${agent.displayName || agent.name} declares this capability.`,
    tags: agent.tags ?? [],
    examples: [],
    inputModes: ['text/plain', 'application/json'],
    outputModes: ['text/plain', 'application/json'],
    securityRequirements: [],
  }));
}

export function a2aCardFor(config: AimeatConfig, agent: AgentRecord, url: string): AgentCard {
  return {
    name: agent.displayName || agent.name,
    description: agent.description
      || `An agent on the AIMEAT node ${config.nodeId}. Work sent here becomes a task its owner's runtime picks up.`,
    supportedInterfaces: [
      { url, protocolBinding: 'JSONRPC', tenant: '', protocolVersion: A2A_PROTOCOL_VERSION },
      // The same address, and the SDK's compat layer decides which shape a request is by the
      // A2A-Version header. Declaring it is what the SDK requires before it will answer one.
      { url, protocolBinding: 'JSONRPC', tenant: '', protocolVersion: A2A_LEGACY_VERSION },
    ],
    provider: { url: config.baseUrl, organization: config.nodeId },
    // The agent's own card version if it has published one, else the node's protocol line. Not a
    // package version: what a client cares about is whether the agent's description changed.
    version: agent.cardIssuedAt ?? '1.0.0',
    capabilities: {
      streaming: A2A_SURFACE.streaming,
      pushNotifications: A2A_SURFACE.pushNotifications,
      extensions: [],
      extendedAgentCard: false,
    },
    // Every door behind this card is authenticated, and by the same bearer the rest of the node
    // takes. Declaring it is how a client knows it needs one before it tries.
    securitySchemes: {
      bearer: {
        scheme: {
          $case: 'httpAuthSecurityScheme',
          value: { scheme: 'bearer', bearerFormat: 'JWT', description: 'An AIMEAT credential for a principal of this agent\'s account.' },
        },
      },
    },
    securityRequirements: [{ schemes: { bearer: { list: ['*'] } } }],
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills: skillsFor(agent),
    signatures: [],
  };
}
