/**
 * @file src/services/node-invoke.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Run one node capability by name, with the caller's own credential.
 *
 *   ONE IMPLEMENTATION, AND THIS IS NOT A SECOND ONE. The dispatch goes through the shared
 *   name-to-REST table (`CONNECT_CLI_TOOLS`) and lands on the node's own Express stack over
 *   loopback, carrying the CALLER'S bearer. So `requireAuth`, `requireScope`, the ownership checks
 *   and the AIMEAT envelope all apply by construction, exactly as they do when the same capability
 *   is reached as a tool or as a route. There is no privileged path here and nothing is re-derived:
 *   an `invoke` of `aimeat_memory_write` IS a `POST /v1/memory` by the same principal.
 *
 *   This is the shape the connect tunnel has used since June (services/connect-tunnel.ts
 *   `handleRequest`): a loopback self-fetch with the principal's pinned token, rather than reaching
 *   into storage behind the gates. It is the reason a wide surface is safe at all.
 *
 *   WHY THE CONNECTOR'S TABLE. It is the only map from a capability NAME to the REST call that
 *   performs it, and it is already wrapped where it matters: `withDeclaredInputOnly` refuses a
 *   parameter the capability does not declare instead of dropping it, and `withProvenanceCarrying`
 *   records an `ai_provenance` block rather than swallowing it. Writing a second map here would
 *   reintroduce the drift those two wrappers exist to end.
 *
 *   WHAT THE CALLER CONTROLS. The capability NAME, which must be in the catalogue, and the input,
 *   which the table filters against the declared contract. Never a URL: paths come from the table,
 *   so there is nothing here for an SSRF to steer.
 *
 * @structure invokeNodeCapability(config, args) → { ok, status, body } | refusal
 * @usage
 *   const out = await invokeNodeCapability(config, { id, input, bearer, agentName });
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V2: discover + invoke).
 */
import type { AimeatConfig } from '../config.js';
import { CONNECT_CLI_TOOLS } from '../cli/connect/tool-call.js';
import { AimeatClient } from '../cli/connect/api-client.js';
import { findNodeCapability, NON_INVOKABLE, listNodeCapabilities } from './node-capabilities.js';
import { logger } from '../utils/logger.js';

export interface InvokeRefusal { ok: false; status: number; code: string; message: string; details?: unknown }
export interface InvokeSuccess { ok: true; capability: string; result: unknown; duration_ms: number }

export interface InvokeArgs {
  /** The capability id, e.g. `aimeat_memory_write`. */
  id: unknown;
  /** The capability's own input. Filtered against its declared contract by the shared table. */
  input: unknown;
  /** The caller's raw bearer. The loopback call carries this and nothing else. */
  bearer: string | undefined;
  /** The caller's agent name, for the handful of handlers that address `/v1/agents/:name/…`. */
  agentName: string;
}

/** How close a suggestion has to be before naming it is help rather than noise. */
const SUGGEST_LIMIT = 5;

export async function invokeNodeCapability(
  config: AimeatConfig, args: InvokeArgs,
): Promise<InvokeSuccess | InvokeRefusal> {
  const id = typeof args.id === 'string' ? args.id.trim() : '';
  if (!id) {
    return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'Name the capability to run. Find one with discover first.' };
  }
  if (NON_INVOKABLE.has(id)) {
    return { ok: false, status: 400, code: 'NOT_INVOKABLE', message: 'That one cannot run itself. Name the capability you actually want.' };
  }
  const capability = findNodeCapability(id);
  if (!capability) {
    // A near-miss list beats "not found" for a caller that guessed at a name, and it is free: the
    // catalogue is in memory.
    const near = listNodeCapabilities()
      .filter(c => c.id.includes(id) || id.includes(c.segment))
      .slice(0, SUGGEST_LIMIT).map(c => c.id);
    return {
      ok: false, status: 404, code: 'NO_SUCH_CAPABILITY',
      message: 'This node has nothing by that name. Search for what you need with discover, then run it by the id it gives you.',
      details: near.length ? { did_you_mean: near } : undefined,
    };
  }
  if (!args.bearer) {
    return { ok: false, status: 401, code: 'AUTH_REQUIRED', message: 'Sign in first. A capability runs as whoever called it, so this needs your credential.' };
  }

  const tool = CONNECT_CLI_TOOLS.find(t => t.name === id);
  if (!tool) {
    // The catalogue is built FROM this table, so this is unreachable unless the two are edited
    // apart. Named rather than crashed, because the honest answer is "this node is inconsistent".
    logger.warn('node-invoke: catalogue names a capability the dispatch table does not', { capability: id });
    return { ok: false, status: 500, code: 'CAPABILITY_UNROUTABLE', message: 'This node lists that capability but cannot run it. Tell whoever runs this node.' };
  }

  const input = (args.input && typeof args.input === 'object' && !Array.isArray(args.input))
    ? args.input as Record<string, unknown>
    : {};

  // Loopback, so the request runs through the real Express stack. NOT config.baseUrl, which would
  // add a public-internet hop for a call that never leaves this process's host.
  const client = new AimeatClient(`http://127.0.0.1:${config.port}`, args.bearer);
  const started = Date.now();
  try {
    const response = await tool.handler({
      client,
      config: { node_url: `http://127.0.0.1:${config.port}`, agent: args.agentName, owner: '' },
      agentPath: encodeURIComponent(args.agentName),
    }, input);
    const duration = Date.now() - started;
    // The capability's own refusal is an ANSWER, not a failure of the dispatcher: hand it back whole
    // so the caller reads the same envelope it would have got calling the route directly.
    if (response && typeof response === 'object' && (response as { ok?: unknown }).ok === false) {
      const err = (response as { error?: { code?: string; message?: string } }).error;
      return {
        ok: false, status: 400, code: err?.code ?? 'CAPABILITY_REFUSED',
        message: err?.message ?? 'That capability refused the call.',
        details: response,
      };
    }
    return { ok: true, capability: id, result: (response as { data?: unknown })?.data ?? response, duration_ms: duration };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A thrown handler is usually a contract problem the caller can fix (an undeclared parameter,
    // a missing required one), so it comes back as 400 with the message rather than as a 500.
    return { ok: false, status: 400, code: 'CAPABILITY_ERROR', message };
  }
}
