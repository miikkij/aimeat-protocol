/**
 * @file src/mcp/tool-error.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one shape a NEW MCP tool failure is written in: `CODE: what happened.`
 *
 *   Counted on 2026-09-19: 333 `isError` returns in 78 files under src/mcp/, in three shapes. 157
 *   are a plain sentence, 80 are a JSON object, 48 are `CODE: message`, and the rest come through
 *   seven local helpers. They are NOT being rewritten: E2E suites and at least one client read
 *   those texts as they are, a good model reads all three shapes equally well, and the thing an
 *   agent was actually missing, what to do next, is appended to every one of them in one place
 *   (error-next-step.ts). So this file is for what gets written from now on, and the rule in
 *   .claude/rules/tool-surfaces.md points here.
 *
 *   WHY `CODE: message`. The code is the same word the REST door answers with (NOT_FOUND,
 *   INVALID_INPUT, SCOPE_DENIED), so an agent that meets the failure on either door recognises
 *   it, and a test can assert the code without pinning the sentence. The message says what
 *   happened and, when the tool knows it, what would work instead. It does not name the support
 *   address: the wrapper adds the next step, and a tool that writes its own is told twice.
 * @structure toolError(code, message)
 * @usage return toolError('NOT_FOUND', `No template "${id}". The shells are: ${shells}.`);
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial.
 */

export interface ToolErrorResult {
  content: [{ type: 'text'; text: string }];
  isError: true;
}

/** `code` is an envelope error code in CAPS_WITH_UNDERSCORES; `message` is a plain sentence. */
export function toolError(code: string, message: string): ToolErrorResult {
  return { content: [{ type: 'text', text: `${code}: ${message}` }], isError: true };
}
