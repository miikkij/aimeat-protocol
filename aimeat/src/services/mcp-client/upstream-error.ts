/**
 * @file upstream-error.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one form in which an error from a remote MCP server, or from its OAuth endpoints,
 *   is written to a log line or to the server's stored `lastError`.
 *
 *   WHY (secrets audit 2026-10-09, chapter 2). The SDK's error text carries two things this node
 *   keeps away from logs: the endpoint, whose query string some services use for their key, and the
 *   upstream's response body, which can echo the request's own headers back, the Bearer among them.
 *   Both went to the log verbatim (invoke.ts, oauth.ts). What stays is what an operator acts on: the
 *   HTTP status, the error's shape, and which host it was.
 * @structure describeUpstreamError
 * @usage logger.warn('mcp-client: …', { server: server.slug, error: describeUpstreamError(err) });
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, chapter 2).
 */

/** Longest text kept. An operator needs the first sentence; an upstream's page is not that. */
const MAX_CHARS = 240;

/**
 * The error as text with every URL cut to its scheme and host, the response body after an HTTP
 * status dropped, any bearer or basic credential masked, and the whole capped.
 */
export function describeUpstreamError(err: unknown): string {
  let text = err instanceof Error ? err.message : String(err);
  // A URL keeps its scheme and host only: the path and the query are where a key travels.
  text = text.replace(/\b([a-z][a-z0-9+.-]*):\/\/([^\s/'"<>?#@]*@)?([^\s/'"<>?#]+)[^\s'"<>]*/gi,
    (_m, scheme: string, _userinfo: string | undefined, host: string) => `${scheme}://${host}/…`);
  // "… (HTTP 401): <body>" is the SDK's shape for a refused request. The body is the upstream's,
  // and it may repeat what we sent, so it goes.
  text = text.replace(/(\(?HTTP \d{3}\)?)\s*:[\s\S]*$/i, '$1');
  // Anything still shaped like a credential.
  text = text.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]');
  text = text.replace(/\b(access_token|refresh_token|client_secret|api[_-]?key|token)(["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi, '$1$2[redacted]');
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}…` : text;
}
