/**
 * @file test/unit/package-account-sale.test.ts
 * @description An author selling their own package to accounts of this node
 *   (services/packages/sale/package-account-entitlement.ts, package-account-sale.ts): a purchase counts
 *   only once the seller's copy of its checkout says completed, a refunded one never, a visitor's name
 *   never; the listing carries no content but a memory part named as preview; the visibility and
 *   read refusals answer only for a group that is sold.
 * @usage pnpm exec vitest run test/unit/package-account-sale.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (wish-tekij-myy-oman-pakettinsa-toiselle-k-ytt-j-lle-samassa-solmu).
 */
import { describe, it, expect } from 'vitest';
import type { Storage, MemoryRecord, PackageRecord } from '../../src/storage/interface.js';
import {
    NS_PACKAGE_ACCOUNT_SALES, saleKey, readAccountSale, activePurchase, purchaseRefusal, listedSaleRefusal,
    saleVisibilityRefusal, type AccountSale,
} from '../../src/services/packages/sale/package-account-entitlement.js';
import { listingOf } from '../../src/services/packages/sale/package-account-sale.js';

/** A memory store with the conditional writes the record helper uses. */
function memStorage(): Storage & { put(owner: string, key: string, value: unknown): void } {
    const rows = new Map<string, MemoryRecord>();
    const id = (o: string, k: string) => `${o}\u0000${k}`;
    const s = {
        async getMemory(o: string, k: string) { return rows.get(id(o, k)) ?? null; },
        async setMemory(r: MemoryRecord) { rows.set(id(r.ownerGaii, r.key), r); },
        async createMemoryIfAbsent(r: MemoryRecord) { if (rows.has(id(r.ownerGaii, r.key))) return false; rows.set(id(r.ownerGaii, r.key), r); return true; },
        async setMemoryIfVersion(r: MemoryRecord, v: number) {
            const cur = rows.get(id(r.ownerGaii, r.key));
            if (!cur || cur.version !== v) return false;
            rows.set(id(r.ownerGaii, r.key), r); return true;
        },
        put(owner: string, key: string, value: unknown) {
            const now = new Date().toISOString();
            rows.set(id(owner, key), { key, ownerGaii: owner, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now } as MemoryRecord);
        },
    };
    return s as unknown as Storage & { put(owner: string, key: string, value: unknown): void };
}

const GROUP = 'tpl::alice';
const SELLER = 'alice@node-1';
function sale(purchases: AccountSale['purchases'], state: AccountSale['state'] = 'on_sale'): AccountSale {
    return {
        groupId: GROUP, author: 'alice', state, preview: ['listing'], updatedAt: '2026-10-31T00:00:00Z',
        prices: [{ id: 'p1', amount: 12_000_000, currency: 'EUR', createdAt: '2026-10-31T00:00:00Z' }], purchases,
    };
}
const paid = (order: string, extra: Partial<AccountSale['purchases'][number]> = {}): AccountSale['purchases'][number] => ({
    buyer: 'bob', order, priceId: 'p1', amount: 12_000_000, currency: 'EUR', handler: 'test.money', sellerGhii: SELLER,
    boughtAt: '2026-10-31T00:00:00Z', state: 'paid', covers: 'line', ...extra,
});

describe('activePurchase', () => {
    it('a paid purchase whose checkout has not completed does not count', async () => {
        const st = memStorage();
        st.put(NS_PACKAGE_ACCOUNT_SALES, saleKey(GROUP), sale([paid('cs_1')]));
        expect(await activePurchase(st, (await readAccountSale(st, GROUP))!, 'bob')).toBeNull();
        st.put(SELLER, 'commerce.order.cs_1', { status: 'completing' });
        expect(await activePurchase(st, (await readAccountSale(st, GROUP))!, 'bob')).toBeNull();
    });

    it('counts once the seller\'s copy of the order is completed, and marks it confirmed', async () => {
        const st = memStorage();
        st.put(NS_PACKAGE_ACCOUNT_SALES, saleKey(GROUP), sale([paid('cs_1')]));
        st.put(SELLER, 'commerce.order.cs_1', { status: 'completed' });
        expect((await activePurchase(st, (await readAccountSale(st, GROUP))!, 'bob'))?.order).toBe('cs_1');
        expect((await readAccountSale(st, GROUP))!.purchases[0]!.confirmed).toBe(true);
    });

    it('a refunded purchase, another account and a visitor\'s name never count', async () => {
        const st = memStorage();
        st.put(NS_PACKAGE_ACCOUNT_SALES, saleKey(GROUP), sale([paid('cs_1', { state: 'refunded', confirmed: true })]));
        const s = (await readAccountSale(st, GROUP))!;
        expect(await activePurchase(st, s, 'bob')).toBeNull();
        expect(await activePurchase(st, sale([paid('cs_2', { confirmed: true })]), 'carol')).toBeNull();
        expect(await activePurchase(st, sale([paid('cs_2', { confirmed: true, buyer: 'bob@other-node' })]), 'bob@other-node')).toBeNull();
        // The shared anonymous identity is every caller without a session: it never holds a purchase.
        expect(await activePurchase(st, sale([paid('cs_3', { confirmed: true, buyer: 'anonymous' })]), 'anonymous')).toBeNull();
    });

    it('the newest purchase of a buyer decides: a refund followed by a new purchase counts', async () => {
        const st = memStorage();
        expect((await activePurchase(st, sale([paid('cs_1', { state: 'refunded' }), paid('cs_2', { confirmed: true })]), 'bob'))?.order).toBe('cs_2');
    });
});

