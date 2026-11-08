/**
 * @file test/unit/exchange-party-buy-card-page.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An outside buyer's purchase paid on the provider's Stripe card page
 *   (services/exchange-party-buy.ts) and completed late, by the seller's Stripe webhook
 *   (commerce/stripe-checkout-complete.ts), or not at all; and the sale a failed delivery books.
 *   Driven in process on an in-memory SQLite store with the real card page handler; Stripe is answered
 *   by a stand-in for safeFetch, which also keeps every refund asked of it. A share for a new party is
 *   granted by a stand-in for grantConsent, because no package exists in this store.
 *
 *   Properties: a card payment made inside the purchase's hour completes it after the hour; an unpaid
 *   expired purchase still answers 410; money paid for an offering that is not for sale any more goes
 *   back; the webhook completes a party purchase through the same completion, once, only from a card
 *   page the node opened, and only for the seller whose webhook it is; the buyer who comes back after
 *   the webhook receives the answer and a new party's key once; a failed last write leaves no booked
 *   sale behind the refund.
 * @usage cd aimeat && pnpm exec vitest run test/unit/exchange-party-buy-card-page.test.ts
 * @version-history
 *   2026-11-08 -- A card page paid for a provider deactivated since is refunded, and the refusal names
 *     the deactivation (secaudit2026nov08b round 15).
 *   v1.0.0 — 2026-11-03 — Initial (secaudit2026nov02d round 13b, party-buy).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

/** What the stand-in Stripe answers for a Checkout Session read; every refund call is kept. */
let stripeSession: Record<string, unknown> = {};
const stripeCalls: string[] = [];
const refunds: string[] = [];
vi.mock('../../src/utils/url-validator.js', async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    safeFetch: async (url: string, init?: { body?: string }) => {
        stripeCalls.push(url);
        if (url.includes('/refunds')) { refunds.push(String(init?.body ?? '')); return new Response(JSON.stringify({ id: 're_unit', status: 'succeeded' }), { status: 200 }); }
        return new Response(JSON.stringify(stripeSession), { status: 200 });
    },
}));
vi.mock('../../src/services/consent-write.js', async (orig) => {
    const real = await orig<Record<string, unknown>>();
    return {
        ...real,
        // The package does not exist in this store, so the share a first purchase makes is written here
        // in the shape the party share check gives it.
        grantConsent: async (deps: { storage: Storage }, caller: { ownerGaii: string }, asked: { recipient: string; dataPattern: string; purpose: string }) => {
            const { parsePartyRef } = await import('../../src/services/parties/contract.js');
            const { findParty } = await import('../../src/services/parties/store.js');
            const party = await findParty(deps.storage, caller.ownerGaii, parsePartyRef(asked.recipient)!.name);
            const value = await deps.storage.createConsent({
                id: randomUUID(), ownerGaii: caller.ownerGaii, dataPattern: asked.dataPattern, recipient: asked.recipient, purpose: asked.purpose,
                scope: 'local', expires: null, status: 'active', grantedAt: new Date().toISOString(), revokedAt: null,
                metadata: { partyUid: party!.uid, allowUrlKey: false, termsRequired: false },
            } as never);
            return { ok: true, value };
        },
    };
});

import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { registerPaymentHandler } from '../../src/commerce/payment-handlers.js';
import type { PaymentHandler } from '../../src/commerce/types.js';
import { stripeCheckoutHandler } from '../../src/commerce/stripe-checkout.js';
import { completeFromStripeCheckout } from '../../src/commerce/stripe-checkout-complete.js';
import { microsToStripeMinor } from '../../src/commerce/money.js';
import { putOffering, type Offering } from '../../src/services/exchange-market.js';
import { createEntitlement, readContractForCall } from '../../src/services/metered-entitlements.js';
import { insertParty, findParty } from '../../src/services/parties/store.js';
import { partyRefOf, type PartyRecord } from '../../src/services/parties/contract.js';
import { partyKeyMatches } from '../../src/services/parties/keys.js';
import { completePartyPurchase, readPartyPurchase, PURCHASE_TTL_MS } from '../../src/services/exchange-party-buy.js';

