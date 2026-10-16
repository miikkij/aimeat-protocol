/**
 * @file test/unit/undelivered-payment.test.ts
 * @description After a checkout collected the money and the delivery failed: does the refund reach
 *   the payment rail, and does the buyer's message say what the rail actually did?
 *
 *   The checkout used to answer "Payment refunded" whatever the rail did: an x402 settlement cannot
 *   be reversed, a Stripe refund could fail, and the sentence was the same. The E2E suites see only
 *   the response body and run on the test payment handler, so the call to the rail and the record
 *   written for an unreturned payment are observed here, beside each other, with a spy rail.
 *
 *   Properties: the rail is asked to refund the collected tracking code and amount; only
 *   `refunded` says the payment came back; `failed` and `not_possible` say it was NOT returned, name
 *   the checkout reference and leave a record under the seller; `nothing_captured` says nothing is
 *   owed and leaves no record; a rail that throws or answers nothing counts as `failed`.
 * @usage cd aimeat && pnpm exec vitest run test/unit/undelivered-payment.test.ts
 * @version-history
 *   2026-10-16 — The session is stored before completion, as createSession stores it: completion now claims it in storage first (QA audit S8-04).
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F5-01, F7e-01, S8-05).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { registerPaymentHandler } from '../../src/commerce/payment-handlers.js';
import { registerSellableResolver } from '../../src/commerce/sellable-resolvers.js';
import { completeSession } from '../../src/commerce/session-service.js';
import { refundCollected, refundSentence, UNDELIVERED_PREFIX } from '../../src/commerce/undelivered-payment.js';
import type { CheckoutSessionRecord, PaymentHandler, RefundOutcome } from '../../src/commerce/types.js';

const NODE = 'unit-undelivered-001';
let storage: Storage;
let config: AimeatConfig;

interface RefundCall { amount: number; trackingCode: string }

/** A rail whose collect always succeeds and whose refund answers what the test asks for. */
function spyRail(id: string, answer: RefundOutcome | 'throw' | 'nothing') {
  const refunds: RefundCall[] = [];
  const handler = {
    id, title: 'spy rail', currencies: ['EUR'],
    async collect(_ctx: unknown, { reference }: { reference: string }) { return { trackingCode: `spy_${reference}` }; },
    async payout() { /* not reached: the delivery fails first */ },
    async refund(_ctx: unknown, { amount, trackingCode }: RefundCall) {
      refunds.push({ amount, trackingCode });
      if (answer === 'throw') throw new Error('rail down');
      if (answer === 'nothing') return undefined;
      return answer;
    },
  } as unknown as PaymentHandler;
  registerPaymentHandler(handler);
  return { handler, refunds };
}

// A line kind whose delivery always fails, so the checkout reaches its refund branch.
registerSellableResolver({
  kind: 'unit-broken',
  async resolve() {
    return {
      kind: 'unit-broken', agentGaii: `seller@${NODE}`, agentName: 'seller', offerId: 'broken', title: 'A broken thing',
      sellerOwner: 'seller', sellerGhii: `seller@${NODE}`, unitPrice: 5_000_000, tollMorsels: 0,
      async fulfill() { throw new Error('The capability behind this tool is gone.'); },
    };
  },
});

function openSession(id: string): CheckoutSessionRecord {
  const now = new Date();
  return {
    id, status: 'open', buyerOwner: 'buyer', buyerGhii: `buyer@${NODE}`, buyerIdentity: `buyer@${NODE}`,
    sellerOwner: 'seller', sellerGhii: `seller@${NODE}`,
    items: [{ kind: 'unit-broken', agent: `seller@${NODE}`, offerId: 'broken', title: 'A broken thing', unitPrice: 5_000_000, quantity: 1, tollMorsels: 0 }],
    currency: 'EUR', total: 5_000_000,
    createdAt: now.toISOString(), updatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
  } as unknown as CheckoutSessionRecord;
}

async function completeFailing(railId: string, sessionId: string): Promise<{ code: string; status: number; message: string }> {
  // The session is stored first, as createSession stores it: completion claims it in storage
  // (commerce/session-claim.ts, QA audit S8-04) before it collects.
  const session = openSession(sessionId);
  const now = new Date().toISOString();
  await storage.setMemory({
    key: `commerce.session.${sessionId}`, ownerGaii: session.buyerGhii, value: session as unknown as Record<string, unknown>,
    visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
  } as never);
  try {
    await completeSession(storage, config, session, railId, 'instrument');
  } catch (e) {
    const err = e as { code: string; statusCode: number; message: string };
    return { code: err.code, status: err.statusCode, message: err.message };
  }
  throw new Error('the checkout completed although its delivery fails');
}

