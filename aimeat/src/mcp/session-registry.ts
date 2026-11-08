/**
 * @file src/mcp/session-registry.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which principal holds which open MCP session, so a route that ends a principal's
 *   credentials can close its live MCP transports in the same breath.
 *
 *   WHY. Deleting an agent and rotating its key both revoke its session rows and cut its connect
 *   tunnel, and both left an open MCP session in place: the transport is a long-lived object in
 *   mcp/index.ts, and nothing outside that file could reach it. The credential on that session is
 *   refused from the next request on (auth/agent-alive.ts), so the hole is closed either way; this
 *   takes the socket down at once instead of waiting for the client's next call, which is what the
 *   connect tunnel already does (services/connect-tunnel.ts closeForGaii).
 *
 *   IT IS A LEAF ON PURPOSE, for the reason mcp/resource-events.ts is one: a route reaching the
 *   registry mcp/index.ts assembles would drag every tool group, and every service those import,
 *   into the route layer. This file imports the logger and the event bus (services/event-bus.ts,
 *   itself a leaf) and nothing else of the node's own.
 *
 *   AN ERASED ACCOUNT. services/owner-erasure.ts cannot import from src/mcp/ (the dependency rules
 *   refuse a service that does), so it tells the `accountErased` event, which reaches every process
 *   of the node, and this file closes the sessions each process holds for that account.
 * @structure noteMcpSession(sessionId, principal, close) · forgetMcpSession(sessionId) ·
 *   closeMcpSessionsForGaii(principal) → number · closeMcpSessionsForAccount(ghii) → number
 * @usage
 *   // mcp/index.ts, when a session is created and when it closes
 *   noteMcpSession(transport.sessionId, authenticatedGaii, () => transport.close());
 *   // routes/agents/management.ts, beside the tunnel close
 *   closeMcpSessionsForGaii(agent.gaii);
 * @version-history
 *   2026-11-08 — closeMcpSessionsForAccount, called on every process for an erased account
 *     (accountErased; secaudit2026nov08b round 15, eraseOwner/mcp-sessions-not-closed).
 *   v1.0.0 — 2026-10-20 — Initial (secaudit 2026-10,
 *     mcp-oauth:access-token-without-session-survives-agent-delete).
 */
import { logger } from '../utils/logger.js';
import { onAccountErasedEvent } from '../services/event-bus.js';

/** One open MCP session: whose it is, and how to close it. */
interface OpenSession {
  principal: string;
  close: () => void | Promise<void>;
}

const openSessions = new Map<string, OpenSession>();

/** Record an open MCP session. Called once per session, when its transport has an id. */
export function noteMcpSession(sessionId: string, principal: string, close: () => void | Promise<void>): void {
  openSessions.set(sessionId, { principal, close });
}

/** Forget a session. Called wherever mcp/index.ts cleans its other per-session maps. */
export function forgetMcpSession(sessionId: string): void {
  openSessions.delete(sessionId);
}

/**
 * Close every open MCP session of `principal` and answer how many there were. Best effort: a close
 * that throws is swallowed, because the caller is a route that has already ended the credential and
 * a socket that refuses to close must not fail that answer. The entry is dropped here as well as in
 * the transport's own onclose, so a failed close leaves nothing behind in this map either.
 */
export function closeMcpSessionsForGaii(principal: string): number {
  let closed = 0;
  for (const [id, session] of openSessions) {
    if (session.principal !== principal) continue;
    openSessions.delete(id);
    closed++;
    const closeFailed = (err: unknown) =>
      logger.warn('MCP transport close failed; the session is dropped from this registry regardless, and its credential is refused on the next request', { sessionId: id, principal, error: String(err) });
    try {
      const done = session.close();
      if (done instanceof Promise) done.catch(closeFailed);
    } catch (err) { closeFailed(err); }
  }
  return closed;
}

/**
 * Close every open MCP session that acts for the account `ghii` (`alice@node`): its agents
 * (`<agent>#alice@node`) and the account itself. Answers how many there were.
 *
 * WHY. Erasing an account releases its name, and a 2025-era session forwards notifications by the
 * GAII string, which the next account of that name with an agent of the same name produces again;
 * its task notifications reached the erased person's open GET stream until the idle sweep. The
 * erasure tells every process (`accountErased`, below), and each closes the sessions it holds
 * (secaudit2026nov08b round 15, eraseOwner/mcp-sessions-not-closed).
 */
export function closeMcpSessionsForAccount(ghii: string): number {
  const suffix = `#${ghii}`;
  let closed = 0;
  for (const { principal } of [...openSessions.values()]) {
    if (principal === ghii || principal.endsWith(suffix)) closed += closeMcpSessionsForGaii(principal);
  }
  return closed;
}

// An account erased on any process of the node: this process closes the sessions it holds for it.
onAccountErasedEvent((evt) => {
  const closed = closeMcpSessionsForAccount(`${evt.owner}@${evt.nodeId}`);
  if (closed) logger.info('MCP sessions of an erased account were closed', { owner: evt.owner, closed });
});
