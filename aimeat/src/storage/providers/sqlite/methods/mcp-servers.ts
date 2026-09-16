/**
 * @file src/storage/providers/sqlite/methods/mcp-servers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite implementation of the remote MCP server store. Mirrors the Postgres provider.
 *
 *   claimMcpRefresh() is the part worth reading: a conditional UPDATE that reports `changes`, so
 *   exactly one caller wins even though better-sqlite3 runs synchronously. The guarantee comes from
 *   the statement rather than from the runtime happening to be single-threaded, which is what keeps
 *   it equivalent to the Postgres path — and equivalence is the point, because the two backends are
 *   tested against the same suite.
 * @structure mcpServerMethods — attach · read · patch · credential · tool cache · refresh claim
 * @usage merged onto SqliteStorage.prototype in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-09-16 — Phase 1 of the MCP proxy.
 */
import type { McpServerQuery, McpServerPatch } from '../../../repositories/mcp-server.repository.js';
import type {
  McpServerRecord, McpServerStatus, McpOwnership, McpTransport,
  McpAuthMode, McpCallerIdentity, McpExposure, RemoteToolSnapshot,
} from '../../../../models/mcp-server-schemas.js';
import type Database from 'better-sqlite3';

/**
 * What these methods need of the object they are merged onto, and nothing more.
 *
 * A structural type rather than `import type { SqliteStorage }`, which is what the older
 * method files do: that import makes index.ts -> methods/x.ts -> index.ts a cycle, and
 * dependency-cruiser is right to call it one. The older cycles are grandfathered in the known
 * list; a new one is not, and re-seeding that list to admit this file would forgive every
 * other entry in it at the same time. These methods only ever touch `this.db`, so saying so
 * costs nothing and the arrow only points one way.
 */
interface HasDb { db: Database.Database }

type Row = Record<string, unknown>;

function toMcpServer(r: Row): McpServerRecord {
  return {
    id: r.id as string,
    slug: r.slug as string,
    title: r.title as string,
    description: (r.description as string) ?? '',
    ownership: r.ownership as McpOwnership,
    ownerGhii: (r.ownerGhii as string | null) ?? null,
    organismId: (r.organismId as string | null) ?? null,
    ws: (r.ws as string | null) ?? null,
    createdBy: r.createdBy as string,
    transport: JSON.parse(r.transport as string) as McpTransport,
    auth: r.auth as McpAuthMode,
    credential: (r.credential as string | null) ?? null,
    credentialShape: (r.credentialShape as 'oauth2' | 'static' | null) ?? null,
    expiresAt: (r.expiresAt as string | null) ?? null,
    providerClientId: (r.providerClientId as string | null) ?? null,
    callerIdentity: r.callerIdentity as McpCallerIdentity,
    exposure: r.exposure as McpExposure,
    toolCache: JSON.parse((r.toolCache as string) || '[]') as RemoteToolSnapshot[],
    toolCacheHash: (r.toolCacheHash as string) ?? '',
    lastListedAt: (r.lastListedAt as string | null) ?? null,
    directory: JSON.parse(
      (r.directory as string) || '{"listed":false,"visibility":"private","tags":[]}',
    ) as McpServerRecord['directory'],
    enabled: Number(r.enabled) === 1,
    status: r.status as McpServerStatus,
    lastOkAt: (r.lastOkAt as string | null) ?? null,
    lastError: (r.lastError as string | null) ?? null,
    createdAt: r.createdAt as string,
    updatedAt: r.updatedAt as string,
  };
}

