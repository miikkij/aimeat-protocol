/**
 * @file src/commerce/test-money-handler.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description TEST-ONLY money payment handler (EUR/USD) that settles WITHOUT a real PSP, so the
 *   priced-raw-call MONEY chain (checkout → settle → mint one-time token → retry) and the hold
 *   rail (authorize → capture | release) can be proven end-to-end in OSS E2E. It moves NO morsel
 *   balances: it simulates the PSP charging the buyer's instrument and paying the seller's connected
 *   account, and keeps the PSP's books of what it charged, held, refunded and paid out
 *   (commerce/test-money-ledger.ts, in storage under the node's system owner, so every process over
 *   one database reads the same books; operators read them at GET /v1/admin/test-money/ledger). The
 *   hold states live there too, written on their version, so capture-over-amount and double-capture
 *   fail exactly like the real rail. Registered ONLY when
 *   `config.testMoneyHandler` (env AIMEAT_TEST_MONEY_HANDLER='true'). A production node may run it
 *   on purpose, to test the money path before the flag is turned off; the start log and the Security
 *   page then say any buyer can complete a money checkout without paying. The Stripe handler
 *   (`com.stripe.spt`) is the real money rail.
 * @version-history
 *   2026-11-15 — Keeps the provider's books: collect and a saved-method charge add to charged, authorize
 *     to held, capture moves the hold to charged (a partial capture releases the rest), release ends
 *     the hold, a refund made adds to refunded and a payout to the payee's paid out. The hold states
 *     moved from a module-local Map into storage (audit M139).
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
import { accountOf, bookCapture, bookCharge, bookHold, bookPayout, bookRefund, bookRelease } from './test-money-ledger.js';

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

/**
 * A fake EUR/USD rail for tests: collect/payout/refund/holds succeed without a PSP and without
 * touching morsel balances, and every movement is booked in the provider's books (test-money-ledger.ts).
 */
export function testMoneyPaymentHandler(): PaymentHandler {
  return {
    id: TEST_MONEY_HANDLER_ID,
    title: 'Test money (E2E only — no real PSP)',
    currencies: ['EUR', 'USD'],
    async collect(ctx, { buyerGhii, amount, currency, reference, instrument, saveForLater }) {
      // A saved method is named after the instrument, so a test can save one that will be declined.
      const saved = saveForLater ? { customer: `testcus_${randomUUID()}`, payment_method: typeof instrument === 'string' && instrument ? instrument : 'testpm' } : undefined;
      // The refund only sees the tracking code, so an instrument that asks for a refund outcome
      // other than `refunded` is carried in it.
      const mark = instrument === REFUND_FAILS ? 'refundfails_' : instrument === REFUND_IMPOSSIBLE ? 'refundimpossible_' : '';
      const trackingCode = instrument === REPLAY ? `testmoney_replay_${reference}` : `testmoney_${mark}${randomUUID()}:${reference}`;
      await bookCharge(ctx.storage, ctx.config, { account: accountOf(instrument, buyerGhii), amount, currency, trackingCode });
      return { trackingCode, ...(saved ? { saved } : {}) };
    },
    async chargeSaved(ctx, { amount, currency, reference, saved }) {
      if (saved.payment_method === 'decline') throw new PaymentError('CARD_DECLINED', 402, 'The saved card was declined (test).');
      const trackingCode = `testmoney_saved_${randomUUID()}:${reference}`;
      await bookCharge(ctx.storage, ctx.config, { account: saved.payment_method ?? 'testpm', amount, currency, trackingCode });
      return { trackingCode };
    },
    async payout(ctx, { toGhii, amount, currency, trackingCode }) {
      // Simulates paying the payee's connected account: booked on the payee, no morsel moves.
      await bookPayout(ctx.storage, ctx.config, { toGhii, amount, currency, trackingCode });
    },
    async refund(ctx, { buyerGhii, amount, trackingCode }) {
      // Simulates reversing the charge, unless the instrument asked for another outcome; an outcome
      // other than `refunded` books nothing, as the provider returned nothing.
      if (trackingCode.startsWith('testmoney_refundfails_')) return { outcome: 'failed', detail: 'The test payment method refused the refund (instrument "refund-fails").' };
      if (trackingCode.startsWith('testmoney_refundimpossible_')) return { outcome: 'not_possible', detail: 'The test payment method cannot refund (instrument "refund-impossible").' };
      // refund must not throw: a refund the books could not record is a refund the provider did not make.
      try {
        await bookRefund(ctx.storage, ctx.config, { buyerGhii, amount, trackingCode });
      } catch (err) {
        return { outcome: 'failed', detail: `The test payment provider could not book the refund: ${err instanceof Error ? err.message : String(err)}` };
      }
      return { outcome: 'refunded' };
    },

    async authorize(ctx, { buyerGhii, amount, currency, instrument }) {
      if (typeof instrument !== 'string' || !instrument) {
        throw new PaymentError('PAYMENT_INSTRUMENT_REQUIRED', 402, 'Provide payment.instrument (any string in test mode)');
      }
      const trackingCode = `testhold_${randomUUID()}`;
      await bookHold(ctx.storage, ctx.config, { account: accountOf(instrument, buyerGhii), amount, currency, trackingCode });
      return { trackingCode };
    },

    async capture(ctx, { amount, trackingCode }) {
      // Throws HOLD_NOT_CAPTURABLE / CAPTURE_OVER_HELD, as the real rail answers.
      await bookCapture(ctx.storage, ctx.config, { trackingCode, amount });
    },

    async release(ctx, { trackingCode }) {
      // Throws HOLD_NOT_RELEASABLE, as the real rail answers.
      await bookRelease(ctx.storage, ctx.config, { trackingCode });
    },
  };
}
