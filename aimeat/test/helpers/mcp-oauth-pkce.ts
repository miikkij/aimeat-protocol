/**
 * @file test/helpers/mcp-oauth-pkce.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The PKCE (S256) and RFC 8707 resource parameters a suite adds to the MCP OAuth flow
 *   (GET /v1/mcp/authorize, POST /v1/mcp/authorize-consent, POST /v1/mcp/token).
 *
 *   WHY. From MCP_OAUTH_LAX_REMOVED_IN (4.0.0, src/mcp/oauth-binding.ts) an authorization request
 *   without `code_challenge` (S256) or without a `resource` that names the node's MCP endpoint is
 *   refused, and a code issued without PKCE is not redeemed. A suite that signs in over MCP OAuth
 *   sends both, so it keeps working on 4.0.0 and does not count as a 3.x client (`mcp_oauth_legacy`)
 *   on the nodes before it.
 *
 *   `base` is the origin of the node the flow runs against (the suite's BASE, or the second node's
 *   origin), because the resource must name that node's own MCP endpoint.
 * @structure
 *   - mcpResource(base): the resource identifier, `${base}/v1/mcp`
 *   - mcpPkce(base): a fresh verifier, its S256 challenge, and the resource
 *   - authorizeParams(pkce): code_challenge, code_challenge_method=S256, resource
 *   - tokenParams(pkce): code_verifier, resource
 * @usage
 *   const pkce = mcpPkce(BASE);
 *   const params = new URLSearchParams({ response_type: 'code', client_id, gaii, signature, timestamp, ...authorizeParams(pkce) });
 *   const auth = await json(`/v1/mcp/authorize?${params}`);
 *   await json('/v1/mcp/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code: auth.body.code, client_id, client_secret, ...tokenParams(pkce) }) });
 * @version-history
 *   v1.0.0 - 2026-10-12 - Initial: the MCP OAuth E2E suites send PKCE and resource ahead of 4.0.0.
 */
import { createHash, randomBytes } from 'node:crypto';

/** PKCE material for one authorization, plus the resource it is bound to. */
export interface McpPkce {
    verifier: string;
    challenge: string;
    resource: string;
}

/** The resource identifier of a node's MCP endpoint (RFC 8707), as the node itself names it. */
export function mcpResource(base: string): string {
    return `${base.replace(/\/+$/, '')}/v1/mcp`;
}

/** A fresh verifier, its S256 challenge, and the MCP resource of the node at `base`. */
export function mcpPkce(base: string): McpPkce {
    const verifier = randomBytes(32).toString('base64url');
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url'), resource: mcpResource(base) };
}

/** What the authorization request (or the consent submission) adds: spread into its query or body. */
export function authorizeParams(pkce: McpPkce): { code_challenge: string; code_challenge_method: 'S256'; resource: string } {
    return { code_challenge: pkce.challenge, code_challenge_method: 'S256', resource: pkce.resource };
}

/** What the authorization_code token request adds: spread into its body. */
export function tokenParams(pkce: McpPkce): { code_verifier: string; resource: string } {
    return { code_verifier: pkce.verifier, resource: pkce.resource };
}
