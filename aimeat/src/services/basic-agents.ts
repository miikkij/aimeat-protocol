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
 *   v1.3.0 — 2026-10-10 — A connected daemon carries the name its connector reported, and
 *     residentRunnable() answers for one named connector when the caller names it.
 *   v1.2.0 — 2026-10-02 — A connected daemon carries the run modes its connector presented, and
 *     residentRunnable() says whether any of the owner's daemons can keep an agent up.
 *   v1.1.0 — 2026-10-02 — Each basic agent in the view carries `task_start`.
 *   v1.0.0 — 2026-08-31 — Extracted from routes/agents-v2/basic-agents.ts so the MCP surface can
 *     answer the same question without a second implementation of it.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { BASIC_AGENTS } from '../data/basic-agents.js';
import { getActiveConnectTunnelManager } from './connect-tunnel.js';
import { addItem, listItems } from './open-items.js';

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
    /** Whether its tasks start on their own ('automatic') or wait for the owner ('confirm'). */
    task_start: string;
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
  return connectedDaemons(owner).flatMap(d => d.principals);
}

/** One connected machine, and what it is holding. */
export interface ConnectedDaemon {
  /** Null from a connector older than 2026-09-01. */
  installId: string | null;
  principals: string[];
  /** The principal an offer is handed to. First by sorted name, so a retry picks the same one. */
  target: string;
  /** The run modes the connector presented at connect; null from one older than 2026-10-02. */
  runModes: string[] | null;
  /** The name the connector reported for its installation; null when it reported none. */
  name: string | null;
}

/**
 * Whether one of the owner's connected daemons can keep an agent resident: true when one says so
 * or does not say (an older connector, given the benefit of the doubt), false when every one of
 * them runs by spawning, null when none is connected, so nothing can be said. With `installId` the
 * answer is for that connector alone: an agent ordered to one machine runs the way that machine
 * runs agents, whatever the owner's other machines can do.
 */
export function residentRunnable(owner: string, installId?: string | null): boolean | null {
  const all = connectedDaemons(owner);
  const daemons = installId ? all.filter(d => d.installId === installId) : all;
  if (daemons.length === 0) return null;
  return daemons.some(d => d.runModes === null || d.runModes.includes('resident'));
}

/**
 * An owner's connected DAEMONS, one entry per machine.
 *
 * The V1 report carried this as a stated limitation: one `connect serve` holds one socket per
 * agent, so two laptops looked like one set of principals and the offer went to whichever sorted
 * first — possibly the machine the person was not sitting at. The daemon now presents an install
 * id and this groups on it.
 *
 * Ecosystem apps hold tunnels too, and one of those answering "create this person's agents" would
 * be an app populating an account, so they are filtered out here as they always were — before the
 * grouping, so a machine holding only apps is not reported as a daemon at all.
 */
export function connectedDaemons(owner: string): ConnectedDaemon[] {
  const tunnels = getActiveConnectTunnelManager();
  if (!tunnels) return [];
  return tunnels.daemonsForOwner(owner)
    .map(d => ({ ...d, principals: d.principals.filter(p => !p.startsWith('eco:')) }))
    .filter(d => d.principals.length > 0)
    .map(d => ({ installId: d.installId, principals: d.principals, target: d.principals[0], runModes: d.runModes, name: d.name }));
}

/**
 * An agent asks its owner for the basic agents. The ask lands on the owner's open-items list, and
 * the owner presses the button that was already there.
 *
 * WHY THIS IS NOT A NEW APPROVAL SYSTEM. Device authorization already has one, and a second one
 * beside it would mean a record type in both providers, a listing route, an approve route and a
 * surface to approve on. Open items is a list the person already reads, already a single memory
 * record, and already carries an item that can close itself when its condition holds. So the
 * request is one item with `closes_when: basic_agents`: the person presses, the agents enrol, and
 * the item leaves the list on its own without anybody marking it done.
 *
 * WHAT IT CANNOT DO, on purpose: create anything. The button is still `requireOwnerPrincipal()`,
 * and an agent asking in the owner's name is not the owner. This writes a line on a list.
 */
export async function requestBasicAgents(
  config: AimeatConfig, storage: Storage, owner: string, askedBy: string, note?: string,
): Promise<{ ok: true; requested: boolean; item_id: string | null; reason?: string } & BasicAgentsView | { ok: false; status: number; code: string; message: string }> {
  const view = await describeBasicAgents(config, storage, owner);

  // Nothing to ask for. Not an error: an agent that checks first and finds them there should be
  // able to say so, rather than putting a dead line on the person's list.
  if (view.agents.every(a => a.enrolled)) {
    return { ok: true, requested: false, item_id: null, reason: 'already_there', ...view };
  }

  const ownerGhii = `${owner}@${config.nodeId}`;
  const existing = await listItems(storage, config, ownerGhii, owner);
  // One ask, not one per conversation. An agent that asks twice should not print two lines on a
  // person's list, and the id of the standing one is a more useful answer than a duplicate.
  const already = existing.find(i => i.closes_when?.check === 'basic_agents' && !i.satisfied);
  if (already) {
    return { ok: true, requested: false, item_id: already.id, reason: 'already_asked', ...view };
  }

  const missing = view.agents.filter(a => !a.enrolled).map(a => a.display_name);
  const title = note?.trim()
    ? `Set up your first agents: ${missing.join(', ')} (${note.trim().slice(0, 120)})`
    : `Set up your first agents: ${missing.join(', ')}`;

  const item = await addItem(storage, ownerGhii, {
    title,
    kind: 'decision',
    origin: askedBy,
    by: 'ai',
    // It answers itself the moment the person presses, so nobody has to tick it off.
    closes_when: { check: 'basic_agents' },
  });
  if (!item) {
    return {
      ok: false, status: 409, code: 'LIST_FULL',
      message: 'Your list of open items is full, so this could not be added to it. Close a few and ask again.',
    };
  }
  return { ok: true, requested: true, item_id: item.id, ...view };
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
      task_start: t.taskStart as string,
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
