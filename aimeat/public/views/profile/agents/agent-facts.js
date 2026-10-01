/**
 * @file public/views/profile/agents/agent-facts.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where an agent runs, what it thinks with and who pays for it, in the person's words
 *   (guided journey P4, brief doc-mupor242l3cq).
 *
 *   WHY. Eleven kinds of agent exist in the code, and for a person they reduce to four places: their
 *   chat AI, their own machine, this AIMEAT, and someone else's service. The card showed a mode word,
 *   a platform and a self-reported model, and none of them answered "where is this, and what does it
 *   cost me". The place is read from what the node itself knows about the agent (its health verdict,
 *   its delivery channel, its mode, its identity version); nothing here is asked of the agent.
 *
 *   ONE LIST FOR THE CARD AND THE PICTURE. The four places are PLACES, which the "where an agent runs"
 *   picture on the page draws and agentFacts() picks one of, so the two cannot name a place differently.
 * @structure PLACES · placeOf(agent) · agentFacts(agent)
 * @usage import { agentFacts } from './agent-facts.js'; const f = agentFacts(agent); f.runsOn, f.thinksWith, f.paidBy
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial.
 */
import { t } from '/js/i18n.js';

const f = (key, vars) => t('profile.agents.facts.' + key, vars);

/** The four places an agent can run, in the order the picture draws them. */
export const PLACES = ['chat', 'machine', 'node', 'service'];

/**
 * The place, from the node's own record. A push address is a service's own server; a live socket or
 * a v2 identity is the person's connector; an internal agent is this AIMEAT; a connection that only
 * speaks MCP is a chat AI. An agent that never connected has no place yet.
 */
export function placeOf(agent) {
  const state = agent?.health?.state;
  const channel = agent?.health?.delivery?.channel;
  if (state === 'system') return 'node';
  if (channel === 'webhook' || channel === 'webhook-failing') return 'service';
  if (channel === 'socket' || agent?.identity_version === 2) return 'machine';
  if (agent?.mode === 'workstation' || agent?.mcp_client) return 'chat';
  return agent?.last_seen ? 'chat' : null;
}

/** The three facts the card states in one line. */
export function agentFacts(agent) {
  const place = placeOf(agent);
  const client = agent?.mcp_client || agent?.platform || '';
  return {
    place,
    runsOn: place ? f('runsOn.' + place, { client: client || f('yourChat') }) : f('runsOn.unknown'),
    thinksWith: agent?.model ? agent.model : f('thinksWith.' + (place || 'unknown')),
    paidBy: f('paidBy.' + (place || 'unknown'), { client: client || f('yourChat') }),
  };
}
