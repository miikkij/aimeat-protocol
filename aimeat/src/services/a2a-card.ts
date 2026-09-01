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
 * @structure a2aCardFor(config, agent, baseUrl, opts)
 * @usage const card = a2aCardFor(config, agent, 'https://node.example/v1/a2a/claude', { offerings });
 * @version-history
 *   v1.1.0 — 2026-09-01 — What a stranger may buy is on the card: a LISTED offering becomes a skill
 *     with its price, the x402 extension is declared, and the two ways in are separate security
 *     schemes (V6a foreign path).
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V6a).
 */
import type { AgentCard } from '@a2a-js/sdk';
import { A2A_PROTOCOL_VERSION } from '@a2a-js/sdk';
import type { Offering } from './exchange-market.js';
import { A2A_X402_EXTENSION } from './a2a-offering.js';
import { FOREIGN_HEADERS } from './a2a-foreign.js';

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

/**
 * A published offering, as an A2A skill a stranger can act on.
 *
 * THE PRICE IS ON THE CARD because the card is what a buyer reads before deciding to knock. An
 * offering whose price is only discoverable by starting a task makes every client start a task to
 * window-shop. The id is the offering id, which is exactly what `metadata.offeringId` takes, so the
 * card names the thing the request needs rather than something a client has to translate.
 */
function offeringSkills(offerings: Offering[]): AgentCard['skills'] {
  return offerings.map(o => ({
    id: o.offeringId,
    name: o.title,
    description: `${o.description || o.title} — ${o.basePrice} ${o.currency ?? 'morsel'} per ${o.unit}. Send this offeringId in message metadata; payment is settled with the x402 extension before the work starts.`,
    tags: ['for-hire', o.surface?.kind === 'agent-work' ? o.surface.taskType : o.action],
    examples: [],
    inputModes: ['text/plain', 'application/json'],
    outputModes: ['text/plain', 'application/json'],
    securityRequirements: [{ schemes: { foreignCard: { list: ['*'] } } }],
  }));
}

/**
 * What else the card can carry. Both optional, because the two callers differ: the card route knows
 * the agent's offerings, and a handler building the card for its own use may not care.
 */
export interface A2ACardOptions {
  /** LISTED agent-work offerings — what a stranger may buy. */
  offerings?: Offering[];
}

export function a2aCardFor(config: AimeatConfig, agent: AgentRecord, url: string, opts: A2ACardOptions = {}): AgentCard {
  const offerings = opts.offerings ?? [];
  const forHire = offerings.length > 0;
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
      // DECLARED ONLY WHEN THERE IS SOMETHING TO BUY. An agent whose owner has published nothing
      // takes no payment on this road, and advertising the payment extension anyway would invite a
      // client to sign a proof for a door that answers "there is nothing for sale here".
      extensions: forHire
        ? [{ uri: A2A_X402_EXTENSION, required: true, params: undefined,
          description: 'Work for hire is quoted as x402 exact-scheme requirements on the first call and starts once the payment settles.' }]
        : [],
      extendedAgentCard: false,
    },
    // TWO WAYS IN, AND THEY REACH DIFFERENT THINGS. A principal of this account gets the agent's
    // own surface, the way V4 and V5 describe it. A stranger gets what the owner has published for
    // hire and nothing else. Declaring both is how a client knows which one it is holding.
    securitySchemes: {
      bearer: {
        scheme: {
          $case: 'httpAuthSecurityScheme',
          value: { scheme: 'bearer', bearerFormat: 'JWT', description: 'An AIMEAT credential for a principal of this agent\'s account.' },
        },
      },
      ...(forHire
        ? {
          foreignCard: {
            scheme: {
              $case: 'apiKeySecurityScheme',
              value: {
                location: 'header',
                name: FOREIGN_HEADERS.card,
                description: `Your own signed agent card in ${FOREIGN_HEADERS.card} and a fresh assertion signed by the same key in ${FOREIGN_HEADERS.assertion}. Your key is pinned on first sight and compared on every call after it. This reaches the skills tagged for-hire and nothing else.`,
              },
            },
          },
        }
        : {}),
    },
    securityRequirements: [{ schemes: { bearer: { list: ['*'] } } }],
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills: [...skillsFor(agent), ...offeringSkills(offerings)],
    signatures: [],
  };
}
