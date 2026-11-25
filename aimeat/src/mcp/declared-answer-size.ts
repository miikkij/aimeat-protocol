/**
 * @file src/mcp/declared-answer-size.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every tool's entry in tools/list declares how large a text answer the client may pass
 *   to the model: `_meta["anthropic/maxResultSizeChars"]`.
 *
 *   WHY. Claude Code saves a text result over 50 000 characters to a file and gives the model the
 *   path, and refuses one over 25 000 tokens. A tool that declares this key gets its own threshold,
 *   up to 500 000 characters, whatever the token count (Claude Code's MCP documentation, "Raise the
 *   limit for a specific tool", read 2026-11-25). Without the declaration the operator's limit
 *   (mcp.tool_answer_chars, models/answer-budget.ts) could be 250 000 and an answer of 60 000 would
 *   still reach the model as a file path. A client that does not know the key ignores it.
 *
 *   NOT ON THE CHAT SURFACE. The node's own chat sends its listed tools with every model call and
 *   holds that list under a size (mcp/chat-tool-text.ts); the declaration is 52 characters a tool and
 *   the node chat does not read it, so mcp/index.ts leaves it out there.
 *
 *   The value is read when the tool registers: a session that is open keeps the value it started
 *   with, and one opened after the setting changed declares the new value.
 * @structure RESULT_SIZE_META_KEY · withDeclaredAnswerSize(register, chars)
 * @usage const register = withDeclaredAnswerSize(originalRegisterTool, () => declaredResultChars(config));
 * @version-history
 *   2026-11-25 — Initial.
 */

type AnyFn = (...args: unknown[]) => unknown;

/** The key Claude Code reads in a tool's `_meta`. */
export const RESULT_SIZE_META_KEY = 'anthropic/maxResultSizeChars';

/**
 * `registerTool` whose config carries the declared size in `_meta`. A `_meta` the tool set itself is
 * kept, its own value for this key included; a call that is not the (name, config, handler) form
 * passes as it came.
 */
export function withDeclaredAnswerSize(register: AnyFn, chars: () => number): AnyFn {
  return (...args: unknown[]) => {
    const config = args[1];
    if (!config || typeof config !== 'object' || Array.isArray(config) || typeof args[2] !== 'function') return register(...args);
    const meta = (config as { _meta?: Record<string, unknown> })._meta;
    return register(args[0], { ...config, _meta: { [RESULT_SIZE_META_KEY]: chars(), ...(meta ?? {}) } }, ...args.slice(2));
  };
}
