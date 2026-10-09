/**
 * @file test/unit/upstream-error-text.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An upstream service's error text stays out of the answer the caller gets. Stripe's
 *   error reached the buyer at checkout, with the seller's key state and its last four characters, and
 *   the e-invoicing operator's error body reached every owner who sent an invoice, where a gateway that
 *   echoes the bearer would have handed over the node's operator key. The caller now gets a plain
 *   sentence and a code; the detail goes to the log, redacted. A card refusal, whose text Stripe writes
 *   for the buyer, still reaches the buyer. Secrets audit 2026-10-09, 07-side-channels d5.
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit, finding d5).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchAnswer: { status: number; body: string } = { status: 200, body: '{}' };
vi.mock('../../src/utils/url-validator.js', async (orig) => ({
  ...(await orig<typeof import('../../src/utils/url-validator.js')>()),
  safeFetch: vi.fn(async () => new Response(fetchAnswer.body, { status: fetchAnswer.status })),
}));

const { stripePaymentHandler } = await import('../../src/commerce/stripe-handler.js');
const { getFinvoiceOperator } = await import('../../src/services/finance/finvoice-operator.js');
import type { AimeatConfig } from '../../src/config.js';
import type { InvoiceRecord } from '../../src/models/finance-schemas.js';

const CANARY = 'CANARYk3yQ9wZ7';
const encryption = { encryptionKey: null, totpSecretEncryptionKey: null };

async function stripeRefusal(status: number, body: unknown): Promise<{ code: string; message: string }> {
  fetchAnswer.status = status;
  fetchAnswer.body = JSON.stringify(body);
  const handler = stripePaymentHandler(encryption);
  try {
    await handler.collect({} as never, {
      amount: 5_000_000, currency: 'EUR', reference: 'chk_1', instrument: 'pm_card_visa',
      seller: { psp: { secretKey: 'sk_test_seller' } },
    } as never);
  } catch (e) {
    return { code: (e as { code: string }).code, message: (e as Error).message };
  }
  throw new Error('collect did not refuse');
}

describe('Stripe error text and the buyer', () => {
  beforeEach(() => { fetchAnswer.status = 200; fetchAnswer.body = '{}'; });

  it('a refused seller key does not reach the buyer', async () => {
    const r = await stripeRefusal(401, { error: { type: 'invalid_request_error', message: `Invalid API Key provided: sk_live_****${CANARY}` } });
    expect(r.code).toBe('PSP_ERROR');
    expect(r.message).not.toContain(CANARY);
    expect(r.message).not.toMatch(/API Key/i);
  });

  it('an account-state error does not reach the buyer', async () => {
    const r = await stripeRefusal(400, { error: { type: 'invalid_request_error', message: `Your account ${CANARY} cannot currently make live charges.` } });
    expect(r.code).toBe('PSP_ERROR');
    expect(r.message).not.toContain(CANARY);
  });

  it('a non-JSON body does not reach the buyer', async () => {
    fetchAnswer.status = 200;
    fetchAnswer.body = `<html>proxy ${CANARY}</html>`;
    const handler = stripePaymentHandler(encryption);
    const err = await handler.collect({} as never, {
      amount: 5_000_000, currency: 'EUR', reference: 'chk_1', instrument: 'pm_card_visa',
      seller: { psp: { secretKey: 'sk_test_seller' } },
    } as never).catch((e: Error) => e);
    expect((err as Error).message).not.toContain(CANARY);
  });

  it('a card refusal still tells the buyer what Stripe wrote for them', async () => {
    const r = await stripeRefusal(402, { error: { type: 'card_error', code: 'card_declined', message: 'Your card was declined.' } });
    expect(r.message).toContain('Your card was declined.');
  });
});

describe('e-invoicing operator error text and the invoice sender', () => {
  const config = { finvoiceOperator: 'rest', finvoiceOperatorUrl: 'https://operator.example', finvoiceOperatorApiKey: CANARY } as unknown as AimeatConfig;
  const invoice = { id: 'inv1', buyer: {} } as unknown as InvoiceRecord;

  it('an operator that echoes the bearer does not hand it to the sender', async () => {
    fetchAnswer.status = 401;
    fetchAnswer.body = `{"error":"bad credentials","received":"Bearer ${CANARY}"}`;
    const err = await getFinvoiceOperator(config)!.submit(invoice, '<xml/>').catch((e: Error) => e) as Error & { code: string };
    expect(err.code).toBe('OPERATOR_REJECTED');
    expect(err.message).not.toContain(CANARY);
    expect(err.message).not.toContain('bad credentials');
  });

  it('an ack without a message id does not hand its body to the sender', async () => {
    fetchAnswer.status = 200;
    fetchAnswer.body = `{"echo":"${CANARY}"}`;
    const err = await getFinvoiceOperator(config)!.submit(invoice, '<xml/>').catch((e: Error) => e) as Error & { code: string };
    expect(err.code).toBe('OPERATOR_PROTOCOL');
    expect(err.message).not.toContain(CANARY);
  });
});
