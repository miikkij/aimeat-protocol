/**
 * @file src/services/app-agents/app-agent-link.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which of a person's agents was made from an agent an app bundles, and from which
 *   version of its definition.
 *
 *   WHY NOT THE NAME. Until 2026-11-11 the status, the list of running copies and the undeploy
 *   action found the agent by a name derived from the app: `<agent_name>-<slug(app_id)>` cut to 64
 *   characters. An agent made by approving a proposal gets that name cut to 40, because a proposal
 *   allows no more. Measured on a production node that day: three of the five bundled agents
 *   there have a derived name over 40 characters, so an approved agent of theirs read as "not
 *   registered" and had no row of its own.
 *
 *   WHERE THE LINK IS. On the proposal, and nowhere else: `source_app` names the app, the agent's
 *   name inside the app and the hash of the definition the agent runs, and the approved proposal's
 *   `name` is the agent's name. A publish of a newer definition to the agent rewrites the hash
 *   (services/agent-proposals.ts recordProposalDefinition). The proposal is the right place because
 *   the node acts on this value (it decides whether to stop the agent itself and whether to publish
 *   a definition), and `agents.proposals.` is a reserved key prefix: an app or an agent holding
 *   memory:write cannot write it (utils/reserved-keys.ts). The record `agents.<name>.deploy`, which
 *   a fleet writes for an agent it deployed, is not reserved and is never read here.
 *
 *   A proposal stored before the field existed, and an agent the owner's own fleet registered, are
 *   found by the two derived names, so nothing made earlier is lost. Nothing is known about the
 *   definition such an agent runs.
 * @structure OwnBundledAgent · findOwnBundledAgent()
 * @usage
 *   const own = await findOwnBundledAgent({ storage, config }, 'alice', 'bob/notes.html', 'summarizer');
 *   if (own.state === 'running') { ... own.agent.name ... }
 * @version-history
 *   v1.0.0 — 2026-11-11 — Initial.
 */
import type { AgentRecord } from '../../storage/interface.js';
import { buildGAII } from '../../utils/gaii.js';
import { deployedAgentName, proposedAgentName } from '../../models/crew-def-schemas.js';
import { listProposals, type AgentProposal, type ProposalContext } from '../agent-proposals.js';
import { isStopped } from '../agent-stop-rules.js';

export type OwnBundledAgent =
  | { state: 'none' }
  /** A proposal for this agent waits for the owner's approval; nothing exists yet. */
  | { state: 'waiting'; proposal: AgentProposal }
  | {
    state: 'running' | 'stopped';
    agent: AgentRecord;
    /** `proposal`: made by the owner's approval on this node. `fleet`: registered by the owner's own runtime. */
    via: 'proposal' | 'fleet';
    /** The hash of the definition it runs, or null when no proposal recorded one. */
    definitionHash: string | null;
    /** The approved proposal it came from; null for a fleet's agent. */
    proposal: AgentProposal | null;
  };

const sameSource = (p: AgentProposal, appId: string, agentName: string): boolean =>
  p.source_app?.app_id === appId && p.source_app.agent_name === agentName;

/**
 * The caller's own agent made from `agentName` of the app `appId`, or the proposal that waits, or
 * nothing. `owner` is the bare account name; only that account's proposals and agents are read.
 */
export async function findOwnBundledAgent(
  ctx: ProposalContext, owner: string, appId: string, agentName: string,
): Promise<OwnBundledAgent> {
  const proposals = await listProposals(ctx, owner);
  const proposedName = proposedAgentName(agentName, appId);
  const deployedName = deployedAgentName(agentName, appId);
  const linked = proposals.filter(p => sameSource(p, appId, agentName));

  // The approved proposals that name this app first (newest first, as listProposals sorts), then the
  // two derived names for an agent made before a proposal carried `source_app`.
  const names = [...new Set([
    ...linked.filter(p => p.state === 'approved').map(p => p.name), proposedName, deployedName,
  ])];
  for (const name of names) {
    const agent = await ctx.storage.getAgent(buildGAII(name, owner, ctx.config.nodeId));
    if (!agent) continue;
    const approved = linked.find(p => p.state === 'approved' && p.name === name)
      ?? proposals.find(p => p.state === 'approved' && p.name === name)
      ?? null;
    return {
      state: isStopped(agent) ? 'stopped' : 'running',
      agent,
      via: approved ? 'proposal' : 'fleet',
      definitionHash: approved && sameSource(approved, appId, agentName) ? approved.source_app?.definition_hash ?? null : null,
      proposal: approved,
    };
  }

  const waiting = linked.find(p => p.state === 'proposed')
    ?? proposals.find(p => p.state === 'proposed' && !p.source_app && p.name === proposedName);
  return waiting ? { state: 'waiting', proposal: waiting } : { state: 'none' };
}
