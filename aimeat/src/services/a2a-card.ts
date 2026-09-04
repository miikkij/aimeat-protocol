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
  // On since 2026-09-04. `message/stream` and `SubscribeToTask` yield the whole task on every move
  // until it settles; services/a2a-stream.ts says why whole tasks rather than deltas, and what
  // makes the stream end.
  streaming: true,
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
  // WHAT THE AGENT ITSELF SAID COMES FIRST. `capabilities` is the coarse list given at creation
  // ('memory'), and `technicalCapabilities` is what the agent reported about itself through
  // aimeat_agent_capabilities_report — a real list of what it can do, with names a person wrote.
  // The card read only the first, so an agent that reported its capabilities saw its card go on
  // saying 'memory', and the tool for saying what you can do could not reach the surface a stranger
  // reads. Measured 2026-09-03: declare two skills, card unchanged.
  const reported = (agent.technicalCapabilities ?? [])
    .map(c => (typeof c === 'string' ? c : c?.name))
    .filter((c): c is string => typeof c === 'string' && c.trim() !== '');
  const declared = reported.length > 0
    ? reported
    : (agent.capabilities ?? []).filter(c => typeof c === 'string' && c.trim() !== '');
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
/**
 * What one offering costs, in a sentence a buyer can act on.
 *
 * `unit` IS THE RAIL, NOT THE BILLING UNIT. It is `'money' | 'morsels'` — what the price is paid
 * IN — and the card used to print it as "per what", so a morsel offering read "8 morsel per
 * morsels". A buyer reading that cannot tell whether it is per document, per page or per hour.
 *
 * AND `basePrice` IS MICROS WHEN THE RAIL IS MONEY. The same line printed it raw, so a EUR 1.50
 * offering advertised itself to strangers as "1500000 EUR per money" — the one number a buyer
 * decides on, wrong by a factor of a million, on the surface built for them to decide on. Nobody
 * had seen it because no money-priced offering has ever been published; it was waiting.
 *
 * `basePrice` is per call or per task either way, so that is what the sentence says.
 */
function priceLine(o: Offering): string {
  if (o.unit === 'money') {
    const amount = (o.basePrice / 1_000_000).toFixed(2).replace(/\.00$/, '');
    return `${amount} ${o.currency ?? 'EUR'} per task`;
  }
  return `${o.basePrice} ${o.basePrice === 1 ? 'morsel' : 'morsels'} per task`;
}

/**
 * The one line a stranger reads in the directory before deciding which card to fetch.
 *
 * An agent's own description when it has one, and otherwise WHAT IT SELLS — the titles of its
 * offerings, joined. Both agents listed on the day the directory shipped had an empty description,
 * and an empty index is a directory that makes everybody read everything, which is the opposite of
 * what a directory is for. The titles are already in hand where this is called, they are what the
 * agent is actually offering, and unlike a typed sentence they cannot go stale.
 *
 * Exported so it can be pinned by value: a rule that lives inline in a route has no seam, and this
 * one is read by people who have never signed up here and cannot be told it was a display bug.
 */
export function directoryDescriptionFor(description: string | null | undefined, offerings: Offering[]): string {
  if (description) return description;
  return offerings.map(o => o.title).filter(Boolean).join(' · ');
}

function offeringSkills(offerings: Offering[]): AgentCard['skills'] {
  return offerings.map(o => ({
    id: o.offeringId,
    name: o.title,
    description: `${o.description || o.title} — ${priceLine(o)}. Send this offeringId in message metadata; payment is settled with the x402 extension before the work starts.`,
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
      // "There is a fuller card if you authenticate", which is what this flag means on a PUBLIC
      // card — not "this is one". It said false while `getAuthenticatedExtendedAgentCard` handed
      // back this very card, so the answer was honest and the method was pointless. A principal of
      // the account now gets the operations extension: see a2aExtendedCardFor.
      extendedAgentCard: true,
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

/**
 * The AIMEAT extension on an agent's EXTENDED card: what the owner granted this agent, and what it
 * can actually do right now.
 *
 * WHY IT IS WORTH HAVING AN EXTENDED CARD AT ALL. The public card answers "what does this agent
 * advertise"; it already carries the agent's own declared capabilities and everything published for
 * hire, so for a stranger there is nothing held back. What it cannot answer is "will this agent
 * actually manage what I am about to ask it" — that depends on the scopes its owner granted, the
 * limitations it declared about itself, and the modules it has loaded. Those are facts about the
 * ACCOUNT, so a stranger must not have them and a principal of the account already can, through the
 * REST agent record. This puts the same facts in A2A's vocabulary, at the door A2A defined for them.
 *
 * WHAT IS DELIBERATELY ABSENT, and the reason the fields are named one by one rather than spread:
 * `webhookSecret` is a credential, `webhookUrl` is an address into somebody's infrastructure,
 * `dailySpendLimit` and `morselBalance` are the owner's money. None of them answers "can this agent
 * do the job", and a spread would have carried all four the first time somebody added a field.
 */
export const A2A_AIMEAT_EXTENSION = 'https://aimeat.io/a2a/ext/agent-operations/v1';

/**
 * The card a caller gets once it has authenticated as a principal of this agent's account.
 *
 * THE PUBLIC CARD PLUS THE EXTENSION, and it takes the built card rather than rebuilding one, so
 * the two cannot describe the agent differently. Rebuilding would mean passing the interface URL
 * and the offerings a second time, and a second call with a different argument is how a client ends
 * up holding two pictures of one agent.
 */
export function a2aExtendedCardFrom(card: AgentCard, agent: AgentRecord): AgentCard {
  const limitations = (agent.agentLimitations ?? []).filter(l => typeof l === 'string' && l.trim() !== '');
  // `capabilities` is optional in the SDK's type even though every card this file builds has one.
  // Read defensively rather than asserted: the input is an AgentCard, and one day it may be a card
  // this file did not build.
  const base = card.capabilities;
  return {
    ...card,
    capabilities: {
      ...base,
      streaming: base?.streaming ?? false,
      pushNotifications: base?.pushNotifications ?? false,
      extendedAgentCard: true,
      extensions: [
        ...(base?.extensions ?? []),
        {
          uri: A2A_AIMEAT_EXTENSION,
          required: false,
          description: 'What this agent\'s owner granted it and what it has loaded, for a caller of the same account deciding whether the work will go through.',
          params: {
            // The scopes are the operative fact: a call outside them answers 403 naming the scope,
            // so a caller that can read them knows the refusal before it spends a turn on it.
            granted_scopes: agent.defaultScopes ?? [],
            declared_limitations: limitations,
            modules_loaded: agent.modulesLoaded ?? [],
            languages: agent.languages ?? [],
            domain_capabilities: agent.domainCapabilities ?? [],
            last_seen: agent.lastSeen,
          },
        },
      ],
    },
  };
}