const NODE = 'unit-partycard-001';
const OWNER = 'seller';
const GHII = `${OWNER}@${NODE}`;
const EXT = `datapkg:${OWNER}/feed`;
const AMOUNT = 500_000;
let storage: Storage;
let config: AimeatConfig;

/** A spy money rail for the sale booking case: collect answers a fresh code, refund says refunded. */
registerPaymentHandler({
    id: 'test.money', title: 'spy rail', currencies: ['EUR', 'USD'],
    async collect(_ctx: unknown, { reference }: { reference: string }) { return { trackingCode: `spy_${reference}` }; },
    async payout() { /* not reached */ },
    async refund() { return { outcome: 'refunded' }; },
} as unknown as PaymentHandler);

const offering = (state = 'listed'): Offering => ({
    offeringId: 'off-unitfeed', providerGhii: GHII, providerOwner: OWNER, kind: 'datapackage', ext: EXT, action: 'read',
    surface: { kind: 'datapackage', ownerName: OWNER, packageName: 'feed', ifaceVersion: 1, model: 'per_read' },
    title: 'Feed', description: 'A feed', unit: 'money', basePrice: 100_000, currency: 'EUR', plans: [], state,
} as unknown as Offering);

/** A party that bought reads earlier and used them up, with its live share bound to the offering. */
async function renewingParty(name: string): Promise<string> {
    const at = new Date().toISOString();
    const party = { uid: `uid-${name}`, name, displayName: name, kind: 'program', status: 'active', createdAt: at, createdBy: GHII, keys: [], failedAttempts: 0, lastSeenAt: null } as unknown as PartyRecord;
    expect(await insertParty(storage, GHII, party)).toBe('ok');
    const ref = partyRefOf(OWNER, name, NODE);
    const ent = await createEntitlement(storage, {
        consumerGaii: ref, providerGhii: GHII, ext: EXT, action: 'read', unit: 'money', pricePerCall: 100_000, currency: 'EUR',
        pricing: { model: 'bundle', blockSize: 2, blockPrice: 200_000, callsRemaining: 0 }, capUnits: null,
        contractRef: 'offering:off-unitfeed', createdBy: 'exchange:purchase:earlier',
    });
    await storage.createConsent({
        id: randomUUID(), ownerGaii: GHII, dataPattern: 'datapkg:feed', recipient: ref, purpose: 'bought earlier', scope: 'local',
        expires: null, status: 'active', grantedAt: at, revokedAt: null,
        metadata: { partyUid: party.uid, allowUrlKey: false, termsRequired: false, termsAcceptedAt: at, contract: { offeringId: 'off-unitfeed', entitlementId: ent.entitlementId, ifaceVersion: 1 } },
    } as never);
    return party.uid;
}

/** An open purchase as openPartyPurchase keeps it (the card page itself is Stripe's, so it is written here). */
async function seed(o: { name: string; renewalOf?: string; handler?: string; expired?: boolean; cardPages?: string[] }): Promise<string> {
    const created = new Date(Date.now() - (o.expired ? PURCHASE_TTL_MS + 60_000 : 0)).toISOString();
    const id = `pp_${Buffer.from(OWNER).toString('base64url')}_${created.slice(0, 4)}${created.slice(5, 7)}_${randomBytes(16).toString('hex')}`;
    const key = `party-purchases.${created.slice(0, 7)}`;
    const rec = await storage.getMemory(GHII, key);
    const purchases = [...((rec?.value as { purchases?: unknown[] } | undefined)?.purchases ?? []), {
        id, offeringId: 'off-unitfeed', providerGhii: GHII, providerOwner: OWNER, packageName: 'feed',
        party: { name: o.name, displayName: o.name, kind: 'program' }, ...(o.renewalOf ? { renewalOf: o.renewalOf } : {}),
        model: 'per_read', quantity: 5, amount: AMOUNT, currency: 'EUR', handler: o.handler ?? 'com.stripe.checkout', status: 'open',
        createdAt: created, expiresAt: new Date(Date.parse(created) + PURCHASE_TTL_MS).toISOString(), ...(o.cardPages ? { cardPages: o.cardPages } : {}),
    }];
    const now = new Date().toISOString();
    await storage.setMemory({ key, ownerGaii: GHII, value: { purchases }, visibility: 'private', tags: [], ttlHours: null, version: (rec?.version ?? 0) + 1, createdAt: rec?.createdAt ?? now, updatedAt: now } as never);
    return id;
}

