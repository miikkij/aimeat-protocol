/**
 * @file _registry.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared helpers for MCP tool registrations in multi-agent mode.
 *   Every tool's input schema gets `agent_name: agentNameSchema` and every
 *   handler calls `pickAgent(registry, agent_name)` to get the right client +
 *   agent name. Single-agent installs are unaffected -- the parameter is
 *   optional and defaults to the only loaded agent.
 * @version-history
 *   v1.1.0 -- 2026-09-07 -- `envelopeResult` / `payloadResult`: one place that decides whether a
 *     tool result is an error. Every tool here built its result by hand, and 144 of the 163 return
 *     sites left `isError` off entirely -- so a node refusal came back as a SUCCESSFUL tool call
 *     whose text happened to say no. Measured on 2026-09-06 against a live serve daemon on the
 *     tunnel: `aimeat_dm_inbox` and `aimeat_dm_thread` answered a 403 SCOPE_DENIED with
 *     `isError: undefined`, while `aimeat_schedule_list` beside them set it.
 *   v1.0.0 -- 2026-05-29 -- Initial multi-agent tool helpers
 */
import { z } from 'zod';
import type { AgentRegistry, RegisteredAgent } from '../../agent-registry.js';
import type { ApiResponse } from '../../api-client.js';

export const agentNameSchema = z
  .string()
  .optional()
  .describe(
    "Which agent to act as. Optional when only one is connected; with several, defaults to the one marked 'primary: true' in its per-agent config (or the first if none is). A bare name works when only one connected agent has it; when two owners on this connector share a name, that is refused and both full identities are named, and you pass one of those instead.",
  );

export function pickAgent(registry: AgentRegistry, agentName?: string): RegisteredAgent {
  return registry.resolve(agentName);
}

/**
 * What an MCP tool hands back: the text the model reads, and whether the call actually happened.
 *
 * The index signature is the SDK's, not ours: `mcp.tool()`'s callback type is an open object, so a
 * closed interface here is rejected at every one of the call sites rather than at this line.
 */
export interface ToolResult {
  [x: string]: unknown;
  content: { type: 'text'; text: string }[];
  isError?: true;
}

/**
 * One tool result from one node envelope, WITH the flag that says whether it worked.
 *
 * `isError` is the only thing in an MCP result that says "this did not happen". Leave it off and a
 * refusal arrives as a successful tool call whose text happens to say no -- and a model reading a
 * successful call that returned no rows draws the obvious conclusion, which is that there are no
 * rows. That is how "you may not read this" becomes "your inbox is empty", and there is nothing
 * downstream that can tell the two apart afterwards.
 *
 * Every tool here used to build this object by hand and 144 of the 163 sites left the flag off, so
 * the flag was present exactly where somebody had happened to think of it. It is not a per-tool
 * decision: `ok === false` is the node saying the call did not happen, whatever the tool was.
 */
export function envelopeResult(resp: ApiResponse): ToolResult {
  return payloadResult(resp.data ?? resp, resp);
}

/**
 * The same, for a tool that shapes its own payload rather than passing the envelope's `data`
 * through -- a summary built from two calls, a field picked out, a list counted. The payload is
 * whatever the tool wants to say; `resp` is the envelope that decides whether it worked.
 */
/**
 * Put the flag on a result somebody else built -- `jsonContent()` and `structuredResult()` from
 * mcp/catalog/shape.ts, which shape a payload and know nothing about the envelope it came from.
 *
 * Those two are shared with the NODE's MCP surface, so they are left alone here rather than taught
 * about `ok`: the same flag is missing there too, and that is a second surface with its own blast
 * radius, not a thing to fix by widening a helper's meaning under it.
 */
export function flagged(result: { content: { type: 'text'; text: string }[] }, resp: Pick<ApiResponse, 'ok'>): ToolResult {
  return { ...result, ...(resp.ok === false ? { isError: true as const } : {}) };
}

export function payloadResult(payload: unknown, resp: Pick<ApiResponse, 'ok'>): ToolResult {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    ...(resp.ok === false ? { isError: true as const } : {}),
  };
}
