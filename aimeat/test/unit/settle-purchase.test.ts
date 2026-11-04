/**
 * @file test/unit/settle-purchase.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description settlePurchase (commerce/settle-purchase.ts) on an in-memory database: the purchase's
 *   last write and the sale's bookings commit together. A delivery write that fails leaves no fee and
 *   no beneficiary share; a tolerant booking that fails leaves nothing of its own and the purchase
 *   stays delivered; a strict one rolls the delivery back. settleSessionlessSale and
 *   bookSessionlessSale (commerce/session-service.ts) book the same fee and shares as before.
 * @usage cd aimeat && pnpm exec vitest run test/unit/settle-purchase.test.ts
 * @version-history
 *   2026-11-04 -- Initial (codebase analysis 2026-11-03, item B2).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { putSplit } from '../../src/commerce/beneficiary-split.js';
import { settlePurchase, PURCHASE_TRANSITIONS, type BookingStep } from '../../src/commerce/settle-purchase.js';
import { bookSessionlessSale, settleSessionlessSale } from '../../src/commerce/session-service.js';

const NODE = 'unit-settle';
const SELLER = `studio@${NODE}`;
const BUYER = `reader@${NODE}`;
const ARTIST = `artist@${NODE}`;
const EXT = 'studio-ext';
const config = { nodeId: NODE, commerceFeePercent: 10, operatorFeeAccount: 'operator', baseUrl: 'https://node.test' } as unknown as AimeatConfig;
let storage: Storage;

const now = () => new Date().toISOString();
const purchaseRecord = (status: string): MemoryRecord => ({
  key: 'purchase.p1', ownerGaii: SELLER, value: { status }, visibility: 'owner', tags: [], ttlHours: null,
  version: 1, createdAt: now(), updatedAt: now(),
} as MemoryRecord);
const statusOf = async () => ((await storage.getMemory(SELLER, 'purchase.p1'))?.value as { status?: string } | undefined)?.status;
const fees = async () => (await storage.listAllMemory({ prefix: 'commerce.platform-fee.', limit: 50 })).items;
const shares = async () => storage.listMemory(ARTIST, { prefix: 'commerce.benefit.' });

const fee = (trackingCode = 'tc1') => ({ kind: 'fee' as const, fee: 100_000, currency: 'EUR', sellerGhii: SELLER, buyerRef: BUYER, trackingCode, handler: 'test.money' });
const share = (trackingCode = 'a2a_tc1_read') => ({ kind: 'shares' as const, sellerGhii: SELLER, ext: EXT, action: 'read', net: 900_000, currency: 'EUR', trackingCode, buyerRef: BUYER, reference: 'ref-1' });
const tolerant = (books: BookingStep['books']): BookingStep => ({ books, tolerant: { message: 'unit: booking failed', context: { purchase: 'p1' } } });

beforeEach(async () => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  await putSplit(storage, {
    splitId: 's1', providerGhii: SELLER, ext: EXT, action: 'read', capabilityLabel: 'read', mode: 'pool', poolPercent: 50,
    beneficiaries: [{ ghii: ARTIST, weight: 1 }], roles: [], dynamic: false, state: 'active', createdAt: '', createdBy: SELLER, updatedAt: '',
  } as never);
  await storage.setMemory(purchaseRecord('paid'));
});

function failWritesTo(prefix: string): void {
  const setMemory = storage.setMemory.bind(storage);
  const setIfVersion = storage.setMemoryIfVersion.bind(storage);
  const createIfAbsent = storage.createMemoryIfAbsent.bind(storage);
  const s = storage as unknown as Record<string, unknown>;
  const refuse = (key: string) => { if (key.startsWith(prefix)) throw new Error(`refused ${key}`); };
  s.setMemory = async (r: MemoryRecord) => { refuse(r.key); return setMemory(r); };
  s.setMemoryIfVersion = async (r: MemoryRecord, v: number) => { refuse(r.key); return setIfVersion(r, v); };
  s.createMemoryIfAbsent = async (r: MemoryRecord) => { refuse(r.key); return createIfAbsent(r); };
}

describe('settlePurchase', () => {
  it('a delivery write that fails books nothing, and the error reaches the caller', async () => {
    const run = settlePurchase(storage, config, {
      from: 'paid',
      deliver: async () => { await storage.setMemory(purchaseRecord('delivered')); throw new Error('the last write failed'); },
      steps: [tolerant([fee(), share()])],
    });
    await expect(run).rejects.toThrow('the last write failed');
    expect(await fees()).toEqual([]);
    expect(await shares()).toEqual([]);
    expect(await statusOf()).toBe('paid');
  });

  it('designed use: the delivery and the bookings commit together', async () => {
    const out = await settlePurchase(storage, config, {
      from: 'paid',
      deliver: async () => { await storage.setMemory(purchaseRecord('delivered')); return 'written'; },
      steps: [tolerant([fee(), share()])],
    });
    expect(out.state).toBe('booked');
    expect(out.delivered).toBe('written');
    expect(out.steps).toEqual([{ ok: true, splits: [null, expect.objectContaining({ pool: 450_000 })] }]);
    expect(await statusOf()).toBe('delivered');
    expect((await fees()).map(r => [r.ownerGaii, (r.value as { fee: number }).fee])).toEqual([[`operator@${NODE}`, 100_000]]);
    const booked = await shares();
    expect(booked.length).toBe(1);
    expect((booked[0]!.value as { items: Array<Record<string, unknown>> }).items).toEqual([
      expect.objectContaining({ amount: 450_000, currency: 'EUR', fromGhii: SELLER, buyerGhii: BUYER, reference: 'ref-1', status: 'accrued' }),
    ]);
  });

  it('a tolerant booking that fails leaves nothing of its own; the delivery and the fee before it stay', async () => {
    failWritesTo('commerce.benefit.');
    const out = await settlePurchase(storage, config, {
      from: 'paid',
      deliver: async () => { await storage.setMemory(purchaseRecord('delivered')); },
      steps: [tolerant([fee(), share()]), tolerant([fee('tc2')])],
    });
    expect(out.steps).toEqual([{ ok: false }, { ok: true, splits: [null] }]);
    expect(await statusOf()).toBe('delivered');
    expect((await fees()).map(r => r.key).sort()).toEqual(['commerce.platform-fee.tc1', 'commerce.platform-fee.tc2']);
    expect(await shares()).toEqual([]);
  });

  it('a strict booking that fails rolls the delivery back and is thrown', async () => {
    failWritesTo('commerce.platform-fee.');
    const run = settlePurchase(storage, config, {
      from: 'paid',
      deliver: async () => { await storage.setMemory(purchaseRecord('delivered')); },
      steps: [{ books: [fee()] }],
    });
    await expect(run).rejects.toThrow('refused commerce.platform-fee.tc1');
    expect(await statusOf()).toBe('paid');
  });

  it('from delivered it books only; a fee needs the node configuration', async () => {
    const out = await settlePurchase(storage, null, { from: 'delivered', steps: [tolerant([share()])] });
    expect(out.state).toBe('booked');
    expect((await shares()).length).toBe(1);
    const noConfig = await settlePurchase(storage, null, { from: 'delivered', steps: [tolerant([fee()])] });
    expect(noConfig.steps).toEqual([{ ok: false }]);
    expect(await fees()).toEqual([]);
  });

  it('the states move only forward: booked and refunded are final', () => {
    expect(PURCHASE_TRANSITIONS.paid).toEqual(['delivered', 'refunded']);
    expect(PURCHASE_TRANSITIONS.booked).toEqual([]);
    expect(PURCHASE_TRANSITIONS.refunded).toEqual([]);
  });
});

describe('a sale without a checkout session', () => {
  const sale = { gross: 1_000_000, currency: 'EUR', sellerGhii: SELLER, buyerRef: BUYER, ext: EXT, action: 'read', trackingCode: 'tc9', handler: 'test.money', reference: 'ref-9' };

  it('settleSessionlessSale: a last write that fails books no fee and no share', async () => {
    await expect(settleSessionlessSale(storage, config, sale, async () => { throw new Error('the purchase record could not be written'); }))
      .rejects.toThrow('the purchase record could not be written');
    expect(await fees()).toEqual([]);
    expect(await shares()).toEqual([]);
  });

  it('designed use: bookSessionlessSale and settleSessionlessSale book the same fee and share, and answer the same amounts', async () => {
    expect(await bookSessionlessSale(storage, config, sale)).toEqual({ fee: 100_000, net: 900_000 });
    const settled = await settleSessionlessSale(storage, config, { ...sale, trackingCode: 'tc10' }, async () => 'done');
    expect(settled).toEqual({ fee: 100_000, net: 900_000, delivered: 'done' });
    expect((await fees()).map(r => (r.value as { fee: number }).fee)).toEqual([100_000, 100_000]);
    expect((await shares()).map(r => r.key).sort()).toEqual(['commerce.benefit.a2a_tc10_read', 'commerce.benefit.a2a_tc9_read']);
  });

  it('designed use: a morsel-priced sale books nothing and answers the gross as the net', async () => {
    expect(await bookSessionlessSale(storage, config, { ...sale, currency: 'morsel' })).toEqual({ fee: 0, net: 1_000_000 });
    expect(await fees()).toEqual([]);
  });

  it('bookSessionlessSale never throws: a failed booking is logged and the seller keeps the whole cut', async () => {
    failWritesTo('commerce.platform-fee.');
    expect(await bookSessionlessSale(storage, config, sale)).toEqual({ fee: 100_000, net: 900_000 });
    expect(await fees()).toEqual([]);
    expect(await shares()).toEqual([]);
  });
});
