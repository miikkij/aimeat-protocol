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
 * @structure listOwnConnections · requireOwnConnection · toPublicConnection · toPublicClient
 * @usage const conn = await requireOwnConnection(storage, principal, id);
 * @version-history
 *   v1.1.0 — 2026-09-05 — toPublicClient moved here from routes/connections.ts by pure extraction,
 *     because the Access page's composite read shows the same rows and must not shape them twice.
 *   v1.0.0 — 2026-08-26 — Extracted from routes/connections.ts when the MCP surface was added, so
 *     the second door could not carry a second copy of the ownership check.
 */
import type { Storage } from '../../storage/interface.js';
import type { ConnectionRecord, PublicConnection, ProviderClientRecord, PublicProviderClient } from '../../models/connection-schemas.js';

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
