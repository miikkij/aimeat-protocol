/**
 * @file src/storage/providers/postgres-kysely/methods/subdomain-sites.ts
 * @description Subdomain-site mapping domain for the Postgres+Kysely backend (SubdomainSite table, keyed
 *   by unique `subdomain`). Maps a subdomain to an app or redirect target. Translated 1:1 from Prisma.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: subdomain sites on Postgres+Kysely.
 */
import type { Selectable } from 'kysely';
import type { SubdomainSiteRecord } from '../../../interface.js';
import type { SubdomainSite } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();

function toSite(r: Selectable<SubdomainSite>): SubdomainSiteRecord {
  return { subdomain: r.subdomain, kind: r.kind as SubdomainSiteRecord['kind'], target: r.target, enabled: r.enabled, createdBy: r.createdBy, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) };
}

export const subdomainSiteMethods = {
  async createSubdomainSite(this: PostgresKyselyStorage, site: SubdomainSiteRecord): Promise<SubdomainSiteRecord> {
    const [row] = await this.db.insertInto('SubdomainSite').values({
      subdomain: site.subdomain, kind: site.kind, target: site.target, enabled: site.enabled,
      createdBy: site.createdBy, createdAt: new Date(site.createdAt), updatedAt: new Date(site.updatedAt),
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
  async updateSubdomainSite(this: PostgresKyselyStorage, subdomain: string, updates: Partial<Pick<SubdomainSiteRecord, 'kind' | 'target' | 'enabled' | 'updatedAt'>>): Promise<SubdomainSiteRecord | null> {
    const data: Record<string, unknown> = { updatedAt: updates.updatedAt ? new Date(updates.updatedAt) : new Date() };
    if (updates.kind !== undefined) data.kind = updates.kind;
    if (updates.target !== undefined) data.target = updates.target;
    if (updates.enabled !== undefined) data.enabled = updates.enabled;
    const rows = await this.db.updateTable('SubdomainSite').set(data as never).where('subdomain', '=', subdomain).returningAll().execute();
    return rows[0] ? toSite(rows[0]) : null;
  },
  async deleteSubdomainSite(this: PostgresKyselyStorage, subdomain: string): Promise<boolean> {
    const r = await this.db.deleteFrom('SubdomainSite').where('subdomain', '=', subdomain).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },
};
