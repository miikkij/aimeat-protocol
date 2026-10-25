/**
 * @file src/storage/providers/sqlite/methods/subdomain-sites.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/subdomain-sites.ts
 *   (subdomainSiteMethods), so a fix in one provider finds its twin by file name. Bodies moved verbatim from
 *   the files named in the version history; bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure subdomainSiteMethods
 * @usage Object.assign(SqliteStorage.prototype, subdomainSiteMethods) in ../index.ts
 * @version-history
 *   v1.2.0 — 2026-10-25 — The `heldSince` column is written on create and update (null clears it) and
 *     read back, mirroring Postgres 0117 (secaudit2026oct22, app-label-recycled-after-delete).
 *   v1.1.0 — 2026-10-25 — The `origin` column is written on create and update and read back (null when
 *     unset), mirroring Postgres 0116; listSubdomainSitesPage reads a keyset page (secaudit2026oct22).
 *   v1.0.0 — 2026-10-05 — createSubdomainSite, getSubdomainSite, listSubdomainSites, updateSubdomainSite,
 *     deleteSubdomainSite, deserializeSubdomainSite moved here from apps.ts so the file mirrors
 *     postgres-kysely/methods/subdomain-sites.ts (secaudit 2026-10, M8).
 */
import type { SubdomainSiteRecord } from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

export const subdomainSiteMethods = {

  // ── Subdomain sites (operator-managed subdomain → app/redirect mappings) ──

  async createSubdomainSite(this: SqliteStorage, site: SubdomainSiteRecord): Promise<SubdomainSiteRecord> {
    this.db.prepare(
      `INSERT INTO subdomain_sites (subdomain, kind, target, enabled, createdBy, createdAt, updatedAt, origin, heldSince)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      site.subdomain, site.kind, site.target, site.enabled ? 1 : 0,
      site.createdBy, site.createdAt, site.updatedAt, site.origin ?? null,
      site.heldSince ? new Date(site.heldSince).toISOString() : null,
    );
    return site;
  },

  async getSubdomainSite(this: SqliteStorage, subdomain: string): Promise<SubdomainSiteRecord | null> {
    const row = this.db.prepare('SELECT * FROM subdomain_sites WHERE subdomain = ?')
      .get(subdomain) as Record<string, unknown> | undefined;
    return row ? this.deserializeSubdomainSite(row) : null;
  },

  async listSubdomainSites(this: SqliteStorage): Promise<SubdomainSiteRecord[]> {
    const rows = this.db.prepare('SELECT * FROM subdomain_sites ORDER BY subdomain')
      .all() as Record<string, unknown>[];
    return rows.map(r => this.deserializeSubdomainSite(r));
  },

  async listSubdomainSitesPage(this: SqliteStorage, query: { after?: string; limit: number }): Promise<SubdomainSiteRecord[]> {
    const limit = Math.min(Math.max(Math.floor(query.limit) || 1, 1), 500);
    // TEXT compares by bytes here, the order the Postgres twin asks for with COLLATE "C".
    const rows = (query.after
      ? this.db.prepare('SELECT * FROM subdomain_sites WHERE subdomain > ? ORDER BY subdomain LIMIT ?').all(query.after, limit)
      : this.db.prepare('SELECT * FROM subdomain_sites ORDER BY subdomain LIMIT ?').all(limit)) as Record<string, unknown>[];
    return rows.map(r => this.deserializeSubdomainSite(r));
  },

  async updateSubdomainSite(this: SqliteStorage,
    subdomain: string,
    updates: Partial<Pick<SubdomainSiteRecord, 'kind' | 'target' | 'enabled' | 'updatedAt' | 'origin' | 'heldSince'>>,
  ): Promise<SubdomainSiteRecord | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (updates.heldSince !== undefined) { sets.push('heldSince = ?'); params.push(updates.heldSince ? new Date(updates.heldSince).toISOString() : null); }
    if (updates.kind !== undefined) { sets.push('kind = ?'); params.push(updates.kind); }
    if (updates.target !== undefined) { sets.push('target = ?'); params.push(updates.target); }
    if (updates.enabled !== undefined) { sets.push('enabled = ?'); params.push(updates.enabled ? 1 : 0); }
    if (updates.origin !== undefined) { sets.push('origin = ?'); params.push(updates.origin); }
    sets.push('updatedAt = ?');
    params.push(updates.updatedAt ?? new Date().toISOString());
    params.push(subdomain);
    const result = this.db.prepare(`UPDATE subdomain_sites SET ${sets.join(', ')} WHERE subdomain = ?`)
      .run(...params);
    if (result.changes === 0) return null;
    return this.getSubdomainSite(subdomain);
  },

  async deleteSubdomainSite(this: SqliteStorage, subdomain: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM subdomain_sites WHERE subdomain = ?').run(subdomain);
    return result.changes > 0;
  },

  deserializeSubdomainSite(this: SqliteStorage, row: Record<string, unknown>): SubdomainSiteRecord {
    return {
      subdomain: row.subdomain as string,
      kind: row.kind as SubdomainSiteRecord['kind'],
      target: row.target as string,
      enabled: (row.enabled as number) === 1,
      createdBy: row.createdBy as string,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
      origin: (row.origin as SubdomainSiteRecord['origin']) ?? null,
      heldSince: (row.heldSince as string | null) ?? null,
    };
  },
};
