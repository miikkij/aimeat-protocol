/**
 * @file src/storage/providers/postgres-kysely/methods/packages.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Package + Package-instance domains for the Postgres+Kysely backend. A Package row is one
 *   version of a package group (all versions share packageGroupId; the (packageGroupId, version) pair is
 *   unique); getLatestPublished returns the highest-version published row in a group. A PackageInstance
 *   row is an installed copy of a package version. Translated 1:1 from the Prisma implementation against
 *   the same tables: the DB-defaulted `id` is omitted on insert and read back via RETURNING (matching the
 *   Mongo backend), a unique-version clash surfaces as PACKAGE_EXISTS, and archivePackageGroup flips every
 *   still-live version to archived.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: package catalog + instances on Postgres+Kysely.
 */
import { sql } from 'kysely';
import type { Selectable } from 'kysely';
import type {
  PackageRecord, PackageComponent, PackageFilter,
  PackageInstanceRecord, InstalledComponent, InstanceFilter,
} from '../../../interface.js';
import type { Package, PackageInstance } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();

function toPackage(r: Selectable<Package>): PackageRecord {
  return {
    id: r.id,
    packageGroupId: r.packageGroupId,
    name: r.name,
    author: r.author,
    authorGhii: r.authorGhii,
    version: r.version,
    changelog: r.changelog ?? '',
    description: r.description ?? '',
    category: r.category ?? 'other',
    tags: r.tags ?? [],
    visibility: (r.visibility ?? 'private') as PackageRecord['visibility'],
    status: (r.status ?? 'draft') as PackageRecord['status'],
    components: (r.components ?? []) as unknown as PackageComponent[],
    manifest: r.manifest ?? '',
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function toInstance(r: Selectable<PackageInstance>): PackageInstanceRecord {
  return {
    id: r.id,
    packageGroupId: r.packageGroupId,
    packageVersion: r.packageVersion,
    packageRecordId: r.packageRecordId,
    owner: r.owner,
    ownerGhii: r.ownerGhii,
    label: r.label ?? '',
    installedComponents: (r.installedComponents ?? []) as unknown as InstalledComponent[],
    status: (r.status ?? 'installed') as PackageInstanceRecord['status'],
    installedAt: iso(r.installedAt),
    updatedAt: iso(r.updatedAt),
  };
}

export const packageMethods = {
  // ── Package Repository ──
  async createPackage(this: PostgresKyselyStorage, record: PackageRecord): Promise<PackageRecord> {
    // `id` is DB-defaulted (Generated) — omit it and read the generated row back via RETURNING, matching
    // the Mongo backend. A duplicate (packageGroupId, version) trips the unique index → PACKAGE_EXISTS.
    try {
      const row = await this.db.insertInto('Package').values({
        packageGroupId: record.packageGroupId, name: record.name, author: record.author,
        authorGhii: record.authorGhii, version: record.version, changelog: record.changelog,
        description: record.description, category: record.category, tags: record.tags,
        visibility: record.visibility, status: record.status, components: jsonb(record.components),
        manifest: record.manifest, createdAt: new Date(record.createdAt), updatedAt: new Date(record.updatedAt),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any).returningAll().executeTakeFirstOrThrow();
      return toPackage(row);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new Error('PACKAGE_EXISTS', { cause: e });
      throw e;
    }
  },

  async getPackage(this: PostgresKyselyStorage, id: string): Promise<PackageRecord | null> {
    const r = await this.db.selectFrom('Package').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toPackage(r) : null;
  },

  async getPackageByGroupAndVersion(this: PostgresKyselyStorage, groupId: string, version: string): Promise<PackageRecord | null> {
    const r = await this.db.selectFrom('Package').selectAll()
      .where('packageGroupId', '=', groupId).where('version', '=', version).executeTakeFirst();
    return r ? toPackage(r) : null;
  },

  async getLatestPublished(this: PostgresKyselyStorage, groupId: string): Promise<PackageRecord | null> {
    const r = await this.db.selectFrom('Package').selectAll()
      .where('packageGroupId', '=', groupId).where('status', '=', 'published')
      .orderBy('version', 'desc').executeTakeFirst();
    return r ? toPackage(r) : null;
  },

  async listPackages(this: PostgresKyselyStorage, filter: PackageFilter): Promise<{ packages: PackageRecord[]; total: number }> {
    let q = this.db.selectFrom('Package');
    if (filter.author) q = q.where('author', '=', filter.author);
    if (filter.category) q = q.where('category', '=', filter.category);
    if (filter.status) q = q.where('status', '=', filter.status);
    if (filter.visibility) q = q.where('visibility', '=', filter.visibility);
    if (filter.search) {
      const s = `%${filter.search}%`;
      q = q.where(eb => eb.or([eb('name', 'ilike', s), eb('description', 'ilike', s)]));
    }
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;
    const [rows, totalRow] = await Promise.all([
      q.selectAll().orderBy('createdAt', 'desc').limit(limit).offset(offset).execute(),
      q.select(sql<number>`count(*)`.as('c')).executeTakeFirst(),
    ]);
    return { packages: rows.map(toPackage), total: Number(totalRow?.c ?? 0) };
  },

  async listVersions(this: PostgresKyselyStorage, groupId: string, limit?: number, offset?: number): Promise<{ versions: PackageRecord[]; total: number }> {
    const lim = limit ?? 50;
    const off = offset ?? 0;
    const q = this.db.selectFrom('Package').where('packageGroupId', '=', groupId);
    const [rows, totalRow] = await Promise.all([
      q.selectAll().orderBy('version', 'desc').limit(lim).offset(off).execute(),
      q.select(sql<number>`count(*)`.as('c')).executeTakeFirst(),
    ]);
    return { versions: rows.map(toPackage), total: Number(totalRow?.c ?? 0) };
  },

  async updatePackage(this: PostgresKyselyStorage, id: string, updates: Partial<PackageRecord>): Promise<PackageRecord | null> {
    const data: Record<string, unknown> = {};
    if (updates.name !== undefined) data.name = updates.name;
    if (updates.description !== undefined) data.description = updates.description;
    if (updates.changelog !== undefined) data.changelog = updates.changelog;
    if (updates.category !== undefined) data.category = updates.category;
    if (updates.tags !== undefined) data.tags = updates.tags;
    if (updates.visibility !== undefined) data.visibility = updates.visibility;
    if (updates.status !== undefined) data.status = updates.status;
    if (updates.components !== undefined) data.components = jsonb(updates.components);
    if (updates.manifest !== undefined) data.manifest = updates.manifest;
    data.updatedAt = new Date();
    const rows = await this.db.updateTable('Package').set(data as never).where('id', '=', id).returningAll().execute();
    return rows[0] ? toPackage(rows[0]) : null;
  },

  async archivePackage(this: PostgresKyselyStorage, id: string): Promise<boolean> {
    const r = await this.db.updateTable('Package')
      .set({ status: 'archived', updatedAt: new Date() }).where('id', '=', id).executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0) > 0;
  },

  async archivePackageGroup(this: PostgresKyselyStorage, groupId: string): Promise<number> {
    const r = await this.db.updateTable('Package')
      .set({ status: 'archived', updatedAt: new Date() })
      .where('packageGroupId', '=', groupId).where('status', '!=', 'archived').executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0);
  },

  // ── Package Instance Repository ──
  async createInstance(this: PostgresKyselyStorage, record: PackageInstanceRecord): Promise<PackageInstanceRecord> {
    // `id` is DB-defaulted (Generated) — omit it and read back via RETURNING, matching the Mongo backend.
    const row = await this.db.insertInto('PackageInstance').values({
      packageGroupId: record.packageGroupId, packageVersion: record.packageVersion,
      packageRecordId: record.packageRecordId, owner: record.owner, ownerGhii: record.ownerGhii,
      label: record.label, installedComponents: jsonb(record.installedComponents), status: record.status,
      installedAt: new Date(record.installedAt), updatedAt: new Date(record.updatedAt),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).returningAll().executeTakeFirstOrThrow();
    return toInstance(row);
  },

  async getInstance(this: PostgresKyselyStorage, id: string): Promise<PackageInstanceRecord | null> {
    const r = await this.db.selectFrom('PackageInstance').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toInstance(r) : null;
  },

  async listInstances(this: PostgresKyselyStorage, filter: InstanceFilter): Promise<{ instances: PackageInstanceRecord[]; total: number }> {
    let q = this.db.selectFrom('PackageInstance');
    if (filter.owner) q = q.where('owner', '=', filter.owner);
    if (filter.ownerGhii) q = q.where('ownerGhii', '=', filter.ownerGhii);
    if (filter.packageGroupId) q = q.where('packageGroupId', '=', filter.packageGroupId);
    if (filter.status) q = q.where('status', '=', filter.status);
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;
    const [rows, totalRow] = await Promise.all([
      q.selectAll().orderBy('installedAt', 'desc').limit(limit).offset(offset).execute(),
      q.select(sql<number>`count(*)`.as('c')).executeTakeFirst(),
    ]);
    return { instances: rows.map(toInstance), total: Number(totalRow?.c ?? 0) };
  },

  async updateInstance(this: PostgresKyselyStorage, id: string, updates: Partial<PackageInstanceRecord>): Promise<PackageInstanceRecord | null> {
    const data: Record<string, unknown> = {};
    if (updates.label !== undefined) data.label = updates.label;
    if (updates.status !== undefined) data.status = updates.status;
    if (updates.installedComponents !== undefined) data.installedComponents = jsonb(updates.installedComponents);
    if (updates.packageVersion !== undefined) data.packageVersion = updates.packageVersion;
    if (updates.packageRecordId !== undefined) data.packageRecordId = updates.packageRecordId;
    data.updatedAt = new Date();
    const rows = await this.db.updateTable('PackageInstance').set(data as never).where('id', '=', id).returningAll().execute();
    return rows[0] ? toInstance(rows[0]) : null;
  },

  async deleteInstance(this: PostgresKyselyStorage, id: string): Promise<boolean> {
    const r = await this.db.deleteFrom('PackageInstance').where('id', '=', id).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  async listInstancesByPackage(this: PostgresKyselyStorage, packageGroupId: string): Promise<{ instances: PackageInstanceRecord[]; total: number }> {
    const q = this.db.selectFrom('PackageInstance').where('packageGroupId', '=', packageGroupId);
    const [rows, totalRow] = await Promise.all([
      q.selectAll().orderBy('installedAt', 'desc').execute(),
      q.select(sql<number>`count(*)`.as('c')).executeTakeFirst(),
    ]);
    return { instances: rows.map(toInstance), total: Number(totalRow?.c ?? 0) };
  },
};
