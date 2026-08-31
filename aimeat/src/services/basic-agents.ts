/**
 * @file src/services/basic-agents.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description "What would the basic-agents button do for this account right now, and can it?"
 *
 *   One function, three callers: the HTTP route, the node's MCP tool, and (through the route) the
 *   connector's. That is the point of it being here rather than in the handler. The button itself
 *   stays where it is — this answers the question, it does not create anything — so there is exactly
 *   one implementation of the reading and exactly one of the creating, and neither is duplicated per
 *   surface.
 *
 *   WHY AN AGENT MAY ASK THIS. Everything in the answer is already visible to a principal acting for
 *   this owner: the template is static and public, and which of the owner's agents exist and hold a
 *   tunnel comes back from `GET /v1/agents` already. What the agent cannot do with it is press the
 *   button — that stays `requireOwnerPrincipal()`, because creating agents is the account changing
 *   and the human's approval is the whole authority. So the agent reads this, hands the person
 *   `approval_url`, and watches `enrolled` flip.
 *
 * @structure describeBasicAgents(config, storage, owner) → BasicAgentsView
 * @usage
 *   import { describeBasicAgents } from '../services/basic-agents.js';
 *   const view = await describeBasicAgents(config, storage, req.auth!.owner);
 * @version-history
 *   v1.0.0 — 2026-08-31 — Extracted from routes/agents-v2/basic-agents.ts so the MCP surface can
 *     answer the same question without a second implementation of it.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { BASIC_AGENTS } from '../data/basic-agents.js';
import { getActiveConnectTunnelManager } from './connect-tunnel.js';

/** Where the owner presses. A deep link into their own profile, not an API address. */
export function basicAgentsApprovalUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/v1/profile?tab=agents`;
}

export interface BasicAgentsView {
  daemon_connected: boolean;
  connected_principals: string[];
  agents: Array<{
    name: string;
    display_name: string;
    description: string;
    scopes: string[];
    mode: string;
    run_mode: string;
    exists: boolean;
    enrolled: boolean;
  }>;
  /** The page the owner opens to press the button. */
  approval_url: string;
  /** One sentence an agent can say to the person, already true for this account's current state. */
  next_step: string;
}

/**
 * A daemon principal is an AGENT principal. An owner's ecosystem apps hold tunnels too, and one of
 * those answering "create this person's agents" would be an app populating an account. Shared with
 * the button so the precondition it refuses on and the state this reports cannot disagree.
 */
export function daemonPrincipals(owner: string): string[] {
  const tunnels = getActiveConnectTunnelManager();
  if (!tunnels) return [];
  return tunnels.principalsForOwner(owner).filter(p => !p.startsWith('eco:'));
}

export async function describeBasicAgents(
  config: AimeatConfig, storage: Storage, owner: string,
): Promise<BasicAgentsView> {
  const connected = daemonPrincipals(owner);
  const existing = await storage.getAgentsByOwner(owner);
  const byName = new Map(existing.map(a => [a.name, a]));

  const agents = BASIC_AGENTS.map(t => {
    const have = byName.get(t.name);
    return {
      name: t.name,
      display_name: t.displayName,
      description: t.description,
      scopes: [...t.scopes],
      mode: t.mode as string,
      run_mode: t.runMode as string,
      exists: !!have,
      enrolled: !!have?.enrolledAt,
    };
  });

  const missing = agents.filter(a => !a.enrolled).length;
  const approvalUrl = basicAgentsApprovalUrl(config.baseUrl);
  // Written for a person to hear, not for a machine to parse. An agent relaying this should be able
  // to say it as-is; the state it describes is the one this call just measured.
  const nextStep = missing === 0
    ? 'These agents are already set up for this account. Nothing to do.'
    : connected.length === 0
      ? `Your connector is not running, so there is nothing here to run these agents yet. Start it, then open ${approvalUrl} and press the button on the Agents page.`
      : `Your connector is running, so this is ready. Open ${approvalUrl} and press the button on the Agents page, and the agents are yours.`;

  return {
    daemon_connected: connected.length > 0,
    connected_principals: connected,
    agents,
    approval_url: approvalUrl,
    next_step: nextStep,
  };
}