/** Stripe's answer for the card page `cs` of purchase `id`: paid in full, or not. */
function stripeSays(cs: string, id: string, paid = true): void {
    stripeSession = {
        id: cs, payment_status: paid ? 'paid' : 'unpaid', amount_total: microsToStripeMinor(AMOUNT), currency: 'eur', livemode: false,
        metadata: { aimeat_session: id, aimeat_buyer: 'x' },
        payment_intent: { id: `pi_${cs}`, payment_method: 'pm_1', latest_charge: { payment_method_details: { card: { funding: 'debit' } } } },
    };
}

const returns = (id: string, cs?: string) => completePartyPurchase({ storage, config }, id, { handler: 'com.stripe.checkout', ...(cs ? { instrument: cs } : {}) });
const webhook = (id: string, cs: string, seller = GHII) => completeFromStripeCheckout(storage, config, seller, { id: cs, metadata: { aimeat_session: id, aimeat_buyer: 'party:seller/x@node' } });
const remaining = async (name: string): Promise<number | undefined> => {
    const c = await readContractForCall(storage, partyRefOf(OWNER, name, NODE), EXT, 'read');
    return c?.pricing?.model === 'bundle' ? c.pricing.callsRemaining : undefined;
};
const feeRecords = async (): Promise<number> => (await storage.listAllMemory({ prefix: 'commerce.platform-fee.', limit: 50 })).items.length;

beforeEach(async () => {
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    config = { ...loadConfig().config, nodeId: NODE, baseUrl: 'https://node.test', encryptionKey: null } as AimeatConfig;
    registerPaymentHandler(stripeCheckoutHandler(config));
    const now = new Date().toISOString();
    await storage.setMemory({ key: 'commerce.psp', ownerGaii: GHII, value: { provider: 'stripe', secretKey: 'sk_test_stand_in' }, visibility: 'private', tags: ['commerce'], ttlHours: null, version: 1, createdAt: now, updatedAt: now } as never);
    await putOffering(storage, offering());
    stripeCalls.length = 0; refunds.length = 0; stripeSession = {};
});

