/**
 * @file src/commerce/test-money-handler.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description TEST-ONLY money payment handler (EUR/USD) that settles WITHOUT a real PSP, so the
 *   priced-raw-call MONEY chain (checkout → settle → mint one-time token → retry) and the hold
 *   rail (authorize → capture | release) can be proven end-to-end in OSS E2E. Off-ledger: it
 *   simulates the PSP charging the buyer's instrument and paying the seller's connected account —
 *   it moves NO morsel balances. Holds keep module-local state so capture-over-amount and
 *   double-capture fail exactly like the real rail. Registered ONLY when
 *   `config.testMoneyHandler` (env AIMEAT_TEST_MONEY_HANDLER='true'). A production node may run it
 *   on purpose, to test the money path before the flag is turned off; the start log and the Security
 *   page then say any buyer can complete a money checkout without paying. The Stripe handler
 *   (`com.stripe.spt`) is the real money rail.
 * @version-history
 *   2026-10-25 — The instrument "replay" answers one tracking code per checkout, as a hosted card page
 *     read back again does, so a test can retry a refunded payment (secaudit2026oct22).
 *   2026-10-16 — refund answers a RefundOutcome; the instruments "refund-fails" and "refund-impossible"
 *     make it answer `failed` / `not_possible`, so a test can drive an unreturned payment (QA audit F7e-01).
 *   v1.3.1 — 2026-10-13 — Registered on any node while the flag is on (ruling
 *     decision-testiraha-toimii-julkisella-nodella-kun-operaattori-kytkee-s).
 *   v1.3.0 — 2026-10-11 — Registered only when testMoneyHandlerActive() says so: the flag AND a
 *     loopback public URL (utils/test-money-guard.ts). aimeat.io had run with the flag on.
 *   v1.2.0 — 2026-10-02 — saveForLater and chargeSaved: a saved method named after the instrument, and
 *     the instrument "decline" fails a later charge (automatic renewal in E2E).
 *   v1.1.0 — 2026-08-06 — Hold rail double (TINKI phase 1): stateful authorize/capture/release
 *   v1.0.0 — 2026-07-17 — Initial (Phase 3 — E2E money rail double)
 */
import { randomUUID } from 'node:crypto';
import type { PaymentHandler } from './types.js';
import { PaymentError } from './payment-handlers.js';

export { testMoneyHandlerActive } from '../utils/test-money-guard.js';

export const TEST_MONEY_HANDLER_ID = 'test.money';
/** Instrument values that make a later refund answer `failed` / `not_possible`, so a test can drive both. */
export const REFUND_FAILS = 'refund-fails';
export const REFUND_IMPOSSIBLE = 'refund-impossible';
/**
 * Instrument value whose collect answers the same tracking code for every try of one checkout, the
 * way Stripe answers a hosted card page read back again (the same PaymentIntent, refunded or not).
 */
export const REPLAY = 'replay';

/** Module-local hold ledger: mirrors the semantics a real PSP enforces server-side. */
const holds = new Map<string, { amount: number; state: 'held' | 'captured' | 'released' }>();

/** A fake EUR/USD rail for tests: collect/payout/refund/holds succeed without touching the ledger. */
export function testMoneyPaymentHandler(): PaymentHandler {
  return {
    id: TEST_MONEY_HANDLER_ID,
    title: 'Test money (E2E only — no real PSP)',
    currencies: ['EUR', 'USD'],
    async collect(_ctx, { reference, instrument, saveForLater }) {
      // A saved method is named after the instrument, so a test can save one that will be declined.
      const saved = saveForLater ? { customer: `testcus_${randomUUID()}`, payment_method: typeof instrument === 'string' && instrument ? instrument : 'testpm' } : undefined;
      // The refund only sees the tracking code, so an instrument that asks for a refund outcome
      // other than `refunded` is carried in it.
      const mark = instrument === REFUND_FAILS ? 'refundfails_' : instrument === REFUND_IMPOSSIBLE ? 'refundimpossible_' : '';
      if (instrument === REPLAY) return { trackingCode: `testmoney_replay_${reference}`, ...(saved ? { saved } : {}) };
      return { trackingCode: `testmoney_${mark}${randomUUID()}:${reference}`, ...(saved ? { saved } : {}) };
    },
    async chargeSaved(_ctx, { reference, saved }) {
      if (saved.payment_method === 'decline') throw new PaymentError('CARD_DECLINED', 402, 'The saved card was declined (test).');
      return { trackingCode: `testmoney_saved_${randomUUID()}:${reference}` };
    },
    async payout() { /* simulate paying the seller's connected account — off-ledger */ },
    async refund(_ctx, { trackingCode }) {
      // Simulates reversing the charge, off-ledger, unless the instrument asked for another outcome.
      if (trackingCode.startsWith('testmoney_refundfails_')) return { outcome: 'failed', detail: 'The test payment method refused the refund (instrument "refund-fails").' };
      if (trackingCode.startsWith('testmoney_refundimpossible_')) return { outcome: 'not_possible', detail: 'The test payment method cannot refund (instrument "refund-impossible").' };
      return { outcome: 'refunded' };
    },

    async authorize(_ctx, { amount, instrument }) {
      if (typeof instrument !== 'string' || !instrument) {
        throw new PaymentError('PAYMENT_INSTRUMENT_REQUIRED', 402, 'Provide payment.instrument (any string in test mode)');
      }
      const trackingCode = `testhold_${randomUUID()}`;
      holds.set(trackingCode, { amount, state: 'held' });
      return { trackingCode };
    },

    async capture(_ctx, { amount, trackingCode }) {
      const hold = holds.get(trackingCode);
      if (!hold || hold.state !== 'held') {
        throw new PaymentError('HOLD_NOT_CAPTURABLE', 409, `Hold ${trackingCode} is not in a capturable state`);
      }
      if (amount > hold.amount) {
        throw new PaymentError('CAPTURE_OVER_HELD', 422, `Capture ${amount} exceeds held ${hold.amount}`);
      }
      hold.state = 'captured';
    },

    async release(_ctx, { trackingCode }) {
      const hold = holds.get(trackingCode);
      if (!hold || hold.state !== 'held') {
        throw new PaymentError('HOLD_NOT_RELEASABLE', 409, `Hold ${trackingCode} is not in a releasable state`);
      }
      hold.state = 'released';
    },
  };
}
