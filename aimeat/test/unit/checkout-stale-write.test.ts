/**
 * @file test/unit/checkout-stale-write.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A checkout change or cancel based on a copy of the session read before a completion
 *   does not put the stored session back to open, so the same payment cannot complete it again and
 *   deliver every line a second time. The change and the cancel decide on the stored session, inside
 *   a compare-and-swap. Usage cases (pass before and after): a change and a cancel on an open session,
 *   and a completion. A spy rail stands in for the card rail and answers the same payment each time,
 *   as a paid card page read back does; nothing leaves the process.
 * @usage cd aimeat && pnpm exec vitest run test/unit/checkout-stale-write.test.ts
 * @version-history
 *   2026-10-27 -- Initial (secaudit2026oct26, commerce/session-service:stale-session-write-reopens-consumed-payment).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { registerPaymentHandler } from '../../src/commerce/payment-handlers.js';
import { registerSellableResolver } from '../../src/commerce/sellable-resolvers.js';
import { cancelSession, completeSession, getSession, updateSessionItems } from '../../src/commerce/session-service.js';
import type { CheckoutSessionRecord, PaymentHandler } from '../../src/commerce/types.js';

const NODE = 'unit-stale-checkout';
const BUYER = `buyer@${NODE}`;
let storage: Storage;
let config: AimeatConfig;
let delivered = 0;

registerPaymentHandler({
  id: 'spy.same-payment', title: 'spy rail', currencies: ['EUR'],
  async collect() { return { trackingCode: 'spy_paid_once' }; },
  async payout() { /* the seller's leg is not under test */ },
  async refund() { return { outcome: 'refunded' }; },
} as unknown as PaymentHandler);

registerSellableResolver({
  kind: 'unit-good',
  async resolve() {
    return {
      kind: 'unit-good', agentGaii: `seller@${NODE}`, agentName: 'seller', offerId: 'good', title: 'A good thing',
      sellerOwner: 'seller', sellerGhii: `seller@${NODE}`, unitPrice: 1_000_000, tollMorsels: 0,
      async fulfill() { delivered++; return { delivered: true }; },
    };
  },
});

const LINE = { kind: 'unit-good', agent: `seller@${NODE}`, offerId: 'good', quantity: 1 };

async function stored(id: string): Promise<CheckoutSessionRecord> {
  const now = new Date();
  const session = {
    id, status: 'open', buyerOwner: 'buyer', buyerGhii: BUYER, buyerIdentity: BUYER,
    sellerOwner: 'seller', sellerGhii: `seller@${NODE}`,
    items: [{ kind: 'unit-good', agent: `seller@${NODE}`, offerId: 'good', title: 'A good thing', unitPrice: 1_000_000, quantity: 1, tollMorsels: 0 }],
    currency: 'EUR', total: 1_000_000,
    createdAt: now.toISOString(), updatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
  } as unknown as CheckoutSessionRecord;
  await storage.setMemory({
    key: `commerce.session.${id}`, ownerGaii: BUYER, value: session as unknown as Record<string, unknown>,
    visibility: 'owner', tags: ['commerce'], ttlHours: null, version: 1, createdAt: now.toISOString(), updatedAt: now.toISOString(),
  } as never);
  return session;
}

const codeOf = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code ?? 'error');

beforeEach(() => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  config = { ...loadConfig().config, nodeId: NODE, baseUrl: 'https://node.test' };
  delivered = 0;
});

describe('a checkout change based on a copy read before completion', () => {
  it('is refused: the completed session stays completed and the same payment does not deliver again', async () => {
    const stale = await stored('cs-stale');
    await completeSession(storage, config, { ...stale }, 'spy.same-payment', 'card');
    expect(delivered).toBe(1);
    expect(await codeOf(updateSessionItems(storage, config, { ...stale }, [LINE]))).toBe('SESSION_NOT_OPEN');
    expect(await codeOf(cancelSession(storage, { ...stale }))).toBe('SESSION_NOT_OPEN');
    const now = await getSession(storage, BUYER, 'cs-stale');
    expect(now?.status).toBe('completed');
    expect(await codeOf(completeSession(storage, config, now!, 'spy.same-payment', 'card'))).toBe('SESSION_NOT_OPEN');
    expect(delivered).toBe(1);
  });

  it('designed use: a change and a cancel on an open session, and a completion, work as before', async () => {
    const open = await stored('cs-open');
    const changed = await updateSessionItems(storage, config, open, [{ ...LINE, quantity: 2 }]);
    expect(changed.status).toBe('open');
    expect(changed.total).toBe(2_000_000);
    expect((await getSession(storage, BUYER, 'cs-open'))?.total).toBe(2_000_000);
    const done = await completeSession(storage, config, (await getSession(storage, BUYER, 'cs-open'))!, 'spy.same-payment', 'card');
    expect(done.status).toBe('completed');
    expect(delivered).toBe(1);
    const other = await stored('cs-cancel');
    const cancelled = await cancelSession(storage, other);
    expect(cancelled.status).toBe('cancelled');
    expect((await getSession(storage, BUYER, 'cs-cancel'))?.status).toBe('cancelled');
  });
});
