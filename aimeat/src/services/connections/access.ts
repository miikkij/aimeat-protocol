/**
 * @file src/services/connections/access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may see and use a connection, and what leaves the node when they do.
 *
 *   TWO SENTENCES, ONE PLACE. "List the caller's own connections" and "this connection is the
 *   caller's" are the whole authorization model of this subsystem, and they were written inline in
 *   the REST route. Adding an MCP door would have written them a second time, which is the drift the
 *   August 2026 audit measured 315 instances of — including agents deleting another owner's
 *   extension. So they live here, and both doors call them.
 *
 *   ABSENT AND NOT-YOURS ANSWER ALIKE. `requireOwnConnection` returns null for both, deliberately:
 *   naming another principal's connection id must not confirm that it exists.
 *
 *   THE PROJECTION IS THE GATE, NOT THE SCOPE. `toPublicConnection` is the only shape that ever
 *   leaves: provider, account label and status — enough for an app to name a connection and tell a
 *   person which account it is — while the credential and the provider's own scope vocabulary never
 *   appear in it.
 * @structure listOwnConnections · requireOwnConnection · CONNECTIONS_READ_AS_OWNER_SCOPE ·
 *   connectionHoldersOf · listUsableConnections · requireUsableConnection · listAgentsConnections ·
 *   requireAgentsConnection · toPublicConnection · toPublicClient
 * @usage const conn = await requireOwnConnection(storage, principal, id);
 * @version-history
 *   2026-10-15 — connectionHoldersOf / listUsableConnections / requireUsableConnection: an agent names
 *     its owner's connections on connections:use and reads them on the new connections:read-as-owner
 *     (feature-list audit 128-130).
 *   v1.2.0 — 2026-10-09 — listAgentsConnections and requireAgentsConnection: the owner in person sees
 *     and revokes the accounts their agents connected (secrets audit 2026-10-09, F2).
 *   v1.1.0 — 2026-09-05 — toPublicClient moved here from routes/connections.ts by pure extraction,
 *     because the Access page's composite read shows the same rows and must not shape them twice.
 *   v1.0.0 — 2026-08-26 — Extracted from routes/connections.ts when the MCP surface was added, so
 *     the second door could not carry a second copy of the ownership check.
 */
import type { Storage } from '../../storage/interface.js';
import type { ConnectionRecord, PublicConnection, ProviderClientRecord, PublicProviderClient } from '../../models/connection-schemas.js';
import { scopeIsCovered } from '../../utils/scope-coverage.js';

/** Everything a caller may know about a connection, and nothing more. */
export function toPublicConnection(c: ConnectionRecord): PublicConnection {
  return { id: c.id, provider: c.provider, mode: c.mode, accountLabel: c.accountLabel, status: c.status };
}

/** A principal's own app registration at a provider: never the secret, and never another principal's row. */
export function toPublicClient(row: ProviderClientRecord, connectionCount: number): PublicProviderClient {
  return {
    provider: row.provider,
    clientId: row.clientId,
    // Not a secret, and visible on purpose: the tenant decides whether the sign-in reaches the
    // right directory at all, so whoever set it must be able to read back what they set.
    tenant: row.tenant ?? null,
    registeredAt: row.registeredAt,
    connectionCount,
  };
}

/** The caller's own connections. Scoped by the query, so there is nothing to filter afterwards. */
export async function listOwnConnections(
  storage: Storage, principal: string,
): Promise<PublicConnection[]> {
  const rows = await storage.listConnections({ principal });
  return rows.map(toPublicConnection);
}

/** An account one of the owner's agents connected, as the owner sees it: the public shape plus whose. */
export interface PublicAgentConnection extends PublicConnection {
  /** The agent's name, as the owner knows it. */
  agent: string;
  /** The agent's identity, which the connection is stored under. */
  principal: string;
}

/**
 * The accounts the owner's agents connected, each under its own GAII. Only the owner in person asks
 * this (routes/connections-agents.ts): an agent's mailbox is its own to every other caller, and its
 * owner is the one person who must be able to see it and take it away (secrets audit 2026-10-09, F2).
 */
