/**
 * @file src/storage/providers/postgres-kysely/methods/subdomain-sites.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Subdomain-site mapping domain for the Postgres+Kysely backend (SubdomainSite table, keyed
 *   by unique `subdomain`). Maps a subdomain to an app or redirect target. Translated 1:1 from Prisma.
 * @version-history
 *   v1.1.0 — 2026-10-25 — The `origin` column (migration 0116) is written on create and update and read
 *     back, null when unset; listSubdomainSitesPage reads a keyset page in byte order (secaudit2026oct22).
 *   v1.0.0 — 2026-07-15 — Phase 5: subdomain sites on Postgres+Kysely.
 */
import { sql, type Selectable } from 'kysely';
import type { SubdomainSiteRecord } from '../../../interface.js';
import type { SubdomainSite } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();

function toSite(r: Selectable<SubdomainSite>): SubdomainSiteRecord {
  return { subdomain: r.subdomain, kind: r.kind as SubdomainSiteRecord['kind'], target: r.target, enabled: r.enabled, createdBy: r.createdBy, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt), origin: (r.origin as SubdomainSiteRecord['origin']) ?? null };
}

export const subdomainSiteMethods = {
  async createSubdomainSite(this: PostgresKyselyStorage, site: SubdomainSiteRecord): Promise<SubdomainSiteRecord> {
    const [row] = await this.db.insertInto('SubdomainSite').values({
      subdomain: site.subdomain, kind: site.kind, target: site.target, enabled: site.enabled,
      createdBy: site.createdBy, createdAt: new Date(site.createdAt), updatedAt: new Date(site.updatedAt),
      origin: site.origin ?? null,
    }).returningAll().execute();
    return toSite(row);
  },
  async getSubdomainSite(this: PostgresKyselyStorage, subdomain: string): Promise<SubdomainSiteRecord | null> {
    const r = await this.db.selectFrom('SubdomainSite').selectAll().where('subdomain', '=', subdomain).executeTakeFirst();
    return r ? toSite(r) : null;
  },
  async listSubdomainSites(this: PostgresKyselyStorage): Promise<SubdomainSiteRecord[]> {
    return (await this.db.selectFrom('SubdomainSite').selectAll().orderBy('subdomain', 'asc').execute()).map(toSite);
  },
  async listSubdomainSitesPage(this: PostgresKyselyStorage, query: { after?: string; limit: number }): Promise<SubdomainSiteRecord[]> {
    const limit = Math.min(Math.max(Math.floor(query.limit) || 1, 1), 500);
    // Byte order (COLLATE "C"), the order SQLite gives TEXT: a locale collation that skips '-' would
    // put the labels in another sequence than the SQLite twin, and the page boundary with them.
    let q = this.db.selectFrom('SubdomainSite').selectAll();
    if (query.after) q = q.where(sql<boolean>`"subdomain" COLLATE "C" > ${query.after}`);
    return (await q.orderBy(sql`"subdomain" COLLATE "C"`).limit(limit).execute()).map(toSite);
  },
  async updateSubdomainSite(this: PostgresKyselyStorage, subdomain: string, updates: Partial<Pick<SubdomainSiteRecord, 'kind' | 'target' | 'enabled' | 'updatedAt' | 'origin'>>): Promise<SubdomainSiteRecord | null> {
    const data: Record<string, unknown> = { updatedAt: updates.updatedAt ? new Date(updates.updatedAt) : new Date() };
    if (updates.kind !== undefined) data.kind = updates.kind;
    if (updates.target !== undefined) data.target = updates.target;
    if (updates.enabled !== undefined) data.enabled = updates.enabled;
    if (updates.origin !== undefined) data.origin = updates.origin;
    const rows = await this.db.updateTable('SubdomainSite').set(data as never).where('subdomain', '=', subdomain).returningAll().execute();
    return rows[0] ? toSite(rows[0]) : null;
  },
  async deleteSubdomainSite(this: PostgresKyselyStorage, subdomain: string): Promise<boolean> {
    const r = await this.db.deleteFrom('SubdomainSite').where('subdomain', '=', subdomain).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },
};
