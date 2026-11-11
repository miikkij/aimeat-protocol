/**
 * @file src/services/organism-agents/attach.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Putting an agent on an organism's agent list (`organism.agentGaiis`, the Agents
 *   section of the organism's page) and taking it off, as one implementation for every surface.
 *
 *   WHY IT MOVED HERE. The rules lived inside POST and DELETE /v1/organisms/:id/agents, and no MCP
 *   tool reached them, so an agent could not add an agent to the list even when its owner told it
 *   to and it held the permission the route asks for. On 2026-11-11 an organism that admits only
 *   listed agents refused an admin's own agent, and the owner's AI had no way to list it (Jouni:
 *   an agent must be able to do what the person can, when it is given the rights). The route and
 *   the MCP tools aimeat_organism_agent_attach and aimeat_organism_agent_detach now call these.
 *
 *   The rules, unchanged from the route:
 *     - only an agent (`name#owner@node`) is listed;
 *     - the caller lists its own owner's agent, or is the organism's owner or an admin;
 *     - where the organism admits only listed agents, the list is who gets in, so adding to it is
 *       the organism's decision: an owner or admin, and a session that may act for the account
 *       holder (the person signed in, or a session holding account:security; `mayActAsPerson`);
 *     - the agent's owner is an active member (the organism's own owner may list their own agent);
 *     - an agent of this node exists.
 *   Taking an agent off is open to its owner and to the organism's owners and admins.
 * @structure AgentListError · attachOrganismAgent() · detachOrganismAgent()
 * @usage
 *   const out = await attachOrganismAgent(storage, config, { organismId, callerOwner, mayActAsPerson, agentGaii });
 * @version-history
 *   v1.0.0 — 2026-11-11 — Extracted from routes/organisms/membership.ts so the MCP surfaces reach it.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { parseGaiiLoose, localAccountName } from '../../utils/gaii.js';
import { isOrganismOwner } from '../organism-ownership.js';
import { agentAccessOf } from '../organism-agent-access.js';
import { emitChange } from '../event-bus.js';

/** A refusal with the status and code the REST route answers. */
export class AgentListError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'AgentListError';
  }
}

export interface AgentListCaller {
  organismId: string;
  /** The bare account name the caller acts for. */
  callerOwner: string;
  /** The account holder signed in, or a session that may act for them (isOwnerPrincipal). */
  mayActAsPerson: boolean;
  agentGaii: unknown;
}

/** Put an agent on the organism's list. Throws AgentListError; answers the listed GAII. */
export async function attachOrganismAgent(
  storage: Storage, config: AimeatConfig, args: AgentListCaller,
): Promise<{ attached: string }> {
  const { organismId, callerOwner, mayActAsPerson } = args;
  const agentGaii = args.agentGaii;
  if (!agentGaii || typeof agentGaii !== 'string') {
    throw new AgentListError(400, 'INVALID_INPUT', 'Body field "agent_gaii" is required');
  }
  if (!parseGaiiLoose(agentGaii).agent) {
    throw new AgentListError(403, 'ACCESS_DENIED', 'You can only attach an agent (name#owner@node)');
  }
  const organism = await storage.getOrganism(organismId);
  if (!organism) throw new AgentListError(404, 'NOT_FOUND', 'Organism not found');

  const agentOwner = localAccountName(agentGaii);
  const ownAgent = agentOwner === callerOwner;
  const isManager = isOrganismOwner(organism, callerOwner) || organism.admins.includes(callerOwner);
  if (!ownAgent && !isManager) throw new AgentListError(403, 'ACCESS_DENIED', 'You can only attach your own agents');
  // Where the list decides who gets in, adding to it is the organism's own decision: only its owner
  // or an admin adds an agent. A member listing their own agent admitted it by themselves until
  // 2026-10-15 (feature-list audit #58).
  if (agentAccessOf(organism) === 'listed' && !isManager) {
    throw new AgentListError(403, 'ACCESS_DENIED', 'This organism admits only the agents on its list, and only its owner or an admin adds one. Ask one of them to add your agent.');
  }
  if (agentAccessOf(organism) === 'listed' && !mayActAsPerson) {
    throw new AgentListError(403, 'ACCESS_DENIED', 'This organism admits only the agents on its list, so adding one takes the owner signed in, or an agent the owner gave the account:security permission. The owner can also add it in the Agents section of the organism\'s page.');
  }
  // The agent's owner must be an active member: an agent is admitted as its owner's, never alone.
  const ownerMembership = await storage.getMembership(organismId, agentOwner);
  const ownerIsMember = !!ownerMembership && ownerMembership.status === 'active';
  if (!ownerIsMember && !(ownAgent && isOrganismOwner(organism, callerOwner))) {
    throw new AgentListError(403, 'NOT_MEMBER', ownAgent
      ? 'You must be a member to attach an agent'
      : `${agentOwner} is not an active member of this organism, so their agent cannot be attached`);
  }
  // An agent of this node must exist: listing a name nobody holds yet would admit whatever agent is
  // later created under it, without anyone listing that one. An agent of another node cannot be
  // looked up here, and is listed as given.
  if (parseGaiiLoose(agentGaii).node === config.nodeId && !(await storage.getAgent(agentGaii))) {
    throw new AgentListError(404, 'NOT_FOUND', `No agent ${agentGaii} on this node`);
  }
  if (organism.agentGaiis.includes(agentGaii)) throw new AgentListError(409, 'ALREADY_ATTACHED', 'That agent is already attached');
  await storage.updateOrganism(organismId, { agentGaiis: [...organism.agentGaiis, agentGaii], updatedAt: new Date().toISOString() });
  emitChange('organisms');
  return { attached: agentGaii };
}

/** Take an agent off the organism's list: its owner, or an owner or admin of the organism. */
export async function detachOrganismAgent(
  storage: Storage, args: Omit<AgentListCaller, 'mayActAsPerson'>,
): Promise<{ detached: string }> {
  const { organismId, callerOwner } = args;
  const agentGaii = args.agentGaii;
  if (!agentGaii || typeof agentGaii !== 'string') throw new AgentListError(400, 'INVALID_INPUT', 'agent_gaii is required');
  const organism = await storage.getOrganism(organismId);
  if (!organism) throw new AgentListError(404, 'NOT_FOUND', 'Organism not found');
  const ownsAgent = localAccountName(agentGaii) === callerOwner;
  const isAdmin = isOrganismOwner(organism, callerOwner) || organism.admins.includes(callerOwner);
  if (!ownsAgent && !isAdmin) throw new AgentListError(403, 'ACCESS_DENIED', 'Only the agent owner or an organism admin can detach it');
  if (!organism.agentGaiis.includes(agentGaii)) throw new AgentListError(404, 'NOT_FOUND', 'That agent is not attached');
  await storage.updateOrganism(organismId, { agentGaiis: organism.agentGaiis.filter(g => g !== agentGaii), updatedAt: new Date().toISOString() });
  emitChange('organisms');
  return { detached: agentGaii };
}