export async function listAgentsConnections(
  storage: Storage, ownerName: string,
): Promise<PublicAgentConnection[]> {
  const out: PublicAgentConnection[] = [];
  for (const agent of await storage.getAgentsByOwner(ownerName)) {
    for (const c of await storage.listConnections({ principal: agent.gaii })) {
      out.push({ ...toPublicConnection(c), agent: agent.name, principal: agent.gaii });
    }
  }
  return out;
}

/**
 * The connection, if one of this owner's agents holds it. Null when it is not, when it is the
 * owner's own, and when there is none, alike: the owner revokes their own on the ordinary route.
 */
export async function requireAgentsConnection(
  storage: Storage, ownerName: string, connectionId: string,
): Promise<ConnectionRecord | null> {
  const conn = await storage.getConnection(connectionId);
  if (!conn) return null;
  const agents = await storage.getAgentsByOwner(ownerName);
  return agents.some(a => a.gaii === conn.principal) ? conn : null;
}

/**
 * Read what is in the OWNER's connected accounts, as the owner: an agent's delegation of its own,
 * outside every wildcard (utils/scope-coverage.ts OWN_TICK_SCOPES), beside messages:read-as-owner.
 * On an agent a connection is its own, so the Email page and the tool descriptions promised the
 * owner's AI their mailboxes while every MCP tool read only the agent's own (feature-list audit 128).
 */
export const CONNECTIONS_READ_AS_OWNER_SCOPE = 'connections:read-as-owner';

/**
 * Whose connections this caller may use. Its own always. An agent's owner's too: for naming and
 * sending when the agent holds connections:use (POST /v1/outbound/send already sends through the
 * owner's mailbox on that word), and for reading when it holds connections:read-as-owner. An app
 * grant and the owner in person resolve to the owner already, so they get the one holder.
 */
export function connectionHoldersOf(
  principal: string, ownerGhii: string, scopes: readonly string[] | undefined, purpose: 'name' | 'read',
): string[] {
  if (principal === ownerGhii) return [principal];
  const granted = scopes ?? [];
  const reachesOwner = scopeIsCovered(granted, CONNECTIONS_READ_AS_OWNER_SCOPE)
    || (purpose === 'name' && scopeIsCovered(granted, 'connections:use'));
  return reachesOwner ? [principal, ownerGhii] : [principal];
}

/** The connections of every holder, each marked when it is the owner's rather than the caller's. */
export async function listUsableConnections(
  storage: Storage, holders: readonly string[],
): Promise<Array<PublicConnection & { holder: 'own' | 'owner' }>> {
  const out: Array<PublicConnection & { holder: 'own' | 'owner' }> = [];
  for (const [i, principal] of holders.entries()) {
    for (const c of await storage.listConnections({ principal })) {
      out.push({ ...toPublicConnection(c), holder: i === 0 ? 'own' : 'owner' });
    }
  }
  return out;
}

/**
 * Whose mailbox a send names: the caller's own when the connection is the caller's, the owner's
 * otherwise. The book a send reads is the owner's (POST /v1/outbound/send, aimeat_mail_send); an agent
 * that connected a mailbox of its own still sends through it.
 */
export async function mailboxHolderFor(
  storage: Storage, principal: string, ownerGhii: string, connectionId: string,
): Promise<string> {
  return (await requireOwnConnection(storage, principal, connectionId)) ? principal : ownerGhii;
}

/** The connection, if one of the holders has it. Null otherwise, for an absent one alike. */
export async function requireUsableConnection(
  storage: Storage, holders: readonly string[], connectionId: string,
): Promise<ConnectionRecord | null> {
  const conn = await storage.getConnection(connectionId);
  if (!conn || !holders.includes(conn.principal)) return null;
  return conn;
}

/**
 * The connection, if it is this caller's. Null when it is not, and null when there is none — the
 * same answer for both, so a refusal cannot be used to discover what another principal has.
 */
export async function requireOwnConnection(
  storage: Storage, principal: string, connectionId: string,
): Promise<ConnectionRecord | null> {
  const conn = await storage.getConnection(connectionId);
  if (!conn || conn.principal !== principal) return null;
  return conn;
}
