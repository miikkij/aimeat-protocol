/**
 * @file test/unit/stripe-handler-requests.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Stripe card handler SENDS when Stripe accepts (QA audit F14a-01, F23a-01, P7-02).
 *   The only earlier test of the handler made Stripe refuse four times, so a wrong amount, currency,
 *   capture mode, key or form field on an ACCEPTED request would have shipped green: Stripe takes it,
 *   no log line is written, and the buyer's card is charged wrongly. Here safeFetch is replaced by a
 *   recorder that answers as Stripe does, and each of the seven methods is held to the request it
 *   makes: the path, the seller's own key in the Authorization header, the form fields, the amount in
 *   minor units, the capture mode, and no Connect or application-fee field (no platform sits between
 *   buyer and seller). The not-succeeded branches are asserted too. A real test-mode run is
 *   test/unit/stripe-testmode.test.ts, which needs STRIPE_TEST_SECRET_KEY.
 * @usage cd aimeat && pnpm exec vitest run test/unit/stripe-handler-requests.test.ts
 * @version-history
 *   2026-10-25 — A retry after a refunded attempt carries a new Idempotency-Key (secaudit2026oct22).
 *   2026-10-16 — Initial (QA audit F14a-01, F23a-01, P7-02).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface Sent { url: string; method: string; headers: Record<string, string>; form: Record<string, string> }
const sent: Sent[] = [];
const answers: Array<{ status: number; body: unknown }> = [];

vi.mock('../../src/utils/url-validator.js', async (orig) => ({
  ...(await orig<typeof import('../../src/utils/url-validator.js')>()),
  safeFetch: vi.fn(async (url: string, init: RequestInit) => {
    const form = Object.fromEntries(new URLSearchParams(String(init.body ?? '')));
    sent.push({ url, method: String(init.method), headers: init.headers as Record<string, string>, form });
    const a = answers.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(a.body), { status: a.status });
  }),
}));

const { stripePaymentHandler, SPT_STRIPE_VERSION } = await import('../../src/commerce/stripe-handler.js');

const KEY = 'sk_test_seller_own_key_1234';
const seller = { ghii: 'seller@node', psp: { secretKey: KEY } };
const handler = stripePaymentHandler({ encryptionKey: null, totpSecretEncryptionKey: null });
const ctx = {} as never;
const CONNECT_FIELDS = ['application_fee_amount', 'transfer_data[destination]', 'on_behalf_of', 'transfer_group'];

function only(): Sent {
  expect(sent).toHaveLength(1);
  return sent[0]!;
}
function noConnect(s: Sent) {
  for (const f of CONNECT_FIELDS) expect(s.form).not.toHaveProperty(f);
  expect(s.headers['Stripe-Account']).toBeUndefined();
}

describe('the Stripe handler on an accepted request', () => {
  beforeEach(() => { sent.length = 0; answers.length = 0; });

  it('collect confirms one PaymentIntent on the seller\'s key, in minor units and lower-case currency', async () => {
    answers.push({ status: 200, body: { id: 'pi_ok_1', status: 'succeeded' } });
    const r = await handler.collect(ctx, { buyerGhii: 'b@node', amount: 12_345_678, currency: 'EUR', reference: 'chk_1', instrument: 'pm_card_visa', seller } as never);
    expect(r).toEqual({ trackingCode: 'pi_ok_1' });
    const s = only();
    expect(s.url).toBe('https://api.stripe.com/v1/payment_intents');
    expect(s.method).toBe('POST');
    expect(s.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(s.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(s.form).toMatchObject({
      // 12.345678 EUR is 1234.5678 cents, which the money chokepoint rounds to 1235.
      amount: '1235', currency: 'eur', payment_method: 'pm_card_visa', confirm: 'true',
      'automatic_payment_methods[enabled]': 'true', 'automatic_payment_methods[allow_redirects]': 'never',
      description: 'AIMEAT checkout chk_1',
    });
    expect(s.form).not.toHaveProperty('capture_method');
    expect(s.form).not.toHaveProperty('customer');
    noConnect(s);
  });

  it('a retry after a refunded attempt carries a new Idempotency-Key; a first try keeps the old one (secaudit2026oct22)', async () => {
    const args = { buyerGhii: 'b@node', amount: 1_000_000, currency: 'EUR', reference: 'chk_r', instrument: 'pm_card_visa', seller };
    answers.push({ status: 200, body: { id: 'pi_a', status: 'succeeded' } }, { status: 200, body: { id: 'pi_b', status: 'succeeded' } }, { status: 200, body: { id: 'pi_a', status: 'succeeded' } });
    await handler.collect(ctx, args as never);
    await handler.collect(ctx, { ...args, attempt: 1 } as never);
    await handler.collect(ctx, args as never);
    const keys = sent.map(s => s.headers['Idempotency-Key']);
    expect(keys[0]).toMatch(/^aimeat-checkout-chk_r-[0-9a-f]{16}$/);
    expect(keys[1]).toMatch(/^aimeat-checkout-chk_r-r1-[0-9a-f]{16}$/);
    expect(keys[2]).toBe(keys[0]);
  });

  it('collect refuses an intent that did not succeed, with PAYMENT_NOT_CAPTURED', async () => {
    answers.push({ status: 200, body: { id: 'pi_x', status: 'requires_action' } });
    await expect(handler.collect(ctx, { amount: 1_000_000, currency: 'USD', reference: 'c', instrument: 'pm_x', seller } as never))
      .rejects.toMatchObject({ code: 'PAYMENT_NOT_CAPTURED', statusCode: 402 });
  });

  it('collect with saveForLater makes a customer first and keeps the card for off-session use', async () => {
    answers.push({ status: 200, body: { id: 'cus_1' } }, { status: 200, body: { id: 'pi_s', status: 'succeeded' } });
    const r = await handler.collect(ctx, { amount: 5_000_000, currency: 'EUR', reference: 'chk_s', instrument: 'pm_1', seller, saveForLater: true } as never);
    expect(r).toEqual({ trackingCode: 'pi_s', saved: { customer: 'cus_1', payment_method: 'pm_1' } });
    expect(sent.map(s => s.url)).toEqual(['https://api.stripe.com/v1/customers', 'https://api.stripe.com/v1/payment_intents']);
    expect(sent[1]!.form).toMatchObject({ customer: 'cus_1', setup_future_usage: 'off_session', amount: '500' });
  });

  it('collect with a shared payment token sends it as payment_method_data under the preview version, with nothing beside it', async () => {
    answers.push({ status: 200, body: { id: 'pi_spt', status: 'succeeded' } });
    await handler.collect(ctx, { amount: 2_000_000, currency: 'EUR', reference: 'chk_spt', instrument: 'spt_abc', seller } as never);
    const s = only();
    expect(s.headers['Stripe-Version']).toBe(SPT_STRIPE_VERSION);
    expect(s.form['payment_method_data[shared_payment_granted_token]']).toBe('spt_abc');
    expect(s.form).not.toHaveProperty('payment_method');
    expect(s.form).not.toHaveProperty('automatic_payment_methods[enabled]');
  });

  it('chargeSaved charges the kept card off-session for a renewal', async () => {
    answers.push({ status: 200, body: { id: 'pi_r', status: 'succeeded' } });
    const r = await handler.chargeSaved!(ctx, { amount: 990_000, currency: 'EUR', reference: 'renew_1', saved: { customer: 'cus_1', payment_method: 'pm_1' }, seller } as never);
    expect(r).toEqual({ trackingCode: 'pi_r' });
    expect(only().form).toMatchObject({ amount: '99', currency: 'eur', customer: 'cus_1', payment_method: 'pm_1', off_session: 'true', confirm: 'true', description: 'AIMEAT renewal renew_1' });
  });

  it('chargeSaved refuses a renewal that needs the buyer present', async () => {
    answers.push({ status: 200, body: { id: 'pi_r2', status: 'requires_action' } });
    await expect(handler.chargeSaved!(ctx, { amount: 990_000, currency: 'EUR', reference: 'r', saved: { customer: 'c', payment_method: 'p' }, seller } as never))
      .rejects.toMatchObject({ code: 'PAYMENT_NOT_CAPTURED' });
  });

  it('refund reverses the intent for the whole amount, in minor units, on the seller\'s key', async () => {
    answers.push({ status: 200, body: { id: 're_1', status: 'succeeded' } });
    await handler.refund(ctx, { buyerGhii: 'b', amount: 2_000_000, trackingCode: 'pi_ok_1', seller } as never);
    const s = only();
    expect(s.url).toBe('https://api.stripe.com/v1/refunds');
    expect(s.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(s.form).toEqual({ payment_intent: 'pi_ok_1', amount: '200' });
  });

  it('authorize places a manual-capture hold and refuses one that did not reach requires_capture', async () => {
    answers.push({ status: 200, body: { id: 'pi_h', status: 'requires_capture' } });
    const r = await handler.authorize!(ctx, { amount: 3_000_000, currency: 'EUR', reference: 'hold_1', instrument: 'pm_card_visa', seller } as never);
    expect(r).toEqual({ trackingCode: 'pi_h' });
    expect(only().form).toMatchObject({ amount: '300', currency: 'eur', capture_method: 'manual', confirm: 'true', payment_method: 'pm_card_visa', description: 'AIMEAT hold hold_1' });
    sent.length = 0;
    answers.push({ status: 200, body: { id: 'pi_h2', status: 'succeeded' } });
    await expect(handler.authorize!(ctx, { amount: 3_000_000, currency: 'EUR', reference: 'h', instrument: 'pm_x', seller } as never))
      .rejects.toMatchObject({ code: 'HOLD_NOT_PLACED' });
  });

  it('capture takes up to the held amount and refuses a capture that did not succeed', async () => {
    answers.push({ status: 200, body: { id: 'pi_h', status: 'succeeded' } });
    await handler.capture!(ctx, { amount: 1_500_000, trackingCode: 'pi_h', seller } as never);
    const s = only();
    expect(s.url).toBe('https://api.stripe.com/v1/payment_intents/pi_h/capture');
    expect(s.form).toEqual({ amount_to_capture: '150' });
    sent.length = 0;
    answers.push({ status: 200, body: { id: 'pi_h', status: 'requires_capture' } });
    await expect(handler.capture!(ctx, { amount: 1_500_000, trackingCode: 'pi_h', seller } as never)).rejects.toMatchObject({ code: 'CAPTURE_FAILED' });
  });

  it('release cancels the uncaptured intent', async () => {
    answers.push({ status: 200, body: { id: 'pi_h', status: 'canceled' } });
    await handler.release!(ctx, { trackingCode: 'pi_h', seller } as never);
    const s = only();
    expect(s.url).toBe('https://api.stripe.com/v1/payment_intents/pi_h/cancel');
    expect(s.form).toEqual({ cancellation_reason: 'requested_by_customer' });
  });

  it('a seller with no key gets PSP_NOT_CONFIGURED and nothing is sent', async () => {
    await expect(handler.collect(ctx, { amount: 1_000_000, currency: 'EUR', reference: 'c', instrument: 'pm', seller: { ghii: 's', psp: {} } } as never))
      .rejects.toMatchObject({ code: 'PSP_NOT_CONFIGURED', statusCode: 403 });
    expect(sent).toHaveLength(0);
  });
});