const recordOf = async (sessionId: string) =>
  (await storage.getMemory(`seller@${NODE}`, `${UNDELIVERED_PREFIX}${sessionId}`))?.value as Record<string, unknown> | undefined;

beforeEach(() => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  config = { ...loadConfig().config, nodeId: NODE, baseUrl: 'https://node.test' };
});

describe('a failed delivery after the collect', () => {
  it('asks the rail to refund the collected amount and tracking code, and says "refunded" only then', async () => {
    const { refunds } = spyRail('spy.refunds', { outcome: 'refunded' });
    const r = await completeFailing('spy.refunds', 'sess-ok');
    expect(refunds).toEqual([{ amount: 5_000_000, trackingCode: 'spy_sess-ok' }]);
    expect(r.status).toBe(502);
    expect(r.code).toBe('FULFILLMENT_FAILED');
    expect(r.message).toMatch(/The payment was refunded\./);
    expect(r.message).toMatch(/capability behind this tool is gone/);
    expect(await recordOf('sess-ok'), 'a refunded payment leaves no undelivered record').toBeUndefined();
  });

  it('a refund that fails says the money was NOT returned, names the checkout, and leaves a record for the seller', async () => {
    const { refunds } = spyRail('spy.fails', { outcome: 'failed', detail: 'the rail said no' });
    const r = await completeFailing('spy.fails', 'sess-fail');
    expect(refunds.length).toBe(1);
    expect(r.code).toBe('FULFILLMENT_FAILED');
    expect(r.message).not.toMatch(/was refunded/i);
    expect(r.message).toMatch(/NOT returned/);
    expect(r.message).toMatch(/sess-fail/);
    expect(r.message).toMatch(/Contact the seller/);
    const rec = await recordOf('sess-fail');
    expect(rec).toMatchObject({
      type: 'aimeat:UndeliveredPayment', sessionId: 'sess-fail', trackingCode: 'spy_sess-fail',
      buyer: `buyer@${NODE}`, seller: `seller@${NODE}`, amount: 5_000_000, currency: 'EUR', rail: 'spy.fails',
      refund: { outcome: 'failed', detail: 'the rail said no' }, status: 'open',
    });
  });

  it('a rail that cannot refund (an onchain transfer) says so and leaves a record', async () => {
    spyRail('spy.final', { outcome: 'not_possible' });
    const r = await completeFailing('spy.final', 'sess-final');
    expect(r.message).not.toMatch(/was refunded/i);
    expect(r.message).toMatch(/cannot return it/);
    expect((await recordOf('sess-final'))?.refund).toEqual({ outcome: 'not_possible' });
  });

  it('nothing captured (a manual invoice) says nothing is owed and leaves no record', async () => {
    spyRail('spy.invoice', { outcome: 'nothing_captured' });
    const r = await completeFailing('spy.invoice', 'sess-inv');
    expect(r.message).toMatch(/No payment was taken/);
    expect(r.message).not.toMatch(/refunded/i);
    expect(await recordOf('sess-inv')).toBeUndefined();
  });

  it('a rail that throws, or answers nothing, counts as a failed refund', async () => {
    spyRail('spy.throws', 'throw');
    const thrown = await completeFailing('spy.throws', 'sess-throw');
    expect(thrown.message).toMatch(/NOT returned/);
    expect(((await recordOf('sess-throw'))?.refund as RefundOutcome).outcome).toBe('failed');

    const silent = spyRail('spy.silent', 'nothing');
    expect(await refundCollected({ config, storage }, silent.handler, { buyerGhii: 'b', amount: 1, trackingCode: 't' }))
      .toMatchObject({ outcome: 'failed' });
  });
});

describe('the sentence about the money', () => {
  it('only "refunded" says the payment came back', () => {
    expect(refundSentence({ outcome: 'refunded' }, 's1')).toMatch(/refunded/);
    for (const outcome of ['failed', 'not_possible', 'nothing_captured'] as const) {
      expect(refundSentence({ outcome }, 's1'), outcome).not.toMatch(/was refunded/i);
    }
  });
});
