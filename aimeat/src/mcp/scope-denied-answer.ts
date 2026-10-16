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
 *   HOW. As mcp/moved-tools-answer.ts: the SDK's one tools/call request handler is wrapped after the
 *   tools are registered. A call whose tool needs a permission this request's token does not hold is
 *   answered here; every other call goes to the SDK handler unchanged.
 * @structure answerScopeDeniedTools(mcp, opts)
 * @usage answerScopeDeniedTools(mcp, { missingWords: (name) => [...], principal: () => agentGaii });
 * @version-history
 *   2026-10-16 — Initial (QA audit E5-04).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { noteMcpScopeRefusal } from './tool-usage-wrap.js';
import { toolError } from './tool-error.js';
import { logger } from '../utils/logger.js';

type RequestHandler = (request: { method: string; params?: { name?: unknown } }, extra: unknown) => Promise<unknown>;

export interface ScopeDeniedOptions {
  /** The permission words tool `name` needs and this request's token lacks; empty when it may be called. */
  missingWords: (name: string) => string[];
  /** The session's principal, for the owner's note. */
  principal: () => string;
}

/** The answer an agent reads: the code REST answers with, the word, and what the person can do. */
export function scopeDeniedText(name: string, words: string[]): string {
  const quoted = words.map((w) => `"${w}"`).join(' and ');
  return toolError('SCOPE_DENIED',
    `${name} needs the permission ${quoted}, which this agent has not been given. `
    + 'The owner can grant it in the agent\'s settings; then connect again so the tool is offered.').content[0].text;
}

export function answerScopeDeniedTools(mcp: McpServer, opts: ScopeDeniedOptions): void {
  // The SDK keeps its handlers in a map on the protocol object (mcp/moved-tools-answer.ts reads it the same way).
  const handlers = (mcp.server as unknown as { _requestHandlers?: Map<string, RequestHandler> })._requestHandlers;
  const original = handlers?.get('tools/call');
  if (!handlers || !original) {
    logger.warn('scope-denied: the MCP server has no tools/call handler to wrap; a tool without permission answers "not found"');
    return;
  }
  handlers.set('tools/call', async (request, extra) => {
    const name = typeof request.params?.name === 'string' ? request.params.name : '';
    const words = name ? opts.missingWords(name) : [];
    if (words.length === 0) return original(request, extra);
    // The MCP half of auth/deny.ts: the same note on the agent's card and its open tasks.
    noteMcpScopeRefusal(opts.principal(), words, name);
    return { content: [{ type: 'text', text: scopeDeniedText(name, words) }], isError: true };
  });
}
