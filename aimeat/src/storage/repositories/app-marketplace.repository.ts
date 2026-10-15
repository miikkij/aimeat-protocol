/**
 * @file src/storage/repositories/app-marketplace.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage-interface contract for the app marketplace: records and queries app-purchase
 *   transactions and checks whether a buyer holds a valid (single/lifetime) license for a seller's app.
 *
 * @structure
 *   - AppMarketplaceRepository: interface implemented per backend (SQLite/Prisma)
 *   - createAppPurchase / getAppPurchase / listAppPurchasesByBuyer|BySeller: purchase persistence + lookup
 *   - hasValidLicense(): license validity check for a buyer/seller/filename pair
 *
 * @version-history
 *   2026-10-15 — hasValidLicense takes the version being served: a single licence covers it only when bought at that version or later (feature-list audit #110).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { AppPurchaseRecord } from '../interface.js';

export interface AppMarketplaceRepository {
    createAppPurchase(record: AppPurchaseRecord): Promise<AppPurchaseRecord>;
    getAppPurchase(transactionId: string): Promise<AppPurchaseRecord | null>;
    listAppPurchasesByBuyer(buyerGaii: string): Promise<AppPurchaseRecord[]>;
    listAppPurchasesBySeller(sellerGaii: string): Promise<AppPurchaseRecord[]>;
    /** A lifetime licence covers every version. A single one, given versionNumber, covers that version only when bought at it or later. */
    hasValidLicense(buyerGaii: string, sellerGaii: string, filename: string, licenseType?: 'single' | 'lifetime', versionNumber?: number): Promise<boolean>;
}
