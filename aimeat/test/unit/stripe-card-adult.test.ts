/**
 * @file test/unit/stripe-card-adult.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The hosted card page (commerce/stripe-checkout.ts) and the credit-card adult check
 *   (commerce/stripe-handler.ts recordCreditCardAdult), with Stripe answered by a stand-in for
 *   safeFetch. What it proves: the page is opened for exactly the session's total with the session in
 *   its metadata; completion takes the payment only when Stripe says it is paid, for this session,
 *   amount and currency; a CREDIT card records the buyer as a verified adult and a debit or prepaid
 *   card does not, on both card paths (Jouni's ruling, Comicland v3 A-4).
 * @version-history
 *   v1.1.0 — 2026-10-25 — A test-mode credit card payment records no adult check, on both card
 *     paths (secaudit2026oct22).
 *   v1.0.0 — 2026-10-18 — Initial (Comicland v3 A-4).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

let answer: Record<string, unknown> = {};
const sent: Array<{ url: string; body: string; method: string }> = [];
vi.mock('../../src/utils/url-validator.js', () => ({
  safeFetch: async (url: string, init: { body?: string; method?: string }) => {
    sent.push({ url, body: String(init.body ?? ''), method: String(init.method ?? 'GET') });
    return new Response(JSON.stringify(answer), { status: 200 });
  },
}));

import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { CheckoutSessionRecord } from '../../src/commerce/types.js';
import { openStripeCheckout, stripeCheckoutHandler } from '../../src/commerce/stripe-checkout.js';
import { stripePaymentHandler } from '../../src/commerce/stripe-handler.js';
import { readAdult } from '../../src/services/adult-assurance.js';

const config = { encryptionKey: null, totpSecretEncryptionKey: null, baseUrl: 'https://node.test' };
const seller = { ghii: 'shop@node', owner: 'shop', psp: { secretKey: 'sk_test_stand_in' } };
const BUYER = 'reader@node';
let storage: Storage;

const session = (over: Partial<CheckoutSessionRecord> = {}): CheckoutSessionRecord => ({
  id: 'chk_abc', status: 'open', total: 4_990_000, currency: 'EUR', buyerGhii: BUYER,
  sellerGhii: 'shop@node', updatedAt: '2026-10-18T10:00:00Z', expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  items: [{ title: 'Harbour Lights, episode 3', input: {} }],
  ...over,
} as unknown as CheckoutSessionRecord);

const paidSession = (funding: string, over: Record<string, unknown> = {}) => ({
  id: 'cs_test_1', payment_status: 'paid', amount_total: 499, currency: 'eur',
  metadata: { aimeat_session: 'chk_abc', aimeat_buyer: BUYER },
  payment_intent: { id: 'pi_1', payment_method: 'pm_1', latest_charge: { payment_method_details: { card: { funding } } } },
  ...over,
});

beforeEach(() => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  sent.length = 0;
});

describe('openStripeCheckout', () => {
  it('opens the page for exactly the session total, with the session and buyer in the metadata', async () => {
    answer = { id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' };
    const page = await openStripeCheckout(config, session(), seller.psp, 'https://comicland.apps.test/read?ep=3');
    expect(page.url).toBe('https://checkout.stripe.com/c/pay/cs_test_1');
    const form = new URLSearchParams(sent[0].body);
    expect(sent[0].url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe('499');
    expect(form.get('line_items[0][price_data][currency]')).toBe('eur');
    expect(form.get('metadata[aimeat_session]')).toBe('chk_abc');
    expect(form.get('metadata[aimeat_buyer]')).toBe(BUYER);
    expect(form.get('success_url')).toContain('stripe_session={CHECKOUT_SESSION_ID}');
    expect(form.get('success_url')).toContain('ep=3');
    expect(form.get('payment_intent_data[setup_future_usage]')).toBeNull();
  });
  it('keeps the card for renewals when a line renews', async () => {
    answer = { id: 'cs_test_1', url: 'https://checkout.stripe.com/x' };
    await openStripeCheckout(config, session({ items: [{ title: 'Monthly', input: { auto_renew: true } }] } as never), seller.psp, 'https://a.test/');
    expect(new URLSearchParams(sent[0].body).get('payment_intent_data[setup_future_usage]')).toBe('off_session');
  });
  it('refuses a session that is not open, or has nothing to pay', async () => {
    await expect(openStripeCheckout(config, session({ status: 'completed' } as never), seller.psp, 'https://a.test/')).rejects.toMatchObject({ code: 'SESSION_NOT_OPEN' });
    await expect(openStripeCheckout(config, session({ total: 0 } as never), seller.psp, 'https://a.test/')).rejects.toMatchObject({ code: 'NOTHING_TO_PAY' });
    expect(sent.length).toBe(0);
  });
});

describe('the hosted page handler', () => {
  const collect = (instrument: unknown) => stripeCheckoutHandler(config).collect({ config: config as never, storage }, {
    buyerGhii: BUYER, amount: 4_990_000, currency: 'EUR', reference: 'chk_abc', fee: 0, instrument, seller,
  });

  it('takes a paid credit card payment and records the buyer as a verified adult', async () => {
    answer = paidSession('credit');
    const r = await collect('cs_test_1');
    expect(r.trackingCode).toBe('pi_1');
    expect(sent[0].url).toContain('checkout/sessions/cs_test_1?expand[]=payment_intent.latest_charge');
    expect(await readAdult(storage, BUYER)).toMatchObject({ verified: true, method: 'credit-card' });
  });
  it('a debit or a prepaid card pays, and records nothing', async () => {
    answer = paidSession('debit');
    await collect('cs_test_1');
    answer = paidSession('prepaid');
    await collect('cs_test_1');
    expect((await readAdult(storage, BUYER)).verified).toBe(false);
  });
  it('refuses a payment for another checkout, another amount, or one not paid', async () => {
    answer = paidSession('credit', { metadata: { aimeat_session: 'chk_other' } });
    await expect(collect('cs_test_1')).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' });
    answer = paidSession('credit', { amount_total: 1 });
    await expect(collect('cs_test_1')).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' });
    answer = paidSession('credit', { payment_status: 'unpaid' });
    await expect(collect('cs_test_1')).rejects.toMatchObject({ code: 'PAYMENT_NOT_CAPTURED' });
    expect((await readAdult(storage, BUYER)).verified).toBe(false);
  });
  it('refuses anything but a Stripe Checkout Session id, before calling Stripe', async () => {
    await expect(collect('pm_card_visa')).rejects.toMatchObject({ code: 'PAYMENT_INSTRUMENT_REQUIRED' });
    expect(sent.length).toBe(0);
  });
});

describe('the direct card handler', () => {
  const collect = () => stripePaymentHandler(config).collect({ config: config as never, storage }, {
    buyerGhii: BUYER, amount: 4_990_000, currency: 'EUR', reference: 'chk_abc', fee: 0, instrument: 'pm_card_visa', seller,
  });
  it('asks Stripe for the charge and records a credit card as an adult check', async () => {
    answer = { id: 'pi_2', status: 'succeeded', latest_charge: { payment_method_details: { card: { funding: 'credit' } } } };
    await collect();
    expect(new URLSearchParams(sent[0].body).get('expand[]')).toBe('latest_charge');
    expect((await readAdult(storage, BUYER)).method).toBe('credit-card');
  });
  it('a debit card records nothing', async () => {
    answer = { id: 'pi_3', status: 'succeeded', latest_charge: { payment_method_details: { card: { funding: 'debit' } } } };
    await collect();
    expect((await readAdult(storage, BUYER)).verified).toBe(false);
  });
  it('a test-mode credit card pays and records nothing (secaudit2026oct22)', async () => {
    answer = { id: 'pi_4', status: 'succeeded', livemode: false, latest_charge: { livemode: false, payment_method_details: { card: { funding: 'credit' } } } };
    const r = await collect();
    expect(r.trackingCode).toBe('pi_4');
    expect((await readAdult(storage, BUYER)).verified).toBe(false);
  });
  it('a live-mode credit card records the adult check', async () => {
    answer = { id: 'pi_5', status: 'succeeded', livemode: true, latest_charge: { livemode: true, payment_method_details: { card: { funding: 'credit' } } } };
    await collect();
    expect((await readAdult(storage, BUYER)).method).toBe('credit-card');
  });
});

describe('the hosted page handler in test mode', () => {
  it('a test-mode credit card pays and records nothing (secaudit2026oct22)', async () => {
    answer = paidSession('credit', {
      livemode: false,
      payment_intent: { id: 'pi_1', livemode: false, payment_method: 'pm_1', latest_charge: { livemode: false, payment_method_details: { card: { funding: 'credit' } } } },
    });
    const r = await stripeCheckoutHandler(config).collect({ config: config as never, storage }, {
      buyerGhii: BUYER, amount: 4_990_000, currency: 'EUR', reference: 'chk_abc', fee: 0, instrument: 'cs_test_1', seller,
    });
    expect(r.trackingCode).toBe('pi_1');
    expect((await readAdult(storage, BUYER)).verified).toBe(false);
  });
});
