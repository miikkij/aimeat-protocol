import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStorage } from '../../src/storage/memory.js';
import type { ListingRecord, PurchaseRecord } from '../../src/storage/interface.js';

// ── Helpers ──────────────────────────────────────────────────

function makeListing(overrides: Partial<ListingRecord> = {}): ListingRecord {
    return {
        id: `listing-${Math.random().toString(36).slice(2, 10)}`,
        ownerName: 'alice',
        sellerGhii: 'alice@test-node-001',
        title: 'Test Item',
        description: 'A test marketplace listing',
        category: 'tuotteet',
        priceMorsels: 50,
        condition: 'new',
        availability: 'immediate',
        location: { city: 'Helsinki', area: 'Uusimaa' },
        tags: ['test'],
        status: 'active',
        memoryKey: 'marketplace.alice.listing.test',
        flagCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides,
    };
}

function makePurchase(overrides: Partial<PurchaseRecord> = {}): PurchaseRecord {
    return {
        id: `purchase-${Math.random().toString(36).slice(2, 10)}`,
        listingId: 'listing-1',
        buyerOwner: 'bob',
        sellerOwner: 'alice',
        priceMorsels: 50,
        transactionFeeMorsels: 3,
        totalCostMorsels: 53,
        status: 'pending_delivery',
        trackingCode: `tc-${Math.random().toString(36).slice(2, 10)}`,
        createdAt: new Date().toISOString(),
        ...overrides,
    };
}

// ── Tests ────────────────────────────────────────────────────

describe('Marketplace — Listings (InMemoryStorage)', () => {
    let storage: InMemoryStorage;

    beforeEach(() => {
        storage = new InMemoryStorage();
    });

    it('creates listing and retrieves it', async () => {
        const listing = makeListing({ id: 'listing-1', title: 'TypeScript Book' });
        const created = await storage.createListing(listing);
        expect(created.id).toBe('listing-1');
        expect(created.title).toBe('TypeScript Book');

        const retrieved = await storage.getListing('listing-1');
        expect(retrieved).not.toBeNull();
        expect(retrieved!.title).toBe('TypeScript Book');
        expect(retrieved!.category).toBe('tuotteet');
    });

    it('returns null for non-existent listing', async () => {
        const result = await storage.getListing('nonexistent');
        expect(result).toBeNull();
    });

    it('lists listings filtered by category', async () => {
        await storage.createListing(makeListing({ id: 'l1', category: 'tuotteet' }));
        await storage.createListing(makeListing({ id: 'l2', category: 'palvelut' }));
        await storage.createListing(makeListing({ id: 'l3', category: 'tuotteet' }));

        const tuotteet = await storage.listListings({ category: 'tuotteet' });
        expect(tuotteet).toHaveLength(2);

        const palvelut = await storage.listListings({ category: 'palvelut' });
        expect(palvelut).toHaveLength(1);
    });

    it('lists listings filtered by city (case-insensitive)', async () => {
        await storage.createListing(makeListing({ id: 'l1', location: { city: 'Helsinki' } }));
        await storage.createListing(makeListing({ id: 'l2', location: { city: 'Tampere' } }));

        const results = await storage.listListings({ city: 'helsinki' });
        expect(results).toHaveLength(1);
        expect(results[0].id).toBe('l1');
    });

    it('lists listings filtered by price range', async () => {
        await storage.createListing(makeListing({ id: 'l1', priceMorsels: 10 }));
        await storage.createListing(makeListing({ id: 'l2', priceMorsels: 50 }));
        await storage.createListing(makeListing({ id: 'l3', priceMorsels: 100 }));
        await storage.createListing(makeListing({ id: 'l4', priceMorsels: 200 }));

        const range = await storage.listListings({ minPrice: 20, maxPrice: 100 });
        expect(range).toHaveLength(2);

        const cheapest = await storage.listListings({ maxPrice: 15 });
        expect(cheapest).toHaveLength(1);
        expect(cheapest[0].id).toBe('l1');
    });

    it('updates listing status', async () => {
        await storage.createListing(makeListing({ id: 'listing-1', status: 'active' }));

        const updated = await storage.updateListing('listing-1', {
            status: 'sold',
            updatedAt: new Date().toISOString(),
        });
        expect(updated).not.toBeNull();
        expect(updated!.status).toBe('sold');
        expect(updated!.id).toBe('listing-1'); // ID preserved

        const retrieved = await storage.getListing('listing-1');
        expect(retrieved!.status).toBe('sold');
    });

    it('returns null when updating non-existent listing', async () => {
        const result = await storage.updateListing('nonexistent', { status: 'sold' });
        expect(result).toBeNull();
    });

    it('deletes listing', async () => {
        await storage.createListing(makeListing({ id: 'listing-1' }));
        expect(await storage.getListing('listing-1')).not.toBeNull();

        const deleted = await storage.deleteListing('listing-1');
        expect(deleted).toBe(true);

        expect(await storage.getListing('listing-1')).toBeNull();

        // Double delete returns false
        const deletedAgain = await storage.deleteListing('listing-1');
        expect(deletedAgain).toBe(false);
    });

    it('lists listings filtered by status and seller', async () => {
        await storage.createListing(makeListing({ id: 'l1', ownerName: 'alice', status: 'active' }));
        await storage.createListing(makeListing({ id: 'l2', ownerName: 'alice', status: 'sold' }));
        await storage.createListing(makeListing({ id: 'l3', ownerName: 'bob', status: 'active' }));

        const aliceActive = await storage.listListings({ sellerOwner: 'alice', status: 'active' });
        expect(aliceActive).toHaveLength(1);
        expect(aliceActive[0].id).toBe('l1');

        const allActive = await storage.listListings({ status: 'active' });
        expect(allActive).toHaveLength(2);
    });
});

