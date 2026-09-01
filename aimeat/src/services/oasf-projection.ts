/**
 * @file src/services/oasf-projection.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One of this node's agents, described as an OASF record — the Open Agentic Schema
 *   Framework's way of saying what an agent is, so a directory that indexes agents can index ours.
 *
 *   NO LIBRARY, DELIBERATELY. OASF is a JSON schema, not a protocol: there is nothing to negotiate,
 *   no framing to get wrong, and no client to be compatible with — a record is either the right
 *   shape or it is not. A dependency here would buy types and cost a version to track, and the
 *   whole file is one function.
 *
 *   IT IS A PROJECTION, LIKE THE A2A CARD BESIDE IT. Everything comes off the AgentRecord the node
 *   already holds. There is nowhere for an operator to hand-write one, for the same reason there is
 *   nowhere to hand-write an A2A card: a second description of what an agent can do drifts from the
 *   first, and then two directories disagree about the same agent.
 *
 *   WHERE THE AIMEAT-SPECIFIC PARTS GO. OASF has `extensions` for exactly this — a named, versioned
 *   object a consumer either understands or steps over. The GAII, the owner, the node and the run
 *   mode live in one `aimeat.agent/v1` extension rather than being smuggled into fields OASF
 *   defined for something else. `locators` carries the two addresses that are useful to a machine:
 *   the A2A interface and the signed AIMEAT card.
 *
 *   WHAT IS NOT CLAIMED. No signature block: OASF signatures cover a record as published to a
 *   registry, and this node serves the record live rather than publishing it anywhere. The AIMEAT
 *   card at the locator IS signed, by the agent's own key, and that is the claim this node can
 *   actually stand behind.
 *
 * @structure OASF_SCHEMA_VERSION · OASF_EXTENSION · oasfRecordFor(config, agent, urls)
 * @usage const record = oasfRecordFor(config, agent, { a2a: '…', card: '…' });
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V6c).
 */
import type { AimeatConfig } from '../config.js';
import type { AgentRecord } from '../storage/interface.js';

/** The OASF schema line this record is written against. */
export const OASF_SCHEMA_VERSION = '0.3.1';

/** The name of the extension the AIMEAT-specific half travels in. */
export const OASF_EXTENSION = 'aimeat.agent';

export interface OasfLocatorUrls {
  /** Where an A2A client talks to this agent. */
  a2a: string;
  /** The agent's own signed AIMEAT card. */
  card: string;
  /** The A2A agent card, for a consumer that reads those rather than ours. */
  a2aCard: string;
}

export interface OasfSkill {
  /** The skill's name. A taxonomy id would be better and we do not have one to give. */
  name: string;
  /** Free text, because a name alone tells a reader almost nothing. */
  description?: string;
}

export interface OasfRecord {
  name: string;
  version: string;
  schema_version: string;
  description: string;
  authors: string[];
  created_at: string;
  skills: OasfSkill[];
  locators: Array<{ type: string; url: string }>;
  extensions: Array<{ name: string; version: string; data: Record<string, unknown> }>;
  annotations: Record<string, string>;
}

/**
 * An agent's declared capabilities as OASF skills.
 *
 * OASF's own skill list is a taxonomy with numeric class ids, and this node does not hold one:
 * `capabilities` is whatever the owner typed. Emitting an invented id would be worse than emitting
 * none — a consumer that trusts the taxonomy would file the agent under something it is not — so
 * the name is the name, and the absence of an id is the honest signal that this is not taxonomy
 * data.
 */
function skillsFor(agent: AgentRecord): OasfSkill[] {
  const declared = (agent.capabilities ?? []).filter(c => typeof c === 'string' && c.trim() !== '');
  if (declared.length === 0) {
    return [{
      name: agent.name,
      description: agent.description || `Work handled by ${agent.displayName || agent.name}.`,
    }];
  }
  return declared.map(c => ({ name: c, description: `${agent.displayName || agent.name} declares this capability.` }));
}

export function oasfRecordFor(config: AimeatConfig, agent: AgentRecord, urls: OasfLocatorUrls): OasfRecord {
  return {
    // OASF names an agent `publisher/name`, and the publisher here is the person whose agent it is.
    name: `${agent.owner}/${agent.name}`,
    // The card's issue date when it has one: what a consumer needs to know is whether the
    // DESCRIPTION changed, and this node has no other version line for an agent.
    version: agent.cardIssuedAt ?? '1.0.0',
    schema_version: OASF_SCHEMA_VERSION,
    description: agent.description
      || `An agent on the AIMEAT node ${config.nodeId}. Work sent to it becomes a task its owner's runtime picks up.`,
    authors: [agent.owner],
    created_at: agent.createdAt,
    skills: skillsFor(agent),
    locators: [
      // `source-code` and `docker-image` are OASF's usual locator types and neither describes a
      // running agent behind a protocol, so the type says what the address IS and a consumer that
      // does not know the word can still read the URL.
      { type: 'a2a-jsonrpc', url: urls.a2a },
      { type: 'a2a-agent-card', url: urls.a2aCard },
      { type: 'aimeat-agent-card', url: urls.card },
    ],
    extensions: [{
      name: OASF_EXTENSION,
      version: '1.0.0',
      data: {
        gaii: agent.gaii,
        owner: agent.owner,
        node: config.nodeId,
        // Stored and shown, never enforced — the same thing the node says everywhere else about it.
        run_mode: agent.runMode ?? null,
        identity_version: agent.identityVersion ?? 1,
        mode: agent.mode ?? null,
        trust_score: agent.trustScore,
        tags: agent.tags ?? [],
      },
    }],
    annotations: {
      // A consumer's first question about an agent it found is who to talk to and how.
      'aimeat.io/node': config.nodeId,
      'aimeat.io/gaii': agent.gaii,
      'aimeat.io/protocol': 'a2a',
    },
  };
}
