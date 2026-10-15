/**
 * @file src/mcp/resource-refusal.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one shape an MCP resource read refuses in: `CODE: what happened. What to do next.`
 *
 *   The tools write a failure as toolError(code, message) and error-next-step.ts appends what to do
 *   next to every failing tool result. A resource read has no `isError` and passes through no such
 *   wrapper, so four resources answered the bare text "Access denied": no code, no reason, and no
 *   step forward (feature-list audit #186). This is toolError's `CODE: message` for a resource, and
 *   the message carries the next step itself.
 * @structure resourceRefusal(uri, code, message)
 * @usage if (!canSeeBoard(board)) return resourceRefusal(uri, 'ACCESS_DENIED', 'This board is not shared with you. …');
 * @version-history
 *   2026-10-15 — Initial (feature-list audit #186).
 */

export interface ResourceRefusal {
  contents: [{ uri: string; text: string }];
}

/** `code` is the envelope error code the REST route answers; `message` says what happened and what to do next. */
export function resourceRefusal(uri: URL | string, code: string, message: string): ResourceRefusal {
  return { contents: [{ uri: uri.toString(), text: `${code}: ${message}` }] };
}
