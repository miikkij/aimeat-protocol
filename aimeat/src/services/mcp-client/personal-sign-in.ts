/**
 * @file personal-sign-in.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A person's own sign-in on a shared MCP server: a node-wide or group server whose auth
 *   is per-user-oauth, so that each person the server admits reaches the far side with their OWN
 *   account there, and the far side's own permissions and audit apply to them.
 *
 *   WHY THIS MODE EXISTS. Under `oauth` a shared server holds one credential and everyone it admits
 *   spends it, so Jira or a company wiki sees every call as the one person who signed in for the
 *   group: their rights, their name in the audit trail. That is right for a service account and
 *   wrong for a team that each have their own account at the far side.
 *
 *   WHAT LIVES WHERE. The round itself is oauth.ts (startMcpOAuth with `personal`); the credential
 *   is a row in mcp_user_credentials, sealed like the server's own; the call spends it in invoke.ts
 *   (resolvePersonalCredential). This file holds the two things the doors need besides: which
 *   servers the caller has signed in to, and signing out.
 * @structure withPersonalSignIn · signOutPersonal
 * @usage const servers = await withPersonalSignIn(storage, ownerGhii, publicServers);
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial (wish-henkil-kohtainen-kirjautuminen-jaettuun-mcp-palvelimeen).
 */
import type { Storage } from '../../storage/interface.js';
import type { McpServerRecord, PublicMcpServer } from '../../models/mcp-server-schemas.js';
import { takesPersonalSignIn } from '../../models/mcp-server-schemas.js';
import { mcpClientPool } from './pool.js';
import { emitChange } from '../event-bus.js';

/**
 * Say, on each server that takes personal sign-ins, whether THIS person has signed in and whether
 * the sign-in still works. One read of the person's own rows, whatever the length of the list.
 */
export async function withPersonalSignIn(
  storage: Storage, ownerGhii: string, servers: PublicMcpServer[],
): Promise<PublicMcpServer[]> {
  if (!servers.some((s) => s.personalSignIn)) return servers;
  const mine = new Map((await storage.listMcpUserCredentials(ownerGhii)).map((r) => [r.serverId, r.status]));
  return servers.map((s) => (s.personalSignIn
    ? { ...s, personalSignIn: { signedIn: mine.has(s.id), status: mine.get(s.id) ?? null } }
    : s));
}

/**
 * Sign one person out of one shared server: their credential goes, their pooled client goes, and
 * nobody else is touched. False when the server takes no personal sign-in or there was none.
 *
 * A token the person granted at the far side is still theirs to revoke there; the node only forgets
 * its copy, the same as detaching a server of one's own.
 */
export async function signOutPersonal(
  storage: Storage, server: McpServerRecord, ownerGhii: string,
): Promise<boolean> {
  if (!takesPersonalSignIn(server)) return false;
  await mcpClientPool.invalidate(server.id, ownerGhii);
  const removed = await storage.deleteMcpUserCredential(server.id, ownerGhii);
  if (removed) emitChange('mcp-servers', ownerGhii);
  return removed;
}
