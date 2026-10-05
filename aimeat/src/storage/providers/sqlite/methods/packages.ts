/**
 * @file src/storage/providers/sqlite/methods/packages.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Package and Package-instance methods, the twin of postgres-kysely/methods/packages.ts.
 *   Extracted from sqlite/index.ts to satisfy max-file-lines; bodies verbatim, bound to SqliteStorage
 *   via prototype merge.
 * @version-history
 *   v1.4.0 — 2026-10-05 — 10 methods (deserializeSystemPrompt, deserializeSystemPromptVersion,
 *     listSystemPrompts, …) moved to system-extras.ts; 18 methods (deserializeTemplateListing,
 *     deserializeReview, deserializeDiscussion, …) moved to template-listings.ts so the file mirrors
 *     postgres-kysely/methods/packages.ts (secaudit 2026-10, M8).
 *   v1.3.0 — 2026-10-02 — countPackageGroups: the author's package groups with a version not archived,
 *     which the per-author quota counts (it counted version rows).
 *   v1.2.0 — 2026-09-28 — An instance carries `mode` (managed | editable), `forkedAt` and `autoUpdate`.
 *   v1.1.0 — 2026-09-09 — deleteReview, deleteDiscussion and listInstancesByPackage deleted: no caller.
 *   v1.0.0 — 2026-07-13 — Extracted from providers/sqlite/index.ts (max-file-lines)
 */
import type {
  PackageRecord, PackageComponent, PackageFilter, PackageInstanceRecord, InstalledComponent, InstanceFilter,
} from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

