/**
 * @file test/unit/exchange-party-buy-delivery.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An outside buyer's purchase (services/exchange-party-buy.ts) when the delivery fails
 *   after the payment was collected, and the month's purchase cap against openings nobody paid for.
 *   Driven in process on an in-memory SQLite store with a spy payment rail registered as `test.money`,
 *   so the refund call's arguments and the contract left behind are observed directly.
 *
 *   A renewal's delivery fails here at the share step: the party has no live share and the package
 *   does not exist in this store, so granting one is refused after the contract was topped up. A
 *   first purchase fails the same way after its party was made.
 *
 *   Properties: a failed delivery leaves the contract as it was and removes the party it made; the
 *   refund carries the seller's payment settings; the buyer reads "refunded" only when the rail
 *   refunded, and an unreturned payment leaves the seller's record; a refunded payment does not
 *   complete the purchase again; an opening that expired unpaid takes no slot of the month's cap,
 *   while paid purchases still fill it.
 * @usage cd aimeat && pnpm exec vitest run test/unit/exchange-party-buy-delivery.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial (secaudit2026nov02d round 13, party-buy).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { registerPaymentHandler } from '../../src/commerce/payment-handlers.js';
import type { PaymentHandler, RefundOutcome } from '../../src/commerce/types.js';
import { writePsp } from '../../src/commerce/psp-record.js';
import { UNDELIVERED_PREFIX } from '../../src/commerce/undelivered-payment.js';
import { putOffering, type Offering } from '../../src/services/exchange-market.js';
import { createEntitlement, readContractForCall } from '../../src/services/metered-entitlements.js';
import { insertParty, findParty } from '../../src/services/parties/store.js';
import { partyRefOf, type PartyRecord } from '../../src/services/parties/contract.js';
import type { PartyContext } from '../../src/services/parties/verify.js';
import { openPartyPurchase, completePartyPurchase, readPartyPurchase, PURCHASE_TTL_MS } from '../../src/services/exchange-party-buy.js';

const NODE = 'unit-partybuy-001';
const OWNER = 'seller';
const GHII = `${OWNER}@${NODE}`;
const EXT = `datapkg:${OWNER}/feed`;
let storage: Storage;
let config: AimeatConfig;

/** The spy rail: `code` is what collect answers, `answer` what refund answers; each refund is kept. */
const rail: { code: string | null; answer: RefundOutcome; refunds: Array<{ trackingCode: string; seller: { psp?: { secretKey?: unknown } } }> } = {
    code: null, answer: { outcome: 'refunded' }, refunds: [],
};
let collects = 0;
registerPaymentHandler({
    id: 'test.money', title: 'spy rail', currencies: ['EUR', 'USD'],
    async collect(_ctx: unknown, { reference }: { reference: string }) { collects++; return { trackingCode: rail.code ?? `spy_${reference}_${collects}` }; },
    async payout() { /* not reached */ },
    async refund(_ctx: unknown, args: { trackingCode: string; seller: { psp?: { secretKey?: unknown } } }) { rail.refunds.push(args); return rail.answer; },
} as unknown as PaymentHandler);

const offering = (): Offering => ({
    offeringId: 'off-unitfeed', providerGhii: GHII, providerOwner: OWNER, kind: 'datapackage', ext: EXT, action: 'read',
    surface: { kind: 'datapackage', ownerName: OWNER, packageName: 'feed', ifaceVersion: 1, model: 'per_read' },
    title: 'Feed', description: 'A feed', unit: 'money', basePrice: 100_000, currency: 'EUR', plans: [], state: 'listed',
} as unknown as Offering);

function partyRecord(name: string): PartyRecord {
    const at = new Date().toISOString();
    return { uid: `uid-${name}`, name, displayName: name, kind: 'program', status: 'active', createdAt: at, createdBy: GHII, keys: [], failedAttempts: 0, lastSeenAt: null } as unknown as PartyRecord;
}

