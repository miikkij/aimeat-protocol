/**
 * @file src/tool-catalog/definitions/organism-agents.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_organism_agent_attach and aimeat_organism_agent_detach: an organism's agent
 *   list (the Agents section of its page) for an AI. On all three surfaces: the node's MCP endpoint
 *   (src/mcp/organisms-name-invites.ts), the connector MCP and the CLI dispatch
 *   (src/tool-dispatch/tool-call-defs-organism.ts), the last two over POST and DELETE
 *   /v1/organisms/:id/agents. One implementation: services/organism-agents/attach.ts.
 * @structure organismAgentTools
 * @usage imported by tool-catalog/definitions.ts
 * @version-history
 *   v1.0.0 — 2026-11-11 — Initial: the list was reachable on the page and over REST only, so an
 *     owner's AI could not add an admin's agent to an organism that admits only listed agents.
 */
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const organismAgentTools = [
    {
        name: 'aimeat_organism_agent_attach',
        description: 'Put an agent on an organism\'s agent list (the Agents section of the organism\'s page). Where the organism admits only listed agents (agent_access "listed"), this list is which agents may act there at all, with their owner\'s rights: an agent not on it is refused as a non-member. Where it admits every member\'s agent, listing adds the organism\'s shared area and takes nothing away. Who may: an agent of your own owner, or any active member\'s agent when your owner is an owner or admin of the organism. Under "listed", only an owner or admin adds one, and the session must act for the person: the person signed in, or an agent the owner gave account:security. The agent\'s owner must be an active member. Undo with aimeat_organism_agent_detach.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Attach Agent to Organism', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'organism:invite',
        surfaces: ['agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            agent_gaii: { type: 'string', required: true, description: 'The agent to list, as name#owner@node (e.g. "claude#alice@node-1"). aimeat_organism_members shows each member\'s agents.' },
        },
    },
    {
        name: 'aimeat_organism_agent_detach',
        description: 'Take an agent off an organism\'s agent list. Where the organism admits only listed agents, the agent is refused there from then on; where it admits every member\'s agent, it keeps its owner\'s rights and loses only what the list added. Who may: the agent\'s owner, or an owner or admin of the organism.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Detach Agent from Organism', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'organism:invite',
        surfaces: ['agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            agent_gaii: { type: 'string', required: true, description: 'The listed agent, as name#owner@node.' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
