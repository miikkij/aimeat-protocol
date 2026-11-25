/**
 * @file src/mcp/oauth-client-auth.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How a client registered at POST /v1/mcp/register authenticates at POST /v1/mcp/token:
 *   with the secret it was issued (client_secret_post), or with none at all when it registered as a
 *   public client (token_endpoint_auth_method "none", RFC 7591 §2; OAuth 2.1 §2.1).
 *
 *   WHY A PUBLIC CLIENT. Until 2026-11-25 registration ignored the method a client asked for and
 *   issued every client a secret it then owed on both grants. A native MCP client is a public client:
 *   Codex's (rmcp) registers with "none" and keeps only its client_id and its tokens across restarts,
 *   so the first refresh after a restart carried no secret and was refused `invalid_client: Invalid
 *   client credentials`, and the person saw a connection that was enabled and would not start. A
 *   Client ID Metadata Document client already signs in with no secret; PKCE (required from 4.0.0,
 *   mcp/oauth-binding.ts) binds the code to the client that asked for it, and a refresh token is
 *   bound to its client_id and rotates on every use.
 *
 *   WHAT STAYS. A client that asks for client_secret_post, for nothing, or for a method this node
 *   does not offer is registered confidential as before, and owes its secret on both grants
 *   (8c820a51c). A public client's row stores the empty string as its secret hash: no token hashes
 *   to it, and the column stays NOT NULL on both backends.
 * @structure
 *   - PUBLIC_CLIENT_SECRET_HASH — what a public client's row holds as its secret
 *   - registeredAuthMethod(requested) — the method a registration gets
 *   - clientAuthFails(client, clientSecret) — whether a token request fails client authentication
 * @usage
 *   const method = registeredAuthMethod(req.body?.token_endpoint_auth_method);
 *   if (clientAuthFails(client, client_secret)) refuse401();
 * @version-history
 *   v1.0.0 — 2026-11-25 — Initial: public clients (wish-agentti-saa-nykyiset-aimeat-ohjeet-ja-tekee-sovitun-ty-n-lop, item 3).
 */
import { createHash } from 'node:crypto';
import type { OAuthClientRecord } from '../storage/interface.js';

/** The methods POST /v1/mcp/token accepts, as the authorization server metadata lists them. */
export const TOKEN_ENDPOINT_AUTH_METHODS = ['client_secret_post', 'none'] as const;
export type TokenEndpointAuthMethod = typeof TOKEN_ENDPOINT_AUTH_METHODS[number];

/** A public client's stored secret: no SHA-256 hex digest is the empty string. */
export const PUBLIC_CLIENT_SECRET_HASH = '';

/** The method a registration gets: "none" when asked for, client_secret_post otherwise (RFC 7591 §2 lets the server choose). */
export function registeredAuthMethod(requested: unknown): TokenEndpointAuthMethod {
    return requested === 'none' ? 'none' : 'client_secret_post';
}

/**
 * True when a token request fails client authentication. A client with no row (a Client ID
 * Metadata Document client) and a public client have no secret to check; a confidential client
 * owes the secret it was issued, and omitting it fails (8c820a51c).
 */
export function clientAuthFails(client: Pick<OAuthClientRecord, 'clientSecret'> | null, clientSecret: unknown): boolean {
    if (!client || client.clientSecret === PUBLIC_CLIENT_SECRET_HASH) return false;
    if (typeof clientSecret !== 'string' || !clientSecret) return true;
    return client.clientSecret !== createHash('sha256').update(clientSecret).digest('hex');
}
