/**
 * @file src/commerce/test-money-handler.ts
 * @description TEST-ONLY money payment handler (EUR/USD) that settles WITHOUT a real PSP, so the
 *   priced-raw-call MONEY chain (checkout → settle → mint one-time token → retry) and the hold
 *   rail (authorize → capture | release) can be proven end-to-end in OSS E2E. Off-ledger: it
 *   simulates the PSP charging the buyer's instrument and paying the seller's connected account —
 *   it moves NO morsel balances. Holds keep module-local state so capture-over-amount and
 *   double-capture fail exactly like the real rail. Registered ONLY when
 *   `config.testMoneyHandler` (env AIMEAT_TEST_MONEY_HANDLER='true'); NEVER in production, where
 *   the Stripe handler (`com.stripe.spt`) is the real money rail.
 * @version-history
 *   v1.1.0 — 2026-08-06 — Hold rail double (TINKI phase 1): stateful authorize/capture/release
 *   v1.0.0 — 2026-07-17 — Initial (Phase 3 — E2E money rail double)
 */
import { randomUUID } from 'node:crypto';
import type { PaymentHandler } from './types.js';
import { PaymentError } from './payment-handlers.js';

export const TEST_MONEY_HANDLER_ID = 'test.money';

/** Module-local hold ledger: mirrors the semantics a real PSP enforces server-side. */
const holds = new Map<string, { amount: number; state: 'held' | 'captured' | 'released' }>();

/** A fake EUR/USD rail for tests: collect/payout/refund/holds succeed without touching the ledger. */
export function testMoneyPaymentHandler(): PaymentHandler {
  return {
    id: TEST_MONEY_HANDLER_ID,
    title: 'Test money (E2E only — no real PSP)',
    currencies: ['EUR', 'USD'],
    async collect(_ctx, { reference }) {
      return { trackingCode: `testmoney_${randomUUID()}:${reference}` };
    },
    async payout() { /* simulate paying the seller's connected account — off-ledger */ },
    async refund() { /* simulate reversing the charge — off-ledger */ },

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