/** A party of the seller that bought a block of reads earlier and used it up. */
async function renewingParty(name: string): Promise<PartyContext> {
    const party = partyRecord(name);
    expect(await insertParty(storage, GHII, party)).toBe('ok');
    const ref = partyRefOf(OWNER, name, NODE);
    await createEntitlement(storage, {
        consumerGaii: ref, providerGhii: GHII, ext: EXT, action: 'read', unit: 'money', pricePerCall: 100_000, currency: 'EUR',
        pricing: { model: 'bundle', blockSize: 2, blockPrice: 200_000, callsRemaining: 0 }, capUnits: null,
        contractRef: 'offering:off-unitfeed', createdBy: 'exchange:purchase:earlier',
    });
    return { owner: OWNER, ownerGhii: GHII, party, partyRef: ref, keyId: 'k1', form: 'basic' };
}

async function open(renewal: PartyContext | null, body: Record<string, unknown> = {}): Promise<string> {
    const r = await openPartyPurchase({ storage, config }, 'off-unitfeed', { handler: 'test.money', reads: 5, ...(renewal ? {} : { party: { display_name: 'New buyer', kind: 'program', name: 'newbuyer' } }), ...body }, renewal);
    if (!r.ok) throw new Error(`open: ${r.status} ${r.code} ${r.message}`);
    return String(r.purchase.id);
}

const complete = (id: string) => completePartyPurchase({ storage, config }, id, { handler: 'test.money', instrument: 'card' });
const remaining = async (name: string): Promise<number | undefined> => {
    const c = await readContractForCall(storage, partyRefOf(OWNER, name, NODE), EXT, 'read');
    return c?.pricing?.model === 'bundle' ? c.pricing.callsRemaining : undefined;
};

beforeEach(async () => {
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    config = { ...loadConfig().config, nodeId: NODE, baseUrl: 'https://node.test' };
    rail.code = null; rail.answer = { outcome: 'refunded' }; rail.refunds = [];
    await putOffering(storage, offering());
});

describe('a delivery that fails after the payment', () => {
    it('leaves a renewing party\'s contract as it was before the purchase', async () => {
        const ctx = await renewingParty('renewer');
        const id = await open(ctx);
        const r = await complete(id);
        expect(r.ok).toBe(false);
        expect(await remaining('renewer'), 'the top-up of a purchase that was not delivered stays').toBe(0);
        expect((await readPartyPurchase(storage, NODE, id))?.status).toBe('open');
    });

    it('does not let the same payment complete the purchase again', async () => {
        const ctx = await renewingParty('replayer');
        const id = await open(ctx);
        rail.code = 'pi_same_payment';
        const first = await complete(id);
        expect(first.ok).toBe(false);
        const again = await complete(id);
        expect(again.ok).toBe(false);
        expect(!again.ok && again.code).toBe('PAYMENT_REFUNDED');
        expect(!again.ok && again.status).toBe(402);
        expect(await remaining('replayer')).toBe(0);
        expect(rail.refunds.length, 'the refused second collect is not refunded twice').toBe(1);
    });

    it('a new payment after a refunded one still completes as far as the delivery allows', async () => {
        const ctx = await renewingParty('retrier');
        const id = await open(ctx);
        expect((await complete(id)).ok).toBe(false);
        const again = await complete(id);
        expect(!again.ok && again.code, 'a fresh payment is not taken for the refunded one').not.toBe('PAYMENT_REFUNDED');
    });

    it('removes the party a first purchase made, so the buyer can try again under the same name', async () => {
        const id = await open(null);
        const r = await complete(id);
        expect(r.ok).toBe(false);
        expect(await findParty(storage, GHII, 'newbuyer'), 'a party whose key was never handed out stays').toBeUndefined();
        const again = await complete(id);
        expect(!again.ok && again.code).not.toBe('PARTY_EXISTS');
    });

    it('refunds with the seller\'s payment settings, as the collect had them', async () => {
        await writePsp(storage, GHII, { provider: 'stripe', secretKey: 'sk_test_unit_seller' }, null);
        const ctx = await renewingParty('withpsp');
        await complete(await open(ctx));
        expect(rail.refunds.length).toBe(1);
        expect(rail.refunds[0]!.seller.psp?.secretKey, 'the refund had no seller key, so the card rail could not refund').toBe('sk_test_unit_seller');
    });

    it('says the payment was refunded only when the rail refunded it, as before', async () => {
        const ctx = await renewingParty('refunded');
        const r = await complete(await open(ctx));
        expect(!r.ok && r.message).toMatch(/; the payment was refunded\.$/);
    });

    it('a refund that fails says the money was NOT returned, names the purchase and leaves the seller a record', async () => {
        rail.answer = { outcome: 'failed', detail: 'the rail said no' };
        const ctx = await renewingParty('unrefunded');
        const id = await open(ctx);
        const r = await complete(id);
        expect(r.ok).toBe(false);
        expect(!r.ok && r.message).not.toMatch(/was refunded/i);
        expect(!r.ok && r.message).toMatch(/NOT returned/);
        expect(!r.ok && r.message).toContain(id);
        const rec = (await storage.getMemory(GHII, `${UNDELIVERED_PREFIX}${id}`))?.value as Record<string, unknown> | undefined;
        expect(rec).toMatchObject({ type: 'aimeat:UndeliveredPayment', sessionId: id, seller: GHII, amount: 500_000, currency: 'EUR', rail: 'test.money', refund: { outcome: 'failed' }, status: 'open' });
    });
});

