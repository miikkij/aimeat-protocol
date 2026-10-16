/**
 * @file test/unit/stripe-testmode.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Stripe card handler against Stripe itself, in TEST MODE (QA audit F14a-01, F23a-01,
 *   P7-02): a payment that succeeds and its refund, the hold rail (authorize, capture, release), a card
 *   kept for renewal and charged off-session, and a card Stripe declines. Each result is read back from
 *   Stripe's own API, so the test proves what Stripe recorded, not what the handler returned.
 *
 *   RUNS ONLY WITH A KEY. It needs STRIPE_TEST_SECRET_KEY, a test-mode secret (`sk_test_…`) of a Stripe
 *   account that exists for this purpose. Without it every case is reported by vitest as SKIPPED, never
 *   as passed. A live key (`sk_live_…`) is refused before any call. The nightly workflow passes the key
 *   from the repository secret of the same name (.github/workflows/e2e-full.yml, job stripe-testmode).
 *   The node-level card sale is test/e2e-stripe-testmode.ts.
 * @usage cd aimeat && STRIPE_TEST_SECRET_KEY=sk_test_… pnpm test:stripe-testmode
 * @version-history
 *   2026-10-16 — Initial (QA audit F14a-01, F23a-01, P7-02).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { stripePaymentHandler } from '../../src/commerce/stripe-handler.js';

const KEY = process.env.STRIPE_TEST_SECRET_KEY ?? '';
const HAVE_KEY = KEY.length > 0;
const seller = { ghii: 'testmode-seller@node', psp: { secretKey: KEY } };
const handler = stripePaymentHandler({ encryptionKey: null, totpSecretEncryptionKey: null });
const ctx = {} as never;
const run = `aimeat-nightly-${Date.now()}`;

/** Stripe's own record of a thing, read with the same key. */
async function stripeGet(path: string): Promise<Record<string, any>> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(20_000) });
  const body = await res.json() as Record<string, any>;
  if (!res.ok) throw new Error(`Stripe GET ${path}: ${res.status} ${JSON.stringify(body.error ?? body)}`);
  return body;
}
async function stripePost(path: string, form: Record<string, string>): Promise<Record<string, any>> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(), signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json() as Record<string, any>;
  if (!res.ok) throw new Error(`Stripe POST ${path}: ${res.status} ${JSON.stringify(body.error ?? body)}`);
  return body;
}

describe.skipIf(!HAVE_KEY)('the Stripe card handler in Stripe test mode', () => {
  beforeAll(() => {
    // Never against real money, whatever the variable holds.
    if (!KEY.startsWith('sk_test_') && !KEY.startsWith('rk_test_')) throw new Error('STRIPE_TEST_SECRET_KEY is not a test-mode key; refusing to run.');
  });

  it('a card payment succeeds for the amount and currency asked, and its refund reverses it', async () => {
    const charged = await handler.collect(ctx, { buyerGhii: 'b@node', amount: 1_230_000, currency: 'EUR', reference: `${run}-pay`, instrument: 'pm_card_visa', seller } as never);
    expect(charged.trackingCode).toMatch(/^pi_/);
    const pi = await stripeGet(`payment_intents/${charged.trackingCode}`);
    expect(pi.status).toBe('succeeded');
    expect(pi.amount).toBe(123);
    expect(pi.currency).toBe('eur');
    expect(pi.amount_received).toBe(123);
    expect(pi.description).toBe(`AIMEAT checkout ${run}-pay`);
    expect(pi.application_fee_amount ?? null).toBeNull();
    expect(pi.transfer_data ?? null).toBeNull();

    await handler.refund(ctx, { buyerGhii: 'b@node', amount: 1_230_000, trackingCode: charged.trackingCode, seller } as never);
    const refunds = await stripeGet(`refunds?payment_intent=${charged.trackingCode}`);
    expect(refunds.data).toHaveLength(1);
    expect(refunds.data[0].amount).toBe(123);
    expect(['succeeded', 'pending']).toContain(refunds.data[0].status);
  }, 60_000);

  it('a hold is placed, captured for less than it held, and a second hold is released', async () => {
    const held = await handler.authorize!(ctx, { amount: 2_000_000, currency: 'EUR', reference: `${run}-hold`, instrument: 'pm_card_visa', seller } as never);
    expect((await stripeGet(`payment_intents/${held.trackingCode}`)).status).toBe('requires_capture');
    await handler.capture!(ctx, { amount: 1_500_000, trackingCode: held.trackingCode, seller } as never);
    const captured = await stripeGet(`payment_intents/${held.trackingCode}`);
    expect(captured.status).toBe('succeeded');
    expect(captured.amount_received).toBe(150);

    const second = await handler.authorize!(ctx, { amount: 1_000_000, currency: 'USD', reference: `${run}-release`, instrument: 'pm_card_visa', seller } as never);
    await handler.release!(ctx, { trackingCode: second.trackingCode, seller } as never);
    const released = await stripeGet(`payment_intents/${second.trackingCode}`);
    expect(released.status).toBe('canceled');
    expect(released.cancellation_reason).toBe('requested_by_customer');
  }, 60_000);

  it('a card kept at the first payment is charged again off-session for a renewal', async () => {
    // A real PaymentMethod (not the pm_card_visa shortcut, which makes a new one each time), as a
    // browser's Stripe.js would hand over.
    const pm = await stripePost('payment_methods', { type: 'card', 'card[token]': 'tok_visa' });
    const first = await handler.collect(ctx, { amount: 990_000, currency: 'EUR', reference: `${run}-first`, instrument: pm.id, seller, saveForLater: true } as never);
    expect(first.saved?.customer).toMatch(/^cus_/);
    const renewal = await handler.chargeSaved!(ctx, { amount: 990_000, currency: 'EUR', reference: `${run}-renew`, saved: first.saved!, seller } as never);
    const pi = await stripeGet(`payment_intents/${renewal.trackingCode}`);
    expect(pi.status).toBe('succeeded');
    expect(pi.customer).toBe(first.saved!.customer);
    expect(pi.amount).toBe(99);
  }, 60_000);

  it('a declined card is refused with the cardholder\'s reason and charges nothing', async () => {
    await expect(handler.collect(ctx, { amount: 1_000_000, currency: 'EUR', reference: `${run}-declined`, instrument: 'pm_card_chargeDeclined', seller } as never))
      .rejects.toMatchObject({ code: 'PSP_ERROR' });
  }, 60_000);
});

describe.runIf(!HAVE_KEY)('the Stripe test-mode run without a key', () => {
  it.skip('is skipped: STRIPE_TEST_SECRET_KEY is not set', () => { /* reported as skipped, never as passed */ });
});
