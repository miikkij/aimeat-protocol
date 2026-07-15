/**
 * @file src/storage/providers/postgres-kysely/methods/template-listings.ts
 * @description Template-listing domain for the Postgres+Kysely backend (TemplateListing / TemplateReview /
 *   TemplateDiscussion): the social/discovery layer over package groups. Listing CRUD with
 *   category/featured/status/tag filtering + sort + pagination, install-count bump, moderation queue,
 *   reviews (upsert keyed by the unique (listingId, authorGhii) + denormalized rating recompute), and
 *   threaded discussions. Translated 1:1 from the Prisma (Mongo/PG) implementation — all columns are
 *   scalar or text[] (no JSONB), so mapping is direct; rating recompute aggregates avg + count in-DB.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: template-listing layer on Postgres+Kysely.
 */
import { sql } from 'kysely';
import type { Selectable } from 'kysely';
import type { TemplateListingRecord, TemplateReview, TemplateDiscussion, TemplateFilter } from '../../../interface.js';
import type { TemplateListing, TemplateReview as TemplateReviewRow, TemplateDiscussion as TemplateDiscussionRow } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();

function toTemplateListing(r: Selectable<TemplateListing>): TemplateListingRecord {
  return {
    id: r.id,
    packageGroupId: r.packageGroupId,
    packageName: r.packageName,
    packageAuthor: r.packageAuthor,
    publishedBy: r.publishedBy,
    publishedByGhii: r.publishedByGhii,
    title: r.title,
    description: r.description ?? '',
    screenshots: r.screenshots ?? [],
    category: r.category ?? 'other',
    tags: r.tags ?? [],
    featured: r.featured ?? false,
    installCount: r.installCount ?? 0,
    rating: r.rating ?? 0,
    reviewCount: r.reviewCount ?? 0,
    status: (r.status ?? 'listed') as TemplateListingRecord['status'],
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
    ...(r.rejectionReason ? { rejectionReason: r.rejectionReason } : {}),
    ...(r.reviewedBy ? { reviewedBy: r.reviewedBy } : {}),
    ...(r.reviewedAt ? { reviewedAt: iso(r.reviewedAt) } : {}),
    ...(r.reviewComment ? { reviewComment: r.reviewComment } : {}),
    ...(r.proposedAt ? { proposedAt: iso(r.proposedAt) } : {}),
    ...(r.proposedBy ? { proposedBy: r.proposedBy } : {}),
  };
}

function toTemplateReview(r: Selectable<TemplateReviewRow>): TemplateReview {
  return {
    id: r.id,
    listingId: r.listingId,
    authorGhii: r.authorGhii,
    authorName: r.authorName,
    rating: r.rating,
    comment: r.comment ?? '',
    createdAt: iso(r.createdAt),
  };
}

function toTemplateDiscussion(r: Selectable<TemplateDiscussionRow>): TemplateDiscussion {
  return {
    id: r.id,
    listingId: r.listingId,
    authorGhii: r.authorGhii,
    authorName: r.authorName,
    message: r.message,
    parentId: r.parentId ?? undefined,
    createdAt: iso(r.createdAt),
  };
}

