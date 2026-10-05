/**
 * @file src/storage/providers/sqlite/methods/template-listings.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/template-listings.ts
 *   (templateListingMethods), so a fix in one provider finds its twin by file name. Bodies moved verbatim
 *   from the files named in the version history; bound to SqliteStorage via the prototype merge in
 *   ../index.ts.
 * @structure templateListingMethods
 * @usage Object.assign(SqliteStorage.prototype, templateListingMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — 18 methods (deserializeTemplateListing, deserializeReview, deserializeDiscussion,
 *     …) moved here from packages.ts so the file mirrors postgres-kysely/methods/template-listings.ts
 *     (secaudit 2026-10, M8).
 */
import type {
  TemplateListingRecord, TemplateReview, TemplateDiscussion, TemplateFilter,
} from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

export const templateListingMethods = {

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
};
