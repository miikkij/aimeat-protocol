/**
 * @file src/storage/providers/postgres-kysely/methods/app-purchases.ts
 * @description App-marketplace purchases (AppPurchase table) for the Postgres+Kysely backend: the signed
 *   purchase receipt a buyer holds for a paid app, plus the license-validity check the fork/download gate
 *   uses. Translated 1:1 from the SQLite/Prisma implementations — appManifest is a jsonb column.
 * @version-history
 *   v1.0.0 — 2026-07-16 — Phase 5: app-marketplace purchases on Postgres+Kysely.
 */
import type { Selectable } from 'kysely';
import type { AppPurchaseRecord } from '../../../interface.js';
import type { AppPurchase } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();

function toPurchase(r: Selectable<AppPurchase>): AppPurchaseRecord {
  return {
    transactionId: r.transactionId, buyerGaii: r.buyerGaii, buyerOwner: r.buyerOwner,
    sellerGaii: r.sellerGaii, sellerOwner: r.sellerOwner, appFilename: r.appFilename, appName: r.appName,
    appVersionNumber: r.appVersionNumber, licenseType: r.licenseType as AppPurchaseRecord['licenseType'],
    priceMorsels: r.priceMorsels, transactionFeeMorsels: r.transactionFeeMorsels, purchasedAt: iso(r.purchasedAt),
    appContent: r.appContent, appManifest: (r.appManifest ?? {}) as unknown as AppPurchaseRecord['appManifest'],
    appScreenshot: r.appScreenshot ?? undefined, signature: r.signature, nodeId: r.nodeId, nodePublicKey: r.nodePublicKey,
  };
}

export const appPurchaseMethods = {
  async createAppPurchase(this: PostgresKyselyStorage, record: AppPurchaseRecord): Promise<AppPurchaseRecord> {
    await this.db.insertInto('AppPurchase').values({
      transactionId: record.transactionId, buyerGaii: record.buyerGaii, buyerOwner: record.buyerOwner,
      sellerGaii: record.sellerGaii, sellerOwner: record.sellerOwner, appFilename: record.appFilename, appName: record.appName,
      appVersionNumber: record.appVersionNumber, licenseType: record.licenseType, priceMorsels: record.priceMorsels,
      transactionFeeMorsels: record.transactionFeeMorsels, purchasedAt: new Date(record.purchasedAt),
      appContent: record.appContent, appManifest: jsonb(record.appManifest ?? {}), appScreenshot: record.appScreenshot ?? null,
      signature: record.signature, nodeId: record.nodeId, nodePublicKey: record.nodePublicKey,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
    return record;
  },
  async getAppPurchase(this: PostgresKyselyStorage, transactionId: string): Promise<AppPurchaseRecord | null> {
    const r = await this.db.selectFrom('AppPurchase').selectAll().where('transactionId', '=', transactionId).executeTakeFirst();
    return r ? toPurchase(r) : null;
  },
  async listAppPurchasesByBuyer(this: PostgresKyselyStorage, buyerGaii: string): Promise<AppPurchaseRecord[]> {
    return (await this.db.selectFrom('AppPurchase').selectAll().where('buyerGaii', '=', buyerGaii).orderBy('purchasedAt', 'desc').execute()).map(toPurchase);
  },
  async listAppPurchasesBySeller(this: PostgresKyselyStorage, sellerGaii: string): Promise<AppPurchaseRecord[]> {
    return (await this.db.selectFrom('AppPurchase').selectAll().where('sellerGaii', '=', sellerGaii).orderBy('purchasedAt', 'desc').execute()).map(toPurchase);
  },
  async hasValidLicense(this: PostgresKyselyStorage, buyerGaii: string, sellerGaii: string, filename: string, licenseType?: 'single' | 'lifetime'): Promise<boolean> {
    // Lifetime license: any lifetime purchase of this app grants access to all versions.
    const lifetime = await this.db.selectFrom('AppPurchase').select('transactionId')
      .where('buyerGaii', '=', buyerGaii).where('sellerGaii', '=', sellerGaii).where('appFilename', '=', filename)
      .where('licenseType', '=', 'lifetime').limit(1).executeTakeFirst();
    if (lifetime) return true;
    // Single license: at least one purchase of this app (version-specific check happens at download).
    if (!licenseType || licenseType === 'single') {
      const single = await this.db.selectFrom('AppPurchase').select('transactionId')
        .where('buyerGaii', '=', buyerGaii).where('sellerGaii', '=', sellerGaii).where('appFilename', '=', filename)
        .limit(1).executeTakeFirst();
      return !!single;
    }
    return false;
  },
};
