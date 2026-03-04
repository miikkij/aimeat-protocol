import type { ListingRecord, PurchaseRecord } from '../interface.js';

export interface MarketplaceRepository {
  createListing(record: ListingRecord): Promise<ListingRecord>;
  getListing(id: string): Promise<ListingRecord | null>;
  listListings(opts?: { category?: string; city?: string; minPrice?: number; maxPrice?: number; status?: string; sellerOwner?: string; page?: number; perPage?: number }): Promise<ListingRecord[]>;
  updateListing(id: string, updates: Partial<ListingRecord>): Promise<ListingRecord | null>;
  deleteListing(id: string): Promise<boolean>;
  createPurchase(record: PurchaseRecord): Promise<PurchaseRecord>;
  getPurchase(id: string): Promise<PurchaseRecord | null>;
  listPurchasesByBuyer(buyerOwner: string): Promise<PurchaseRecord[]>;
  listPurchasesBySeller(sellerOwner: string): Promise<PurchaseRecord[]>;
  updatePurchase(id: string, updates: Partial<PurchaseRecord>): Promise<PurchaseRecord | null>;
}
