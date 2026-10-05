/**
 * @file src/storage/providers/sqlite/methods/app-purchases.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/app-purchases.ts
 *   (appPurchaseMethods), so a fix in one provider finds its twin by file name. Bodies moved verbatim from
 *   the files named in the version history; bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure appPurchaseMethods
 * @usage Object.assign(SqliteStorage.prototype, appPurchaseMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — createAppPurchase, getAppPurchase, listAppPurchasesByBuyer,
 *     listAppPurchasesBySeller, hasValidLicense, deserializeAppPurchase moved here from apps.ts so the file
 *     mirrors postgres-kysely/methods/app-purchases.ts (secaudit 2026-10, M8).
 */
import type { AppPurchaseRecord } from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

export const appPurchaseMethods = {

  // ── App Marketplace (purchase receipts) ──

  async createAppPurchase(this: SqliteStorage, record: AppPurchaseRecord): Promise<AppPurchaseRecord> {
    this.db.prepare(`INSERT INTO app_purchases (transactionId, buyerGaii, buyerOwner, sellerGaii, sellerOwner, appFilename, appName, appVersionNumber, licenseType, priceMorsels, transactionFeeMorsels, purchasedAt, appContent, appManifest, appScreenshot, signature, nodeId, nodePublicKey) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      record.transactionId, record.buyerGaii, record.buyerOwner,
      record.sellerGaii, record.sellerOwner, record.appFilename,
      record.appName, record.appVersionNumber, record.licenseType,
      record.priceMorsels, record.transactionFeeMorsels, record.purchasedAt,
      record.appContent, JSON.stringify(record.appManifest),
      record.appScreenshot ?? null, record.signature,
      record.nodeId, record.nodePublicKey,
    );
    return record;
  },

  async getAppPurchase(this: SqliteStorage, transactionId: string): Promise<AppPurchaseRecord | null> {
    const row = this.db.prepare('SELECT * FROM app_purchases WHERE transactionId = ?').get(transactionId) as Record<string, unknown> | undefined;
    return row ? this.deserializeAppPurchase(row) : null;
  },

  async listAppPurchasesByBuyer(this: SqliteStorage, buyerGaii: string): Promise<AppPurchaseRecord[]> {
    const rows = this.db.prepare('SELECT * FROM app_purchases WHERE buyerGaii = ? ORDER BY purchasedAt DESC').all(buyerGaii) as Record<string, unknown>[];
    return rows.map(r => this.deserializeAppPurchase(r));
  },

  async listAppPurchasesBySeller(this: SqliteStorage, sellerGaii: string): Promise<AppPurchaseRecord[]> {
    const rows = this.db.prepare('SELECT * FROM app_purchases WHERE sellerGaii = ? ORDER BY purchasedAt DESC').all(sellerGaii) as Record<string, unknown>[];
    return rows.map(r => this.deserializeAppPurchase(r));
  },

  async hasValidLicense(this: SqliteStorage, buyerGaii: string, sellerGaii: string, filename: string, licenseType?: 'single' | 'lifetime'): Promise<boolean> {
    // Lifetime license: any purchase of this app grants access to all versions
    const lifetime = this.db.prepare('SELECT 1 FROM app_purchases WHERE buyerGaii = ? AND sellerGaii = ? AND appFilename = ? AND licenseType = ? LIMIT 1').get(buyerGaii, sellerGaii, filename, 'lifetime') as Record<string, unknown> | undefined;
    if (lifetime) return true;
    // Single license: buyer has at least one purchase of this app (version-specific check done at download)
    if (!licenseType || licenseType === 'single') {
      const single = this.db.prepare('SELECT 1 FROM app_purchases WHERE buyerGaii = ? AND sellerGaii = ? AND appFilename = ? LIMIT 1').get(buyerGaii, sellerGaii, filename) as Record<string, unknown> | undefined;
      return !!single;
    }
    return false;
  },

  deserializeAppPurchase(this: SqliteStorage, row: Record<string, unknown>): AppPurchaseRecord {
    const record: AppPurchaseRecord = {
      transactionId: row.transactionId as string,
      buyerGaii: row.buyerGaii as string,
      buyerOwner: row.buyerOwner as string,
      sellerGaii: row.sellerGaii as string,
      sellerOwner: row.sellerOwner as string,
      appFilename: row.appFilename as string,
      appName: row.appName as string,
      appVersionNumber: row.appVersionNumber as number,
      licenseType: row.licenseType as 'single' | 'lifetime',
      priceMorsels: row.priceMorsels as number,
      transactionFeeMorsels: row.transactionFeeMorsels as number,
      purchasedAt: row.purchasedAt as string,
      appContent: row.appContent as string,
      appManifest: JSON.parse((row.appManifest as string) || '{}'),
      signature: row.signature as string,
      nodeId: row.nodeId as string,
      nodePublicKey: row.nodePublicKey as string,
    };
    if (row.appScreenshot) record.appScreenshot = row.appScreenshot as string;
    return record;
  },
};
