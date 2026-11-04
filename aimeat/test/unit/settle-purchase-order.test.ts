/**
 * @file test/unit/settle-purchase-order.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A checkout whose completion cannot be written books no sale: the operator's platform
 *   fee record is written in one transaction with the completed session and the seller's order copy
 *   (commerce/settle-purchase.ts). Before, the fee was booked first, so a failed completion write left
 *   a fee receivable for a sale that never completed. Usage case (passes before and after): a
 *   completion books one fee record of the same amount and answers the same receipt. A spy rail
 *   stands in for the card rail; nothing leaves the process.
 * @usage cd aimeat && pnpm exec vitest run test/unit/settle-purchase-order.test.ts
 * @version-history
 *   2026-11-04 -- Initial (codebase analysis 2026-11-03, item B2).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { registerPaymentHandler } from '../../src/commerce/payment-handlers.js';
import { registerSellableResolver } from '../../src/commerce/sellable-resolvers.js';
import { completeSession, getSession } from '../../src/commerce/session-service.js';
import type { CheckoutSessionRecord, PaymentHandler } from '../../src/commerce/types.js';

const NODE = 'unit-settle-order';
const BUYER = `buyer@${NODE}`;
const SELLER = `seller@${NODE}`;
let storage: Storage;
let config: AimeatConfig;

registerPaymentHandler({
  id: 'spy.settle', title: 'spy rail', currencies: ['EUR'],
  async collect() { return { trackingCode: 'spy_settle_paid' }; },
  async payout() { /* the seller's leg is not under test */ },
  async refund() { return { outcome: 'refunded' }; },
} as unknown as PaymentHandler);

registerSellableResolver({
  kind: 'unit-settle-good',
  async resolve() {
    return {
      kind: 'unit-settle-good', agentGaii: SELLER, agentName: 'seller', offerId: 'good', title: 'A good thing',
      sellerOwner: 'seller', sellerGhii: SELLER, unitPrice: 2_000_000, tollMorsels: 0,
      async fulfill() { return { delivered: true }; },
    };
  },
});

async function stored(id: string): Promise<CheckoutSessionRecord> {
  const now = new Date();
  const session = {
    id, status: 'open', buyerOwner: 'buyer', buyerGhii: BUYER, buyerIdentity: BUYER,
    sellerOwner: 'seller', sellerGhii: SELLER,
    items: [{ kind: 'unit-settle-good', agent: SELLER, offerId: 'good', title: 'A good thing', unitPrice: 2_000_000, quantity: 1, tollMorsels: 0 }],
    currency: 'EUR', total: 2_000_000,
    createdAt: now.toISOString(), updatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
  } as unknown as CheckoutSessionRecord;
  await storage.setMemory({
    key: `commerce.session.${id}`, ownerGaii: BUYER, value: session as unknown as Record<string, unknown>,
    visibility: 'owner', tags: ['commerce'], ttlHours: null, version: 1, createdAt: now.toISOString(), updatedAt: now.toISOString(),
  } as never);
  return session;
}

const feeRecords = async () => (await storage.listAllMemory({ prefix: 'commerce.platform-fee.', limit: 50 })).items;

beforeEach(() => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  config = { ...loadConfig().config, nodeId: NODE, baseUrl: 'https://node.test', commerceFeePercent: 5, operatorFeeAccount: 'operator' };
});

describe('a checkout completion and its sale booking', () => {
  it('a completion write that fails leaves no platform fee booked', async () => {
    const session = await stored('cs-write-fails');
    const setMemory = storage.setMemory.bind(storage);
    // The seller's order copy is the completion's last write.
    (storage as unknown as { setMemory: typeof setMemory }).setMemory = async (rec) => {
      if (rec.key.startsWith('commerce.order.')) throw new Error('disk full');
      return setMemory(rec);
    };
    await expect(completeSession(storage, config, session, 'spy.settle', 'card')).rejects.toThrow('disk full');
    expect((await feeRecords()).length, 'a fee was booked for a completion that was never written').toBe(0);
    expect((await getSession(storage, BUYER, 'cs-write-fails'))?.status).not.toBe('completed');
  });

  it('designed use: a completion books one fee record and answers the same receipt', async () => {
    const done = await completeSession(storage, config, await stored('cs-ok'), 'spy.settle', 'card');
    expect(done.status).toBe('completed');
    expect(done.receipt).toMatchObject({ handler: 'spy.settle', charged: 2_000_000, fee: 100_000, earned: 1_900_000, trackingCode: 'spy_settle_paid' });
    const fees = await feeRecords();
    expect(fees.length).toBe(1);
    expect(fees[0]!.ownerGaii).toBe(`operator@${NODE}`);
    expect(fees[0]!.value).toMatchObject({ fee: 100_000, currency: 'EUR', mode: 'receivable', handler: 'spy.settle', sellerGhii: SELLER, buyerGhii: BUYER, trackingCode: 'spy_settle_paid' });
    expect((await storage.getMemory(SELLER, 'commerce.order.cs-ok'))?.value).toMatchObject({ status: 'completed' });
    expect((await getSession(storage, BUYER, 'cs-ok'))?.status).toBe('completed');
  });
});
