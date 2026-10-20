/**
 * @file src/mcp/scope-denied-answer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Answer a call to a tool this session's permissions do not allow with SCOPE_DENIED and
 *   the permission it needs, and note the refusal for the owner, instead of the SDK's "Tool X not
 *   found" (or "disabled" when a permission was removed during the session).
 *
 *   WHY. A tool the agent's permissions filter out is not registered (mcp/index.ts), so it stays out
 *   of tools/list, which is right: a tool that is not offered was not refused. A call by name anyway,
 *   from a skill or a handbook that names the tool, got "Tool X not found", and the agent told its
 *   person the tool does not exist; the owner's agent card showed no refusal to grant (QA audit
 *   E5-04). REST answers the same refusal with SCOPE_DENIED and notes it (auth/deny.ts denyScope403).
 *
 *   Since 2026-10-17 a tool whose missing permissions the agent's person can allow with one press is
 *   registered and listed (mcp/permission-ask-gate.ts), so this answer is also what such a listed
 *   tool says when it is called before the person has allowed it.
 *
 *   HOW. As mcp/moved-tools-answer.ts: the SDK's one tools/call request handler is wrapped after the
 *   tools are registered. A call whose tool needs a permission this request's token does not hold is
 *   answered here; every other call goes to the SDK handler unchanged.
 * @structure answerScopeDeniedTools(mcp, opts)
 * @usage answerScopeDeniedTools(mcp, { missingWords: (name) => [...], principal: () => agentGaii });
 * @version-history
 *   2026-10-20 — The tools/call handler is wrapped through mcp/sdk-seams.ts.
 *   2026-10-17 — The answer tells the AI what it may not do in plain words and hands it the address
 *     where the person allows it with one press (services/permission-ask.ts). The permission word
 *     stays at the end, for the agent's own records, with the instruction not to show it to the
 *     person (wish-puuttuva-lupa-ai-neuvoo-ihmist-yhdell-salli-painikkeella-eik).
 *   2026-10-16 — Initial (QA audit E5-04).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { noteMcpScopeRefusal } from './tool-usage-wrap.js';
import { toolError } from './tool-error.js';
import { permissionAskText } from '../services/permission-ask.js';
import { logger } from '../utils/logger.js';
import { wrapToolsCall } from './sdk-seams.js';

export interface ScopeDeniedOptions {
  /** The permission words tool `name` needs and this request's token lacks; empty when it may be called. */
  missingWords: (name: string) => string[];
  /** The session's principal, for the owner's note. */
  principal: () => string;
  /** The node's public address, for the address the person allows the permission at. */
  baseUrl: string;
}

/**
 * The answer an agent reads: the code REST answers with, what it may not do yet in plain words, and
 * the address it hands the person. The permission word closes the text, for the agent's own
 * records; the person never needs it.
 */
export function scopeDeniedText(name: string, words: string[], opts: { baseUrl: string; agentGaii: string }): string {
  const quoted = words.map((w) => `"${w}"`).join(' and ');
  return toolError('SCOPE_DENIED',
    `${permissionAskText({ baseUrl: opts.baseUrl, agentGaii: opts.agentGaii, tool: name, words })} `
    + `(For your records, not for the person: ${name} needs the permission ${quoted}.)`).content[0].text;
}

export function answerScopeDeniedTools(mcp: McpServer, opts: ScopeDeniedOptions): void {
  // The SDK has no public way to wrap tools/call; mcp/sdk-seams.ts reaches its handler map.
  const wrapped = wrapToolsCall(mcp, (original) => async (request, extra) => {
    const name = typeof request.params?.name === 'string' ? request.params.name : '';
    const words = name ? opts.missingWords(name) : [];
    if (words.length === 0) return original(request, extra);
    // The MCP half of auth/deny.ts: the same note on the agent's card and its open tasks.
    noteMcpScopeRefusal(opts.principal(), words, name);
    const text = scopeDeniedText(name, words, { baseUrl: opts.baseUrl, agentGaii: opts.principal() });
    return { content: [{ type: 'text', text }], isError: true };
  });
  if (!wrapped) logger.warn('scope-denied: the MCP server has no tools/call handler to wrap; a tool without permission answers "not found"');
}