export const templateListingMethods = {
  // ── Listings ──

  async createTemplateListing(this: PostgresKyselyStorage, record: TemplateListingRecord): Promise<TemplateListingRecord> {
    const row = await this.db.insertInto('TemplateListing').values({
      packageGroupId: record.packageGroupId,
      packageName: record.packageName,
      packageAuthor: record.packageAuthor,
      publishedBy: record.publishedBy,
      publishedByGhii: record.publishedByGhii,
      title: record.title,
      description: record.description,
      screenshots: record.screenshots ?? [],
      category: record.category,
      tags: record.tags ?? [],
      featured: record.featured,
      installCount: record.installCount,
      rating: record.rating,
      reviewCount: record.reviewCount,
      status: record.status,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
      rejectionReason: record.rejectionReason ?? null,
      reviewedBy: record.reviewedBy ?? null,
      reviewedAt: record.reviewedAt ? new Date(record.reviewedAt) : null,
      reviewComment: record.reviewComment ?? null,
      proposedAt: record.proposedAt ? new Date(record.proposedAt) : null,
      proposedBy: record.proposedBy ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).returningAll().executeTakeFirstOrThrow();
    return toTemplateListing(row);
  },

  async getTemplateListing(this: PostgresKyselyStorage, id: string): Promise<TemplateListingRecord | null> {
    const r = await this.db.selectFrom('TemplateListing').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toTemplateListing(r) : null;
  },

  async getListingByPackage(this: PostgresKyselyStorage, packageGroupId: string): Promise<TemplateListingRecord | null> {
    const r = await this.db.selectFrom('TemplateListing').selectAll().where('packageGroupId', '=', packageGroupId).executeTakeFirst();
    return r ? toTemplateListing(r) : null;
  },

  async listTemplateListings(this: PostgresKyselyStorage, filter: TemplateFilter): Promise<{ listings: TemplateListingRecord[]; total: number }> {
    let base = this.db.selectFrom('TemplateListing');
    if (filter.category) base = base.where('category', '=', filter.category);
    if (filter.status) base = base.where('status', '=', filter.status);
    if (filter.featured !== undefined) base = base.where('featured', '=', filter.featured);
    if (filter.tags && filter.tags.length > 0) base = base.where(sql<boolean>`"tags" && ${sql.val(filter.tags)}`); // array-overlap (hasSome)
    if (filter.search) base = base.where(eb => eb.or([eb('title', 'ilike', `%${filter.search}%`), eb('description', 'ilike', `%${filter.search}%`)]));

    const sortCol = filter.sort === 'rating' ? 'rating' : filter.sort === 'installs' ? 'installCount' : 'createdAt';
    const rows = await base.selectAll().orderBy(sortCol, 'desc').limit(filter.limit ?? 50).offset(filter.offset ?? 0).execute();
    const totalRow = await base.select(this.db.fn.countAll<number>().as('n')).executeTakeFirst();
    return { listings: rows.map(toTemplateListing), total: Number(totalRow?.n ?? 0) };
  },

  async updateTemplateListing(this: PostgresKyselyStorage, id: string, updates: Partial<TemplateListingRecord>): Promise<TemplateListingRecord | null> {
    const data: Record<string, unknown> = {};
    if (updates.title !== undefined) data.title = updates.title;
    if (updates.description !== undefined) data.description = updates.description;
    if (updates.screenshots !== undefined) data.screenshots = updates.screenshots;
    if (updates.category !== undefined) data.category = updates.category;
    if (updates.tags !== undefined) data.tags = updates.tags;
    if (updates.featured !== undefined) data.featured = updates.featured;
    if (updates.status !== undefined) data.status = updates.status;
    if (updates.rejectionReason !== undefined) data.rejectionReason = updates.rejectionReason;
    if (updates.reviewedBy !== undefined) data.reviewedBy = updates.reviewedBy;
    if (updates.reviewedAt !== undefined) data.reviewedAt = new Date(updates.reviewedAt);
    if (updates.reviewComment !== undefined) data.reviewComment = updates.reviewComment;
    if (updates.proposedAt !== undefined) data.proposedAt = new Date(updates.proposedAt);
    if (updates.proposedBy !== undefined) data.proposedBy = updates.proposedBy;
    data.updatedAt = new Date();
    try {
      const rows = await this.db.updateTable('TemplateListing').set(data as never).where('id', '=', id).returningAll().execute();
      return rows[0] ? toTemplateListing(rows[0]) : null;
    } catch { return null; }
  },

  async deleteTemplateListing(this: PostgresKyselyStorage, id: string): Promise<boolean> {
    try {
      await this.db.deleteFrom('TemplateReview').where('listingId', '=', id).execute();
      await this.db.deleteFrom('TemplateDiscussion').where('listingId', '=', id).execute();
      const r = await this.db.deleteFrom('TemplateListing').where('id', '=', id).executeTakeFirst();
      return Number(r.numDeletedRows ?? 0) > 0;
    } catch { return false; }
  },

  async incrementInstallCount(this: PostgresKyselyStorage, listingId: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.db.updateTable('TemplateListing').set({ installCount: sql`"TemplateListing"."installCount" + 1` } as any).where('id', '=', listingId).execute();
  },

  async listPendingTemplates(this: PostgresKyselyStorage, limit = 20, offset = 0): Promise<TemplateListingRecord[]> {
    const rows = await this.db.selectFrom('TemplateListing').selectAll()
      .where('status', '=', 'pending_review').orderBy('createdAt', 'asc').limit(limit).offset(offset).execute();
    return rows.map(toTemplateListing);
  },

  // ── Reviews ──

  async addReview(this: PostgresKyselyStorage, review: TemplateReview): Promise<TemplateReview> {
    const row = await this.db.insertInto('TemplateReview').values({
      listingId: review.listingId,
      authorGhii: review.authorGhii,
      authorName: review.authorName,
      rating: review.rating,
      comment: review.comment,
      createdAt: new Date(review.createdAt),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).onConflict(oc => oc.columns(['listingId', 'authorGhii']).doUpdateSet({
      authorName: review.authorName,
      rating: review.rating,
      comment: review.comment,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)).returningAll().executeTakeFirstOrThrow();
    await templateListingMethods.recalculateRating.call(this, review.listingId);
    return toTemplateReview(row);
  },

  async getReviewsByListing(this: PostgresKyselyStorage, listingId: string, limit?: number, offset?: number): Promise<{ reviews: TemplateReview[]; total: number }> {
    const base = this.db.selectFrom('TemplateReview').where('listingId', '=', listingId);
    const rows = await base.selectAll().orderBy('createdAt', 'desc').limit(limit ?? 50).offset(offset ?? 0).execute();
    const totalRow = await base.select(this.db.fn.countAll<number>().as('n')).executeTakeFirst();
    return { reviews: rows.map(toTemplateReview), total: Number(totalRow?.n ?? 0) };
  },

  async getReviewByAuthor(this: PostgresKyselyStorage, listingId: string, authorGhii: string): Promise<TemplateReview | null> {
    const r = await this.db.selectFrom('TemplateReview').selectAll()
      .where('listingId', '=', listingId).where('authorGhii', '=', authorGhii).executeTakeFirst();
    return r ? toTemplateReview(r) : null;
  },

  async updateReview(this: PostgresKyselyStorage, id: string, updates: Partial<TemplateReview>): Promise<TemplateReview | null> {
    const data: Record<string, unknown> = {};
    if (updates.rating !== undefined) data.rating = updates.rating;
    if (updates.comment !== undefined) data.comment = updates.comment;
    if (updates.authorName !== undefined) data.authorName = updates.authorName;
    try {
      const rows = await this.db.updateTable('TemplateReview').set(data as never).where('id', '=', id).returningAll().execute();
      if (!rows[0]) return null;
      await templateListingMethods.recalculateRating.call(this, rows[0].listingId);
      return toTemplateReview(rows[0]);
    } catch { return null; }
  },

  async deleteReview(this: PostgresKyselyStorage, id: string): Promise<boolean> {
    try {
      const row = await this.db.selectFrom('TemplateReview').select('listingId').where('id', '=', id).executeTakeFirst();
      if (!row) return false;
      await this.db.deleteFrom('TemplateReview').where('id', '=', id).execute();
      await templateListingMethods.recalculateRating.call(this, row.listingId);
      return true;
    } catch { return false; }
  },

  async recalculateRating(this: PostgresKyselyStorage, listingId: string): Promise<{ rating: number; reviewCount: number }> {
    const agg = await this.db.selectFrom('TemplateReview').where('listingId', '=', listingId)
      .select([this.db.fn.avg<number>('rating').as('avg'), this.db.fn.count<number>('rating').as('cnt')])
      .executeTakeFirst();
    const rating = Math.round((Number(agg?.avg ?? 0)) * 10) / 10;
    const reviewCount = Number(agg?.cnt ?? 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.db.updateTable('TemplateListing').set({ rating, reviewCount } as any).where('id', '=', listingId).execute();
    return { rating, reviewCount };
  },

  // ── Discussions ──

  async addDiscussion(this: PostgresKyselyStorage, discussion: TemplateDiscussion): Promise<TemplateDiscussion> {
    const row = await this.db.insertInto('TemplateDiscussion').values({
      listingId: discussion.listingId,
      authorGhii: discussion.authorGhii,
      authorName: discussion.authorName,
      message: discussion.message,
      parentId: discussion.parentId ?? null,
      createdAt: new Date(discussion.createdAt),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).returningAll().executeTakeFirstOrThrow();
    return toTemplateDiscussion(row);
  },

  async getDiscussionsByListing(this: PostgresKyselyStorage, listingId: string, limit?: number, offset?: number): Promise<{ discussions: TemplateDiscussion[]; total: number }> {
    const base = this.db.selectFrom('TemplateDiscussion').where('listingId', '=', listingId);
    const rows = await base.selectAll().orderBy('createdAt', 'asc').limit(limit ?? 50).offset(offset ?? 0).execute();
    const totalRow = await base.select(this.db.fn.countAll<number>().as('n')).executeTakeFirst();
    return { discussions: rows.map(toTemplateDiscussion), total: Number(totalRow?.n ?? 0) };
  },

  async deleteDiscussion(this: PostgresKyselyStorage, id: string): Promise<boolean> {
    try {
      const r = await this.db.deleteFrom('TemplateDiscussion').where('id', '=', id).executeTakeFirst();
      return Number(r.numDeletedRows ?? 0) > 0;
    } catch { return false; }
  },
};