export const mcpServerMethods = {
  async createMcpServer(this: HasDb, row: McpServerRecord): Promise<void> {
    this.db.prepare(`
      INSERT INTO mcp_servers (id, slug, title, description, ownership, ownerGhii, organismId, ws,
        createdBy, transport, auth, credential, credentialShape, expiresAt, providerClientId,
        callerIdentity, exposure, toolCache, toolCacheHash, lastListedAt, directory, enabled,
        status, lastOkAt, lastError, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id, row.slug, row.title, row.description, row.ownership, row.ownerGhii, row.organismId,
      row.ws, row.createdBy, JSON.stringify(row.transport), row.auth, row.credential,
      row.credentialShape, row.expiresAt, row.providerClientId, row.callerIdentity, row.exposure,
      JSON.stringify(row.toolCache), row.toolCacheHash, row.lastListedAt,
      JSON.stringify(row.directory), row.enabled ? 1 : 0, row.status, row.lastOkAt, row.lastError,
      row.createdAt, row.updatedAt,
    );
  },

  async getMcpServer(this: HasDb, id: string): Promise<McpServerRecord | undefined> {
    const r = this.db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as Row | undefined;
    return r ? toMcpServer(r) : undefined;
  },

  async findMcpServerBySlug(
    this: HasDb,
    slug: string, ownership: McpOwnership, ownerGhii?: string, organismId?: string,
  ): Promise<McpServerRecord | undefined> {
    // COALESCE mirrors the unique index. `ownerGhii = NULL` is never true, so a bare comparison
    // would miss every node-wide server and the operator's registry would be unreachable by name.
    const r = this.db.prepare(`
      SELECT * FROM mcp_servers
      WHERE slug = ? AND ownership = ?
        AND COALESCE(ownerGhii, '') = ? AND COALESCE(organismId, '') = ?
    `).get(slug, ownership, ownerGhii ?? '', organismId ?? '') as Row | undefined;
    return r ? toMcpServer(r) : undefined;
  },

  async listMcpServers(this: HasDb, query: McpServerQuery = {}): Promise<McpServerRecord[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (query.ownership) { clauses.push('ownership = ?'); params.push(query.ownership); }
    if (query.ownerGhii) { clauses.push('ownerGhii = ?'); params.push(query.ownerGhii); }
    if (query.organismId) { clauses.push('organismId = ?'); params.push(query.organismId); }
    if (query.ws) { clauses.push('ws = ?'); params.push(query.ws); }
    if (query.status) { clauses.push('status = ?'); params.push(query.status); }
    if (query.enabled !== undefined) { clauses.push('enabled = ?'); params.push(query.enabled ? 1 : 0); }
    // json_extract rather than a LIKE on the blob: a server whose TAGS happened to contain the word
    // "listed" would match a text search, and the discovery source would publish a private server.
    if (query.listed !== undefined) {
      clauses.push("json_extract(directory, '$.listed') = ?");
      params.push(query.listed ? 1 : 0);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(
      `SELECT * FROM mcp_servers${where} ORDER BY createdAt DESC`,
    ).all(...params) as Row[];
    return rows.map(toMcpServer);
  },

  async updateMcpServer(this: HasDb, id: string, patch: McpServerPatch): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.title !== undefined) { sets.push('title = ?'); params.push(patch.title); }
    if (patch.description !== undefined) { sets.push('description = ?'); params.push(patch.description); }
    if (patch.transport !== undefined) { sets.push('transport = ?'); params.push(JSON.stringify(patch.transport)); }
    if (patch.callerIdentity !== undefined) { sets.push('callerIdentity = ?'); params.push(patch.callerIdentity); }
    if (patch.exposure !== undefined) { sets.push('exposure = ?'); params.push(patch.exposure); }
    if (patch.directory !== undefined) { sets.push('directory = ?'); params.push(JSON.stringify(patch.directory)); }
    if (patch.enabled !== undefined) { sets.push('enabled = ?'); params.push(patch.enabled ? 1 : 0); }
    if (!sets.length) return;
    sets.push('updatedAt = ?');
    params.push(new Date().toISOString(), id);
    this.db.prepare(`UPDATE mcp_servers SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  },

  async updateMcpServerCredential(
    this: HasDb, id: string, credential: string | null, expiresAt: string | null,
  ): Promise<void> {
    // status back to active and lastError cleared: a token exchange that worked is exactly the
    // evidence that whatever was wrong no longer is.
    this.db.prepare(`
      UPDATE mcp_servers
      SET credential = ?, expiresAt = ?, status = 'active', lastError = NULL, updatedAt = ?
      WHERE id = ?
    `).run(credential, expiresAt, new Date().toISOString(), id);
  },

  async setMcpServerStatus(
    this: HasDb, id: string, status: McpServerStatus, error?: string | null,
  ): Promise<void> {
    this.db.prepare(
      'UPDATE mcp_servers SET status = ?, lastError = ?, updatedAt = ? WHERE id = ?',
    ).run(status, error ?? null, new Date().toISOString(), id);
  },

  async touchMcpServerOk(this: HasDb, id: string): Promise<void> {
    const now = new Date().toISOString();
    this.db.prepare(
      "UPDATE mcp_servers SET lastOkAt = ?, lastError = NULL, status = 'active', updatedAt = ? WHERE id = ?",
    ).run(now, now, id);
  },

  async setMcpServerToolCache(
    this: HasDb, id: string, tools: RemoteToolSnapshot[], hash: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    this.db.prepare(
      'UPDATE mcp_servers SET toolCache = ?, toolCacheHash = ?, lastListedAt = ?, updatedAt = ? WHERE id = ?',
    ).run(JSON.stringify(tools), hash, now, now, id);
  },

  async claimMcpRefresh(this: HasDb, id: string, staleAfterMs: number): Promise<boolean> {
    const now = Date.now();
    const staleBefore = new Date(now - staleAfterMs).toISOString();
    // ONE conditional UPDATE, and `changes` is the answer. A read-then-write leaves exactly the
    // window this method exists to close: two callers both see "unclaimed" and both refresh, and a
    // server that rotates its refresh token then has one live token and one caller holding a dead
    // one. The OR is what releases a claim whose holder died mid-refresh.
    const res = this.db.prepare(`
      UPDATE mcp_servers SET refreshClaimedAt = ?
      WHERE id = ? AND (refreshClaimedAt IS NULL OR refreshClaimedAt < ?)
    `).run(new Date(now).toISOString(), id, staleBefore);
    return res.changes > 0;
  },

  async releaseMcpRefresh(this: HasDb, id: string): Promise<void> {
    this.db.prepare('UPDATE mcp_servers SET refreshClaimedAt = NULL WHERE id = ?').run(id);
  },

  async deleteMcpServer(this: HasDb, id: string): Promise<void> {
    this.db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
  },

  async deleteMcpServersByOwner(this: HasDb, ownerGhii: string): Promise<number> {
    const res = this.db.prepare('DELETE FROM mcp_servers WHERE ownerGhii = ?').run(ownerGhii);
    return res.changes;
  },
};
