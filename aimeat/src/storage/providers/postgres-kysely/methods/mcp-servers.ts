/**
 * @file src/storage/providers/postgres-kysely/methods/mcp-servers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Postgres+Kysely implementation of the remote MCP server store.
 *
 *   claimMcpRefresh() is the one method here that is a concurrency primitive rather than CRUD. It
 *   is a CONDITIONAL UPDATE, not read-then-write: Postgres serialises the row update, so exactly
 *   one concurrent caller sees a rowcount of 1 and the rest see 0. Doing it in application code
 *   would leave open the very window it exists to close, and several MCP servers invalidate the old
 *   refresh token as they issue a new one — so the loser of that race ends up holding a dead token
 *   and parks a perfectly healthy server in needs_reauth.
 * @structure mcpServerMethods — attach · read · patch · credential · tool cache · refresh claim
 * @usage merged onto PostgresKyselyStorage.prototype in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-09-16 — Phase 1 of the MCP proxy. Schema: migrations/0076_mcp_servers.sql.
 */
import { sql } from 'kysely';
import type { Selectable } from 'kysely';
import type { McpServerQuery, McpServerPatch } from '../../../repositories/mcp-server.repository.js';
import type {
  McpServerRecord, McpServerStatus, McpOwnership, McpTransport,
  McpAuthMode, McpCallerIdentity, McpExposure, RemoteToolSnapshot,
} from '../../../../models/mcp-server-schemas.js';
import type { McpServer as McpServerRow, Json } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

