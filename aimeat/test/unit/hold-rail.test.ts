/**
 * @file test/unit/hold-rail.test.ts
 * @description Does a hold's state change actually reach the payment rail?
 *
 *   e2e-commerce-holds asserts capture and release entirely from the response body — `hold.status`
 *   and `hold.capturedAmount` are read out of the record transition() mutates in memory just before
 *   saving it. Delete `await handler.capture!(...)` from that function and keep the state flip, and
 *   tests 5, 6 and 8 stay green while no money is captured: the hold reads 'captured', the seller is
 *   never paid, and the buyer's authorization silently expires on the rail.
 *
 *   That cannot be caught from the E2E layer as the code stands. hold-book.ts checks the seller, the
 *   status and the amount BEFORE it calls the rail, so every negative case in that suite is answered
 *   by the book and no later call ever reaches the handler again — and the test double keeps its hold
 *   ledger in a module-local Map with no read surface, in a different process from the suite. The
 *   observation has to happen where the two can be seen together, which is here.
 *
 *   Two properties, and the second is the one that matters more: the rail is CALLED, and when the
 *   rail refuses, the record does not say the money moved.
 * @usage cd aimeat && pnpm exec vitest run test/unit/hold-rail.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-16 — Initial (E2E test-quality audit, e2e-commerce-holds:133 echo-trust).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { registerPaymentHandler } from '../../src/commerce/payment-handlers.js';
import { createHold, captureHold, releaseHold } from '../../src/commerce/hold-book.js';
import { PaymentError } from '../../src/commerce/errors.js';
import type { PaymentHandler } from '../../src/commerce/types.js';
import type { AimeatConfig } from '../../src/config.js';

const NODE = 'test-node-001';
const config = { nodeId: NODE } as unknown as AimeatConfig;

/** What the rail was actually asked to do, in order. */
interface RailCall { kind: 'authorize' | 'capture' | 'release'; amount?: number; trackingCode?: string }

function spyHandler(id: string, opts: { failCapture?: boolean; failRelease?: boolean } = {}) {
    const calls: RailCall[] = [];
    const handler: PaymentHandler = {
        id,
        title: 'spy rail',
        currencies: ['EUR'],
        async collect() { return { trackingCode: 'x' }; },
        async payout() { /* not used here */ },
        async refund() { /* not used here */ },
        async authorize(_ctx, { amount }) {
            calls.push({ kind: 'authorize', amount });
            return { trackingCode: `spy_${calls.length}` };
        },
        async capture(_ctx, { amount, trackingCode }) {
            calls.push({ kind: 'capture', amount, trackingCode });
            if (opts.failCapture) throw new PaymentError('CAPTURE_REFUSED', 402, 'the rail said no');
        },
        async release(_ctx, { trackingCode }) {
            calls.push({ kind: 'release', trackingCode });
            if (opts.failRelease) throw new PaymentError('RELEASE_REFUSED', 402, 'the rail said no');
        },
    } as unknown as PaymentHandler;
    registerPaymentHandler(handler);
    return { handler, calls };
}

async function twoParties(storage: SqliteStorage, suffix: string) {
    const buyer = `buyer${suffix}`;
    const seller = `seller${suffix}`;
    const now = new Date().toISOString();
    for (const name of [buyer, seller]) {
        await storage.createGHII({
            ghii: `${name}@${NODE}`, username: name, ownerName: name, nodeId: NODE,
            displayName: name, verificationLevel: 0, totpEnabled: false,
            createdAt: now, updatedAt: now,
        } as never);
    }
    return { buyer, seller };
}

const makeHold = (storage: SqliteStorage, p: { buyer: string; seller: string }, handlerId: string) =>
    createHold(storage, config, {
        buyerOwner: p.buyer, buyerIdentity: `${p.buyer}@${NODE}`, sellerOwner: p.seller,
        amount: 80_000000, currency: 'EUR', purpose: 'auction', reference: 'ref-1',
        handlerId, instrument: 'test-instrument',
    });

describe('a hold moves on the rail, not only in the record', () => {
    let storage: SqliteStorage;

    beforeEach(() => {
        storage = new SqliteStorage(':memory:');
    });

    it('capture calls the rail with the captured amount and the hold\'s own tracking code', async () => {
        const { calls } = spyHandler('spy.capture.ok');
        const parties = await twoParties(storage, 'a');
        const hold = await makeHold(storage, parties, 'spy.capture.ok');

        const after = await captureHold(storage, config, parties.seller, hold.id, 62_000000);

        expect(after.status).toBe('captured');
        expect(after.capturedAmount).toBe(62_000000);
        // The assertion e2e-commerce-holds cannot make: the money instruction left the node.
        const capture = calls.find(c => c.kind === 'capture');
        expect(capture, 'the rail was never asked to capture').toBeDefined();
        expect(capture!.amount).toBe(62_000000);
        expect(capture!.trackingCode).toBe(hold.trackingCode);
    });

    it('a rail that REFUSES the capture leaves the hold held, not captured', async () => {
        // Refuse before you write. If the state flip happened first, or the throw were swallowed, the
        // record would announce money that never moved — which is the same defect one step later.
        const { calls } = spyHandler('spy.capture.fail', { failCapture: true });
        const parties = await twoParties(storage, 'b');
        const hold = await makeHold(storage, parties, 'spy.capture.fail');

        await expect(captureHold(storage, config, parties.seller, hold.id, 62_000000)).rejects.toThrow();
        expect(calls.some(c => c.kind === 'capture')).toBe(true);

        const stored = await storage.getMemory(`${parties.seller}@${NODE}`, `commerce.hold-in.${hold.id}`)
            ?? await storage.getMemory(`${parties.buyer}@${NODE}`, `commerce.hold.${hold.id}`);
        const record = stored?.value as unknown as { status: string; capturedAmount?: number } | undefined;
        expect(record, 'the hold record is readable').toBeDefined();
        expect(record!.status).toBe('held');
        expect(record!.capturedAmount ?? null).toBeNull();
    });

    it('release calls the rail, and a rail that refuses leaves the hold held', async () => {
        const ok = spyHandler('spy.release.ok');
        const partiesOk = await twoParties(storage, 'c');
        const holdOk = await makeHold(storage, partiesOk, 'spy.release.ok');
        const released = await releaseHold(storage, config, partiesOk.buyer, holdOk.id);
        expect(released.status).toBe('released');
        expect(ok.calls.find(c => c.kind === 'release')?.trackingCode).toBe(holdOk.trackingCode);

        const bad = spyHandler('spy.release.fail', { failRelease: true });
        const partiesBad = await twoParties(storage, 'd');
        const holdBad = await makeHold(storage, partiesBad, 'spy.release.fail');
        await expect(releaseHold(storage, config, partiesBad.buyer, holdBad.id)).rejects.toThrow();
        expect(bad.calls.some(c => c.kind === 'release')).toBe(true);

        const stored = await storage.getMemory(`${partiesBad.buyer}@${NODE}`, `commerce.hold.${holdBad.id}`);
        expect((stored?.value as unknown as { status: string }).status).toBe('held');
    });
});
