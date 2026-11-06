/**
 * @file src/routes/agents/announce-scopes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description announceScopes(): an agent's permissions changed, so tell the two places that hold
 *   the old list. Moved unchanged out of ./management.ts so POST /v1/agents/:name/allow
 *   (./permission-allow.ts) says it the same way as PATCH /v1/agents/:name/scopes and the
 *   read-through routes.
 * @structure announceScopes(gaii)
 * @usage announceScopes(updated.gaii);
 * @version-history
 *   2026-11-05 — widenAndAnnounce is removed: a token mint adds no word, and the store place's default is given
 *     and announced by services/place-agent-scopes.ts (codebase analysis 2026-11-03, decision 8b of 2026-11-05).
 *   2026-11-04 — The running connector tunnel manager is read from nodeContext() (services/node-context.ts) in place of
 *     getActiveConnectTunnelManager (codebase analysis 2026-11-03, item D-i).
 *   v1.1.0 — 2026-11-02 — widenAndAnnounce: a store place's default, announced when it adds a word.
 *   v1.0.0 — 2026-10-17 — Pure extraction from ./management.ts
 *     (wish-puuttuva-lupa-ai-neuvoo-ihmist-yhdell-salli-painikkeella-eik).
 */
import { emitToolListChanged } from '../../services/resource-events.js';
import { nodeContext } from '../../services/node-context.js';

/**
 * An agent's permissions changed: tell the two places that hold the old list. Moved unchanged out of
 * PATCH /v1/agents/:name/scopes, so the read-through doors say it the same way.
 */
export function announceScopes(gaii: string): void {
  // The agent's open MCP sessions registered the tools THESE scopes allowed, so the list they
  // hold is now wrong. Saying so is the difference between the person reconnecting the connector
  // by hand after every permission change and not having to think about it at all.
  emitToolListChanged(gaii);
  // …and the tool list is only half of it. An open MCP session re-lists its tools on that signal,
  // but a connector holds a MINTED token whose scopes were fixed when it was minted, for up to an
  // hour, and nothing told it otherwise: the node's own /v1/agents said the agent held the new
  // word while every call it made was refused for lacking it. This frame asks for a fresh mint and
  // nothing else — it must never be auth_revoked, which stops the identity, because then ADDING a
  // permission would kill the agent.
  nodeContext().tunnel?.notifyScopesChanged(gaii);
}
