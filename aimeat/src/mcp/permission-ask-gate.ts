/**
 * @file src/mcp/permission-ask-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two decisions that let an agent's person allow a missing permission and have it work
 *   in the same conversation.
 *
 *   OFFERED BEFORE IT IS ALLOWED. Until 2026-10-17 a tool whose permission the agent lacked was left
 *   out of the session (mcp/index.ts gate), on the rule that a tool not offered was not refused. A
 *   person's ChatGPT therefore had no aimeat_dm_send at all and told her the node had no way to send
 *   a message. askableTool() says which such tools stay on the list: an agent session, and every word
 *   the tool is missing one that the person may give with one press (services/permission-ask.ts). A
 *   call to one answers SCOPE_DENIED with the address (mcp/scope-denied-answer.ts), and the refusal
 *   itself is unchanged: scope-denied-answer.ts sits in front of the tool's handler. A tool missing an
 *   operator's word, a word outside every wildcard or a powerful one stays off the list as before.
 *
 *   A TOKEN OLDER THAN THE PERMISSION. An MCP OAuth access token carries the agent's permissions as
 *   they were when it was issued (mcp/oauth.ts), and the effective permissions are that list
 *   intersected with the agent's record (auth/effective-scopes.ts), which can only remove. So a
 *   permission the person allowed a minute ago was refused until the token expired, up to an hour.
 *   staleGrantRefusal() answers such a token 401 invalid_token at the MCP endpoint; the client
 *   refreshes it (RFC 6750 §3.1, the MCP authorization specification) and the refresh grant mints
 *   from the record, so the new token carries the permission and the next call works. Only for a
 *   token this node issued through MCP OAuth, which is a copy of the record at issue time and always
 *   has a refresh token beside it: a device-flow token or a personal access token may be narrower
 *   than the record on purpose, and it has no refresh to fall back on. The refresh copies the record,
 *   so the new token is never stale and the 401 cannot repeat.
 * @structure askableTool(scopes, name) · staleGrantRefusal(verified, storage, config)
 * @usage
 *   const listed = (name) => permitted(name) || (mayAsk && askableTool(scopes, name));
 *   const stale = await staleGrantRefusal(verified, storage, config); // string → answer 401
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial (wish-puuttuva-lupa-ai-neuvoo-ihmist-yhdell-salli-painikkeella-eik).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { VerifiedToken } from '../auth/jwt.js';
import { enforcedScopesForTool } from '../tool-catalog/scopes.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { oneClickWords, scopesBehindRecord } from '../services/permission-ask.js';
import { namesMcpResource } from './oauth-binding.js';
import { logger } from '../utils/logger.js';
import { isOwnerInPerson, parseGaiiLoose } from '../utils/gaii.js';

/** The tool is not allowed, and everything it is missing the person can allow with one press. */
export function askableTool(scopes: readonly string[], name: string): boolean {
  const missing = enforcedScopesForTool(name).filter((w) => !scopeIsCovered(scopes, w));
  return oneClickWords(missing);
}

/** An access token this node issued through MCP OAuth: it names the MCP endpoint as its audience. */
function isMcpOAuthToken(v: VerifiedToken, config: AimeatConfig): boolean {
  return !!v.mcp_client || (typeof v.aud === 'string' && namesMcpResource(config, v.aud));
}

/**
 * The 401 message when an MCP OAuth agent token lacks a permission its agent now holds, else null.
 * Never fails a request: an unreadable record answers null and the token works as it did.
 */
export async function staleGrantRefusal(v: VerifiedToken, storage: Storage, config: AimeatConfig): Promise<string | null> {
  // An agent's token names the agent (`name#owner@node`); an owner, an app and a visitor do not.
  if (v.anonymous || isOwnerInPerson(v) || v.sub.startsWith('eco:') || !parseGaiiLoose(v.sub).agent || !isMcpOAuthToken(v, config)) return null;
  const behind = await scopesBehindRecord(storage, v.sub, v.scopes);
  if (behind.length === 0) return null;
  logger.info('permission-ask-gate: an MCP OAuth token predates a permission its agent now holds; asking the client to refresh', {
    sub: v.sub, missing: behind.join(','),
  });
  return 'The person has allowed this agent more since this access token was issued. Refresh the token at /v1/mcp/token and repeat the request.';
}