describe('Marketplace — Purchases (InMemoryStorage)', () => {
    let storage: InMemoryStorage;

    beforeEach(() => {
        storage = new InMemoryStorage();
    });

    it('creates purchase and retrieves it', async () => {
        const purchase = makePurchase({ id: 'purchase-1', listingId: 'listing-1' });
        const created = await storage.createPurchase(purchase);
        expect(created.id).toBe('purchase-1');
        expect(created.status).toBe('pending_delivery');

        const retrieved = await storage.getPurchase('purchase-1');
        expect(retrieved).not.toBeNull();
        expect(retrieved!.buyerOwner).toBe('bob');
        expect(retrieved!.sellerOwner).toBe('alice');
    });

    it('returns null for non-existent purchase', async () => {
        const result = await storage.getPurchase('nonexistent');
        expect(result).toBeNull();
    });

    it('lists purchases by buyer', async () => {
        await storage.createPurchase(makePurchase({ id: 'p1', buyerOwner: 'bob' }));
        await storage.createPurchase(makePurchase({ id: 'p2', buyerOwner: 'bob' }));
        await storage.createPurchase(makePurchase({ id: 'p3', buyerOwner: 'carol' }));

        const bobPurchases = await storage.listPurchasesByBuyer('bob');
        expect(bobPurchases).toHaveLength(2);

        const carolPurchases = await storage.listPurchasesByBuyer('carol');
        expect(carolPurchases).toHaveLength(1);
    });

    it('lists purchases by seller', async () => {
        await storage.createPurchase(makePurchase({ id: 'p1', sellerOwner: 'alice' }));
        await storage.createPurchase(makePurchase({ id: 'p2', sellerOwner: 'alice' }));
        await storage.createPurchase(makePurchase({ id: 'p3', sellerOwner: 'dave' }));

        const aliceSales = await storage.listPurchasesBySeller('alice');
        expect(aliceSales).toHaveLength(2);

        const daveSales = await storage.listPurchasesBySeller('dave');
        expect(daveSales).toHaveLength(1);
    });

    it('updates purchase (deliver and rate)', async () => {
        await storage.createPurchase(makePurchase({ id: 'purchase-1' }));

        // Deliver
        const delivered = await storage.updatePurchase('purchase-1', {
            status: 'delivered',
        });
        expect(delivered).not.toBeNull();
        expect(delivered!.status).toBe('delivered');

        // Complete with rating
        const completed = await storage.updatePurchase('purchase-1', {
            status: 'completed',
            rating: { score: 5, comment: 'Excellent seller!' },
            completedAt: new Date().toISOString(),
        });
        expect(completed).not.toBeNull();
        expect(completed!.status).toBe('completed');
        expect(completed!.rating).toEqual({ score: 5, comment: 'Excellent seller!' });
        expect(completed!.completedAt).toBeDefined();
    });

    it('returns null when updating non-existent purchase', async () => {
        const result = await storage.updatePurchase('nonexistent', { status: 'delivered' });
        expect(result).toBeNull();
    });
});