describe('the refusals answer only for a group that is sold', () => {
    it('a group with no sale record is left alone', async () => {
        const st = memStorage();
        expect(await purchaseRefusal(st, GROUP, 'bob')).toBeNull();
        expect(await listedSaleRefusal(st, GROUP)).toBeNull();
        expect(await saleVisibilityRefusal(st, GROUP, 'public')).toBeNull();
    });

    it('on sale: no purchase is 402, the author is not refused, public is PACKAGE_PRICED, private is allowed', async () => {
        const st = memStorage();
        st.put(NS_PACKAGE_ACCOUNT_SALES, saleKey(GROUP), sale([]));
        expect(await purchaseRefusal(st, GROUP, 'bob')).toMatchObject({ status: 402, code: 'PURCHASE_REQUIRED' });
        expect(await purchaseRefusal(st, GROUP, 'alice')).toBeNull();
        expect(await listedSaleRefusal(st, GROUP)).toMatchObject({ status: 402, code: 'PURCHASE_REQUIRED' });
        expect(await saleVisibilityRefusal(st, GROUP, 'members')).toMatchObject({ status: 409, code: 'PACKAGE_PRICED' });
        expect(await saleVisibilityRefusal(st, GROUP, 'private')).toBeNull();
    });

    it('an ended sale is not listed and frees the visibility; the buyer of record still has no refusal', async () => {
        const st = memStorage();
        st.put(NS_PACKAGE_ACCOUNT_SALES, saleKey(GROUP), sale([paid('cs_1', { confirmed: true })], 'ended'));
        expect(await listedSaleRefusal(st, GROUP)).toBeNull();
        expect(await saleVisibilityRefusal(st, GROUP, 'public')).toBeNull();
        expect(await purchaseRefusal(st, GROUP, 'bob')).toBeNull();
        expect(await purchaseRefusal(st, GROUP, 'carol')).toMatchObject({ code: 'PURCHASE_REQUIRED' });
    });
});

describe('listingOf', () => {
    const pkg = {
        packageGroupId: GROUP, name: 'tpl', author: 'alice', version: 'v1', description: 'd', category: 'other', tags: [],
        status: 'published', visibility: 'private', createdAt: '', updatedAt: '',
        components: [
            { id: 'ui', type: 'app', label: 'App', content: '<html>secret</html>', contentHash: 'h1', dependencies: [] },
            { id: 'listing', type: 'memory', label: 'Listing', content: '{"entries":[]}', contentHash: 'h2', dependencies: [] },
        ],
    } as unknown as PackageRecord;

    it('carries the preview memory part\'s content and no other content, with the price and the line that buys it', () => {
        const l = listingOf(pkg, sale([])) as any;
        expect(l.listing_only).toBe(true);
        expect(l.components.find((c: any) => c.id === 'ui').content).toBeUndefined();
        expect(l.components.find((c: any) => c.id === 'listing').content).toBe('{"entries":[]}');
        expect(JSON.stringify(l)).not.toContain('secret');
        expect(l.buy).toEqual({ kind: 'package-account', app: GROUP, currency: 'EUR' });
        expect(l.sale.purchases).toBeUndefined();
    });

    it('an app part named as preview still carries no content, and a paused sale has no buy line', () => {
        const s = { ...sale([]), preview: ['ui'], state: 'paused' as const };
        const l = listingOf(pkg, s) as any;
        expect(l.components.find((c: any) => c.id === 'ui').content).toBeUndefined();
        expect(l.buy).toBeNull();
        expect(l.sale.buyable).toBe(false);
    });
});
