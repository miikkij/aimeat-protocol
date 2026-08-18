/**
 * @file src/storage/providers/postgres-kysely/methods/marketplace.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Marketplace domain for the Postgres+Kysely backend (Listing / Purchase). Listing CRUD +
 *   filtered/paginated list, and purchase create/get/update with buyer/seller lookups. Translated 1:1
 *   from the Prisma implementation: category/status/sellerOwner + price-range filters happen in-DB,
 *   city (a JSON sub-field) is filtered post-query, then the page slice is applied.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: marketplace on Postgres+Kysely.
 */
import type { Selectable } from 'kysely';
import type { ListingRecord, PurchaseRecord } from '../../../interface.js';
import type { Listing, Purchase } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb, dbError } from '../helpers.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();
const isoOpt = (t: Date | string | null | undefined): string | undefined => (t == null ? undefined : iso(t));

function toListing(r: Selectable<Listing>): ListingRecord {
  return {
    id: r.id, ownerName: r.ownerName, sellerGhii: r.sellerGhii, title: r.title, description: r.description,
    category: r.category as ListingRecord['category'], priceMorsels: r.priceMorsels,
    condition: (r.condition ?? undefined) as ListingRecord['condition'], availability: (r.availability ?? undefined) as ListingRecord['availability'],
    location: (r.location ?? undefined) as ListingRecord['location'], tags: r.tags ?? undefined, images: r.images ?? undefined,
    status: r.status as ListingRecord['status'], memoryKey: r.memoryKey, flagCount: r.flagCount,
    createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt), semantic: (r.semantic ?? undefined) as ListingRecord['semantic'],
  };
}
function toPurchase(r: Selectable<Purchase>): PurchaseRecord {
  return {
    id: r.id, listingId: r.listingId, buyerOwner: r.buyerOwner, sellerOwner: r.sellerOwner, priceMorsels: r.priceMorsels,
    transactionFeeMorsels: r.transactionFeeMorsels, totalCostMorsels: r.totalCostMorsels, status: r.status as PurchaseRecord['status'],
    rating: r.ratingScore != null ? { score: r.ratingScore, comment: r.ratingComment ?? undefined } : undefined,
    trackingCode: r.trackingCode, createdAt: iso(r.createdAt), completedAt: isoOpt(r.completedAt),
  };
}

