import type { AppPurchaseRecord } from '../interface.js';

export interface AppMarketplaceRepository {
    createAppPurchase(record: AppPurchaseRecord): Promise<AppPurchaseRecord>;
    getAppPurchase(transactionId: string): Promise<AppPurchaseRecord | null>;
    listAppPurchasesByBuyer(buyerGaii: string): Promise<AppPurchaseRecord[]>;
    listAppPurchasesBySeller(sellerGaii: string): Promise<AppPurchaseRecord[]>;
    hasValidLicense(buyerGaii: string, sellerGaii: string, filename: string, licenseType?: 'single' | 'lifetime'): Promise<boolean>;
}
