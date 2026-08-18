/**
 * @file src/storage/providers/sqlite/methods/packages.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description System-prompt, Package, Template-listing, Package-instance methods. Extracted from sqlite/index.ts to satisfy max-file-lines; bodies verbatim, bound to SqliteStorage via prototype merge.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from providers/sqlite/index.ts (max-file-lines)
 */
import type {
  SystemPromptRecord, SystemPromptVersionRecord, PackageRecord, PackageComponent, PackageFilter, TemplateListingRecord,
  TemplateReview, TemplateDiscussion, TemplateFilter, PackageInstanceRecord, InstalledComponent, InstanceFilter
} from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

export const packagesMethods = {
  // ── System Prompts ────────────────────────────────────────────────

  deserializeSystemPrompt(this: SqliteStorage, row: Record<string, unknown>): SystemPromptRecord {
    return {
      id: row.id as string,
      group: row.grp as string,
      name: row.name as string,
      description: row.description as string,
      content: row.content as string,
      locales: row.locales ? JSON.parse(row.locales as string) : undefined,
      active: row.active === 1,
      variables: JSON.parse(row.variables as string),
      usedIn: JSON.parse(row.usedIn as string),
      version: row.version as number,
      updatedAt: row.updatedAt as string,
      updatedBy: row.updatedBy as string,
    };
  },

  deserializeSystemPromptVersion(this: SqliteStorage, row: Record<string, unknown>): SystemPromptVersionRecord {
    return {
      promptId: row.promptId as string,
      version: row.version as number,
      content: row.content as string,
      locales: row.locales ? JSON.parse(row.locales as string) : undefined,
      changedBy: row.changedBy as string,
      changedAt: row.changedAt as string,
      changeNote: row.changeNote as string | undefined,
    };
  },

  async listSystemPrompts(this: SqliteStorage, opts?: { group?: string }): Promise<SystemPromptRecord[]> {
    const sql = opts?.group
      ? 'SELECT * FROM system_prompts WHERE grp = ? ORDER BY grp, name'
      : 'SELECT * FROM system_prompts ORDER BY grp, name';
    const rows = (opts?.group
      ? this.db.prepare(sql).all(opts.group)
      : this.db.prepare(sql).all()) as Record<string, unknown>[];
    return rows.map(r => this.deserializeSystemPrompt(r));
  },

  async getSystemPrompt(this: SqliteStorage, id: string): Promise<SystemPromptRecord | null> {
    const row = this.db.prepare('SELECT * FROM system_prompts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeSystemPrompt(row) : null;
  },

  async upsertSystemPrompt(this: SqliteStorage, record: SystemPromptRecord): Promise<SystemPromptRecord> {
    this.db.prepare(
      `INSERT INTO system_prompts (id, grp, name, description, content, locales, active, variables, usedIn, version, updatedAt, updatedBy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         grp = excluded.grp, name = excluded.name, description = excluded.description,
         content = excluded.content, locales = excluded.locales, active = excluded.active,
         variables = excluded.variables, usedIn = excluded.usedIn, version = excluded.version,
         updatedAt = excluded.updatedAt, updatedBy = excluded.updatedBy`
    ).run(
      record.id, record.group, record.name, record.description, record.content,
      record.locales ? JSON.stringify(record.locales) : null,
      record.active ? 1 : 0,
      JSON.stringify(record.variables), JSON.stringify(record.usedIn),
      record.version, record.updatedAt, record.updatedBy,
    );
    return record;
  },

  async getSystemPromptVersions(this: SqliteStorage, promptId: string): Promise<SystemPromptVersionRecord[]> {
    const rows = this.db.prepare(
      'SELECT * FROM system_prompt_versions WHERE promptId = ? ORDER BY version DESC'
    ).all(promptId) as Record<string, unknown>[];
    return rows.map(r => this.deserializeSystemPromptVersion(r));
  },

  async getSystemPromptVersion(this: SqliteStorage, promptId: string, version: number): Promise<SystemPromptVersionRecord | null> {
    const row = this.db.prepare(
      'SELECT * FROM system_prompt_versions WHERE promptId = ? AND version = ?'
    ).get(promptId, version) as Record<string, unknown> | undefined;
    return row ? this.deserializeSystemPromptVersion(row) : null;
  },

  async createSystemPromptVersion(this: SqliteStorage, record: SystemPromptVersionRecord): Promise<SystemPromptVersionRecord> {
    this.db.prepare(
      `INSERT INTO system_prompt_versions (promptId, version, content, locales, changedBy, changedAt, changeNote)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.promptId, record.version, record.content,
      record.locales ? JSON.stringify(record.locales) : null,
      record.changedBy, record.changedAt, record.changeNote ?? null,
    );
    return record;
  },

  async pruneSystemPromptVersions(this: SqliteStorage, promptId: string, keepCount: number): Promise<number> {
    const result = this.db.prepare(
      `DELETE FROM system_prompt_versions WHERE promptId = ? AND version NOT IN (
         SELECT version FROM system_prompt_versions WHERE promptId = ? ORDER BY version DESC LIMIT ?
       )`
    ).run(promptId, promptId, keepCount);
    return result.changes;
  },

  async deleteAllSystemPrompts(this: SqliteStorage): Promise<void> {
    this.db.prepare('DELETE FROM system_prompt_versions').run();
    this.db.prepare('DELETE FROM system_prompts').run();
  },

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
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
  },

  async createPackage(this: SqliteStorage, record: PackageRecord): Promise<PackageRecord> {
    try {
      this.db.prepare(
        `INSERT INTO packages (id, packageGroupId, name, author, authorGhii, version, changelog, description, category, tags, visibility, status, components, manifest, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        record.id, record.packageGroupId, record.name, record.author,
        record.authorGhii, record.version, record.changelog, record.description,
        record.category, JSON.stringify(record.tags), record.visibility,
        record.status, JSON.stringify(record.components), record.manifest,
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
       components = ?, manifest = ?, updatedAt = ? WHERE id = ?`
    ).run(
      merged.packageGroupId, merged.name, merged.author, merged.authorGhii, merged.version,
      merged.changelog, merged.description, merged.category, JSON.stringify(merged.tags),
      merged.visibility, merged.status, JSON.stringify(merged.components), merged.manifest,
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

  // ══════════════════════════════════════════════════════════
  // ── Template Listings ──
  // ══════════════════════════════════════════════════════════

  deserializeTemplateListing(this: SqliteStorage, row: Record<string, unknown>): TemplateListingRecord {
    return {
      id: row.id as string,
      packageGroupId: row.packageGroupId as string,
      packageName: row.packageName as string,
      packageAuthor: row.packageAuthor as string,
      publishedBy: row.publishedBy as string,
      publishedByGhii: row.publishedByGhii as string,
      title: row.title as string,
      description: row.description as string,
      screenshots: JSON.parse(row.screenshots as string) as string[],
      category: row.category as string,
      tags: JSON.parse(row.tags as string) as string[],
      featured: !!(row.featured as number),
      installCount: row.installCount as number,
      rating: row.rating as number,
      reviewCount: row.reviewCount as number,
      status: row.status as TemplateListingRecord['status'],
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
      ...(row.rejectionReason ? { rejectionReason: row.rejectionReason as string } : {}),
      ...(row.reviewedBy ? { reviewedBy: row.reviewedBy as string } : {}),
      ...(row.reviewedAt ? { reviewedAt: row.reviewedAt as string } : {}),
      ...(row.reviewComment ? { reviewComment: row.reviewComment as string } : {}),
      ...(row.proposedAt ? { proposedAt: row.proposedAt as string } : {}),
      ...(row.proposedBy ? { proposedBy: row.proposedBy as string } : {}),
    };
  },

  deserializeReview(this: SqliteStorage, row: Record<string, unknown>): TemplateReview {
    return {
      id: row.id as string,
      listingId: row.listingId as string,
      authorGhii: row.authorGhii as string,
      authorName: row.authorName as string,
      rating: row.rating as number,
      comment: row.comment as string,
      createdAt: row.createdAt as string,
    };
  },

  deserializeDiscussion(this: SqliteStorage, row: Record<string, unknown>): TemplateDiscussion {
    return {
      id: row.id as string,
      listingId: row.listingId as string,
      authorGhii: row.authorGhii as string,
      authorName: row.authorName as string,
      message: row.message as string,
      parentId: row.parentId as string | undefined,
      createdAt: row.createdAt as string,
    };
  },

  async createTemplateListing(this: SqliteStorage, record: TemplateListingRecord): Promise<TemplateListingRecord> {
    this.db.prepare(
      `INSERT INTO template_listings (id, packageGroupId, packageName, packageAuthor, publishedBy, publishedByGhii, title, description, screenshots, category, tags, featured, installCount, rating, reviewCount, status, createdAt, updatedAt, rejectionReason, reviewedBy, reviewedAt, reviewComment, proposedAt, proposedBy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.packageGroupId, record.packageName, record.packageAuthor,
      record.publishedBy, record.publishedByGhii, record.title, record.description,
      JSON.stringify(record.screenshots), record.category, JSON.stringify(record.tags),
      record.featured ? 1 : 0, record.installCount, record.rating, record.reviewCount,
      record.status, record.createdAt, record.updatedAt,
      record.rejectionReason ?? null, record.reviewedBy ?? null, record.reviewedAt ?? null,
      record.reviewComment ?? null, record.proposedAt ?? null, record.proposedBy ?? null,
    );
    return record;
  },

  async getTemplateListing(this: SqliteStorage, id: string): Promise<TemplateListingRecord | null> {
    const row = this.db.prepare('SELECT * FROM template_listings WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeTemplateListing(row) : null;
  },

  async getListingByPackage(this: SqliteStorage, packageGroupId: string): Promise<TemplateListingRecord | null> {
    const row = this.db.prepare(
      'SELECT * FROM template_listings WHERE packageGroupId = ?'
    ).get(packageGroupId) as Record<string, unknown> | undefined;
    return row ? this.deserializeTemplateListing(row) : null;
  },

  async listTemplateListings(this: SqliteStorage, filter: TemplateFilter): Promise<{ listings: TemplateListingRecord[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.category) { conditions.push('category = ?'); params.push(filter.category); }
    if (filter.tags && filter.tags.length > 0) {
      const tagConditions = filter.tags.map(() => 'tags LIKE ?');
      conditions.push(`(${tagConditions.join(' AND ')})`);
      for (const tag of filter.tags) params.push(`%${tag}%`);
    }
    if (filter.featured !== undefined) { conditions.push('featured = ?'); params.push(filter.featured ? 1 : 0); }
    if (filter.status) { conditions.push('status = ?'); params.push(filter.status); }
    if (filter.search) {
      conditions.push('(title LIKE ? OR description LIKE ? OR tags LIKE ?)');
      const s = `%${filter.search}%`;
      params.push(s, s, s);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;

    let orderBy: string;
    switch (filter.sort) {
      case 'rating': orderBy = 'rating DESC'; break;
      case 'installs': orderBy = 'installCount DESC'; break;
      case 'newest': orderBy = 'createdAt DESC'; break;
      default: orderBy = 'createdAt DESC';
    }

    const total = (this.db.prepare(`SELECT COUNT(*) as c FROM template_listings ${where}`).get(...params) as { c: number }).c;
    const rows = this.db.prepare(
      `SELECT * FROM template_listings ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as Record<string, unknown>[];

    return { listings: rows.map(r => this.deserializeTemplateListing(r)), total };
  },

  async updateTemplateListing(this: SqliteStorage, id: string, updates: Partial<TemplateListingRecord>): Promise<TemplateListingRecord | null> {
    const existing = await this.getTemplateListing(id);
    if (!existing) return null;
    const merged = { ...existing, ...updates, id };
    this.db.prepare(
      `UPDATE template_listings SET packageGroupId = ?, packageName = ?, packageAuthor = ?,
       publishedBy = ?, publishedByGhii = ?, title = ?, description = ?, screenshots = ?,
       category = ?, tags = ?, featured = ?, installCount = ?, rating = ?, reviewCount = ?,
       status = ?, updatedAt = ?, rejectionReason = ?, reviewedBy = ?, reviewedAt = ?,
       reviewComment = ?, proposedAt = ?, proposedBy = ? WHERE id = ?`
    ).run(
      merged.packageGroupId, merged.packageName, merged.packageAuthor,
      merged.publishedBy, merged.publishedByGhii, merged.title, merged.description,
      JSON.stringify(merged.screenshots), merged.category, JSON.stringify(merged.tags),
      merged.featured ? 1 : 0, merged.installCount, merged.rating, merged.reviewCount,
      merged.status, merged.updatedAt, merged.rejectionReason ?? null,
      merged.reviewedBy ?? null, merged.reviewedAt ?? null, merged.reviewComment ?? null,
      merged.proposedAt ?? null, merged.proposedBy ?? null, id,
    );
    return merged;
  },

  async deleteTemplateListing(this: SqliteStorage, id: string): Promise<boolean> {
    this.db.prepare('DELETE FROM template_reviews WHERE listingId = ?').run(id);
    this.db.prepare('DELETE FROM template_discussions WHERE listingId = ?').run(id);
    const result = this.db.prepare('DELETE FROM template_listings WHERE id = ?').run(id);
    return result.changes > 0;
  },

  async incrementInstallCount(this: SqliteStorage, listingId: string): Promise<void> {
    this.db.prepare('UPDATE template_listings SET installCount = installCount + 1 WHERE id = ?').run(listingId);
  },

  async listPendingTemplates(this: SqliteStorage, limit = 20, offset = 0): Promise<TemplateListingRecord[]> {
    const rows = this.db.prepare(
      'SELECT * FROM template_listings WHERE status = ? ORDER BY createdAt ASC LIMIT ? OFFSET ?'
    ).all('pending_review', limit, offset) as Record<string, unknown>[];
    return rows.map(r => this.deserializeTemplateListing(r));
  },

  async addReview(this: SqliteStorage, review: TemplateReview): Promise<TemplateReview> {
    this.db.prepare(
      `INSERT OR REPLACE INTO template_reviews (id, listingId, authorGhii, authorName, rating, comment, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      review.id, review.listingId, review.authorGhii, review.authorName,
      review.rating, review.comment, review.createdAt,
    );
    await this.recalculateRating(review.listingId);
    return review;
  },

  async getReviewsByListing(this: SqliteStorage, listingId: string, limit?: number, offset?: number): Promise<{ reviews: TemplateReview[]; total: number }> {
    const lim = limit ?? 50;
    const off = offset ?? 0;
    const total = (this.db.prepare('SELECT COUNT(*) as c FROM template_reviews WHERE listingId = ?').get(listingId) as { c: number }).c;
    const rows = this.db.prepare(
      'SELECT * FROM template_reviews WHERE listingId = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?'
    ).all(listingId, lim, off) as Record<string, unknown>[];
    return { reviews: rows.map(r => this.deserializeReview(r)), total };
  },

  async getReviewByAuthor(this: SqliteStorage, listingId: string, authorGhii: string): Promise<TemplateReview | null> {
    const row = this.db.prepare(
      'SELECT * FROM template_reviews WHERE listingId = ? AND authorGhii = ?'
    ).get(listingId, authorGhii) as Record<string, unknown> | undefined;
    return row ? this.deserializeReview(row) : null;
  },

  async updateReview(this: SqliteStorage, id: string, updates: Partial<TemplateReview>): Promise<TemplateReview | null> {
    const row = this.db.prepare('SELECT * FROM template_reviews WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    const existing = this.deserializeReview(row);
    const merged = { ...existing, ...updates, id };
    this.db.prepare(
      'UPDATE template_reviews SET rating = ?, comment = ? WHERE id = ?'
    ).run(merged.rating, merged.comment, id);
    await this.recalculateRating(merged.listingId);
    return merged;
  },

  async deleteReview(this: SqliteStorage, id: string): Promise<boolean> {
    const row = this.db.prepare('SELECT * FROM template_reviews WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return false;
    const listingId = row.listingId as string;
    const result = this.db.prepare('DELETE FROM template_reviews WHERE id = ?').run(id);
    if (result.changes > 0) {
      await this.recalculateRating(listingId);
      return true;
    }
    return false;
  },

  async recalculateRating(this: SqliteStorage, listingId: string): Promise<{ rating: number; reviewCount: number }> {
    const stats = this.db.prepare(
      'SELECT AVG(rating) as avg, COUNT(*) as cnt FROM template_reviews WHERE listingId = ?'
    ).get(listingId) as { avg: number | null; cnt: number };
    const rating = stats.avg ?? 0;
    const reviewCount = stats.cnt;
    this.db.prepare(
      'UPDATE template_listings SET rating = ?, reviewCount = ? WHERE id = ?'
    ).run(rating, reviewCount, listingId);
    return { rating, reviewCount };
  },

  async addDiscussion(this: SqliteStorage, discussion: TemplateDiscussion): Promise<TemplateDiscussion> {
    this.db.prepare(
      `INSERT INTO template_discussions (id, listingId, authorGhii, authorName, message, parentId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      discussion.id, discussion.listingId, discussion.authorGhii, discussion.authorName,
      discussion.message, discussion.parentId ?? null, discussion.createdAt,
    );
    return discussion;
  },

  async getDiscussionsByListing(this: SqliteStorage, listingId: string, limit?: number, offset?: number): Promise<{ discussions: TemplateDiscussion[]; total: number }> {
    const lim = limit ?? 50;
    const off = offset ?? 0;
    const total = (this.db.prepare('SELECT COUNT(*) as c FROM template_discussions WHERE listingId = ?').get(listingId) as { c: number }).c;
    const rows = this.db.prepare(
      'SELECT * FROM template_discussions WHERE listingId = ? ORDER BY createdAt ASC LIMIT ? OFFSET ?'
    ).all(listingId, lim, off) as Record<string, unknown>[];
    return { discussions: rows.map(r => this.deserializeDiscussion(r)), total };
  },

  async deleteDiscussion(this: SqliteStorage, id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM template_discussions WHERE id = ?').run(id);
    return result.changes > 0;
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
      installedAt: row.installedAt as string,
      updatedAt: row.updatedAt as string,
    };
  },

  async createInstance(this: SqliteStorage, record: PackageInstanceRecord): Promise<PackageInstanceRecord> {
    this.db.prepare(
      `INSERT INTO package_instances (id, packageGroupId, packageVersion, packageRecordId, owner, ownerGhii, label, installedComponents, status, installedAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.packageGroupId, record.packageVersion, record.packageRecordId,
      record.owner, record.ownerGhii, record.label,
      JSON.stringify(record.installedComponents), record.status,
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
       owner = ?, ownerGhii = ?, label = ?, installedComponents = ?, status = ?, updatedAt = ?
       WHERE id = ?`
    ).run(
      merged.packageGroupId, merged.packageVersion, merged.packageRecordId,
      merged.owner, merged.ownerGhii, merged.label,
      JSON.stringify(merged.installedComponents), merged.status, merged.updatedAt, id,
    );
    return merged;
  },

  async deleteInstance(this: SqliteStorage, id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM package_instances WHERE id = ?').run(id);
    return result.changes > 0;
  },

  async listInstancesByPackage(this: SqliteStorage, packageGroupId: string): Promise<{ instances: PackageInstanceRecord[]; total: number }> {
    const total = (this.db.prepare('SELECT COUNT(*) as c FROM package_instances WHERE packageGroupId = ?').get(packageGroupId) as { c: number }).c;
    const rows = this.db.prepare(
      'SELECT * FROM package_instances WHERE packageGroupId = ? ORDER BY installedAt DESC'
    ).all(packageGroupId) as Record<string, unknown>[];
    return { instances: rows.map(r => this.deserializeInstance(r)), total };
  },

};