export const packageMethods = {

  // ══════════════════════════════════════════════════════════
  // ── Packages ──
  // ══════════════════════════════════════════════════════════

  deserializePackage(this: SqliteStorage, row: Record<string, unknown>): PackageRecord {
    return {
      id: row.id as string,
      packageGroupId: row.packageGroupId as string,
      name: row.name as string,
      author: row.author as string,
      authorGhii: row.authorGhii as string,
      version: row.version as string,
      changelog: row.changelog as string,
      description: row.description as string,
      category: row.category as string,
      tags: JSON.parse(row.tags as string) as string[],
      visibility: row.visibility as PackageRecord['visibility'],
      status: row.status as PackageRecord['status'],
      components: JSON.parse(row.components as string) as PackageComponent[],
      manifest: row.manifest as string,
      ...(row.upstream ? { upstream: JSON.parse(row.upstream as string) as PackageRecord['upstream'] } : {}),
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
  },

  async createPackage(this: SqliteStorage, record: PackageRecord): Promise<PackageRecord> {
    try {
      this.db.prepare(
        `INSERT INTO packages (id, packageGroupId, name, author, authorGhii, version, changelog, description, category, tags, visibility, status, components, manifest, upstream, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        record.id, record.packageGroupId, record.name, record.author,
        record.authorGhii, record.version, record.changelog, record.description,
        record.category, JSON.stringify(record.tags), record.visibility,
        record.status, JSON.stringify(record.components), record.manifest,
        record.upstream ? JSON.stringify(record.upstream) : null,
        record.createdAt, record.updatedAt,
      );
    } catch (e) {
      if (e instanceof Error && e.message.includes('UNIQUE constraint failed')) {
        throw new Error('PACKAGE_EXISTS', { cause: e });
      }
      throw e;
    }
    return record;
  },

  async getPackage(this: SqliteStorage, id: string): Promise<PackageRecord | null> {
    const row = this.db.prepare('SELECT * FROM packages WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializePackage(row) : null;
  },

  async getPackageByGroupAndVersion(this: SqliteStorage, groupId: string, version: string): Promise<PackageRecord | null> {
    const row = this.db.prepare(
      'SELECT * FROM packages WHERE packageGroupId = ? AND version = ?'
    ).get(groupId, version) as Record<string, unknown> | undefined;
    return row ? this.deserializePackage(row) : null;
  },

  async getLatestPublished(this: SqliteStorage, groupId: string): Promise<PackageRecord | null> {
    const row = this.db.prepare(
      `SELECT * FROM packages WHERE packageGroupId = ? AND status = 'published' ORDER BY version DESC LIMIT 1`
    ).get(groupId) as Record<string, unknown> | undefined;
    return row ? this.deserializePackage(row) : null;
  },

  async listPackages(this: SqliteStorage, filter: PackageFilter): Promise<{ packages: PackageRecord[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.author) { conditions.push('author = ?'); params.push(filter.author); }
    if (filter.category) { conditions.push('category = ?'); params.push(filter.category); }
    if (filter.status) { conditions.push('status = ?'); params.push(filter.status); }
    if (filter.visibility) { conditions.push('visibility = ?'); params.push(filter.visibility); }
    if (filter.search) {
      conditions.push('(name LIKE ? OR description LIKE ? OR tags LIKE ?)');
      const s = `%${filter.search}%`;
      params.push(s, s, s);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;

    const total = (this.db.prepare(`SELECT COUNT(*) as c FROM packages ${where}`).get(...params) as { c: number }).c;
    const rows = this.db.prepare(
      `SELECT * FROM packages ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as Record<string, unknown>[];

    return { packages: rows.map(r => this.deserializePackage(r)), total };
  },

  async listVersions(this: SqliteStorage, groupId: string, limit?: number, offset?: number): Promise<{ versions: PackageRecord[]; total: number }> {
    const lim = limit ?? 50;
    const off = offset ?? 0;
    const total = (this.db.prepare('SELECT COUNT(*) as c FROM packages WHERE packageGroupId = ?').get(groupId) as { c: number }).c;
    const rows = this.db.prepare(
      'SELECT * FROM packages WHERE packageGroupId = ? ORDER BY version DESC LIMIT ? OFFSET ?'
    ).all(groupId, lim, off) as Record<string, unknown>[];
    return { versions: rows.map(r => this.deserializePackage(r)), total };
  },

  async updatePackage(this: SqliteStorage, id: string, updates: Partial<PackageRecord>): Promise<PackageRecord | null> {
    const existing = await this.getPackage(id);
    if (!existing) return null;
    const merged = { ...existing, ...updates, id };
    this.db.prepare(
      `UPDATE packages SET packageGroupId = ?, name = ?, author = ?, authorGhii = ?, version = ?,
       changelog = ?, description = ?, category = ?, tags = ?, visibility = ?, status = ?,
       components = ?, manifest = ?, upstream = ?, updatedAt = ? WHERE id = ?`
    ).run(
      merged.packageGroupId, merged.name, merged.author, merged.authorGhii, merged.version,
      merged.changelog, merged.description, merged.category, JSON.stringify(merged.tags),
      merged.visibility, merged.status, JSON.stringify(merged.components), merged.manifest,
      merged.upstream ? JSON.stringify(merged.upstream) : null,
      merged.updatedAt, id,
    );
    return merged;
  },

  async archivePackage(this: SqliteStorage, id: string): Promise<boolean> {
    const result = this.db.prepare(
      `UPDATE packages SET status = 'archived', updatedAt = ? WHERE id = ?`
    ).run(new Date().toISOString(), id);
    return result.changes > 0;
  },

  async archivePackageGroup(this: SqliteStorage, groupId: string): Promise<number> {
    const result = this.db.prepare(
      `UPDATE packages SET status = 'archived', updatedAt = ? WHERE packageGroupId = ? AND status != 'archived'`
    ).run(new Date().toISOString(), groupId);
    return result.changes;
  },

  async countPackageGroups(this: SqliteStorage, author: string): Promise<number> {
    const row = this.db.prepare(
      `SELECT COUNT(DISTINCT packageGroupId) as c FROM packages WHERE author = ? AND status != 'archived'`
    ).get(author) as { c: number };
    return row.c;
  },

  // ══════════════════════════════════════════════════════════
  // ── Package Instances ──
  // ══════════════════════════════════════════════════════════

  deserializeInstance(this: SqliteStorage, row: Record<string, unknown>): PackageInstanceRecord {
    return {
      id: row.id as string,
      packageGroupId: row.packageGroupId as string,
      packageVersion: row.packageVersion as string,
      packageRecordId: row.packageRecordId as string,
      owner: row.owner as string,
      ownerGhii: row.ownerGhii as string,
      label: row.label as string,
      installedComponents: JSON.parse(row.installedComponents as string) as InstalledComponent[],
      status: row.status as PackageInstanceRecord['status'],
      mode: row.mode === 'managed' ? 'managed' : 'editable',
      ...(row.forkedAt ? { forkedAt: row.forkedAt as string } : {}),
      autoUpdate: row.autoUpdate === 1 || row.autoUpdate === true,
      installedAt: row.installedAt as string,
      updatedAt: row.updatedAt as string,
    };
  },

  async createInstance(this: SqliteStorage, record: PackageInstanceRecord): Promise<PackageInstanceRecord> {
    this.db.prepare(
      `INSERT INTO package_instances (id, packageGroupId, packageVersion, packageRecordId, owner, ownerGhii, label, installedComponents, status, mode, forkedAt, autoUpdate, installedAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.packageGroupId, record.packageVersion, record.packageRecordId,
      record.owner, record.ownerGhii, record.label,
      JSON.stringify(record.installedComponents), record.status,
      record.mode ?? 'editable', record.forkedAt ?? null, record.autoUpdate ? 1 : 0,
      record.installedAt, record.updatedAt,
    );
    return record;
  },

  async getInstance(this: SqliteStorage, id: string): Promise<PackageInstanceRecord | null> {
    const row = this.db.prepare('SELECT * FROM package_instances WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeInstance(row) : null;
  },

  async listInstances(this: SqliteStorage, filter: InstanceFilter): Promise<{ instances: PackageInstanceRecord[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.owner) { conditions.push('owner = ?'); params.push(filter.owner); }
    if (filter.ownerGhii) { conditions.push('ownerGhii = ?'); params.push(filter.ownerGhii); }
    if (filter.packageGroupId) { conditions.push('packageGroupId = ?'); params.push(filter.packageGroupId); }
    if (filter.status) { conditions.push('status = ?'); params.push(filter.status); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;

    const total = (this.db.prepare(`SELECT COUNT(*) as c FROM package_instances ${where}`).get(...params) as { c: number }).c;
    const rows = this.db.prepare(
      `SELECT * FROM package_instances ${where} ORDER BY installedAt DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as Record<string, unknown>[];

    return { instances: rows.map(r => this.deserializeInstance(r)), total };
  },

  async updateInstance(this: SqliteStorage, id: string, updates: Partial<PackageInstanceRecord>): Promise<PackageInstanceRecord | null> {
    const existing = await this.getInstance(id);
    if (!existing) return null;
    const merged = { ...existing, ...updates, id };
    this.db.prepare(
      `UPDATE package_instances SET packageGroupId = ?, packageVersion = ?, packageRecordId = ?,
       owner = ?, ownerGhii = ?, label = ?, installedComponents = ?, status = ?, mode = ?, forkedAt = ?, autoUpdate = ?, updatedAt = ?
       WHERE id = ?`
    ).run(
      merged.packageGroupId, merged.packageVersion, merged.packageRecordId,
      merged.owner, merged.ownerGhii, merged.label,
      JSON.stringify(merged.installedComponents), merged.status,
      merged.mode ?? 'editable', merged.forkedAt ?? null, merged.autoUpdate ? 1 : 0, merged.updatedAt, id,
    );
    return merged;
  },

  async deleteInstance(this: SqliteStorage, id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM package_instances WHERE id = ?').run(id);
    return result.changes > 0;
  },
};
