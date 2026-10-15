/**
 * @file checkout-claim.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description QA audit S8-04 and S8-03, at the unit level.
 *   - The claim: of several completions that loaded the same open session, exactly one moves the
 *     stored record to `completing`; the rest are SESSION_NOT_OPEN. A released claim is open again.
 *   - Stripe: every charge Stripe could make twice carries an Idempotency-Key, the same for the same
 *     checkout and card, another for another card, and the period's key on a renewal.
 *   - The invoice rail: refused for a line delivered at once unless the seller takes invoice credit
 *     for it, never for a line fulfilled as a task.
 * @usage cd aimeat && pnpm exec vitest run test/unit/checkout-claim.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit S8-03, S8-04).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetched: Array<{ url: string; headers: Record<string, string> }> = [];
vi.mock('../../src/utils/url-validator.js', () => ({
    safeFetch: async (url: string, init: { headers?: Record<string, string> }) => {
        fetched.push({ url, headers: init.headers ?? {} });
        const id = url.endsWith('/customers') ? 'cus_1' : 'pi_1';
        return new Response(JSON.stringify({ id, status: 'succeeded' }), { status: 200 });
    },
}));

const { SqliteStorage } = await import('../../src/storage/providers/sqlite/index.js');
const { claimSessionForCompletion, releaseSessionClaim, invoiceRailRefusal } = await import('../../src/commerce/session-claim.js');
const { putRecord } = await import('../../src/commerce/platform-fee.js');
const { stripePaymentHandler, stripeIdempotencyKey } = await import('../../src/commerce/stripe-handler.js');
type Session = import('../../src/commerce/types.js').CheckoutSessionRecord;
type Sellable = import('../../src/commerce/types.js').Sellable;

const BUYER = 'buyer@aimeat-unit-claim-001';
const session = (id: string): Session => ({
    id, status: 'open', buyerOwner: 'buyer', buyerGhii: BUYER, buyerIdentity: BUYER, sellerOwner: 'shop', sellerGhii: 'shop@aimeat-unit-claim-001',
    items: [], currency: 'EUR', total: 0, createdAt: '', updatedAt: '', expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
} as unknown as Session);

describe('one completion claims a checkout session', () => {
    it('of three completions that loaded the same open session, one claims it and two are refused', async () => {
        const storage = new SqliteStorage(':memory:');
        const s = session('chk_race');
        await putRecord(storage as never, BUYER, 'commerce.session.chk_race', s);
        const outcomes = await Promise.allSettled([1, 2, 3].map(() => claimSessionForCompletion(storage as never, s, 'commerce.session.chk_race')));
        expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1);
        const refused = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');
        expect(refused).toHaveLength(2);
        for (const r of refused) expect((r.reason as { code?: string }).code).toBe('SESSION_NOT_OPEN');
        expect(((await storage.getMemory(BUYER, 'commerce.session.chk_race'))!.value as Session).status).toBe('completing');
    });

    it('a released claim can be claimed again, and a completed session cannot', async () => {
        const storage = new SqliteStorage(':memory:');
        const s = session('chk_again');
        await putRecord(storage as never, BUYER, 'commerce.session.chk_again', s);
        await claimSessionForCompletion(storage as never, s, 'commerce.session.chk_again');
        await releaseSessionClaim(storage as never, s, 'commerce.session.chk_again');
        await expect(claimSessionForCompletion(storage as never, s, 'commerce.session.chk_again')).resolves.toBeUndefined();
        await putRecord(storage as never, BUYER, 'commerce.session.chk_again', { ...s, status: 'completed' });
        await expect(claimSessionForCompletion(storage as never, s, 'commerce.session.chk_again')).rejects.toMatchObject({ code: 'SESSION_NOT_OPEN' });
    });
});

describe('Stripe charges carry an Idempotency-Key', () => {
    const handler = stripePaymentHandler({ encryptionKey: null, totpSecretEncryptionKey: null });
    const seller = { ghii: 'shop@n', owner: 'shop', psp: { secretKey: 'sk_test_unit_12345678' } };
    beforeEach(() => { fetched.length = 0; });

    it('the same checkout paid with the same card sends the same key, another card another key', async () => {
        const args = { buyerGhii: BUYER, amount: 2_000_000, currency: 'EUR', reference: 'chk_1', fee: 0, instrument: 'pm_card_visa', seller };
        await handler.collect({} as never, args as never);
        await handler.collect({} as never, args as never);
        await handler.collect({} as never, { ...args, instrument: 'pm_card_mastercard' } as never);
        const keys = fetched.map(f => f.headers['Idempotency-Key']);
        expect(keys[0]).toBe(stripeIdempotencyKey('checkout', 'chk_1', 'pm_card_visa'));
        expect(keys[1]).toBe(keys[0]);
        expect(keys[2]).not.toBe(keys[0]);
    });

    it('a renewal sends the key of its period', async () => {
        await handler.chargeSaved!({} as never, { amount: 2_000_000, currency: 'EUR', reference: 'renew:grp:node:2026-11', saved: { customer: 'cus_1', payment_method: 'pm_1' }, seller } as never);
        expect(fetched[0]!.headers['Idempotency-Key']).toBe('aimeat-renewal-renew:grp:node:2026-11');
    });
});

describe('the invoice rail for a line delivered at once', () => {
    const line = (over: Partial<Sellable>): Sellable => ({ kind: 'app-tool', title: 'Echo', psp: undefined, ...over } as unknown as Sellable);
    const fulfil = async () => ({});

    it('is refused for a line with its own fulfil step, unless the seller takes invoices for it', () => {
        expect(invoiceRailRefusal('io.aimeat.invoice', [line({ fulfill: fulfil })])?.code).toBe('INVOICE_NOT_ACCEPTED');
        expect(invoiceRailRefusal('io.aimeat.invoice', [line({ fulfill: fulfil, psp: { invoiceImmediate: true } })])).toBeNull();
    });

    it('is open for a task, and other handlers are not asked', () => {
        expect(invoiceRailRefusal('io.aimeat.invoice', [line({})])).toBeNull();
        expect(invoiceRailRefusal('io.aimeat.invoice', [line({ fulfill: fulfil, fulfillsAsTask: true })])).toBeNull();
        expect(invoiceRailRefusal('com.stripe.spt', [line({ fulfill: fulfil })])).toBeNull();
    });
});