function toMcpServer(r: Selectable<McpServerRow>): McpServerRecord {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description ?? '',
    ownership: r.ownership as McpOwnership,
    ownerGhii: r.ownerGhii ?? null,
    organismId: r.organismId ?? null,
    ws: r.ws ?? null,
    createdBy: r.createdBy,
    transport: r.transport as unknown as McpTransport,
    auth: r.auth as McpAuthMode,
    credential: r.credential ?? null,
    credentialShape: (r.credentialShape as 'oauth2' | 'static' | null) ?? null,
    expiresAt: r.expiresAt ?? null,
    providerClientId: r.providerClientId ?? null,
    callerIdentity: r.callerIdentity as McpCallerIdentity,
    exposure: r.exposure as McpExposure,
    toolCache: (r.toolCache as unknown as RemoteToolSnapshot[] | null) ?? [],
    toolCacheHash: r.toolCacheHash ?? '',
    lastListedAt: r.lastListedAt ?? null,
    directory: (r.directory as unknown as McpServerRecord['directory'] | null)
      ?? { listed: false, visibility: 'private', tags: [] },
    enabled: r.enabled,
    status: r.status as McpServerStatus,
    lastOkAt: r.lastOkAt ?? null,
    lastError: r.lastError ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export const mcpServerMethods = {
  async createMcpServer(this: PostgresKyselyStorage, row: McpServerRecord): Promise<void> {
    await this.db.insertInto('McpServer').values({
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      ownership: row.ownership,
      ownerGhii: row.ownerGhii,
      organismId: row.organismId,
      ws: row.ws,
      createdBy: row.createdBy,
      // jsonb() yields a `<json>::jsonb` fragment; kysely-codegen types the column as the VALUE it
      // reads back, so the fragment needs one narrowing cast on the way in.
      transport: jsonb(row.transport) as unknown as Json,
      auth: row.auth,
      credential: row.credential,
      credentialShape: row.credentialShape,
      expiresAt: row.expiresAt,
      providerClientId: row.providerClientId,
      callerIdentity: row.callerIdentity,
      exposure: row.exposure,
      toolCache: jsonb(row.toolCache) as unknown as Json,
      toolCacheHash: row.toolCacheHash,
      lastListedAt: row.lastListedAt,
      directory: jsonb(row.directory) as unknown as Json,
      enabled: row.enabled,
      status: row.status,
      lastOkAt: row.lastOkAt,
      lastError: row.lastError,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }).execute();
  },

  async getMcpServer(
    this: PostgresKyselyStorage, id: string,
  ): Promise<McpServerRecord | undefined> {
    const r = await this.db.selectFrom('McpServer').selectAll()
      .where('id', '=', id).executeTakeFirst();
    return r ? toMcpServer(r) : undefined;
  },

  async findMcpServerBySlug(
    this: PostgresKyselyStorage,
    slug: string, ownership: McpOwnership, ownerGhii?: string, organismId?: string,
  ): Promise<McpServerRecord | undefined> {
    let q = this.db.selectFrom('McpServer').selectAll()
      .where('slug', '=', slug)
      .where('ownership', '=', ownership);
    // Matches the COALESCE in the unique index: NULL never equals NULL, so a bare `= null` would
    // never find a node-wide server and the operator's registry would be unreachable by name.
    q = ownerGhii === undefined ? q.where('ownerGhii', 'is', null) : q.where('ownerGhii', '=', ownerGhii);
    q = organismId === undefined ? q.where('organismId', 'is', null) : q.where('organismId', '=', organismId);
    const r = await q.executeTakeFirst();
    return r ? toMcpServer(r) : undefined;
  },

  async listMcpServers(
    this: PostgresKyselyStorage, query: McpServerQuery = {},
  ): Promise<McpServerRecord[]> {
    let q = this.db.selectFrom('McpServer').selectAll();
    if (query.ownership) q = q.where('ownership', '=', query.ownership);
    if (query.ownerGhii) q = q.where('ownerGhii', '=', query.ownerGhii);
    if (query.organismId) q = q.where('organismId', '=', query.organismId);
    if (query.ws) q = q.where('ws', '=', query.ws);
    if (query.status) q = q.where('status', '=', query.status);
    if (query.enabled !== undefined) q = q.where('enabled', '=', query.enabled);
    // The jsonb path, not a text match: a server whose TAGS happened to contain the word "listed"
    // would match a text search, and the discovery source would then publish a private server.
    // COALESCE because a row written before `directory` gained the key reads NULL, and NULL is not
    // false in SQL — an unlisted server would answer neither `listed: true` nor `listed: false`.
    if (query.listed !== undefined) {
      q = q.where(
        sql<boolean>`COALESCE(("directory"->>'listed')::boolean, false) = ${query.listed}`,
      );
    }
    const rows = await q.orderBy('createdAt', 'desc').execute();
    return rows.map(toMcpServer);
  },

  async updateMcpServer(
    this: PostgresKyselyStorage, id: string, patch: McpServerPatch,
  ): Promise<void> {
    const set: Record<string, unknown> = {};
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.transport !== undefined) set.transport = jsonb(patch.transport);
    if (patch.callerIdentity !== undefined) set.callerIdentity = patch.callerIdentity;
    if (patch.exposure !== undefined) set.exposure = patch.exposure;
    if (patch.directory !== undefined) set.directory = jsonb(patch.directory);
    if (patch.enabled !== undefined) set.enabled = patch.enabled;
    if (!Object.keys(set).length) return;
    set.updatedAt = new Date().toISOString();
    await this.db.updateTable('McpServer')
      .set(set as never).where('id', '=', id).execute();
  },

  async updateMcpServerCredential(
    this: PostgresKyselyStorage, id: string, credential: string | null, expiresAt: string | null,
  ): Promise<void> {
    // status back to active and lastError cleared: a token exchange that worked is exactly the
    // evidence that whatever was wrong no longer is.
    await this.db.updateTable('McpServer').set({
      credential, expiresAt, status: 'active', lastError: null,
      updatedAt: new Date().toISOString(),
    }).where('id', '=', id).execute();
  },

  async setMcpServerStatus(
    this: PostgresKyselyStorage, id: string, status: McpServerStatus, error?: string | null,
  ): Promise<void> {
    await this.db.updateTable('McpServer')
      .set({ status, lastError: error ?? null, updatedAt: new Date().toISOString() })
      .where('id', '=', id).execute();
  },

  async touchMcpServerOk(this: PostgresKyselyStorage, id: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.updateTable('McpServer')
      .set({ lastOkAt: now, lastError: null, status: 'active', updatedAt: now })
      .where('id', '=', id).execute();
  },

  async setMcpServerToolCache(
    this: PostgresKyselyStorage, id: string, tools: RemoteToolSnapshot[], hash: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.db.updateTable('McpServer').set({
      toolCache: jsonb(tools) as unknown as Json,
      toolCacheHash: hash,
      lastListedAt: now,
      updatedAt: now,
    }).where('id', '=', id).execute();
  },

  async claimMcpRefresh(
    this: PostgresKyselyStorage, id: string, staleAfterMs: number,
  ): Promise<boolean> {
    const now = Date.now();
    const staleBefore = new Date(now - staleAfterMs).toISOString();
    const res = await this.db.updateTable('McpServer')
      .set({ refreshClaimedAt: new Date(now).toISOString() })
      .where('id', '=', id)
      .where((eb) => eb.or([
        eb('refreshClaimedAt', 'is', null),
        // A crash mid-refresh must not wedge the server permanently.
        eb('refreshClaimedAt', '<', staleBefore),
      ]))
      .executeTakeFirst();
    return (res.numUpdatedRows ?? 0n) > 0n;
  },

  async releaseMcpRefresh(this: PostgresKyselyStorage, id: string): Promise<void> {
    await this.db.updateTable('McpServer')
      .set({ refreshClaimedAt: null })
      .where('id', '=', id).execute();
  },

  async deleteMcpServer(this: PostgresKyselyStorage, id: string): Promise<void> {
    await this.db.deleteFrom('McpServer').where('id', '=', id).execute();
  },

  async deleteMcpServersByOwner(
    this: PostgresKyselyStorage, ownerGhii: string,
  ): Promise<number> {
    const res = await this.db.deleteFrom('McpServer')
      .where('ownerGhii', '=', ownerGhii).executeTakeFirst();
    return Number(res.numDeletedRows ?? 0n);
  },
};
