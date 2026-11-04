/**
 * @file src/auth/injected-request.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether a request is one the node dispatched to itself in process
 *   (services/request-injector.ts), and for which caller's bearer.
 *
 *   The injector hands the node's own HTTP server a connection that is not a socket. Before it does,
 *   it marks that connection here with the hash of the bearer the request carries, when the
 *   dispatch is for a caller (`aimeat_invoke`, `aimeat_capabilities_invoke`,
 *   `aimeat_app_tool_invoke`). The mark is a property under a symbol on the connection object, so
 *   nothing a client sends can set it: a request from outside arrives on a socket the node did not
 *   build and carries no mark.
 *
 *   Two readers:
 *   - auth/mcp-token-on-rest.ts takes a token bound to the MCP endpoint on a REST route when the
 *     request is the node's own dispatch for that exact token (injectedRequestCovers). This is what
 *     the loopback pass (auth/loopback-pass.ts) did for the same three tools over a socket.
 *   - auth/loopback-pass.ts fromNodeMachine answers false for any injected request, as it does for a
 *     request that carries the self-request or loopback-pass header: a dispatch the node makes for a
 *     principal is not a person at the node's own machine.
 * @structure markInjectedConnection(connection, bearer) · isInjectedRequest(req) ·
 *   injectedRequestCovers(req, bearer)
 * @usage
 *   markInjectedConnection(serverSide, bearer);                       // services/request-injector.ts
 *   if (injectedRequestCovers(req, token)) return 'accept';            // auth/mcp-token-on-rest.ts
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial: the mark replaces the loopback pass for the three tools that run a
 *     capability through the node's own routes (codebase analysis 2026-11-03, item D-j).
 */
import { createHash, timingSafeEqual } from 'node:crypto';

const INJECTED = Symbol('aimeat.injected-request');

interface InjectedMark {
  /** The hash of the bearer the dispatch carries for a caller, or null for a dispatch for nobody in particular. */
  bearerHash: Buffer | null;
}

function hashOf(bearer: string): Buffer {
  return createHash('sha256').update(bearer).digest();
}

/** Mark the server side of an in-process connection. Called by the injector before the server sees it. */
export function markInjectedConnection(connection: object, bearer: string | null): void {
  const mark: InjectedMark = { bearerHash: bearer ? hashOf(bearer) : null };
  Object.defineProperty(connection, INJECTED, { value: mark, enumerable: false });
}

function markOf(req: { socket?: unknown }): InjectedMark | null {
  const socket = req.socket as Record<symbol, unknown> | null | undefined;
  const mark = socket ? socket[INJECTED] : undefined;
  return mark && typeof mark === 'object' ? mark as InjectedMark : null;
}

/** True when the request came through the node's own in-process dispatch. */
export function isInjectedRequest(req: { socket?: unknown }): boolean {
  return markOf(req) !== null;
}

/**
 * True when the request is the node's own in-process dispatch for this exact bearer. A request
 * from outside, an injected request for nobody in particular, and an injected request that carries
 * another bearer all answer false.
 */
export function injectedRequestCovers(req: { socket?: unknown }, bearer: string): boolean {
  const mark = markOf(req);
  if (!mark?.bearerHash || !bearer) return false;
  return timingSafeEqual(mark.bearerHash, hashOf(bearer));
}