export const marketplaceMethods = {
  async createListing(this: PostgresKyselyStorage, r: ListingRecord): Promise<ListingRecord> {
    await this.db.insertInto('Listing').values({
      id: r.id, ownerName: r.ownerName, sellerGhii: r.sellerGhii, title: r.title, description: r.description, category: r.category,
      priceMorsels: r.priceMorsels, condition: r.condition ?? null, availability: r.availability ?? null,
      location: jsonb(r.location ?? null), tags: r.tags ?? [], images: r.images ?? [], status: r.status, memoryKey: r.memoryKey,
      flagCount: r.flagCount, createdAt: new Date(r.createdAt), updatedAt: new Date(r.updatedAt ?? r.createdAt), semantic: jsonb(r.semantic ?? null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
    return r;
  },
  async getListing(this: PostgresKyselyStorage, id: string): Promise<ListingRecord | null> {
    const r = await this.db.selectFrom('Listing').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toListing(r) : null;
  },
  async listListings(this: PostgresKyselyStorage, opts?: { category?: string; city?: string; minPrice?: number; maxPrice?: number; status?: string; sellerOwner?: string; page?: number; perPage?: number }): Promise<ListingRecord[]> {
    const page = opts?.page ?? 1, perPage = opts?.perPage ?? 20;
    let q = this.db.selectFrom('Listing').selectAll();
    if (opts?.category) q = q.where('category', '=', opts.category);
    if (opts?.status) q = q.where('status', '=', opts.status);
    if (opts?.sellerOwner) q = q.where('ownerName', '=', opts.sellerOwner);
    if (opts?.minPrice !== undefined) q = q.where('priceMorsels', '>=', opts.minPrice);
    if (opts?.maxPrice !== undefined) q = q.where('priceMorsels', '<=', opts.maxPrice);
    let results = (await q.orderBy('createdAt', 'desc').execute()).map(toListing);
    if (opts?.city) results = results.filter(l => l.location?.city?.toLowerCase() === opts.city!.toLowerCase());
    const start = (page - 1) * perPage;
    return results.slice(start, start + perPage);
  },
  async updateListing(this: PostgresKyselyStorage, id: string, updates: Partial<ListingRecord>): Promise<ListingRecord | null> {
    try {
      const data: Record<string, unknown> = { ...updates };
      delete data.id;
      if ('location' in data) data.location = jsonb(data.location ?? null);
      if ('semantic' in data) data.semantic = jsonb(data.semantic ?? null);
      if (typeof data.createdAt === 'string') data.createdAt = new Date(data.createdAt);
      if (typeof data.updatedAt === 'string') data.updatedAt = new Date(data.updatedAt);
      const rows = await this.db.updateTable('Listing').set(data as never).where('id', '=', id).returningAll().execute();
      return rows[0] ? toListing(rows[0]) : null;
    } catch (err) { throw dbError('updateListing', err); }
  },
  async deleteListing(this: PostgresKyselyStorage, id: string): Promise<boolean> {
    const r = await this.db.deleteFrom('Listing').where('id', '=', id).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  async createPurchase(this: PostgresKyselyStorage, r: PurchaseRecord): Promise<PurchaseRecord> {
    await this.db.insertInto('Purchase').values({
      id: r.id, listingId: r.listingId, buyerOwner: r.buyerOwner, sellerOwner: r.sellerOwner, priceMorsels: r.priceMorsels,
      transactionFeeMorsels: r.transactionFeeMorsels, totalCostMorsels: r.totalCostMorsels, status: r.status,
      ratingScore: r.rating?.score ?? null, ratingComment: r.rating?.comment ?? null, trackingCode: r.trackingCode,
      createdAt: new Date(r.createdAt), completedAt: r.completedAt ? new Date(r.completedAt) : null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
    return r;
  },
  async getPurchase(this: PostgresKyselyStorage, id: string): Promise<PurchaseRecord | null> {
    const r = await this.db.selectFrom('Purchase').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toPurchase(r) : null;
  },
  async listPurchasesByBuyer(this: PostgresKyselyStorage, buyerOwner: string): Promise<PurchaseRecord[]> {
    const rows = await this.db.selectFrom('Purchase').selectAll().where('buyerOwner', '=', buyerOwner).orderBy('createdAt', 'desc').execute();
    return rows.map(toPurchase);
  },
  async listPurchasesBySeller(this: PostgresKyselyStorage, sellerOwner: string): Promise<PurchaseRecord[]> {
    const rows = await this.db.selectFrom('Purchase').selectAll().where('sellerOwner', '=', sellerOwner).orderBy('createdAt', 'desc').execute();
    return rows.map(toPurchase);
  },
  async updatePurchase(this: PostgresKyselyStorage, id: string, updates: Partial<PurchaseRecord>): Promise<PurchaseRecord | null> {
    try {
      const data: Record<string, unknown> = {};
      if (updates.status) data.status = updates.status;
      if (updates.rating) { data.ratingScore = updates.rating.score; data.ratingComment = updates.rating.comment ?? null; }
      if (updates.completedAt) data.completedAt = new Date(updates.completedAt);
      if (Object.keys(data).length === 0) return this.getPurchase(id);
      const rows = await this.db.updateTable('Purchase').set(data as never).where('id', '=', id).returningAll().execute();
      return rows[0] ? toPurchase(rows[0]) : null;
    } catch (err) { throw dbError('updatePurchase', err); }
  },
};