describe('the month\'s purchase cap', () => {
    const month = new Date().toISOString().slice(0, 7);
    async function seed(n: number, status: 'open' | 'completed', expired: boolean): Promise<void> {
        const at = Date.now() - (expired ? 2 * PURCHASE_TTL_MS : 0);
        const purchases = Array.from({ length: n }, (_, i) => ({
            id: `pp_seed_${i}`, offeringId: 'off-unitfeed', providerGhii: GHII, providerOwner: OWNER, packageName: 'feed',
            party: { name: `p${i}`, displayName: 'P', kind: 'program' }, model: 'per_read', quantity: 1, amount: 100_000, currency: 'EUR',
            handler: 'test.money', status, createdAt: new Date(at).toISOString(), expiresAt: new Date(at + PURCHASE_TTL_MS).toISOString(),
        }));
        const now = new Date().toISOString();
        await storage.setMemory({ key: `party-purchases.${month}`, ownerGaii: GHII, value: { purchases }, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now } as never);
    }
    const held = async (): Promise<number> => ((await storage.getMemory(GHII, `party-purchases.${month}`))?.value as { purchases: unknown[] }).purchases.length;

    it('an opening that expired unpaid takes no slot: a new buyer and a renewal still open purchases', async () => {
        await seed(2000, 'open', true);
        const fresh = await openPartyPurchase({ storage, config }, 'off-unitfeed', { handler: 'test.money', reads: 1, party: { display_name: 'Late buyer', kind: 'program' } }, null);
        expect(fresh.ok, `a new buyer: ${JSON.stringify(fresh)}`).toBe(true);
        const ctx = await renewingParty('capped');
        const renew = await openPartyPurchase({ storage, config }, 'off-unitfeed', { handler: 'test.money', reads: 1 }, ctx);
        expect(renew.ok, `a renewal: ${JSON.stringify(renew)}`).toBe(true);
        expect(await held(), 'the record keeps at most 500 expired openings beside the live ones').toBeLessThanOrEqual(502);
    });

    it('2000 paid purchases still fill the month', async () => {
        await seed(2000, 'completed', true);
        const r = await openPartyPurchase({ storage, config }, 'off-unitfeed', { handler: 'test.money', reads: 1, party: { display_name: 'Buyer', kind: 'program' } }, null);
        expect(!r.ok && r.code).toBe('TOO_MANY_PURCHASES');
        expect(await held()).toBe(2000);
    });

    it('2000 openings still waiting for their payment fill it too', async () => {
        await seed(2000, 'open', false);
        const r = await openPartyPurchase({ storage, config }, 'off-unitfeed', { handler: 'test.money', reads: 1, party: { display_name: 'Buyer', kind: 'program' } }, null);
        expect(!r.ok && r.code).toBe('TOO_MANY_PURCHASES');
    });
});