describe('paid on the card page inside the hour, back after it', () => {
    it('the purchase is delivered', async () => {
        const uid = await renewingParty('late');
        const id = await seed({ name: 'late', renewalOf: uid, expired: true });
        stripeSays('cs_late', id);
        const r = await returns(id, 'cs_late');
        expect(r.ok, `a paid purchase that came back late: ${JSON.stringify(r)}`).toBe(true);
        expect((await readPartyPurchase(storage, NODE, id))?.status).toBe('completed');
        expect(await remaining('late')).toBe(5);
        expect(refunds.length).toBe(0);
    });

    it('designed use: an unpaid expired purchase still answers 410, and without a card page nothing asks Stripe', async () => {
        const uid = await renewingParty('unpaid');
        const id = await seed({ name: 'unpaid', renewalOf: uid, expired: true });
        stripeSays('cs_unpaid', id, false);
        const r = await returns(id, 'cs_unpaid');
        expect(!r.ok && r.status).toBe(410);
        expect(!r.ok && r.code).toBe('PURCHASE_EXPIRED');
        expect((await readPartyPurchase(storage, NODE, id))?.status).toBe('open');
        stripeCalls.length = 0;
        const bare = await returns(id);
        expect(!bare.ok && bare.code).toBe('PURCHASE_EXPIRED');
        expect(stripeCalls.length).toBe(0);
    });

    it('designed use: an expired test-money purchase answers 410 before anything is collected', async () => {
        const id = await seed({ name: 'testmoney', handler: 'test.money', expired: true });
        const r = await completePartyPurchase({ storage, config }, id, { handler: 'test.money', instrument: 'card' });
        expect(!r.ok && r.code).toBe('PURCHASE_EXPIRED');
    });

    it('money paid for an offering that is not for sale any more goes back, and the buyer is told', async () => {
        const uid = await renewingParty('delisted');
        const id = await seed({ name: 'delisted', renewalOf: uid });
        await putOffering(storage, offering('delisted'));
        stripeSays('cs_delisted', id);
        const r = await returns(id, 'cs_delisted');
        expect(r.ok).toBe(false);
        expect(refunds.length, 'the card payment for a delisted offering was kept').toBe(1);
        expect(!r.ok && r.message).toMatch(/the payment was refunded\.$/);
        expect(await remaining('delisted')).toBe(0);
    });

    it('money paid on the card page for a provider deactivated since goes back, and the refusal names the deactivation', async () => {
        // secaudit2026nov08b round 15: every read of a deactivated provider's party is refused, so the
        // completion takes the refund an offering that cannot be sold takes.
        const uid = await renewingParty('deactivated');
        const id = await seed({ name: 'deactivated', renewalOf: uid });
        const realGetOwner = storage.getOwner.bind(storage);
        vi.spyOn(storage, 'getOwner').mockImplementation(async (name: string) => (
            name === OWNER ? { ...((await realGetOwner(name)) ?? { name: OWNER }), disabledAt: '2026-11-08T10:00:00.000Z' } as never : realGetOwner(name)));
        stripeSays('cs_deactivated', id);
        const r = await returns(id, 'cs_deactivated');
        expect(!r.ok && r.code).toBe('ACCOUNT_DISABLED');
        expect(refunds.length, 'the card payment for a deactivated provider was kept').toBe(1);
        expect(!r.ok && r.message).toMatch(/deactivated on 2026-11-08/);
        expect(!r.ok && r.message).toMatch(/the payment was refunded\.$/);
        expect(await remaining('deactivated')).toBe(0);
        expect((await readPartyPurchase(storage, NODE, id))?.status).toBe('open');
    });

    it('designed use: a buyer who comes back inside the hour completes as before', async () => {
        const uid = await renewingParty('ontime');
        const id = await seed({ name: 'ontime', renewalOf: uid });
        stripeSays('cs_ontime', id);
        const r = await returns(id, 'cs_ontime');
        expect(r.ok).toBe(true);
        expect(r.ok && (r.data.contract as { pricing: { callsRemaining: number } }).pricing.callsRemaining).toBe(5);
    });
});

