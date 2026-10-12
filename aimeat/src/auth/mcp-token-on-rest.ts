/**
 * @file src/auth/mcp-token-on-rest.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether a REST route takes a token that was issued for this node's MCP endpoint.
 *
 *   RFC 8707 asks a resource server to refuse a token whose audience is another resource. Every
 *   access token the MCP OAuth flow issues names the MCP endpoint (`aud = <base>/v1/mcp`,
 *   mcp/oauth-binding.ts), and the MCP endpoint refuses a token for another resource. This is the
 *   other half: the REST routes refuse a token bound to the MCP endpoint, from
 *   MCP_TOKEN_ON_REST_REMOVED_IN (4.0.0). Before that release the token is accepted, the response
 *   carries the Deprecation headers, and the use is counted under `deprecated_use_by_type`
 *   (`mcp_token_on_rest`, GET /v1/stats) through services/deprecation.ts.
 *
 *   WHAT IS NOT JUDGED HERE.
 *   - The MCP surface itself: `/v1/mcp`, `/mcp`, `/v2/mcp/<role>` and the MCP OAuth routes under
 *     `/v1/mcp/` take the token in every release.
 *   - The node's own loopback request for an MCP tool (auth/loopback-pass.ts): `aimeat_invoke`,
 *     `aimeat_capabilities_invoke` and `aimeat_app_tool_invoke` send the session's bearer to the REST
 *     routes with a pass this process minted for that bearer, and that request is accepted, not
 *     counted, in every release.
 *   - A token without an audience. The node's chat and the commerce fulfilment mint MCP-flavoured
 *     tokens (`mcp_client`) without one for REST use, so `mcp_client` alone does not bind a token.
 * @structure MCP_TOKEN_ON_REST_REMOVED_IN · isMcpSurfacePath · isMcpBoundToken · mcpTokenOnRestVerdict ·
 *   MCP_TOKEN_ON_REST_MESSAGE
 * @usage
 *   const verdict = mcpTokenOnRestVerdict(req, token, verified, config);
 *   if (verdict === 'refuse') { denyInvalidToken(req, res, MCP_TOKEN_ON_REST_MESSAGE); return; }
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial (wish-mcp-tokeni-ei-kelpaa-rest-reiteill-4-0-0-sta-ensin-kolme-mcp,
 *     ruling decision-4-0-0-siivouksen-23-avointa-p-t-st-suositusten-mukaan item 8, Core 2026-11 MCP-07).
 */
import type { Request } from 'express';
import type { AimeatConfig } from '../config.js';
import type { VerifiedToken } from './jwt.js';
import { namesMcpResource, mcpResourceOf } from '../mcp/oauth-binding.js';
import { removedFrom, noteDeprecatedUse } from '../services/deprecation.js';
import { LOOPBACK_PASS_HEADER, loopbackPassCovers } from './loopback-pass.js';

/** The release from which a REST route refuses a token bound to the MCP endpoint. */
export const MCP_TOKEN_ON_REST_REMOVED_IN = '4.0.0';

/** What a refused client reads, in the error and in the WWW-Authenticate challenge. */
export const MCP_TOKEN_ON_REST_MESSAGE =
  'This token was issued for the MCP endpoint and is not accepted on REST routes. '
  + 'Call the node through MCP, or use an agent token from device authorization or a personal access token.';

/**
 * The paths that are the MCP surface: the Streamable HTTP endpoints and the MCP OAuth routes. An
 * MCP-bound token is the credential these were built for.
 */
export function isMcpSurfacePath(path: string): boolean {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  if (p === '/v1/mcp' || p === '/mcp' || p.startsWith('/v1/mcp/')) return true;
  return /^\/v2\/mcp\/[a-z]+$/.test(p);
}

/** True when the token names this node's MCP endpoint as its audience. */
export function isMcpBoundToken(verified: VerifiedToken, config: AimeatConfig): boolean {
  if (verified.aud === undefined) return false;
  const list = Array.isArray(verified.aud) ? verified.aud : [verified.aud];
  return list.some(a => typeof a === 'string' && namesMcpResource(config, a));
}

/**
 * What the REST layer does with this verified token on this request:
 *   - `accept`: not an MCP-bound token, the MCP surface, or the node's own loopback call;
 *   - `deprecated`: an MCP-bound token on a REST route before 4.0.0, accepted, with the
 *     Deprecation headers set and the use counted;
 *   - `refuse`: the same from 4.0.0. The caller answers 401 with `error="invalid_token"`.
 * `config` absent (a router mounted on its own in a unit test, before initSessionAuth) accepts.
 */
export function mcpTokenOnRestVerdict(
  req: Request, token: string, verified: VerifiedToken, config: AimeatConfig | null | undefined, version?: string,
): 'accept' | 'deprecated' | 'refuse' {
  if (!config || !isMcpBoundToken(verified, config)) return 'accept';
  if (isMcpSurfacePath(req.path)) return 'accept';
  if (loopbackPassCovers(req.header(LOOPBACK_PASS_HEADER), token, req.socket?.remoteAddress)) return 'accept';
  if (removedFrom(MCP_TOKEN_ON_REST_REMOVED_IN, version)) return 'refuse';
  noteDeprecatedUse({
    kind: 'mcp_token_on_rest',
    removedIn: MCP_TOKEN_ON_REST_REMOVED_IN,
    successor: '/v1/agents/device-authorize',
    notice: `A REST route accepted an access token issued for ${mcpResourceOf(config)} (RFC 8707: a token is for the resource it names).`,
  }, { path: req.path, sub: verified.sub });
  return 'deprecated';
}
