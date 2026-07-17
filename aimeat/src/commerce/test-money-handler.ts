/**
 * @file src/commerce/test-money-handler.ts
 * @description TEST-ONLY money payment handler (EUR/USD) that settles WITHOUT a real PSP, so the
 *   priced-raw-call MONEY chain (checkout → settle → mint one-time token → retry) can be proven
 *   end-to-end in OSS E2E. Off-ledger: it simulates the PSP charging the buyer's instrument and
 *   paying the seller's connected account — it moves NO morsel balances. Registered ONLY when
 *   `config.testMoneyHandler` (env AIMEAT_TEST_MONEY_HANDLER='true'); NEVER in production, where
 *   the EE Stripe handler (`com.stripe.spt`) is the real money rail.
 * @version-history
 *   v1.0.0 — 2026-07-17 — Initial (Phase 3 — E2E money rail double)
 */
import { randomUUID } from 'node:crypto';
import type { PaymentHandler } from './types.js';

export const TEST_MONEY_HANDLER_ID = 'test.money';

/** A fake EUR/USD rail for tests: collect/payout/refund succeed without touching the ledger. */
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
  };
}