describe('the seller\'s Stripe webhook', () => {
    it('completes a renewal whose buyer never came back: the contract is topped up and the sale booked', async () => {
        const uid = await renewingParty('away');
        const id = await seed({ name: 'away', renewalOf: uid, cardPages: ['cs_away'] });
        stripeSays('cs_away', id);
        expect(await webhook(id, 'cs_away')).toBe('checkout_completed');
        expect((await readPartyPurchase(storage, NODE, id))?.status).toBe('completed');
        expect(await remaining('away')).toBe(5);
        expect(await feeRecords()).toBe(1);
    });

    it('completes a first purchase, and the buyer who comes back later receives the key once', async () => {
        const id = await seed({ name: 'newcomer', cardPages: ['cs_new'] });
        stripeSays('cs_new', id);
        expect(await webhook(id, 'cs_new')).toBe('checkout_completed');
        expect((await findParty(storage, GHII, 'newcomer'))?.keys.length, 'no key is made for an answer nobody reads').toBe(0);
        const back = await returns(id, 'cs_new');
        expect(back.ok, `the buyer back after the webhook: ${JSON.stringify(back)}`).toBe(true);
        const key = back.ok ? String((back.data.connection as { key?: string }).key ?? '') : '';
        expect(key).not.toBe('');
        const party = await findParty(storage, GHII, 'newcomer');
        expect(party?.keys.length).toBe(1);
        expect(partyKeyMatches(key, party!.keys[0]!.hash)).toBe(true);
        const again = await returns(id, 'cs_new');
        expect(!again.ok && again.code).toBe('ALREADY_COMPLETED');
        expect((await findParty(storage, GHII, 'newcomer'))?.keys.length).toBe(1);
    });

    it('the buyer back after the webhook must name the card page that paid', async () => {
        const id = await seed({ name: 'other', cardPages: ['cs_paid'] });
        stripeSays('cs_paid', id);
        expect(await webhook(id, 'cs_paid')).toBe('checkout_completed');
        const wrong = await returns(id, 'cs_someone_else');
        expect(!wrong.ok && wrong.code).toBe('ALREADY_COMPLETED');
        expect((await returns(id, 'cs_paid')).ok).toBe(true);
    });

    it('whichever comes first completes it: the buyer first, then the webhook finds it done', async () => {
        const uid = await renewingParty('both');
        const id = await seed({ name: 'both', renewalOf: uid, cardPages: ['cs_both'] });
        stripeSays('cs_both', id);
        expect((await returns(id, 'cs_both')).ok).toBe(true);
        expect(await webhook(id, 'cs_both')).toBe('checkout_already_closed');
        expect(await remaining('both'), 'one payment tops the contract up once').toBe(5);
        expect(await feeRecords()).toBe(1);
    });

    it('completes nothing from a Stripe session the node did not open for the purchase, or for another seller', async () => {
        const uid = await renewingParty('foreign');
        const id = await seed({ name: 'foreign', renewalOf: uid, cardPages: ['cs_node_page'] });
        stripeSays('cs_seller_made', id);
        expect(await webhook(id, 'cs_seller_made')).toBe('checkout_not_found');
        expect(await webhook(id, 'cs_node_page', `other@${NODE}`)).toBe('checkout_not_found');
        expect(stripeCalls.length).toBe(0);
        expect((await readPartyPurchase(storage, NODE, id))?.status).toBe('open');
    });

    it('a paid card page that comes in after the hour completes the purchase too', async () => {
        const uid = await renewingParty('slowhook');
        const id = await seed({ name: 'slowhook', renewalOf: uid, expired: true, cardPages: ['cs_slow'] });
        stripeSays('cs_slow', id);
        expect(await webhook(id, 'cs_slow')).toBe('checkout_completed');
        expect(await remaining('slowhook')).toBe(5);
    });
});

describe('a delivery whose last write fails', () => {
    it('leaves no booked sale behind the refund', async () => {
        const uid = await renewingParty('lastwrite');
        const id = await seed({ name: 'lastwrite', renewalOf: uid, handler: 'test.money' });
        // The purchase record refuses the write that marks the purchase completed, and only that one.
        const real = storage;
        storage = new Proxy(real, {
            get(target, prop, receiver) {
                const v = Reflect.get(target, prop, receiver) as unknown;
                if (prop !== 'setMemoryIfVersion' || typeof v !== 'function') return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
                return async (rec: { key: string; value: { purchases?: Array<{ id: string; status: string }> } }, version: number) => {
                    if (rec.key.startsWith('party-purchases.') && rec.value.purchases?.some(p => p.id === id && p.status === 'completed')) throw new Error('the store went away');
                    return (v as (r: unknown, n: number) => Promise<boolean>).call(target, rec, version);
                };
            },
        });
        const r = await completePartyPurchase({ storage, config }, id, { handler: 'test.money', instrument: 'card' });
        expect(r.ok).toBe(false);
        expect(!r.ok && r.message).toMatch(/the payment was refunded\.$/);
        expect(await feeRecords(), 'the sale stayed booked while its payment was refunded').toBe(0);
        expect(await remaining('lastwrite')).toBe(0);
    });
});
