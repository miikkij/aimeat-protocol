/**
 * @file src/services/oauth-consent-info.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the MCP OAuth consent page shows about the app that asks, from data this server
 *   checked rather than from the page's own address (GET /v1/mcp/consent-info, mcp/oauth-consent-info.ts).
 *
 *   WHY (secaudit2026oct22, mcp-oauth:consent-identity-from-request-not-verified-client, the page
 *   part; developer decision 2026-10-25). The consent page read the app's name and redirect from its
 *   query string, so a link could open it under any name, the page never said where the code goes,
 *   and Deny navigated to whatever redirect the query named. This answers, for a client_id and the
 *   redirect the request names:
 *   - `client_name`: the name the client registered (dynamic registration, which the client chose
 *     itself: `self_declared: true`) or the name its Client ID Metadata Document gives;
 *   - `client_id_host`: for a metadata-document client, the host of its client_id URL, which is the
 *     place that identifies it;
 *   - `redirect_ok` and `redirect_host`: whether the redirect is one the client registered, and its
 *     host. The page shows the host and sends a Deny only to a redirect this checked.
 * @structure OAuthConsentInfo · oauthConsentInfo(storage, clientId, redirectUri)
 * @usage const info = await oauthConsentInfo(storage, clientId, redirectUri, redirectUriRegistered); if (!info) 404
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22).
 */
import type { Storage } from '../storage/interface.js';
import { resolveClientIdMetadata } from './oauth-client-metadata.js';

/** The OAuth routes' own redirect test (mcp/oauth-redirect.ts redirectUriRegistered), handed in: a service does not import mcp/. */
export type RedirectMatcher = (registered: readonly string[], requested: string) => boolean;

export interface OAuthConsentInfo {
  client_id: string;
  client_name: string;
  self_declared: boolean;
  client_id_host?: string | null;
  redirect_ok: boolean;
  redirect_uri?: string;
  redirect_host?: string | null;
}

const hostOf = (url: string): string | null => (URL.canParse(url) ? new URL(url).host || null : null);

/** The checked facts, or null when this server knows no such client. */
export async function oauthConsentInfo(
  storage: Pick<Storage, 'getOAuthClient'>, clientId: string, asked: string, redirectUriRegistered: RedirectMatcher,
): Promise<OAuthConsentInfo | null> {
  const client = await storage.getOAuthClient(clientId);
  const viaUrl = client ? null : await resolveClientIdMetadata(clientId);
  if (!client && !viaUrl) return null;
  const registered = client ? client.redirectUris : viaUrl!.redirectUris;
  // The authorize step uses the first registered redirect when the request names none.
  const redirect = asked || registered[0] || '';
  const redirectOk = !!redirect && redirectUriRegistered(registered, redirect) && hostOf(redirect) !== null;
  return {
    client_id: clientId,
    client_name: client ? client.clientName : viaUrl!.clientName,
    self_declared: !!client,
    ...(viaUrl ? { client_id_host: hostOf(clientId) } : {}),
    redirect_ok: redirectOk,
    ...(redirectOk ? { redirect_uri: redirect, redirect_host: hostOf(redirect) } : {}),
  };
}
